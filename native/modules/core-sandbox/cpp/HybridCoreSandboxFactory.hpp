// geschrieben nach: Plan „Eigener Kern" Stufe 3a und der öffentlichen Doku von Nitro Modules (HybridObject in C++, Promise, Callback); keine Vorlage
#pragma once

#include <cmath>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>

#include "HybridCoreSandboxBox.hpp"
#include "HybridCoreSandboxFactorySpec.hpp"
#include "SandboxCore.hpp"

namespace margelo::nitro::seanime::coresandbox {

  /** Opens sandboxes. Found by the app's JavaScript under the name `CoreSandboxFactory`. */
  class HybridCoreSandboxFactory final : public HybridCoreSandboxFactorySpec {
  public:
    HybridCoreSandboxFactory() : HybridObject(TAG) {}

    std::shared_ptr<Promise<std::shared_ptr<HybridCoreSandboxBoxSpec>>> create(
      double memoryBytes, double stackBytes, double timeMs,
      const std::function<void(double /* call */, const std::string& /* name */, const std::string& /* payload */)>& onHostCall) override {
      auto promise = Promise<std::shared_ptr<HybridCoreSandboxBoxSpec>>::create();
      // a whole day at most keeps the clock's arithmetic far from its end
      constexpr double LONGEST_MS = 24.0 * 60 * 60 * 1000;
      constexpr double LARGEST_BYTES = 4.0 * 1024 * 1024 * 1024;
      bool sane = std::isfinite(memoryBytes) && std::isfinite(stackBytes) && std::isfinite(timeMs) && memoryBytes >= 1 &&
                  memoryBytes <= LARGEST_BYTES && stackBytes >= 1 && stackBytes <= 64.0 * 1024 * 1024 && timeMs >= 1 && timeMs <= LONGEST_MS;
      if (!sane) {
        promise->reject(std::make_exception_ptr(std::runtime_error("ERR_SANDBOX: the limits are out of range")));
        return promise;
      }
      ::seanime::sandbox::Limits limits{static_cast<size_t>(memoryBytes), static_cast<size_t>(stackBytes), static_cast<int64_t>(timeMs)};
      auto core = std::make_shared<::seanime::sandbox::SandboxCore>(limits, onHostCall);
      core->open([promise, core](const std::string& error) {
        if (!error.empty()) {
          promise->reject(std::make_exception_ptr(std::runtime_error("ERR_SANDBOX: " + error)));
          return;
        }
        std::shared_ptr<HybridCoreSandboxBoxSpec> box = std::make_shared<HybridCoreSandboxBox>(core);
        promise->resolve(box);
      });
      return promise;
    }

    std::shared_ptr<Promise<double>> nativeHeapBytes() override {
      // the allocator may walk its whole heap for this number: not on the thread that asks
      return Promise<double>::async([]() { return static_cast<double>(::seanime::sandbox::processHeapBytes()); });
    }

    std::shared_ptr<Promise<void>> keepScript(const std::string& key, const std::string& code, bool append) override {
      KeptScripts::keep(key, code, append);
      auto promise = Promise<void>::create();
      promise->resolve();
      return promise;
    }
  };

} // namespace margelo::nitro::seanime::coresandbox
