// geschrieben nach: Plan „Eigener Kern" Stufe 6b-2, docs/EIGENER-KERN.md §4q (Skizze „Ausgang"), RFC 7230/7231 (HTTP/1.1: Anfragezeile, Kopfzeilen, GET und HEAD), RFC 7233 (Range, 206, 416, Content-Range) und der öffentlichen Doku von Boost.Asio (io_context, ip::tcp, async_read_until, async_write, steady_timer); Phase 7b (Ausgang im WLAN): Kopfzeilen `transferMode.dlna.org` und `contentFeatures.dlna.org` (DLNA.ORG_OP, DLNA.ORG_FLAGS) nach öffentlicher DLNA-/UPnP-Doku, `pread`, `getifaddrs`, `getsockname` nach POSIX; keine Vorlage
#include "StreamServer.hpp"

#include <algorithm>
#include <atomic>
#include <array>
#include <cctype>
#include <chrono>
#include <map>
#include <mutex>
#include <random>
#include <set>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

#include <arpa/inet.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#if defined(__ANDROID__)
#include <android/log.h>
#endif

#include <boost/asio/buffer.hpp>
#include <boost/asio/executor_work_guard.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/address.hpp>
#include <boost/asio/ip/address_v4.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/read_until.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/asio/write.hpp>
#include <boost/system/error_code.hpp>

namespace asio = boost::asio;
using asio::ip::tcp;
using Failed = boost::system::error_code;

namespace seanime::torrent {

  namespace {

    /** A request's head may be this long */
    constexpr std::size_t HEAD_LIMIT = 16 * 1024;
    /** The head must be there within this time */
    constexpr auto HEAD_PATIENCE = std::chrono::seconds(15);
    /** A reader waits this long for one piece the torrent does not have yet, then it is cut off */
    constexpr auto PIECE_PATIENCE = std::chrono::seconds(90);
    /** After the last byte the reader gets this long to close its side */
    constexpr auto END_PATIENCE = std::chrono::seconds(5);
    /** More readers than this at once are turned away (a player opens two or three) */
    constexpr std::size_t MOST_READERS = 32;
    constexpr auto ACCEPT_AGAIN = std::chrono::milliseconds(200);
    /** The network port closes by itself after this long without a reader (phase 7b) */
    constexpr auto LAN_IDLE = std::chrono::minutes(10);
    constexpr auto LAN_CHECK = std::chrono::seconds(30);
    /** A plain file is read and sent in parts of this size */
    constexpr std::size_t FILE_CHUNK = 256 * 1024;

    std::string lower(std::string text) {
      std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      return text;
    }

    std::string trim(const std::string& text) {
      std::size_t from = 0;
      std::size_t to = text.size();
      while (from < to && (text[from] == ' ' || text[from] == '\t')) from++;
      while (to > from && (text[to - 1] == ' ' || text[to - 1] == '\t')) to--;
      return text.substr(from, to - from);
    }

