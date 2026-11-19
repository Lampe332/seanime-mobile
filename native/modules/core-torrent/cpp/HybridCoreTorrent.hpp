// geschrieben nach: Plan „Eigener Kern" Stufe 6b-1 und der öffentlichen Doku von Nitro Modules (HybridObject in C++, Promise, Callback, ArrayBuffer); Aufbau wie modules/core-sandbox
#pragma once

#include <cmath>
#include <exception>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "HybridCoreTorrentSpec.hpp"
#include "TorrentCore.hpp"

namespace margelo::nitro::seanime::coretorrent {

  /**
   * The app's BitTorrent session for JavaScript, found under the name `CoreTorrent`. Thin: every method checks its
   * numbers, hands the work to the session's thread (TorrentCore) and answers from there.
   */
  class HybridCoreTorrent final : public HybridCoreTorrentSpec {
    using Core = ::seanime::torrent::TorrentCore;

  public:
    HybridCoreTorrent() : HybridObject(TAG), core_(Core::create()) {}
    // the app's JavaScript went away (reload): the session ends on its own thread, nobody waits
    ~HybridCoreTorrent() override { core_->quit(); }

    std::shared_ptr<Promise<void>> start(const CoreTorrentSettings& settings, const std::function<void(const std::vector<CoreTorrentStatus>& /* statuses */)>& onStatus) override {
      if (!whole(settings.listenPort) || !whole(settings.connections)) return failed<void>("the settings are out of range");
      ::seanime::torrent::Settings wanted;
      wanted.folder = settings.folder;
      wanted.listenPort = static_cast<int>(settings.listenPort);
      wanted.connections = static_cast<int>(settings.connections);
      wanted.dht = settings.dht;
      wanted.lsd = settings.lsd;
      wanted.trackers = settings.trackers;
      wanted.pex = settings.pex;
      wanted.portMapping = settings.portMapping;
      wanted.utp = settings.utp;
      // called on the session's thread; Nitro carries the call over to the app's thread
      Core::Tick tick = [onStatus](const std::vector<::seanime::torrent::Status>& all) {
        std::vector<CoreTorrentStatus> statuses;
        statuses.reserve(all.size());
        for (const auto& one : all) statuses.push_back(toStatus(one));
        onStatus(statuses);
      };
      return onThread<void>([wanted, tick](Core& core) { core.start(wanted, tick); });
    }

    std::shared_ptr<Promise<void>> stop() override {
      return onThread<void>([](Core& core) { core.stop(); });
    }

    std::shared_ptr<Promise<std::string>> addMagnet(const std::string& uri, const std::string& savePath) override {
      return onThread<std::string>([uri, savePath](Core& core) { return core.addMagnet(uri, savePath); });
    }

    std::shared_ptr<Promise<std::string>> addTorrentFile(const std::shared_ptr<ArrayBuffer>& bytes, const std::string& savePath) override {
      // JavaScript's bytes are only safe to read during this call: copied here (a .torrent file is small)
      const char* data = bytes ? reinterpret_cast<const char*>(bytes->data()) : nullptr;
      std::vector<char> copy = data ? std::vector<char>(data, data + bytes->size()) : std::vector<char>();
      return onThread<std::string>([copy = std::move(copy), savePath](Core& core) { return core.addTorrentFile(copy, savePath); });
    }

    std::shared_ptr<Promise<void>> remove(const std::string& infoHash, bool deleteFiles) override {
      auto promise = Promise<void>::create();
      std::shared_ptr<Core> core = core_;
      core_->post([promise, core, infoHash, deleteFiles]() {
        try {
          core->remove(infoHash, deleteFiles, [promise](const std::string& error) {
            if (error.empty()) promise->resolve();
            else promise->reject(failure(error));
          });
        } catch (const std::exception& error) {
          promise->reject(failure(error.what()));
        }
      });
      return promise;
    }

    std::shared_ptr<Promise<std::vector<CoreTorrentFile>>> files(const std::string& infoHash) override {
      return onThread<std::vector<CoreTorrentFile>>([infoHash](Core& core) {
        std::vector<CoreTorrentFile> list;
        for (const auto& file : core.files(infoHash)) {
          list.emplace_back(static_cast<double>(file.index), file.path, static_cast<double>(file.size), static_cast<double>(file.offset),
                            static_cast<double>(file.pieceStart), static_cast<double>(file.pieceEnd));
        }
        return list;
      });
    }

    std::shared_ptr<Promise<void>> setFilePriority(const std::string& infoHash, double index, double priority) override {
      if (!whole(index) || !whole(priority)) return failed<void>("the numbers are out of range");
      return onThread<void>([infoHash, index, priority](Core& core) { core.setFilePriority(infoHash, static_cast<int>(index), static_cast<int>(priority)); });
    }

    std::shared_ptr<Promise<void>> setSequential(const std::string& infoHash, bool on) override {
      return onThread<void>([infoHash, on](Core& core) { core.setSequential(infoHash, on); });
    }

    std::shared_ptr<Promise<void>> setPaused(const std::string& infoHash, bool paused) override {
      return onThread<void>([infoHash, paused](Core& core) { core.setPaused(infoHash, paused); });
    }

    std::shared_ptr<Promise<void>> setQueued(const std::string& infoHash, bool queued) override {
      return onThread<void>([infoHash, queued](Core& core) { core.setQueued(infoHash, queued); });
    }

