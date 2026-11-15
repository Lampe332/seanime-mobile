// geschrieben nach: Plan „Eigener Kern" Stufe 6b-1, docs/EIGENER-KERN.md §4q und der öffentlichen Doku von libtorrent 2.1 (session, torrent_handle, alerts, resume data); keine Vorlage
#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/session.hpp>
#include <libtorrent/torrent_handle.hpp>

#include "StreamServer.hpp"

namespace seanime::torrent {

  struct Settings {
    std::string folder;
    int listenPort = 0;
    int connections = 60;
    bool dht = true;
    bool lsd = true;
    bool trackers = true;
    bool pex = true;
    bool portMapping = true;
    bool utp = true;
  };

  struct FileEntry {
    int index = 0;
    std::string path;
    std::int64_t size = 0;
    std::int64_t offset = 0;
    int pieceStart = 0;
    int pieceEnd = 0;
  };

  struct Status {
    std::string infoHash;
    std::string name;
    std::string state;
    std::string error;
    bool hasMetadata = false;
    double progress = 0;
    int downRate = 0;
    int upRate = 0;
    int peers = 0;
    int seeds = 0;
    int piecesHave = 0;
    int pieces = 0;
    std::int64_t bytesDone = 0;
    std::int64_t bytesWanted = 0;
    /** Peers the torrent knows of, connected or not */
    int peersKnown = 0;
    /** Nodes in the DHT's routing table (the whole session) */
    int dhtNodes = 0;
    /** Announces to trackers since the torrent was added: answered, failed, and the last failure's text */
    int trackersOk = 0;
    int trackersFailed = 0;
    std::string trackerError;
    /** Web seed addresses the torrent has */
    int webSeeds = 0;
  };

  /**
   * The app's one BitTorrent session around libtorrent, platform neutral: C++ standard library and libtorrent only.
   *
   * One thread of its own does everything: it runs the work handed to `post` in order, reads libtorrent's alerts and
   * sends the status of every torrent once per second. libtorrent's own threads (network, disk) sit behind it. Every
   * member function except `create`, `post` and `quit` is for that thread only, so for work handed to `post`; they
   * throw std::runtime_error with a text for the app.
   */
  class TorrentCore final : public std::enable_shared_from_this<TorrentCore> {
  public:
    using Tick = std::function<void(const std::vector<Status>&)>;
    /** `error` is "" when it went well */
    using Done = std::function<void(const std::string& error)>;

    /** Starts the thread; it lives until `quit` */
    static std::shared_ptr<TorrentCore> create();
    /** From any thread: work for the session's thread. What it throws is lost: catch inside. */
    void post(std::function<void()> work);
    /** From any thread: ends the session (as `stop`) and the thread, without waiting for either */
    void quit();

    void start(const Settings& settings, Tick tick);
    void stop();
    std::string addMagnet(const std::string& uri, const std::string& savePath);
    std::string addTorrentFile(const std::vector<char>& bytes, const std::string& savePath);
    /** `done` is called on the session's thread, when the torrent (with `deleteFiles`: its files) is gone */
    void remove(const std::string& infoHash, bool deleteFiles, Done done);
    std::vector<FileEntry> files(const std::string& infoHash);
    void setFilePriority(const std::string& infoHash, int index, int priority);
    void setSequential(const std::string& infoHash, bool on);
    /** Pauses or resumes one torrent; the state goes into its resume data at once, so it survives a restart */
    void setPaused(const std::string& infoHash, bool paused);
    void setPieceDeadlines(const std::string& infoHash, int firstPiece, int count, int firstMs, int stepMs);
    void clearDeadlines(const std::string& infoHash);
    Status status(const std::string& infoHash);
    void connectPeer(const std::string& infoHash, const std::string& host, int port);
    /**
     * The address one file of a torrent is served at for the app's player (StreamServer.hpp); the outlet starts with the
     * first call and ends with the session. A file that was not wanted yet is loaded from now on.
     */
    std::string serve(const std::string& infoHash, int index);
    /**
     * Phase 7b: shares one file into the local network for a TV (StreamServer::share), at the device's address toward
     * `toward` (the receiver's IPv4 address, "" for the Wi-Fi's). A plain file of the app's storage needs no session.
     */
    std::string shareFile(const std::string& path, const std::string& toward);
    std::string shareTorrent(const std::string& infoHash, int index, const std::string& toward);
    /** Every share into the network ends */
    void unshare();