    bool digits(const std::string& text) {
      return !text.empty() && std::all_of(text.begin(), text.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
    }

    /** A number of digits only; one too long to hold counts as "beyond every file" */
    std::int64_t number(const std::string& text) {
      if (text.size() > 18) return INT64_MAX;
      std::int64_t value = 0;
      for (char c : text) value = value * 10 + (c - '0');
      return value;
    }

    /** `words` words of 32 bits: 8 hex digits each (the player's port 4 = 32 digits, a share into the network 8 = 64) */
    std::string randomToken(int words = 4) {
      static const char HEX[] = "0123456789abcdef";
      std::random_device device;
      std::string token;
      for (int i = 0; i < words; i++) {
        unsigned int word = device();
        for (int n = 0; n < 4; n++) {
          token.push_back(HEX[(word >> (n * 8 + 4)) & 0xf]);
          token.push_back(HEX[(word >> (n * 8)) & 0xf]);
        }
      }
      return token;
    }

    /** Everything but letters, digits and `-._~` as %XX, so the name is one part of the path */
    std::string encoded(const std::string& name) {
      static const char HEX[] = "0123456789ABCDEF";
      std::string out;
      for (unsigned char c : name) {
        if (std::isalnum(c) || c == '-' || c == '.' || c == '_' || c == '~') {
          out.push_back(static_cast<char>(c));
        } else {
          out.push_back('%');
          out.push_back(HEX[c >> 4]);
          out.push_back(HEX[c & 0xf]);
        }
      }
      return out;
    }

    const char* mimeOf(const std::string& name) {
      const std::size_t dot = name.rfind('.');
      const std::string extension = dot == std::string::npos ? "" : lower(name.substr(dot + 1));
      if (extension == "mp4" || extension == "m4v") return "video/mp4";
      if (extension == "mkv") return "video/x-matroska";
      if (extension == "webm") return "video/webm";
      if (extension == "avi") return "video/x-msvideo";
      if (extension == "ts" || extension == "m2ts") return "video/mp2t";
      if (extension == "vtt") return "text/vtt";
      if (extension == "srt") return "application/x-subrip";
      if (extension == "ass" || extension == "ssa") return "text/x-ssa";
      return "application/octet-stream";
    }

    std::string keyOf(const std::string& infoHash, const std::string& index) {
      return infoHash + "/" + index;
    }

    /**
     * What a DLNA renderer reads before it plays (phase 7b): a video is streamed and may be read from any byte on
     * (DLNA.ORG_OP=01: Range in bytes, no time seek; FLAGS: streaming, background, stall and DLNA 1.5); anything else is
     * fetched as a whole.
     */
    std::string dlnaHeadersOf(const char* mime) {
      if (std::string(mime).rfind("video/", 0) != 0) return "transferMode.dlna.org: Interactive\r\n";
      return "transferMode.dlna.org: Streaming\r\ncontentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n";
    }

    bool privateV4(std::uint32_t address) {
      return (address >> 24) == 10 || (address >> 20) == ((172u << 4) | 1u) || (address >> 16) == ((192u << 8) | 168u);
    }

    std::string textOf(const in_addr& address) {
      char text[INET_ADDRSTRLEN] = {};
      ::inet_ntop(AF_INET, &address, text, sizeof(text));
      return text;
    }

  } // namespace

  ByteRange readRange(const std::string& header, std::int64_t size) {
    ByteRange whole;
    const std::string value = trim(header);
    // no header, another unit, several ranges or anything unreadable: the header is ignored (RFC 7233 §3.1)
    if (value.size() < 6 || lower(value.substr(0, 6)) != "bytes=") return whole;
    const std::string spec = value.substr(6);
    if (spec.find(',') != std::string::npos) return whole;
    const std::size_t dash = spec.find('-');
    if (dash == std::string::npos) return whole;
    const std::string from = trim(spec.substr(0, dash));
    const std::string to = trim(spec.substr(dash + 1));
    ByteRange range;
    if (from.empty()) {
      // the last n bytes
      if (!digits(to)) return whole;
      const std::int64_t count = number(to);
      if (count == 0 || size == 0) {
        range.kind = ByteRange::Kind::unsatisfiable;
        return range;
      }
      range.kind = ByteRange::Kind::part;
      range.first = count >= size ? 0 : size - count;
      range.last = size - 1;
      return range;
    }
    if (!digits(from) || (!to.empty() && !digits(to))) return whole;
    range.first = number(from);
    range.last = to.empty() ? size - 1 : number(to);
    if (!to.empty() && range.last < range.first) return whole;
    if (range.first >= size) {
      range.kind = ByteRange::Kind::unsatisfiable;
      return range;
    }
    range.kind = ByteRange::Kind::part;
    range.last = std::min(range.last, size - 1);
    return range;
  }

  class Connection;

