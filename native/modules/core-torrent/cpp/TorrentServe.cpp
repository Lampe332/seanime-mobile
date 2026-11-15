// geschrieben nach: Plan „Eigener Kern" Stufe 6b-2, docs/EIGENER-KERN.md §4q (Skizze „Ausgang": Stücke lesen, auf fehlende warten, Fristen ab der gelesenen Stelle) und der öffentlichen Doku von libtorrent 2.1 (torrent_handle: read_piece, have_piece, set_piece_deadline mit alert_when_available, reset_piece_deadline; read_piece_alert); Phase 7b: Freigabe ins WLAN, `stat` nach POSIX; keine Vorlage
#include "TorrentCore.hpp"

#include <algorithm>
#include <iterator>
#include <stdexcept>

#include <sys/stat.h>

#include <libtorrent/download_priority.hpp>
#include <libtorrent/file_storage.hpp>
#include <libtorrent/torrent_info.hpp>

namespace lt = libtorrent;

/*
 * The session's side of the outlet (StreamServer): which reader waits for which piece, and which pieces are wanted soon.
 *
 * A reader reads its part of the file piece by piece. A piece the torrent has is read from the disk by libtorrent
 * (`read_piece`); one it does not have gets the deadline "now" with the wish to be handed over as soon as it is there.
 * Either way the bytes come back as a `read_piece_alert`. Behind the piece a reader reads, the next ones get deadlines
 * one after the other: that is the jump - a reader that starts in the middle of the file pulls the download there. A
 * reader that goes away takes its deadlines with it, unless another reader wants the same pieces.
 */

namespace seanime::torrent {

  namespace {

    /** This much of the file behind the piece a reader reads is wanted soon */
    constexpr std::int64_t AHEAD_BYTES = 8 * 1024 * 1024;
    constexpr int AHEAD_FEWEST = 4;
    constexpr int AHEAD_MOST = 32;
    /** Each piece further behind the read one may take this much longer */
    constexpr int AHEAD_STEP_MS = 250;

    int aheadOf(int pieceLength) {
      const std::int64_t length = std::max(1, pieceLength);
      return static_cast<int>(std::clamp<std::int64_t>((AHEAD_BYTES + length - 1) / length, AHEAD_FEWEST, AHEAD_MOST));
    }

    std::string nameOf(const std::string& path) {
      const std::size_t slash = path.find_last_of("/\\");
      return slash == std::string::npos ? path : path.substr(slash + 1);
    }

  } // namespace

  StreamServer& TorrentCore::outlet() {
    if (!server_) {
      // the outlet never keeps the session alive; work it hands over runs on the session's thread
      std::weak_ptr<TorrentCore> weak = weak_from_this();
      PieceSource source;
      source.want = [weak](std::uint64_t reader, const ServedFile& file, int piece, PieceDone done) {
        std::shared_ptr<TorrentCore> core = weak.lock();
        if (!core) {
          PieceData none;
          none.error = "the session is gone";
          done(std::move(none));
          return;
        }
        core->post([core, reader, file, piece, done = std::move(done)]() mutable { core->wantPiece(reader, file, piece, std::move(done)); });
      };
      source.gone = [weak](std::uint64_t reader) {
        if (std::shared_ptr<TorrentCore> core = weak.lock()) core->post([core, reader]() { core->readerGone(reader); });
      };
      server_ = StreamServer::open(std::move(source));
    }
    return *server_;
  }