  private:
    /** Where one reader of the outlet is: the pieces [first, end) are wanted soon */
    struct Reader {
      std::string infoHash;
      int first = -1;
      int end = -1;
    };
    using PieceKey = std::pair<std::string, int>;
    using PieceDone = std::function<void(PieceData)>;

    // the outlet's side (TorrentServe.cpp), all on the session's thread
    void wantPiece(std::uint64_t reader, const ServedFile& file, int piece, PieceDone done);
    void readerGone(std::uint64_t reader);
    void letGo(const Reader& old);
    void pieceRead(const libtorrent::torrent_handle& handle, int piece, PieceData data, bool cancelled);
    /** After libtorrent dropped every deadline of a torrent: the pieces readers wait for are asked for again */
    void askAgain(const std::string& infoHash, const libtorrent::torrent_handle& handle);
    /** Every reader of this torrent ("" for all) fails and is forgotten */
    void failReaders(const std::string& infoHash, const char* why);
    void endServing();
    /** The outlet, opened when it is first needed */
    StreamServer& outlet();
    ServedFile servedFile(const std::string& infoHash, int index);
    struct Entry {
      libtorrent::torrent_handle handle;
      /** All pieces, 0 until the metadata is there */
      int pieces = 0;
      int trackersOk = 0;
      int trackersFailed = 0;
      std::string trackerError;
    };
    struct Removal {
      bool deleteFiles = false;
      Done done;
      std::chrono::steady_clock::time_point since;
    };

    TorrentCore() = default;
    void loop();
    void handleAlerts();
    void tick();
    Entry& entry(const std::string& infoHash);
    /** The torrent of an alert; nullptr when the session let go of it */
    Entry* entryOf(const libtorrent::torrent_handle& handle);
    std::string add(libtorrent::add_torrent_params params, const std::string& savePath);
    /** `keepPaused`: a torrent the user paused stays paused when it comes back from its resume data */
    void applyFlags(libtorrent::add_torrent_params& params, bool keepPaused = false) const;
    Status statusOf(const std::string& infoHash, Entry& entry);
    void requestSave(const libtorrent::torrent_handle& handle);
    void writeResume(const libtorrent::add_torrent_params& params);
    void finishRemoval(const std::string& infoHash, bool deleted, const std::string& error);

    // shared with other threads
    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> work_;
    bool alerts_ = false;
    bool quit_ = false;

    // the session's thread only
    std::unique_ptr<libtorrent::session> session_;
    Settings settings_;
    Tick tick_;
    std::map<std::string, Entry> torrents_;
    std::map<std::string, Removal> removals_;
    int savesOut_ = 0;
    std::uint64_t ticks_ = 0;
    /** The DHT's nodes as the session's statistics last said, and where they stand in those */
    int dhtNodes_ = 0;
    int dhtNodesAt_ = -1;

    // the outlet, the session's thread only
    std::shared_ptr<StreamServer> server_;
    std::map<std::uint64_t, Reader> readers_;
    /** Who waits for which piece */
    std::map<PieceKey, std::vector<std::pair<std::uint64_t, PieceDone>>> awaited_;
    /** Pieces libtorrent was asked to hand over as soon as they are there */
    std::set<PieceKey> armed_;
    /** Answers "cancelled" still on their way for pieces that were let go, so they do not end a later wait */
    std::map<PieceKey, int> staleCancels_;
  };

} // namespace seanime::torrent