  /**
   * One line per request of the outlet in the system's log (Android: tag SeanimeTorrent): the method, the range asked
   * for and the answer. Numbers only, neither the token nor the file's name. A request from the network says "wifi".
   */
  static void logRequest(bool lan, const std::string& method, bool ranged, const ByteRange& wanted, std::int64_t size) {
#if defined(__ANDROID__)
    const char* side = lan ? "outlet (wifi)" : "outlet";
    if (wanted.kind == ByteRange::Kind::part) {
      __android_log_print(ANDROID_LOG_INFO, "SeanimeTorrent", "%s: %s Range bytes=%lld-%lld of %lld -> 206", side, method.c_str(),
                          static_cast<long long>(wanted.first), static_cast<long long>(wanted.last), static_cast<long long>(size));
    } else {
      __android_log_print(ANDROID_LOG_INFO, "SeanimeTorrent", "%s: %s %s of %lld -> %d", side, method.c_str(), ranged ? "Range outside the file" : "no Range",
                          static_cast<long long>(size), wanted.kind == ByteRange::Kind::unsatisfiable ? 416 : 200);
    }
#else
    (void)lan;
    (void)method;
    (void)ranged;
    (void)wanted;
    (void)size;
#endif
  }

  static void logLan(const char* text) {
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_INFO, "SeanimeTorrent", "outlet (wifi): %s", text);
#else
    (void)text;
#endif
  }

  struct StreamServer::Shared : std::enable_shared_from_this<StreamServer::Shared> {
    asio::io_context io{1};
    asio::executor_work_guard<asio::io_context::executor_type> work{asio::make_work_guard(io)};
    tcp::acceptor acceptor{io};
    asio::steady_timer again{io};
    PieceSource source;
    std::string token;
    int port = 0;
    std::atomic<std::uint64_t> nextReader{1};

    /** Guards `files`: written by `serve` and `forget` from other threads */
    std::mutex mutex;
    std::map<std::string, ServedFile> files;

    /** Also guarded by `mutex`: the shares into the network by their token, and where that port is (0: closed) */
    std::map<std::string, ServedFile> shares;
    std::string lanHost;
    int lanPort = 0;

    // the outlet's thread only
    std::set<std::shared_ptr<Connection>> open;
    bool closed = false;
    /** The network port (phase 7b), its readers and when one was last there */
    std::shared_ptr<tcp::acceptor> lan;
    asio::steady_timer idle{io};
    std::size_t lanReaders = 0;
    std::chrono::steady_clock::time_point lanLast;

    void accept();
    void acceptLan(std::shared_ptr<tcp::acceptor> from);
    void openLan(std::shared_ptr<tcp::acceptor> acceptor);
    void watchIdle();
    void endLan(const char* why);
    bool find(const std::string& key, ServedFile& out) {
      std::lock_guard<std::mutex> lock(mutex);
      auto found = files.find(key);
      if (found == files.end()) return false;
      out = found->second;
      return true;
    }
    bool findShare(const std::string& token, ServedFile& out) {
      std::lock_guard<std::mutex> lock(mutex);
      auto found = shares.find(token);
      if (found == shares.end()) return false;
      out = found->second;
      return true;
    }
  };

  /** One reader: one request, then the connection ends (`Connection: close`). The outlet's thread only. */
  class Connection final : public std::enable_shared_from_this<Connection> {
  public:
    Connection(std::shared_ptr<StreamServer::Shared> server, tcp::socket socket, bool lan)
        : server_(std::move(server)), socket_(std::move(socket)), patience_(server_->io), id_(server_->nextReader++), lan_(lan) {}
    ~Connection() {
      if (fd_ >= 0) ::close(fd_);
    }

    const std::string& infoHash() const { return file_.infoHash; }
    bool lan() const { return lan_; }

    void start() {
      arm(HEAD_PATIENCE);
      auto self = shared_from_this();
      asio::async_read_until(socket_, asio::dynamic_buffer(head_, HEAD_LIMIT), "\r\n\r\n", [self](const Failed& failed, std::size_t length) {
        if (failed || self->ended_) return self->end();
        self->disarm();
        self->request(length);
      });
    }

