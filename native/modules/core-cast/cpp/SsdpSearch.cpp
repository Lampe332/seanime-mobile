// geschrieben nach: öffentlicher UPnP-Spezifikation (Device Architecture 1.0, 1.2.2) und POSIX-Sockets (socket, setsockopt IP_MULTICAST_TTL, sendto, poll, recvfrom); keine Vorlage
#include "SsdpSearch.hpp"

#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <netinet/in.h>
#include <poll.h>
#include <set>
#include <stdexcept>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

namespace seanime::cast {

  namespace {
    /** Closes the socket however the search ends */
    struct Socket {
      int fd;
      explicit Socket(int value) : fd(value) {}
      ~Socket() {
        if (fd >= 0) ::close(fd);
      }
      Socket(const Socket&) = delete;
      Socket& operator=(const Socket&) = delete;
    };

    std::string why(const char* what) {
      return std::string(what) + ": " + std::strerror(errno);
    }
  } // namespace

  std::vector<std::string> multicastSearch(const std::string& message, const std::string& host, int port, int waitMs) {
    if (port < 1 || port > 65535 || waitMs < 0 || waitMs > 30000) throw std::runtime_error("search out of range");
    sockaddr_in group{};
    group.sin_family = AF_INET;
    group.sin_port = htons(static_cast<uint16_t>(port));
    if (::inet_pton(AF_INET, host.c_str(), &group.sin_addr) != 1) throw std::runtime_error("not an IPv4 address: " + host);

    Socket socket(::socket(AF_INET, SOCK_DGRAM, 0));
    if (socket.fd < 0) throw std::runtime_error(why("socket"));
    // any free port of the device: the answers come back to it (Device Architecture 1.0: unicast to the asker)
    sockaddr_in local{};
    local.sin_family = AF_INET;
    local.sin_addr.s_addr = htonl(INADDR_ANY);
    local.sin_port = 0;
    if (::bind(socket.fd, reinterpret_cast<sockaddr*>(&local), sizeof(local)) != 0) throw std::runtime_error(why("bind"));
    // the specification asks for a TTL of 2 (UPnP 1.0 says 4; 2 is enough inside one home network)
    unsigned char ttl = 2;
    ::setsockopt(socket.fd, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof(ttl));

    int sent = 0;
    for (int round = 0; round < 2; round++) {
      if (round > 0) std::this_thread::sleep_for(std::chrono::milliseconds(100));
      ssize_t written = ::sendto(socket.fd, message.data(), message.size(), 0, reinterpret_cast<sockaddr*>(&group), sizeof(group));
      if (written == static_cast<ssize_t>(message.size())) sent++;
    }
    if (sent == 0) throw std::runtime_error(why("sendto"));

    std::vector<std::string> answers;
    std::set<std::string> seen;
    const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(waitMs);
    char buffer[8192];
    for (;;) {
      auto left = std::chrono::duration_cast<std::chrono::milliseconds>(until - std::chrono::steady_clock::now()).count();
      if (left <= 0) break;
      pollfd wait{socket.fd, POLLIN, 0};
      int ready = ::poll(&wait, 1, static_cast<int>(left));
      if (ready < 0) {
        if (errno == EINTR) continue;
        break;
      }
      if (ready == 0) break;
      ssize_t got = ::recvfrom(socket.fd, buffer, sizeof(buffer), 0, nullptr, nullptr);
      if (got <= 0) continue;
      std::string answer(buffer, static_cast<size_t>(got));
      // a device answers each of the two searches; once is enough
      if (seen.insert(answer).second) answers.push_back(std::move(answer));
      if (answers.size() >= 64) break;
    }
    return answers;
  }

} // namespace seanime::cast