  ServedFile TorrentCore::servedFile(const std::string& infoHash, int index) {
    Entry& found = entry(infoHash);
    std::shared_ptr<const lt::torrent_info> info = found.handle.torrent_file();
    if (!info) throw std::runtime_error("the torrent has no file list yet");
    const lt::file_storage& layout = info->layout();
    if (index < 0 || index >= layout.num_files() || layout.pad_file_at(lt::file_index_t{index})) throw std::runtime_error("the torrent has no such file");

    ServedFile file;
    file.infoHash = found.handle.is_valid() ? infoHash : "";
    std::transform(file.infoHash.begin(), file.infoHash.end(), file.infoHash.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    file.index = index;
    file.name = nameOf(layout.file_path(lt::file_index_t{index}));
    file.offset = layout.file_offset(lt::file_index_t{index});
    file.size = layout.file_size(lt::file_index_t{index});
    file.pieceLength = info->piece_length();
    found.pieces = info->num_pieces();
    if (found.handle.file_priority(lt::file_index_t{index}) == lt::dont_download) found.handle.file_priority(lt::file_index_t{index}, lt::default_priority);
    return file;
  }

  std::string TorrentCore::serve(const std::string& infoHash, int index) {
    const ServedFile file = servedFile(infoHash, index);
    return outlet().serve(file);
  }

  std::string TorrentCore::shareTorrent(const std::string& infoHash, int index, const std::string& toward) {
    const ServedFile file = servedFile(infoHash, index);
    return outlet().share(file, localAddress(toward));
  }

  std::string TorrentCore::shareFile(const std::string& path, const std::string& toward) {
    struct stat about {};
    if (path.empty() || path[0] != '/' || ::stat(path.c_str(), &about) != 0 || !S_ISREG(about.st_mode)) throw std::runtime_error("no such file");
    ServedFile file;
    file.path = path;
    file.name = nameOf(path);
    file.size = static_cast<std::int64_t>(about.st_size);
    return outlet().share(file, localAddress(toward));
  }

  void TorrentCore::unshare() {
    if (server_) server_->unshare();
  }

  void TorrentCore::wantPiece(std::uint64_t reader, const ServedFile& file, int piece, PieceDone done) {
    auto fail = [&done](const char* why) {
      PieceData none;
      none.error = why;
      done(std::move(none));
    };
    auto found = torrents_.find(file.infoHash);
    if (!session_ || found == torrents_.end()) return fail("the session has no such torrent");
    Entry& entry = found->second;
    if (piece < 0 || piece >= entry.pieces) return fail("the torrent has no such piece");
    const int last = std::min<std::int64_t>(entry.pieces - 1, (file.offset + std::max<std::int64_t>(file.size, 1) - 1) / std::max(1, file.pieceLength));

    Reader& at = readers_[reader];
    const Reader before = at;
    // a reader moves on piece by piece: what its window held already keeps its deadline, only the new end is added
    const bool movedOn = before.first >= 0 && before.infoHash == file.infoHash && piece >= before.first && piece <= before.end;
    at.infoHash = file.infoHash;
    at.first = piece;
    at.end = std::min(last + 1, piece + aheadOf(file.pieceLength));
    if (!movedOn && before.first >= 0) letGo(before);

    const PieceKey key{file.infoHash, piece};
    auto& waiting = awaited_[key];
    const bool first = waiting.empty();
    waiting.emplace_back(reader, std::move(done));
    if (first) {
      if (entry.handle.have_piece(lt::piece_index_t{piece})) {
        entry.handle.read_piece(lt::piece_index_t{piece});
      } else if (armed_.insert(key).second) {
        entry.handle.set_piece_deadline(lt::piece_index_t{piece}, 0, lt::torrent_handle::alert_when_available);
      }
    }

    for (int ahead = movedOn ? std::max(piece + 1, before.end) : piece + 1; ahead < at.end; ahead++) {
      // a piece somebody waits for has the deadline "now" already; setting it again would take its hand-over away
      if (armed_.count(PieceKey{file.infoHash, ahead})) continue;
      entry.handle.set_piece_deadline(lt::piece_index_t{ahead}, (ahead - piece) * AHEAD_STEP_MS);
    }
  }

  void TorrentCore::readerGone(std::uint64_t reader) {
    auto found = readers_.find(reader);
    if (found == readers_.end()) return;
    const Reader old = found->second;
    readers_.erase(found);
    for (auto waiting = awaited_.begin(); waiting != awaited_.end();) {
      auto& list = waiting->second;
      list.erase(std::remove_if(list.begin(), list.end(), [reader](const auto& one) { return one.first == reader; }), list.end());
      waiting = list.empty() ? awaited_.erase(waiting) : std::next(waiting);
    }
    letGo(old);
  }

  void TorrentCore::letGo(const Reader& old) {
    auto found = torrents_.find(old.infoHash);
    if (!session_ || found == torrents_.end() || old.first < 0) return;
    for (int piece = old.first; piece < old.end; piece++) {
      const PieceKey key{old.infoHash, piece};
      if (awaited_.count(key)) continue;
      const bool wanted = std::any_of(readers_.begin(), readers_.end(), [&old, piece](const auto& other) {
        return other.second.infoHash == old.infoHash && piece >= other.second.first && piece < other.second.end;
      });
      if (wanted) continue;
      // libtorrent answers a dropped hand-over with "cancelled": that answer belongs to nobody
      if (armed_.erase(key)) staleCancels_[key]++;
      found->second.handle.reset_piece_deadline(lt::piece_index_t{piece});
    }
  }

  void TorrentCore::pieceRead(const lt::torrent_handle& handle, int piece, PieceData data, bool cancelled) {
    std::string infoHash;
    for (const auto& [hash, entry] : torrents_) {
      if (entry.handle == handle) {
        infoHash = hash;
        break;
      }
    }
    if (infoHash.empty()) return;
    const PieceKey key{infoHash, piece};
    if (cancelled) {
      auto stale = staleCancels_.find(key);
      if (stale != staleCancels_.end()) {
        if (--stale->second <= 0) staleCancels_.erase(stale);
        return;
      }
    } else if (data.error.empty()) {
      // alerts come in order: every "cancelled" from before this piece was there has been seen
      staleCancels_.erase(key);
    }
    armed_.erase(key);
    auto waiting = awaited_.find(key);
    if (waiting == awaited_.end()) return;
    const auto list = std::move(waiting->second);
    awaited_.erase(waiting);
    for (const auto& [reader, done] : list) done(data);
  }

  void TorrentCore::askAgain(const std::string& infoHash, const lt::torrent_handle& handle) {
    for (const PieceKey& key : armed_) {
      if (key.first != infoHash) continue;
      staleCancels_[key]++;
      handle.set_piece_deadline(lt::piece_index_t{key.second}, 0, lt::torrent_handle::alert_when_available);
    }
  }

  void TorrentCore::failReaders(const std::string& infoHash, const char* why) {
    const auto mine = [&infoHash](const std::string& hash) { return infoHash.empty() || hash == infoHash; };
    for (auto waiting = awaited_.begin(); waiting != awaited_.end();) {
      if (!mine(waiting->first.first)) {
        ++waiting;
        continue;
      }
      PieceData none;
      none.error = why;
      for (const auto& [reader, done] : waiting->second) done(none);
      waiting = awaited_.erase(waiting);
    }
    for (auto reader = readers_.begin(); reader != readers_.end();) reader = mine(reader->second.infoHash) ? readers_.erase(reader) : std::next(reader);
    for (auto key = armed_.begin(); key != armed_.end();) key = mine(key->first) ? armed_.erase(key) : std::next(key);
    for (auto key = staleCancels_.begin(); key != staleCancels_.end();) key = mine(key->first.first) ? staleCancels_.erase(key) : std::next(key);
    if (server_ && !infoHash.empty()) server_->forget(infoHash);
  }

  void TorrentCore::endServing() {
    failReaders("", "the session stopped");
    if (!server_) return;
    // plain files shared into the network (phase 7b) need no session: the outlet stays for them
    if (server_->sharing()) {
      server_->forgetTorrents();
      return;
    }
    server_->close();
    server_.reset();
  }

} // namespace seanime::torrent