    void end() {
      if (ended_) return;
      ended_ = true;
      disarm();
      Failed ignored;
      socket_.close(ignored);
      held_.reset();
      if (fd_ >= 0) ::close(fd_);
      fd_ = -1;
      if (asked_) server_->source.gone(id_);
      if (counted_) {
        server_->lanReaders--;
        server_->lanLast = std::chrono::steady_clock::now();
      }
      server_->open.erase(shared_from_this());
    }

  private:
    void arm(std::chrono::steady_clock::duration time) {
      const std::uint64_t mine = ++armed_;
      patience_.expires_after(time);
      auto self = shared_from_this();
      patience_.async_wait([self, mine](const Failed& failed) {
        if (!failed && mine == self->armed_) self->end();
      });
    }

    void disarm() {
      ++armed_;
      patience_.cancel();
    }

    /** Answers without a body and ends */
    void refuse(const char* status, const std::string& more = "") {
      out_ = std::string("HTTP/1.1 ") + status + "\r\n" + more + "Content-Length: 0\r\nConnection: close\r\n\r\n";
      auto self = shared_from_this();
      asio::async_write(socket_, asio::buffer(out_), [self](const Failed&, std::size_t) { self->finish(); });
    }

    void request(std::size_t length) {
      const std::string head = head_.substr(0, length);
      const std::size_t lineEnd = head.find("\r\n");
      const std::string line = head.substr(0, lineEnd);
      const std::size_t space = line.find(' ');
      const std::size_t lastSpace = line.rfind(' ');
      if (space == std::string::npos || lastSpace == space || line.compare(lastSpace + 1, 7, "HTTP/1.") != 0) return refuse("400 Bad Request");
      const std::string method = line.substr(0, space);
      std::string target = line.substr(space + 1, lastSpace - space - 1);
      const bool headOnly = method == "HEAD";
      if (!headOnly && method != "GET") return refuse("405 Method Not Allowed", "Allow: GET, HEAD\r\n");

      std::string range;
      for (std::size_t at = lineEnd + 2; at < head.size();) {
        const std::size_t end = head.find("\r\n", at);
        if (end == std::string::npos || end == at) break;
        const std::string field = head.substr(at, end - at);
        at = end + 2;
        const std::size_t colon = field.find(':');
        if (colon != std::string::npos && lower(trim(field.substr(0, colon))) == "range") range = trim(field.substr(colon + 1));
      }

      // the player's port: /<token>/<info hash>/<file index>/<name>; the network's: /<token>/<name>. The name is for the
      // reader only; nothing else is answered (no lists of anything)
      target = target.substr(0, target.find('?'));
      std::vector<std::string> parts;
      for (std::size_t at = 0; at <= target.size();) {
        const std::size_t slash = std::min(target.find('/', at), target.size());
        parts.push_back(target.substr(at, slash - at));
        at = slash + 1;
      }
      const bool known = lan_ ? parts.size() == 3 && parts[0].empty() && !parts[1].empty() && server_->findShare(parts[1], file_)
                              : parts.size() >= 4 && parts[0].empty() && parts[1] == server_->token && server_->find(keyOf(lower(parts[2]), parts[3]), file_);
      if (!known) return refuse("404 Not Found");
      if (lan_) {
        counted_ = true;
        server_->lanReaders++;
        server_->lanLast = std::chrono::steady_clock::now();
      }

      const ByteRange wanted = readRange(range, file_.size);
      const char* mime = mimeOf(file_.name);
      const std::string common = std::string("Content-Type: ") + mime + "\r\nAccept-Ranges: bytes\r\n" + dlnaHeadersOf(mime) + "Cache-Control: no-store\r\nConnection: close\r\n";
      if (wanted.kind == ByteRange::Kind::unsatisfiable) {
        out_ = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + std::to_string(file_.size) + "\r\nContent-Length: 0\r\n" + common + "\r\n";
        at_ = end_ = 0;
      } else if (wanted.kind == ByteRange::Kind::part) {
        at_ = wanted.first;
        end_ = wanted.last + 1;
        out_ = "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes " + std::to_string(wanted.first) + "-" + std::to_string(wanted.last) + "/" + std::to_string(file_.size) +
               "\r\nContent-Length: " + std::to_string(end_ - at_) + "\r\n" + common + "\r\n";
      } else {
        at_ = 0;
        end_ = file_.size;
        out_ = "HTTP/1.1 200 OK\r\nContent-Length: " + std::to_string(file_.size) + "\r\n" + common + "\r\n";
      }
      if (headOnly) at_ = end_ = 0;
      logRequest(lan_, method, !range.empty(), wanted, file_.size);

      watch();
      auto self = shared_from_this();
      asio::async_write(socket_, asio::buffer(out_), [self](const Failed& failed, std::size_t) {
        if (failed || self->ended_) return self->end();
        self->next();
      });
    }

