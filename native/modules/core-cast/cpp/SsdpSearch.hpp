// geschrieben nach: öffentlicher UPnP-Spezifikation (Device Architecture 1.0, 1.2.2: M-SEARCH an 239.255.255.250:1900, Antworten per Unicast an den Absender) und POSIX-Sockets; keine Vorlage
#pragma once

#include <string>
#include <vector>

namespace seanime::cast {

  /**
   * Sends `message` to the multicast group `host`:`port` from a socket of its own (twice, 100 ms apart) and collects the
   * answers that reach that socket until `waitMs` have passed. Blocks the calling thread for that long. Throws
   * std::runtime_error when the socket cannot be opened or nothing could be sent. Knows nothing of Android or iOS.
   */
  std::vector<std::string> multicastSearch(const std::string& message, const std::string& host, int port, int waitMs);

} // namespace seanime::cast