    std::shared_ptr<Promise<void>> setLimits(const CoreTorrentLimits& limits) override {
      if (!whole(limits.downloadLimit) || !whole(limits.uploadLimit) || !whole(limits.activeDownloads)) return failed<void>("the limits are out of range");
      ::seanime::torrent::Limits wanted;
      wanted.downloadLimit = static_cast<int>(limits.downloadLimit);
      wanted.uploadLimit = static_cast<int>(limits.uploadLimit);
      wanted.activeDownloads = static_cast<int>(limits.activeDownloads);
      wanted.stopWhenFinished = limits.stopWhenFinished;
      return onThread<void>([wanted](Core& core) { core.setLimits(wanted); });
    }

    std::shared_ptr<Promise<void>> moveStorage(const std::string& infoHash, const std::string& savePath) override {
      auto promise = Promise<void>::create();
      std::shared_ptr<Core> core = core_;
      core_->post([promise, core, infoHash, savePath]() {
        try {
          core->moveStorage(infoHash, savePath, [promise](const std::string& error) {
            if (error.empty()) promise->resolve();
            else promise->reject(failure(error));
          });
        } catch (const std::exception& error) {
          promise->reject(failure(error.what()));
        }
      });
      return promise;
    }

    std::shared_ptr<Promise<void>> setPieceDeadlines(const std::string& infoHash, double firstPiece, double count, double firstMs, double stepMs) override {
      if (!whole(firstPiece) || !whole(count) || !whole(firstMs) || !whole(stepMs)) return failed<void>("the numbers are out of range");
      return onThread<void>([infoHash, firstPiece, count, firstMs, stepMs](Core& core) {
        core.setPieceDeadlines(infoHash, static_cast<int>(firstPiece), static_cast<int>(count), static_cast<int>(firstMs), static_cast<int>(stepMs));
      });
    }

    std::shared_ptr<Promise<void>> clearDeadlines(const std::string& infoHash) override {
      return onThread<void>([infoHash](Core& core) { core.clearDeadlines(infoHash); });
    }

    std::shared_ptr<Promise<CoreTorrentStatus>> status(const std::string& infoHash) override {
      return onThread<CoreTorrentStatus>([infoHash](Core& core) { return toStatus(core.status(infoHash)); });
    }

    std::shared_ptr<Promise<void>> connectPeer(const std::string& infoHash, const std::string& host, double port) override {
      if (!whole(port)) return failed<void>("the peer's port is out of range");
      return onThread<void>([infoHash, host, port](Core& core) { core.connectPeer(infoHash, host, static_cast<int>(port)); });
    }

    std::shared_ptr<Promise<std::string>> serve(const std::string& infoHash, double index) override {
      if (!whole(index)) return failed<std::string>("the file's index is out of range");
      return onThread<std::string>([infoHash, index](Core& core) { return core.serve(infoHash, static_cast<int>(index)); });
    }

    std::shared_ptr<Promise<std::string>> shareFile(const std::string& path, const std::string& toward) override {
      return onThread<std::string>([path, toward](Core& core) { return core.shareFile(path, toward); });
    }

    std::shared_ptr<Promise<std::string>> shareTorrent(const std::string& infoHash, double index, const std::string& toward) override {
      if (!whole(index)) return failed<std::string>("the file's index is out of range");
      return onThread<std::string>([infoHash, index, toward](Core& core) { return core.shareTorrent(infoHash, static_cast<int>(index), toward); });
    }

    std::shared_ptr<Promise<void>> unshare() override {
      return onThread<void>([](Core& core) { core.unshare(); });
    }

  private:
    /** A whole number an `int` holds without loss, and not negative */
    static bool whole(double number) {
      return std::isfinite(number) && number >= 0 && number <= 2000000000.0 && std::floor(number) == number;
    }

    static std::exception_ptr failure(const std::string& text) {
      return std::make_exception_ptr(std::runtime_error("ERR_TORRENT: " + text));
    }

    template <typename Result>
    static std::shared_ptr<Promise<Result>> failed(const std::string& text) {
      auto promise = Promise<Result>::create();
      promise->reject(failure(text));
      return promise;
    }

    static CoreTorrentStatus toStatus(const ::seanime::torrent::Status& status) {
      return CoreTorrentStatus(status.infoHash, status.name, status.state, status.error, status.hasMetadata, status.progress,
                               static_cast<double>(status.downRate), static_cast<double>(status.upRate), static_cast<double>(status.peers),
                               static_cast<double>(status.seeds), static_cast<double>(status.piecesHave), static_cast<double>(status.pieces),
                               static_cast<double>(status.bytesDone), static_cast<double>(status.bytesWanted), static_cast<double>(status.peersKnown),
                               static_cast<double>(status.dhtNodes), static_cast<double>(status.trackersOk), static_cast<double>(status.trackersFailed),
                               status.trackerError, static_cast<double>(status.webSeeds), static_cast<double>(status.queuePosition));
    }

    /** Runs `work` on the session's thread and answers the promise from there */
    template <typename Result, typename Work>
    std::shared_ptr<Promise<Result>> onThread(Work work) {
      auto promise = Promise<Result>::create();
      std::shared_ptr<Core> core = core_;
      core_->post([promise, core, work = std::move(work)]() {
        try {
          if constexpr (std::is_void_v<Result>) {
            work(*core);
            promise->resolve();
          } else {
            promise->resolve(work(*core));
          }
        } catch (const std::exception& error) {
          promise->reject(failure(error.what()));
        } catch (...) {
          promise->reject(failure("unknown failure"));
        }
      });
      return promise;
    }

    std::shared_ptr<Core> core_;
  };

} // namespace margelo::nitro::seanime::coretorrent