    /** A reader that closes its side is gone, also while it waits for a piece; what it still sends is not read as a request */
    void watch() {
      watching_ = true;
      auto self = shared_from_this();
      socket_.async_read_some(asio::buffer(spare_), [self](const Failed& failed, std::size_t) {
        if (failed || self->ended_) return self->end();
        self->watch();
      });
    }

    void next() {
      if (at_ >= end_) return finish();
      if (!file_.path.empty()) return readFile();
      const int piece = static_cast<int>((file_.offset + at_) / file_.pieceLength);
      arm(PIECE_PATIENCE);
      asked_ = true;
      std::weak_ptr<Connection> weak = weak_from_this();
      std::shared_ptr<StreamServer::Shared> server = server_;
      server_->source.want(id_, file_, piece, [weak, server, piece](PieceData data) {
        // from the session's thread: back to the outlet's
        asio::post(server->io, [weak, piece, data = std::move(data)]() {
          if (auto self = weak.lock()) self->piece(piece, data);
        });
      });
    }

    void piece(int piece, const PieceData& data) {
      if (ended_) return;
      disarm();
      const std::int64_t from = file_.offset + at_ - static_cast<std::int64_t>(piece) * file_.pieceLength;
      // a piece that cannot be had ends the answer early: the reader sees fewer bytes than promised and asks again
      if (!data.error.empty() || !data.bytes || from < 0 || from >= data.size) return end();
      const std::int64_t count = std::min<std::int64_t>(data.size - from, end_ - at_);
      held_ = data.bytes;
      auto self = shared_from_this();
      // no time limit here: a player whose cache is full reads nothing for minutes
      asio::async_write(socket_, asio::buffer(held_.get() + from, static_cast<std::size_t>(count)), [self, count](const Failed& failed, std::size_t) {
        self->held_.reset();
        if (failed || self->ended_) return self->end();
        self->at_ += count;
        self->next();
      });
    }

    /** A plain file of the app's storage: the next part with `pread`, from the local disk (no waiting for a peer) */
    void readFile() {
      if (fd_ < 0) fd_ = ::open(file_.path.c_str(), O_RDONLY | O_CLOEXEC);
      if (fd_ < 0) return end();
      if (chunk_.empty()) chunk_.resize(FILE_CHUNK);
      const std::size_t want = static_cast<std::size_t>(std::min<std::int64_t>(static_cast<std::int64_t>(FILE_CHUNK), end_ - at_));
#if defined(__ANDROID__)
      const ssize_t got = ::pread64(fd_, chunk_.data(), want, static_cast<off64_t>(at_));
#else
      const ssize_t got = ::pread(fd_, chunk_.data(), want, static_cast<off_t>(at_));
#endif
      // the file became shorter or cannot be read: the reader sees fewer bytes than promised
      if (got <= 0) return end();
      auto self = shared_from_this();
      asio::async_write(socket_, asio::buffer(chunk_.data(), static_cast<std::size_t>(got)), [self, got](const Failed& failed, std::size_t) {
        if (failed || self->ended_) return self->end();
        self->at_ += got;
        self->next();
      });
    }

