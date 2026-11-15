// geschrieben nach: Plan „Eigener Kern" Phase 7c-1 und der öffentlichen Doku von Nitro Modules (HybridObject in C++, Promise); keine Vorlage
#pragma once

#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "HybridCoreCastSpec.hpp"
#include "SsdpSearch.hpp"

namespace margelo::nitro::seanime::corecast {

  /** The search into the home network. Found by the app's JavaScript under the name `CoreCast`. */
  class HybridCoreCast final : public HybridCoreCastSpec {
  public:
    HybridCoreCast() : HybridObject(TAG) {}

    std::shared_ptr<Promise<std::vector<std::string>>> search(const std::string& message, const std::string& host, double port, double waitMs) override {
      auto promise = Promise<std::vector<std::string>>::create();
      if (!std::isfinite(port) || !std::isfinite(waitMs)) {
        promise->reject(std::make_exception_ptr(std::runtime_error("ERR_CAST: the search is out of range")));
        return promise;
      }
      // a thread of its own: the search waits seconds and must not hold one of Nitro's shared threads that long
      std::thread([promise, message, host, port, waitMs]() {
        try {
          promise->resolve(::seanime::cast::multicastSearch(message, host, static_cast<int>(port), static_cast<int>(waitMs)));
        } catch (const std::exception& error) {
          promise->reject(std::make_exception_ptr(std::runtime_error(std::string("ERR_CAST: ") + error.what())));
        }
      }).detach();
      return promise;
    }
  };

} // namespace margelo::nitro::seanime::corecast
