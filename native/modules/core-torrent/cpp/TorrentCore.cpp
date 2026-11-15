// geschrieben nach: Plan „Eigener Kern" Stufe 6b-1, docs/EIGENER-KERN.md §4q und der öffentlichen Doku von libtorrent 2.1 (session, session_params, torrent_handle, torrent_status, alerts, session statistics, resume data, pread_disk_io, session_handle::native_handle) und von BoringSSL (x509.h); keine Vorlage
#include "TorrentCore.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <thread>
#include <utility>

#include <libtorrent/address.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/aux_/session_impl.hpp>
#include <libtorrent/download_priority.hpp>
#include <libtorrent/error_code.hpp>
#include <libtorrent/file_storage.hpp>
#include <libtorrent/load_torrent.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/peer_info.hpp>
#include <libtorrent/pex_flags.hpp>
#include <libtorrent/pread_disk_io.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/session_params.hpp>
#include <libtorrent/session_stats.hpp>
#include <libtorrent/settings_pack.hpp>
#include <libtorrent/socket.hpp>
#include <libtorrent/torrent_flags.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/write_resume_data.hpp>

namespace lt = libtorrent;
namespace fs = std::filesystem;

namespace seanime::torrent {

  namespace {

    using Clock = std::chrono::steady_clock;

    /** The status goes out this often */
    constexpr auto TICK = std::chrono::seconds(1);
    /** Resume data of torrents that changed is written every this many ticks */
    constexpr std::uint64_t SAVE_EVERY_TICKS = 30;
    /** Stopping waits this long for the resume data of the torrents */
    constexpr auto STOP_PATIENCE = std::chrono::seconds(5);
    /** A removal the disk thread never answers ends with an error after this long */
    constexpr auto REMOVAL_PATIENCE = std::chrono::seconds(20);

    std::string hex(const lt::sha1_hash& hash) {
      std::ostringstream out;
      out << hash;
      return out.str();
    }

    std::string lower(std::string text) {
      std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      return text;
    }

    std::vector<char> readFile(const fs::path& path) {
      std::ifstream in(path, std::ios::binary);
      if (!in) return {};
      return std::vector<char>((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    }

    /** Written beside the file and moved over it, so a cut-off write never leaves half a file */
    bool writeFile(const fs::path& path, const std::vector<char>& bytes) {
      fs::path part = path;
      part += ".part";
      {
        std::ofstream out(part, std::ios::binary | std::ios::trunc);
        if (!out) return false;
        out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!out) return false;
      }
      std::error_code failed;
      fs::rename(part, path, failed);
      return !failed;
    }

    fs::path resumeFile(const Settings& settings, const std::string& infoHash) {
      return fs::path(settings.folder) / "resume" / (infoHash + ".resume");
    }

    void setFlag(lt::torrent_flags_t& flags, lt::torrent_flags_t flag, bool on) {
      if (on) flags |= flag;
      else flags &= ~flag;
    }

    /**
     * TLS (HTTPS trackers, HTTPS web seeds) checks certificates against the system's authorities. Android keeps one
     * file per authority, under names BoringSSL's folder lookup does not find (the old subject hash): they are put
     * together into one file in the session's folder, and the answer is that file ("": none). The session's own TLS
     * context loads it (see start); the process environment (SSL_CERT_FILE) stays untouched. Elsewhere nothing happens
     * (libtorrent looks in the usual places itself).
     */
    std::string systemCertificates(const fs::path& folder) {
#if defined(__ANDROID__)
      std::vector<char> bundle;
      for (const char* place : {"/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"}) {
        try {
          for (const auto& file : fs::directory_iterator(place)) {
            std::vector<char> one = readFile(file.path());
            bundle.insert(bundle.end(), one.begin(), one.end());
            bundle.push_back('\n');
          }
        } catch (...) {
          // a folder this system does not have, or one that cannot be read
        }
        if (!bundle.empty()) break;
      }
      if (bundle.empty()) return "";
      const std::string file = (folder / "ca-bundle.pem").string();
      return writeFile(file, bundle) ? file : "";
#else
      (void)folder;
      return "";
#endif
    }

    const char* stateName(const lt::torrent_status& status) {
      if (status.flags & lt::torrent_flags::paused) return "paused";
      switch (status.state) {
        case lt::torrent_status::checking_files:
        case lt::torrent_status::checking_resume_data: return "checking";
        case lt::torrent_status::downloading_metadata: return "metadata";
        case lt::torrent_status::downloading: return "downloading";
        case lt::torrent_status::finished: return "finished";
        case lt::torrent_status::seeding: return "seeding";
        default: return "checking";
      }
    }

  } // namespace