    /** Everything is sent: our side is closed, the reader closes its own (seen by `watch`) or is cut off after a while */
    void finish() {
      if (ended_) return;
      Failed ignored;
      socket_.shutdown(tcp::socket::shutdown_send, ignored);
      arm(END_PATIENCE);
      if (!watching_) watch();
    }

    std::shared_ptr<StreamServer::Shared> server_;
    tcp::socket socket_;
    asio::steady_timer patience_;
    const std::uint64_t id_;
    std::uint64_t armed_ = 0;
    std::string head_;
    std::string out_;
    std::array<char, 512> spare_{};
    ServedFile file_;
    /** The next byte of the file to send, and the first one not to send */
    std::int64_t at_ = 0;
    std::int64_t end_ = 0;
    /** The piece being written */
    boost::shared_array<char> held_;
    bool asked_ = false;
    bool watching_ = false;
    bool ended_ = false;
    /** From the network port; `counted_`: a request with a known token, counted among the network's readers */
    const bool lan_;
    bool counted_ = false;
    /** A plain file: its descriptor and the part being sent */
    int fd_ = -1;
    std::vector<char> chunk_;
  };

  void StreamServer::Shared::accept() {
    auto self = shared_from_this();
    acceptor.async_accept([self](const Failed& failed, tcp::socket socket) {
      if (self->closed || failed == asio::error::operation_aborted) return;
      if (failed) {
        // out of sockets or the like: not in a tight loop
        self->again.expires_after(ACCEPT_AGAIN);
        self->again.async_wait([self](const Failed& stopped) {
          if (!stopped && !self->closed) self->accept();
        });
        return;
      }
      if (self->open.size() < MOST_READERS) {
        Failed ignored;
        socket.set_option(tcp::no_delay(true), ignored);
        auto connection = std::make_shared<Connection>(self, std::move(socket), false);
        self->open.insert(connection);
        connection->start();
      }
      self->accept();
    });
  }

  void StreamServer::Shared::acceptLan(std::shared_ptr<tcp::acceptor> from) {
    auto self = shared_from_this();
    from->async_accept([self, from](const Failed& failed, tcp::socket socket) {
      if (self->closed || self->lan != from || failed == asio::error::operation_aborted) return;
      if (failed) {
        auto later = std::make_shared<asio::steady_timer>(self->io, ACCEPT_AGAIN);
        later->async_wait([self, from, later](const Failed& stopped) {
          if (!stopped && !self->closed && self->lan == from) self->acceptLan(from);
        });
        return;
      }
      if (self->open.size() < MOST_READERS) {
        Failed ignored;
        socket.set_option(tcp::no_delay(true), ignored);
        auto connection = std::make_shared<Connection>(self, std::move(socket), true);
        self->open.insert(connection);
        connection->start();
      }
      self->acceptLan(from);
    });
  }

  void StreamServer::Shared::openLan(std::shared_ptr<tcp::acceptor> acceptor) {
    Failed ignored;
    if (closed) {
      acceptor->close(ignored);
      return;
    }
    // another address: the old port and its readers end
    if (lan) endLan("moved to another address");
    lan = std::move(acceptor);
    lanLast = std::chrono::steady_clock::now();
    logLan("open");
    acceptLan(lan);
    watchIdle();
  }

  void StreamServer::Shared::watchIdle() {
    auto self = shared_from_this();
    idle.expires_after(LAN_CHECK);
    idle.async_wait([self](const Failed& stopped) {
      if (stopped || self->closed || !self->lan) return;
      if (self->lanReaders == 0 && std::chrono::steady_clock::now() - self->lanLast >= LAN_IDLE) {
        Failed failed;
        const int port = self->lan->local_endpoint(failed).port();
        bool newer = false;
        {
          std::lock_guard<std::mutex> lock(self->mutex);
          // a share for a port that is being opened right now stays
          newer = failed || self->lanPort != port;
          if (!newer) {
            self->shares.clear();
            self->lanHost.clear();
            self->lanPort = 0;
          }
        }
        if (!newer) return self->endLan("closed after 10 minutes without a reader");
      }
      self->watchIdle();
    });
  }

