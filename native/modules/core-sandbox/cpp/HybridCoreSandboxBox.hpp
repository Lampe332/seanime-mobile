// geschrieben nach: Plan „Eigener Kern" Stufe 3a und der öffentlichen Doku von Nitro Modules (HybridObject in C++, Promise); keine Vorlage
#pragma once

#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>

#include "HybridCoreSandboxBoxSpec.hpp"
#include "SandboxCore.hpp"

namespace margelo::nitro::seanime::coresandbox {

  /**
   * Scripts kept for every sandbox (`keepScript`), by key, until the app ends: the helpers for extensions (~100 KB)
   * cross from JavaScript once, every later sandbox only names the key (docs/EIGENER-KERN.md §4l).
   */
  class KeptScripts final {
  public:
    static void keep(const std::string& key, const std::string& code, bool append) {
      std::lock_guard<std::mutex> lock(mutex());
      auto& slot = scripts()[key];
      if (append && slot) {
        std::string joined;
        joined.reserve(slot->size() + code.size());
        joined.append(*slot).append(code);
        slot = std::make_shared<const std::string>(std::move(joined));
      } else {
        slot = std::make_shared<const std::string>(code);
      }
    }

    static std::shared_ptr<const std::string> find(const std::string& key) {
      std::lock_guard<std::mutex> lock(mutex());
      auto found = scripts().find(key);
      return found == scripts().end() ? nullptr : found->second;
    }

  private:
    static std::mutex& mutex() {
      static std::mutex instance;
      return instance;
    }

    static std::unordered_map<std::string, std::shared_ptr<const std::string>>& scripts() {
      static std::unordered_map<std::string, std::shared_ptr<const std::string>> instance;
      return instance;
    }
  };

  /** One sandbox as the app's JavaScript holds it. Every method only hands work to the sandbox's thread. */
  class HybridCoreSandboxBox final : public HybridCoreSandboxBoxSpec {
  public:
    explicit HybridCoreSandboxBox(std::shared_ptr<::seanime::sandbox::SandboxCore> core) : HybridObject(TAG), _core(std::move(core)) {}

    std::shared_ptr<Promise<std::string>> run(const std::string& code, const std::string& name) override {
      return runCode(code, name);
    }

    std::shared_ptr<Promise<std::string>> runKept(const std::string& key, const std::string& after, const std::string& name) override {
      auto script = KeptScripts::find(key);
      if (!script) {
        auto promise = Promise<std::string>::create();
        promise->reject(std::make_exception_ptr(std::runtime_error("ERR_SANDBOX: no script is kept under \"" + key + "\"")));
        return promise;
      }
      std::string code;
      code.reserve(script->size() + after.size());
      code.append(*script).append(after);
      return runCode(std::move(code), name);
    }

    std::shared_ptr<Promise<void>> answerHost(double call, bool ok, const std::string& value, const std::string& body) override {
      _core->answerHost(call, ok, value, body);
      auto promise = Promise<void>::create();
      promise->resolve();
      return promise;
    }

    std::shared_ptr<Promise<void>> close() override {
      auto promise = Promise<void>::create();
      _core->close([promise]() { promise->resolve(); });
      return promise;
    }

  private:
    std::shared_ptr<Promise<std::string>> runCode(std::string code, const std::string& name) {
      auto promise = Promise<std::string>::create();
      _core->run(std::move(code), name, [promise](::seanime::sandbox::RunResult result) {
        using ::seanime::sandbox::Outcome;
        switch (result.outcome) {
          case Outcome::Ok:
            promise->resolve(result.text);
            return;
          case Outcome::Time:
            promise->reject(std::make_exception_ptr(std::runtime_error("ERR_SANDBOX_TIME: " + result.text)));
            return;
          case Outcome::Closed:
            promise->reject(std::make_exception_ptr(std::runtime_error("ERR_SANDBOX_CLOSED: " + result.text)));
            return;
          case Outcome::Failed:
            promise->reject(std::make_exception_ptr(std::runtime_error("ERR_SANDBOX: " + result.text)));
            return;
        }
      });
      return promise;
    }

    std::shared_ptr<::seanime::sandbox::SandboxCore> _core;
  };

} // namespace margelo::nitro::seanime::coresandbox