  std::shared_ptr<TorrentCore> TorrentCore::create() {
    std::shared_ptr<TorrentCore> core(new TorrentCore());
    // the thread holds the core, so it outlives whoever lets go of it without `quit`
    std::thread([core]() { core->loop(); }).detach();
    return core;
  }

  void TorrentCore::post(std::function<void()> work) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      work_.push_back(std::move(work));
    }
    wake_.notify_one();
  }

  void TorrentCore::quit() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      quit_ = true;
    }
    wake_.notify_one();
  }

  void TorrentCore::loop() {
    auto nextTick = Clock::now() + TICK;
    for (;;) {
      std::deque<std::function<void()>> work;
      bool quit = false;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        auto ready = [this]() { return !work_.empty() || alerts_ || quit_; };
        // without a session nothing happens by itself: sleep until someone asks
        if (session_) wake_.wait_until(lock, nextTick, ready);
        else wake_.wait(lock, ready);
        work.swap(work_);
        alerts_ = false;
        quit = quit_;
      }
      for (auto& piece : work) {
        try {
          piece();
        } catch (...) {
          // work answers for itself; nothing may end the thread
        }
      }
      try {
        if (session_) handleAlerts();
        if (quit) {
          stop();
          return;
        }
        auto now = Clock::now();
        if (now >= nextTick) {
          nextTick = now + TICK;
          if (session_) tick();
        }
      } catch (...) {
      }
    }
  }

  void TorrentCore::start(const Settings& settings, Tick tick) {
    if (session_) throw std::runtime_error("the session is running already");
    if (settings.folder.empty()) throw std::runtime_error("the session needs a folder");
    if (settings.listenPort < 0 || settings.listenPort > 65535) throw std::runtime_error("the port is out of range");
    std::error_code failed;
    fs::create_directories(fs::path(settings.folder) / "resume", failed);
    if (failed) throw std::runtime_error("the session's folder cannot be made: " + failed.message());

    lt::session_params params;
    std::vector<char> state = readFile(fs::path(settings.folder) / "session.state");
    if (!state.empty()) {
      try {
        params = lt::read_session_params(lt::span<char const>(state.data(), static_cast<std::ptrdiff_t>(state.size())));
      } catch (...) {
        params = lt::session_params();
      }
    }
    lt::settings_pack& pack = params.settings;
    pack.set_int(lt::settings_pack::alert_mask, lt::alert_category::status | lt::alert_category::error | lt::alert_category::storage | lt::alert_category::tracker);
    std::string port = std::to_string(settings.listenPort);
    pack.set_str(lt::settings_pack::listen_interfaces, "0.0.0.0:" + port + ",[::]:" + port);
    pack.set_int(lt::settings_pack::connections_limit, std::max(2, settings.connections));
    pack.set_bool(lt::settings_pack::enable_dht, settings.dht);
    pack.set_bool(lt::settings_pack::enable_lsd, settings.lsd);
    pack.set_bool(lt::settings_pack::enable_upnp, settings.portMapping);
    pack.set_bool(lt::settings_pack::enable_natpmp, settings.portMapping);
    pack.set_bool(lt::settings_pack::enable_outgoing_utp, settings.utp);
    pack.set_bool(lt::settings_pack::enable_incoming_utp, settings.utp);
    // plain read/write calls instead of memory mapped files (§4q: mapped files count as the app's memory on Android)
    params.disk_io_constructor = lt::pread_disk_io_constructor;

    settings_ = settings;
    tick_ = std::move(tick);
    ticks_ = 0;
    savesOut_ = 0;
    dhtNodes_ = 0;
    dhtNodesAt_ = lt::find_metric_idx("dht.dht_nodes");
    const std::string authorities = systemCertificates(fs::path(settings.folder));
    session_ = std::make_unique<lt::session>(std::move(params));
    // libtorrent has no setting for the authorities of its HTTPS trackers and web seeds; its TLS context (the
    // session's, reached through native_handle) takes the file directly. Before any torrent is added, so before any
    // HTTPS connection; BoringSSL's certificate store locks itself against the session's thread.
    if (!authorities.empty()) {
      lt::error_code ec;
      // public through the session's interface (session_impl itself keeps the override private)
      lt::aux::session_interface& session = *session_->native_handle();
      session.ssl_ctx()->load_verify_file(authorities, ec);
      // a file that cannot be read shows later as a certificate error of the tracker (`trackerError`)
      (void)ec;
    }
    // called by libtorrent's own thread: only wakes this one
    session_->set_alert_notify([this]() {
      {
        std::lock_guard<std::mutex> lock(mutex_);
        alerts_ = true;
      }
      wake_.notify_one();
    });

    // the torrents of the last session
    for (const auto& file : fs::directory_iterator(fs::path(settings.folder) / "resume", failed)) {
      if (file.path().extension() != ".resume") continue;
      std::vector<char> bytes = readFile(file.path());
      lt::error_code error;
      lt::add_torrent_params resume = lt::read_resume_data(lt::span<char const>(bytes.data(), static_cast<std::ptrdiff_t>(bytes.size())), error);
      if (error) continue;
      applyFlags(resume, true);
      lt::torrent_handle handle = session_->add_torrent(std::move(resume), error);
      if (error || !handle.is_valid()) continue;
      torrents_[hex(handle.info_hashes().get_best())] = Entry{handle};
    }
  }

  void TorrentCore::stop() {
    if (!session_) return;
    // the outlet first: its readers are cut off before the torrents go
    endServing();
    session_->pause();
    savesOut_ = 0;
    for (auto& [infoHash, entry] : torrents_) {
      if (entry.handle.is_valid()) requestSave(entry.handle);
    }
    auto until = Clock::now() + STOP_PATIENCE;
    while (savesOut_ > 0 && Clock::now() < until) {
      session_->wait_for_alert(std::chrono::milliseconds(200));
      handleAlerts();
    }
    writeFile(fs::path(settings_.folder) / "session.state", lt::write_session_params_buf(session_->session_state()));

    for (auto& [infoHash, removal] : removals_) {
      if (removal.done) removal.done("the session stopped");
    }
    removals_.clear();
    torrents_.clear();
    tick_ = nullptr;
    session_->set_alert_notify([]() {});
    // the proxy's end waits for libtorrent's threads; the session object goes first
    lt::session_proxy rest = session_->abort();
    session_.reset();
  }

  void TorrentCore::applyFlags(lt::add_torrent_params& params, bool keepPaused) const {
    // no queue: a torrent the app adds runs, one the user paused (phase 6f) stays paused after a restart
    const bool paused = keepPaused && (params.flags & lt::torrent_flags::paused);
    params.flags &= ~(lt::torrent_flags::auto_managed | lt::torrent_flags::paused);
    if (paused) params.flags |= lt::torrent_flags::paused;
    setFlag(params.flags, lt::torrent_flags::disable_dht, !settings_.dht);
    setFlag(params.flags, lt::torrent_flags::disable_lsd, !settings_.lsd);
    setFlag(params.flags, lt::torrent_flags::disable_pex, !settings_.pex);
    if (!settings_.trackers) {
      params.trackers.clear();
      params.tracker_tiers.clear();
    }
  }

  std::string TorrentCore::add(lt::add_torrent_params params, const std::string& savePath) {
    if (!session_) throw std::runtime_error("no session is running");
    if (savePath.empty()) throw std::runtime_error("a torrent needs a folder to be saved to");
    std::string infoHash = hex(params.ti ? params.ti->info_hashes().get_best() : params.info_hashes.get_best());
    if (torrents_.count(infoHash)) return infoHash;
    params.save_path = savePath;
    applyFlags(params);
    lt::error_code error;
    lt::torrent_handle handle = session_->add_torrent(std::move(params), error);
    if (error) throw std::runtime_error("the torrent cannot be added: " + error.message());
    torrents_[infoHash] = Entry{handle};
    return infoHash;
  }

  std::string TorrentCore::addMagnet(const std::string& uri, const std::string& savePath) {
    lt::error_code error;
    lt::add_torrent_params params = lt::parse_magnet_uri(uri, error);
    if (error) throw std::runtime_error("the magnet link cannot be read: " + error.message());
    return add(std::move(params), savePath);
  }

  std::string TorrentCore::addTorrentFile(const std::vector<char>& bytes, const std::string& savePath) {
    lt::add_torrent_params params;
    try {
      params = lt::load_torrent_buffer(lt::span<char const>(bytes.data(), static_cast<std::ptrdiff_t>(bytes.size())));
    } catch (const std::exception& failure) {
      throw std::runtime_error(std::string("the torrent file cannot be read: ") + failure.what());
    }
    return add(std::move(params), savePath);
  }

  TorrentCore::Entry& TorrentCore::entry(const std::string& infoHash) {
    if (!session_) throw std::runtime_error("no session is running");
    auto found = torrents_.find(lower(infoHash));
    if (found == torrents_.end()) throw std::runtime_error("the session has no such torrent");
    return found->second;
  }

  void TorrentCore::remove(const std::string& infoHash, bool deleteFiles, Done done) {
    Entry& found = entry(infoHash);
    std::string key = lower(infoHash);
    lt::torrent_handle handle = found.handle;
    failReaders(key, "the torrent was removed");
    torrents_.erase(key);
    std::error_code ignored;
    fs::remove(resumeFile(settings_, key), ignored);
    // A magnet link without its file list has no files yet, and libtorrent answers a request to delete them with
    // "could not be deleted": such a torrent is only taken out of the session, which is all there is of it.
    bool hasFiles = false;
    try {
      hasFiles = handle.status(lt::status_flags_t{}).has_metadata;
    } catch (...) {
    }
    const bool withFiles = deleteFiles && hasFiles;
    removals_[key] = Removal{withFiles, std::move(done), Clock::now()};
    session_->remove_torrent(handle, withFiles ? lt::session::delete_files : lt::remove_flags_t{});
  }

  void TorrentCore::finishRemoval(const std::string& infoHash, bool deleted, const std::string& error) {
    auto found = removals_.find(infoHash);
    if (found == removals_.end()) return;
    // with files to delete, the answer is the disk thread's, not the session's
    if (found->second.deleteFiles && !deleted) return;
    Done done = std::move(found->second.done);
    removals_.erase(found);
    if (done) done(error);
  }

  TorrentCore::Entry* TorrentCore::entryOf(const lt::torrent_handle& handle) {
    try {
      if (!handle.is_valid()) return nullptr;
      auto found = torrents_.find(hex(handle.info_hashes().get_best()));
      return found == torrents_.end() ? nullptr : &found->second;
    } catch (...) {
      return nullptr;
    }
  }

  std::vector<FileEntry> TorrentCore::files(const std::string& infoHash) {
    Entry& found = entry(infoHash);
    std::shared_ptr<const lt::torrent_info> info = found.handle.torrent_file();
    if (!info) throw std::runtime_error("the torrent has no file list yet");
    const lt::file_storage& layout = info->layout();
    const std::int64_t pieceLength = info->piece_length();
    std::vector<FileEntry> list;
    for (lt::file_index_t index : layout.file_range()) {
      if (layout.pad_file_at(index)) continue;
      FileEntry file;
      file.index = static_cast<int>(index);
      file.path = layout.file_path(index);
      file.size = layout.file_size(index);
      file.offset = layout.file_offset(index);
      file.pieceStart = static_cast<int>(file.offset / pieceLength);
      file.pieceEnd = file.size > 0 ? static_cast<int>((file.offset + file.size - 1) / pieceLength) : file.pieceStart;
      list.push_back(std::move(file));
    }
    return list;
  }

  void TorrentCore::setFilePriority(const std::string& infoHash, int index, int priority) {
    Entry& found = entry(infoHash);
    std::shared_ptr<const lt::torrent_info> info = found.handle.torrent_file();
    if (!info) throw std::runtime_error("the torrent has no file list yet");
    if (index < 0 || index >= info->layout().num_files()) throw std::runtime_error("the torrent has no such file");
    if (priority < 0 || priority > 7) throw std::runtime_error("the priority is out of range");
    found.handle.file_priority(lt::file_index_t{index}, lt::download_priority_t{static_cast<std::uint8_t>(priority)});
  }

  void TorrentCore::setSequential(const std::string& infoHash, bool on) {
    Entry& found = entry(infoHash);
    if (on) found.handle.set_flags(lt::torrent_flags::sequential_download);
    else found.handle.unset_flags(lt::torrent_flags::sequential_download);
  }

  void TorrentCore::setPaused(const std::string& infoHash, bool paused) {
    Entry& found = entry(infoHash);
    // not auto-managed (applyFlags), so the state is the user's until changed again
    if (paused) found.handle.pause();
    else found.handle.resume();
    requestSave(found.handle);
  }

  void TorrentCore::setPieceDeadlines(const std::string& infoHash, int firstPiece, int count, int firstMs, int stepMs) {
    Entry& found = entry(infoHash);
    std::shared_ptr<const lt::torrent_info> info = found.handle.torrent_file();
    if (!info) throw std::runtime_error("the torrent has no file list yet");
    if (firstPiece < 0 || count < 0 || firstMs < 0 || stepMs < 0) throw std::runtime_error("the deadlines are out of range");
    const int end = std::min(info->num_pieces(), firstPiece + std::min(count, info->num_pieces()));
    const std::string key = lower(infoHash);
    for (int piece = firstPiece; piece < end; piece++) {
      // a piece a reader of the outlet waits for is wanted "now" already and keeps its hand-over (TorrentServe.cpp)
      if (armed_.count(PieceKey{key, piece})) continue;
      found.handle.set_piece_deadline(lt::piece_index_t{piece}, firstMs + (piece - firstPiece) * stepMs);
    }
  }

  void TorrentCore::clearDeadlines(const std::string& infoHash) {
    Entry& found = entry(infoHash);
    found.handle.clear_piece_deadlines();
    askAgain(lower(infoHash), found.handle);
  }

  Status TorrentCore::statusOf(const std::string& infoHash, Entry& found) {
    lt::torrent_status status = found.handle.status(lt::torrent_handle::query_name);
    if (found.pieces == 0 && status.has_metadata) {
      if (std::shared_ptr<const lt::torrent_info> info = found.handle.torrent_file()) found.pieces = info->num_pieces();
    }
    Status out;
    out.infoHash = infoHash;
    out.name = status.name;
    out.state = stateName(status);
    out.error = status.errc ? status.errc.message() : "";
    out.hasMetadata = status.has_metadata;
    out.progress = status.progress_ppm / 1000000.0;
    out.downRate = status.download_payload_rate;
    out.upRate = status.upload_payload_rate;
    out.peers = status.num_peers;
    out.seeds = status.num_seeds;
    out.piecesHave = status.num_pieces;
    out.pieces = found.pieces;
    out.bytesDone = status.total_wanted_done;
    out.bytesWanted = status.total_wanted;
    out.peersKnown = status.list_peers;
    out.dhtNodes = dhtNodes_;
    out.trackersOk = found.trackersOk;
    out.trackersFailed = found.trackersFailed;
    out.trackerError = found.trackerError;
    out.webSeeds = static_cast<int>(found.handle.url_seeds().size());
    return out;
  }

  Status TorrentCore::status(const std::string& infoHash) {
    return statusOf(lower(infoHash), entry(infoHash));
  }

  void TorrentCore::connectPeer(const std::string& infoHash, const std::string& host, int port) {
    Entry& found = entry(infoHash);
    if (port < 1 || port > 65535) throw std::runtime_error("the peer's port is out of range");
    lt::error_code error;
    lt::address address = lt::make_address(host, error);
    if (error) throw std::runtime_error("the peer's address is no IP address");
    // no flags: plain TCP, and no encrypted handshake is tried first
    found.handle.connect_peer(lt::tcp::endpoint(address, static_cast<std::uint16_t>(port)), lt::peer_source_flags_t{}, lt::pex_flags_t{});
  }

  void TorrentCore::requestSave(const lt::torrent_handle& handle) {
    handle.save_resume_data(lt::torrent_handle::save_info_dict);
    savesOut_++;
  }

  void TorrentCore::writeResume(const lt::add_torrent_params& params) {
    std::string infoHash = hex(params.info_hashes.get_best());
    // a torrent removed meanwhile gets no resume data back
    if (!torrents_.count(infoHash)) return;
    writeFile(resumeFile(settings_, infoHash), lt::write_resume_data_buf(params));
  }

  void TorrentCore::handleAlerts() {
    std::vector<lt::alert*> alerts;
    session_->pop_alerts(&alerts);
    for (lt::alert* alert : alerts) {
      if (auto* saved = lt::alert_cast<lt::save_resume_data_alert>(alert)) {
        if (savesOut_ > 0) savesOut_--;
        writeResume(saved->params);
      } else if (lt::alert_cast<lt::save_resume_data_failed_alert>(alert)) {
        if (savesOut_ > 0) savesOut_--;
      } else if (auto* metadata = lt::alert_cast<lt::metadata_received_alert>(alert)) {
        if (metadata->handle.is_valid()) requestSave(metadata->handle);
      } else if (auto* finished = lt::alert_cast<lt::torrent_finished_alert>(alert)) {
        if (finished->handle.is_valid()) requestSave(finished->handle);
      } else if (auto* removed = lt::alert_cast<lt::torrent_removed_alert>(alert)) {
        finishRemoval(hex(removed->info_hashes.get_best()), false, "");
      } else if (auto* deleted = lt::alert_cast<lt::torrent_deleted_alert>(alert)) {
        finishRemoval(hex(deleted->info_hashes.get_best()), true, "");
      } else if (auto* read = lt::alert_cast<lt::read_piece_alert>(alert)) {
        // a piece for a reader of the outlet (TorrentServe.cpp)
        PieceData data;
        data.bytes = read->buffer;
        data.size = read->size;
        if (read->error) data.error = read->error.message();
        pieceRead(read->handle, static_cast<int>(read->piece), std::move(data), read->error == boost::system::errc::operation_canceled);
      } else if (auto* stats = lt::alert_cast<lt::session_stats_alert>(alert)) {
        const auto counters = stats->counters();
        if (dhtNodesAt_ >= 0 && dhtNodesAt_ < static_cast<int>(counters.size())) dhtNodes_ = static_cast<int>(counters[dhtNodesAt_]);
      } else if (auto* answered = lt::alert_cast<lt::tracker_reply_alert>(alert)) {
        if (Entry* found = entryOf(answered->handle)) found->trackersOk++;
      } else if (auto* refused = lt::alert_cast<lt::tracker_error_alert>(alert)) {
        if (Entry* found = entryOf(refused->handle)) {
          found->trackersFailed++;
          found->trackerError = refused->error ? refused->error.message() : std::string(refused->error_message());
        }
      } else if (auto* failed = lt::alert_cast<lt::torrent_delete_failed_alert>(alert)) {
        finishRemoval(hex(failed->info_hashes.get_best()), true, "the files cannot be deleted: " + failed->error.message());
      }
    }
  }

  void TorrentCore::tick() {
    ticks_++;
    // the DHT's node count comes back as an alert, for the next status
    session_->post_session_stats();
    std::vector<Status> all;
    all.reserve(torrents_.size());
    for (auto& [infoHash, found] : torrents_) {
      try {
        all.push_back(statusOf(infoHash, found));
        if (ticks_ % SAVE_EVERY_TICKS == 0 && found.handle.need_save_resume_data()) requestSave(found.handle);
      } catch (...) {
        // a handle libtorrent has let go of meanwhile: left out
      }
    }
    if (!all.empty() && tick_) tick_(all);

    auto now = Clock::now();
    for (auto pending = removals_.begin(); pending != removals_.end();) {
      if (now - pending->second.since < REMOVAL_PATIENCE) {
        ++pending;
        continue;
      }
      Done done = std::move(pending->second.done);
      pending = removals_.erase(pending);
      if (done) done("the removal got no answer");
    }
  }

} // namespace seanime::torrent