  void StreamServer::Shared::endLan(const char* why) {
    if (!lan) return;
    Failed ignored;
    lan->close(ignored);
    lan.reset();
    idle.cancel();
    const std::vector<std::shared_ptr<Connection>> all(open.begin(), open.end());
    for (const auto& connection : all) {
      if (connection->lan()) connection->end();
    }
    logLan(why);
  }

  std::shared_ptr<StreamServer> StreamServer::open(PieceSource source) {
    auto shared = std::make_shared<Shared>();
    shared->source = std::move(source);
    shared->token = randomToken();
    Failed failed;
    const tcp::endpoint local(asio::ip::address_v4::loopback(), 0);
    shared->acceptor.open(local.protocol(), failed);
    if (!failed) shared->acceptor.bind(local, failed);
    if (!failed) shared->acceptor.listen(16, failed);
    if (failed) throw std::runtime_error("the outlet's port cannot be opened: " + failed.message());
    shared->port = shared->acceptor.local_endpoint(failed).port();
    if (failed || shared->port == 0) throw std::runtime_error("the outlet's port cannot be read");
    shared->accept();
    // the thread holds the outlet's parts until its last connection is gone
    std::thread([shared]() {
      for (;;) {
        try {
          shared->io.run();
          return;
        } catch (...) {
          // one connection's failure is not the others'
        }
      }
    }).detach();
    std::shared_ptr<StreamServer> server(new StreamServer());
    server->shared_ = std::move(shared);
    return server;
  }

  StreamServer::~StreamServer() {
    close();
  }

  std::string StreamServer::serve(const ServedFile& file) {
    const std::string index = std::to_string(file.index);
    {
      std::lock_guard<std::mutex> lock(shared_->mutex);
      shared_->files[keyOf(file.infoHash, index)] = file;
    }
    return "http://127.0.0.1:" + std::to_string(shared_->port) + "/" + shared_->token + "/" + file.infoHash + "/" + index + "/" + encoded(file.name);
  }

  void StreamServer::forget(const std::string& infoHash) {
    {
      std::lock_guard<std::mutex> lock(shared_->mutex);
      for (auto file = shared_->files.begin(); file != shared_->files.end();) {
        file = file->second.infoHash == infoHash ? shared_->files.erase(file) : std::next(file);
      }
      for (auto file = shared_->shares.begin(); file != shared_->shares.end();) {
        file = file->second.infoHash == infoHash ? shared_->shares.erase(file) : std::next(file);
      }
    }
    std::shared_ptr<Shared> shared = shared_;
    asio::post(shared->io, [shared, infoHash]() {
      const std::vector<std::shared_ptr<Connection>> all(shared->open.begin(), shared->open.end());
      for (const auto& connection : all) {
        if (connection->infoHash() == infoHash) connection->end();
      }
    });
  }

  std::string StreamServer::share(const ServedFile& file, const std::string& host) {
    std::shared_ptr<Shared> shared = shared_;
    std::lock_guard<std::mutex> lock(shared->mutex);
    if (shared->lanPort == 0 || shared->lanHost != host) {
      // a new port on this thread; the outlet's thread takes it over (and lets go of an old one)
      Failed failed;
      const asio::ip::address_v4 address = asio::ip::make_address_v4(host, failed);
      if (failed || address.is_loopback() || address.is_unspecified()) throw std::runtime_error("no address of the device in the network to share at");
      auto acceptor = std::make_shared<tcp::acceptor>(shared->io);
      const tcp::endpoint where(address, 0);
      acceptor->open(where.protocol(), failed);
      if (!failed) acceptor->bind(where, failed);
      if (!failed) acceptor->listen(16, failed);
      if (failed) throw std::runtime_error("the outlet's network port cannot be opened: " + failed.message());
      const int port = acceptor->local_endpoint(failed).port();
      if (failed || port == 0) throw std::runtime_error("the outlet's network port cannot be read");
      shared->shares.clear();
      shared->lanHost = host;
      shared->lanPort = port;
      asio::post(shared->io, [shared, acceptor]() { shared->openLan(acceptor); });
    }
    // 64 hex digits of its own for every share
    const std::string token = randomToken(8);
    shared->shares[token] = file;
    return "http://" + host + ":" + std::to_string(shared->lanPort) + "/" + token + "/" + encoded(file.name);
  }

