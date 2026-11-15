// geschrieben nach: Plan „Eigener Kern" Stufe 3a, dem Vertrag src/core/extensions/sandbox/sandbox.ts und der öffentlichen Doku von quickjs-ng (quickjs.h); keine Vorlage
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

/*
 * One sandbox: a QuickJS runtime and context of its own, on exactly one thread of its own with a queue of work.
 * Nothing here knows of React Native, Android or iOS: POSIX threads, the C++ standard library and QuickJS only.
 * Every method may be called from any thread and returns at once; the answers come from the sandbox's thread.
 */
namespace seanime::sandbox {

  struct Limits {
    /** Memory the engine may hold, in bytes */
    size_t memoryBytes;
    /** Depth of its stack, in bytes */
    size_t stackBytes;
    /** Longest time of one run, in milliseconds, the waiting for the host included */
    int64_t timeMs;
  };

  enum class Outcome {
    /** `text` is the result */
    Ok,
    /** The code threw or the engine hit a limit: `text` is "Name: message" as QuickJS words it */
    Failed,
    /** Stopped while it waited, after the time allowed */
    Time,
    /** The sandbox is closed */
    Closed,
  };

  struct RunResult {
    Outcome outcome;
    std::string text;
  };

  /** The code inside asks the app: answered with `answerHost(call, …)` */
  using HostAsk = std::function<void(double call, const std::string& name, const std::string& payload)>;

  class SandboxCore final {
  public:
    SandboxCore(Limits limits, HostAsk ask);
    /** Stops running code and frees the engine, without waiting for it */
    ~SandboxCore();
    SandboxCore(const SandboxCore&) = delete;
    SandboxCore& operator=(const SandboxCore&) = delete;

    /** Starts the thread and the engine. `opened` is called once: with "" when the engine is ready, else with why not. */
    void open(std::function<void(const std::string& error)> opened);
    /** Runs a script in the global scope; a promise it ends in is waited for. One run at a time, in the order asked. */
    void run(std::string code, std::string name, std::function<void(RunResult)> done);
    /** The app's answer to a question of the code inside; a non-empty `body` reaches it as `[value, body]` */
    void answerHost(double call, bool ok, std::string value, std::string body);
    /** Stops running code, frees the engine and ends the thread; `done` is called when all of that happened */
    void close(std::function<void()> done);

  private:
    struct State;
    std::shared_ptr<State> _state;
  };

  /** Memory the process holds through malloc, in bytes; 0 where the platform cannot tell */
  size_t processHeapBytes();

} // namespace seanime::sandbox
