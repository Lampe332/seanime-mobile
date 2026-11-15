// geschrieben nach: Plan „Eigener Kern" Stufe 6b-2, docs/EIGENER-KERN.md §4q (Skizze „Ausgang"), RFC 7230/7231 (HTTP/1.1: Anfragezeile, Kopfzeilen, GET und HEAD) und RFC 7233 (Range, 206, 416, Content-Range); keine Vorlage
#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#include <boost/shared_array.hpp>

namespace seanime::torrent {

  /** One whole piece of a torrent, or why it cannot be had (`error` is "" when it is there) */
  struct PieceData {
    boost::shared_array<char> bytes;
    int size = 0;
    std::string error;
  };

  /** One file of a torrent as the outlet serves it */
  struct ServedFile {
    /** 40 hex digits, lower case */
    std::string infoHash;
    int index = 0;
    /** The file's name without its folders */
    std::string name;
    /** Where the file starts in the torrent's bytes */
    std::int64_t offset = 0;
    std::int64_t size = 0;
    int pieceLength = 1;
    /** Set: a plain file of the app's storage, read with `pread` (no torrent, `infoHash` is "") */
    std::string path;
  };

  /** Where the outlet gets its bytes from. Both are called on the outlet's thread and must not wait. */
  struct PieceSource {
    /** `reader` reads `piece` next; `done` may be called from any thread, once, or never when the reader is gone */
    std::function<void(std::uint64_t reader, const ServedFile& file, int piece, std::function<void(PieceData)> done)> want;
    /** `reader` reads no more */
    std::function<void(std::uint64_t reader)> gone;
  };

  /**
   * The outlet: a small HTTP server for the app's player, on 127.0.0.1 only, on a port the system picks, behind a random
   * token in the address. GET and HEAD, with `Range` (one range; several are answered with the whole file). A reader
   * that asks for bytes the torrent does not have yet waits for them. One thread of its own (Boost.Asio) carries every
   * connection; nothing here waits on another thread.
   */
  class StreamServer final {
  public:
    /** Opens the port and starts the thread; throws std::runtime_error when the port cannot be opened */
    static std::shared_ptr<StreamServer> open(PieceSource source);
    ~StreamServer();
    /** From any thread: the address of the file from now on, `http://127.0.0.1:<port>/<token>/<hash>/<index>/<name>` */
    std::string serve(const ServedFile& file);
    /** From any thread: the files of this torrent are served no more, its readers are cut off */
    void forget(const std::string& infoHash);
    /**
     * From any thread: the file is shared into the local network (phase 7b) on a second port, bound to the device's
     * address `host` (an IPv4 address of the Wi-Fi), behind a token of its own:
     * `http://<host>:<port>/<token>/<name>`. The port opens with the first share and closes with `unshare`, or by
     * itself after 10 minutes without a reader. Throws std::runtime_error when the port cannot be opened.
     */
    std::string share(const ServedFile& file, const std::string& host);
    /** From any thread: every share ends, the network port closes, its readers are cut off */
    void unshare();
    /** From any thread: whether something is shared into the network */
    bool sharing();
    /** From any thread: the torrents' files are served no more (shared plain files stay), their readers are cut off */
    void forgetTorrents();
    /** From any thread: cuts every reader off and ends the thread, without waiting for it */
    void close();

    struct Shared;

  private:
    StreamServer() = default;
    std::shared_ptr<Shared> shared_;
  };

  /** What a `Range` header asks of a file of `size` bytes (RFC 7233): the whole file, one part, or nothing that exists */
  struct ByteRange {
    enum class Kind { whole, part, unsatisfiable };
    Kind kind = Kind::whole;
    std::int64_t first = 0;
    std::int64_t last = 0;
  };
  ByteRange readRange(const std::string& header, std::int64_t size);

  /**
   * The device's IPv4 address a receiver at `toward` (an IPv4 address; "" for none) reaches it at: the address the
   * system would send from to there, else the first one of a Wi-Fi interface (`wlan*`), else any other that is not
   * the loopback. Throws std::runtime_error when there is none.
   */
  std::string localAddress(const std::string& toward);

} // namespace seanime::torrent