  void StreamServer::unshare() {
    std::shared_ptr<Shared> shared = shared_;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->shares.clear();
      shared->lanHost.clear();
      shared->lanPort = 0;
    }
    asio::post(shared->io, [shared]() { shared->endLan("closed"); });
  }

  bool StreamServer::sharing() {
    std::lock_guard<std::mutex> lock(shared_->mutex);
    return !shared_->shares.empty();
  }

  void StreamServer::forgetTorrents() {
    {
      std::lock_guard<std::mutex> lock(shared_->mutex);
      shared_->files.clear();
      for (auto file = shared_->shares.begin(); file != shared_->shares.end();) {
        file = file->second.infoHash.empty() ? std::next(file) : shared_->shares.erase(file);
      }
    }
    std::shared_ptr<Shared> shared = shared_;
    asio::post(shared->io, [shared]() {
      const std::vector<std::shared_ptr<Connection>> all(shared->open.begin(), shared->open.end());
      for (const auto& connection : all) {
        if (!connection->infoHash().empty()) connection->end();
      }
    });
  }

  std::string localAddress(const std::string& toward) {
    // the address the system would send from to the receiver (a UDP socket only chooses its route, nothing is sent)
    in_addr target{};
    if (!toward.empty() && ::inet_pton(AF_INET, toward.c_str(), &target) == 1) {
      const int probe = ::socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
      if (probe >= 0) {
        sockaddr_in to{};
        to.sin_family = AF_INET;
        to.sin_port = htons(9);
        to.sin_addr = target;
        sockaddr_in me{};
        socklen_t length = sizeof(me);
        const bool found = ::connect(probe, reinterpret_cast<sockaddr*>(&to), sizeof(to)) == 0 && ::getsockname(probe, reinterpret_cast<sockaddr*>(&me), &length) == 0;
        ::close(probe);
        // only a home network's address: never one of the mobile network
        if (found && privateV4(ntohl(me.sin_addr.s_addr))) return textOf(me.sin_addr);
      }
    }
    ifaddrs* all = nullptr;
    if (::getifaddrs(&all) != 0 || !all) throw std::runtime_error("the device's network addresses cannot be read");
    std::string wifi;
    std::string home;
    for (ifaddrs* at = all; at; at = at->ifa_next) {
      if (!at->ifa_addr || at->ifa_addr->sa_family != AF_INET || !(at->ifa_flags & IFF_UP) || (at->ifa_flags & IFF_LOOPBACK)) continue;
      const in_addr address = reinterpret_cast<sockaddr_in*>(at->ifa_addr)->sin_addr;
      const std::string name = at->ifa_name ? at->ifa_name : "";
      if (wifi.empty() && name.rfind("wlan", 0) == 0) wifi = textOf(address);
      else if (home.empty() && name.rfind("rmnet", 0) != 0 && privateV4(ntohl(address.s_addr))) home = textOf(address);
    }
    ::freeifaddrs(all);
    if (!wifi.empty()) return wifi;
    if (!home.empty()) return home;
    throw std::runtime_error("the device is in no Wi-Fi");
  }

  void StreamServer::close() {
    std::shared_ptr<Shared> shared = shared_;
    asio::post(shared->io, [shared]() {
      if (shared->closed) return;
      shared->closed = true;
      Failed ignored;
      shared->acceptor.close(ignored);
      shared->again.cancel();
      shared->endLan("closed with the outlet");
      const std::vector<std::shared_ptr<Connection>> all(shared->open.begin(), shared->open.end());
      for (const auto& connection : all) connection->end();
      // nothing left to wait for: `run` returns once the last handler is through
      shared->work.reset();
    });
  }

} // namespace seanime::torrent
