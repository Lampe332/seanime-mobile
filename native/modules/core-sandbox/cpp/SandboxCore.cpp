// geschrieben nach: Plan „Eigener Kern" Stufe 3a, dem Vertrag src/core/extensions/sandbox/sandbox.ts, dem eigenen Node-Unterbau node-engine.ts (gleiches Verhalten) und der öffentlichen Doku von quickjs-ng (quickjs.h: Runtime, Limits, Interrupt-Handler, Promises, Jobs); keine Vorlage
#include "SandboxCore.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <limits>
#include <mutex>
#include <unordered_map>
#include <utility>
#include <vector>

#include <pthread.h>

#include "quickjs.h"

#if defined(__ANDROID__)
#include <malloc.h>
#elif defined(__APPLE__)
#include <malloc/malloc.h>
#endif

namespace seanime::sandbox {

  namespace {

    using Clock = std::chrono::steady_clock;

    constexpr int64_t NEVER = std::numeric_limits<int64_t>::max();
    /** Room of the thread above what JavaScript may use: for the C functions of QuickJS between two of its checks */
    constexpr size_t STACK_HEADROOM = 512 * 1024;
    constexpr size_t STACK_PAGE = 16 * 1024;

    int64_t nowNs() {
      return std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count();
    }

    struct Task {
      std::string code;
      std::string name;
      std::function<void(RunResult)> done;
    };

    struct Answer {
      int64_t call;
      bool ok;
      std::string value;
      /** The long text of the answer beside the JSON (a page), empty for none */
      std::string body = {};
    };

    struct Waiting {
      JSValue resolve;
      JSValue reject;
    };

    /** A callback of the caller must never end the sandbox's thread */
    template <typename Work> void guarded(Work&& work) noexcept {
      try {
        work();
      } catch (...) {
      }
    }

  } // namespace

  struct SandboxCore::State {
    Limits limits;
    HostAsk ask;
    std::function<void(const std::string&)> opened;

    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Task> tasks;
    std::deque<Answer> answers;
    std::vector<std::function<void()>> closeWaiters;
    bool started = false;
    bool finished = false;
    /** Read by the interrupt handler in the middle of running code */
    std::atomic<bool> closing{false};
    std::atomic<int64_t> deadlineNs{NEVER};

    // the sandbox's thread only
    JSRuntime* runtime = nullptr;
    JSContext* context = nullptr;
    std::unordered_map<int64_t, Waiting> waiting;
    int64_t nextCall = 0;

    bool overTime() const {
      return nowNs() >= deadlineNs.load(std::memory_order_relaxed);
    }

    void dropException() {
      JS_FreeValue(context, JS_GetException(context));
    }

    /** What QuickJS could not put into words: it was stopped, or it has no memory left for it */
    std::string wordless() const {
      if (closing.load() || overTime()) return "InternalError: interrupted";
      return "InternalError: out of memory";
    }

    bool textOf(JSValueConst value, std::string& text) {
      size_t length = 0;
      const char* chars = JS_ToCStringLen(context, &length, value);
      if (chars == nullptr) {
        dropException();
        return false;
      }
      text.assign(chars, length);
      JS_FreeCString(context, chars);
      return true;
    }

    /** "Name: message", as the Node engine words it */
    std::string errorText(JSValueConst error) {
      // out of memory can leave QuickJS without the memory for an error object
      if (JS_IsNull(error) || JS_IsUndefined(error) || JS_IsUninitialized(error)) return wordless();
      std::string text;
      if (!JS_IsObject(error)) return textOf(error, text) ? text : wordless();

      JSValue name = JS_GetPropertyStr(context, error, "name");
      JSValue message = JS_GetPropertyStr(context, error, "message");
      bool ok = !JS_IsException(name) && !JS_IsException(message);
      if (!ok) dropException();
      std::string nameText = "Error";
      std::string messageText;
      if (ok && JS_IsString(name)) ok = textOf(name, nameText);
      if (ok && JS_IsString(message)) {
        ok = textOf(message, messageText);
      } else if (ok) {
        JSValue json = JS_JSONStringify(context, error, JS_UNDEFINED, JS_UNDEFINED);
        if (JS_IsException(json)) {
          dropException();
          ok = false;
        } else if (JS_IsString(json)) {
          ok = textOf(json, messageText);
        } else {
          messageText = "undefined";
        }
        JS_FreeValue(context, json);
      }
      JS_FreeValue(context, name);
      JS_FreeValue(context, message);
      return ok ? nameText + ": " + messageText : wordless();
    }

    std::string takeException(JSContext* from) {
      JSValue error = JS_GetException(from);
      std::string text = errorText(error);
      JS_FreeValue(context, error);
      return text;
    }

    /** `[value, body]` for the code inside, JS_EXCEPTION when there is no memory for it */
    JSValue pairOf(const std::string& value, const std::string& body) {
      JSValue pair = JS_NewArray(context);
      if (JS_IsException(pair)) return pair;
      JSValue first = JS_NewStringLen(context, value.data(), value.size());
      if (JS_IsException(first) || JS_SetPropertyUint32(context, pair, 0, first) < 0) {
        JS_FreeValue(context, pair);
        return JS_EXCEPTION;
      }
      JSValue second = JS_NewStringLen(context, body.data(), body.size());
      if (JS_IsException(second) || JS_SetPropertyUint32(context, pair, 1, second) < 0) {
        JS_FreeValue(context, pair);
        return JS_EXCEPTION;
      }
      return pair;
    }

    /** Hands the app's answer to the promise the code inside waits on */
    void settle(const Answer& answer) {
      auto found = waiting.find(answer.call);
      if (found == waiting.end()) return;
      Waiting functions = found->second;
      waiting.erase(found);

      bool resolve = answer.ok;
      JSValue argument;
      if (answer.ok && !answer.body.empty()) {
        argument = pairOf(answer.value, answer.body);
      } else if (answer.ok) {
        argument = JS_NewStringLen(context, answer.value.data(), answer.value.size());
      } else {
        argument = JS_NewError(context);
        if (!JS_IsException(argument)) {
          JSValue message = JS_NewStringLen(context, answer.value.data(), answer.value.size());
          if (JS_IsException(message)) {
            JS_FreeValue(context, argument);
            argument = JS_EXCEPTION;
          } else {
            JS_DefinePropertyValueStr(context, argument, "message", message, JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
          }
        }
      }
      if (JS_IsException(argument)) {
        // no memory even for the answer: the code inside gets a rejection without a value
        dropException();
        argument = JS_NULL;
        resolve = false;
      }
      JSValue result = JS_Call(context, resolve ? functions.resolve : functions.reject, JS_UNDEFINED, 1, &argument);
      if (JS_IsException(result)) dropException();
      JS_FreeValue(context, result);
      JS_FreeValue(context, argument);
      JS_FreeValue(context, functions.resolve);
      JS_FreeValue(context, functions.reject);
    }

    void settleAnswers() {
      std::deque<Answer> arrived;
      {
        std::lock_guard<std::mutex> lock(mutex);
        arrived.swap(answers);
      }
      for (const Answer& answer : arrived) settle(answer);
    }

    RunResult failure(std::string text) const {
      if (closing.load()) return {Outcome::Closed, "the sandbox is closed"};
      return {Outcome::Failed, std::move(text)};
    }

    RunResult stringOf(JSValueConst value) {
      std::string text;
      if (JS_IsString(value) && !textOf(value, text)) return failure(wordless());
      return {Outcome::Ok, std::move(text)};
    }

    RunResult runNow(const Task& task) {
      JSValue value = JS_Eval(context, task.code.c_str(), task.code.size(), task.name.c_str(), JS_EVAL_TYPE_GLOBAL);
      if (JS_IsException(value)) return failure(takeException(context));
      if (!JS_IsPromise(value)) {
        RunResult result = stringOf(value);
        JS_FreeValue(context, value);
        return result;
      }

      RunResult result{Outcome::Ok, ""};
      for (;;) {
        settleAnswers();
        // what became ready: the steps after an `await` inside
        bool broken = false;
        for (;;) {
          JSContext* from = nullptr;
          int ran = JS_ExecutePendingJob(runtime, &from);
          if (ran == 0) break;
          if (ran < 0) {
            result = failure(takeException(from != nullptr ? from : context));
            broken = true;
            break;
          }
        }
        if (broken) break;

        JSPromiseStateEnum state = JS_PromiseState(context, value);
        if (state == JS_PROMISE_FULFILLED) {
          JSValue settled = JS_PromiseResult(context, value);
          result = stringOf(settled);
          JS_FreeValue(context, settled);
          break;
        }
        if (state == JS_PROMISE_REJECTED) {
          JSValue reason = JS_PromiseResult(context, value);
          result = failure(errorText(reason));
          JS_FreeValue(context, reason);
          break;
        }
        if (closing.load()) {
          result = {Outcome::Closed, "the sandbox is closed"};
          break;
        }
        if (overTime()) {
          result = {Outcome::Time, "stopped after " + std::to_string(limits.timeMs) + " ms"};
          break;
        }
        // nothing left to run: only an answer of the app, the clock or a close goes on from here
        std::unique_lock<std::mutex> lock(mutex);
        auto until = Clock::time_point(std::chrono::duration_cast<Clock::duration>(std::chrono::nanoseconds(deadlineNs.load())));
        wake.wait_until(lock, until, [this] { return !answers.empty() || closing.load(); });
      }
      JS_FreeValue(context, value);
      return result;
    }

    static int interrupt(JSContext*, void* opaque) {
      auto* state = static_cast<State*>(opaque);
      return state->closing.load(std::memory_order_relaxed) || state->overTime() ? 1 : 0;
    }

    /** `__host(name, payload)`: a promise the app's answer settles */
    static JSValue door(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
      auto* state = static_cast<State*>(JS_GetContextOpaque(context));
      std::string name;
      std::string payload;
      if (!state->textOrThrow(argc > 0 ? argv[0] : JS_UNDEFINED, name)) return JS_EXCEPTION;
      if (!state->textOrThrow(argc > 1 ? argv[1] : JS_UNDEFINED, payload)) return JS_EXCEPTION;
      JSValue functions[2];
      JSValue promise = JS_NewPromiseCapability(context, functions);
      if (JS_IsException(promise)) return promise;
      int64_t call = ++state->nextCall;
      state->waiting.emplace(call, Waiting{functions[0], functions[1]});
      bool asked = false;
      guarded([&] {
        state->ask(static_cast<double>(call), name, payload);
        asked = true;
      });
      if (!asked) {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->answers.push_back({call, false, "the app could not be asked"});
      }
      return promise;
    }

    /** Like textOf, but leaves the exception for the code inside */
    bool textOrThrow(JSValueConst value, std::string& text) {
      size_t length = 0;
      const char* chars = JS_ToCStringLen(context, &length, value);
      if (chars == nullptr) return false;
      text.assign(chars, length);
      JS_FreeCString(context, chars);
      return true;
    }

    std::string start() {
      runtime = JS_NewRuntime();
      if (runtime == nullptr) return "the engine could not be created";
      JS_SetMemoryLimit(runtime, limits.memoryBytes);
      // counted from where this thread's stack is now
      JS_SetMaxStackSize(runtime, limits.stackBytes);
      JS_SetInterruptHandler(runtime, &State::interrupt, this);
      context = JS_NewContext(runtime);
      if (context == nullptr) return "the engine's context could not be created";
      JS_SetContextOpaque(context, this);
      JSValue global = JS_GetGlobalObject(context);
      JSValue function = JS_NewCFunction(context, &State::door, "__host", 2);
      int set = JS_IsException(function) ? -1 : JS_SetPropertyStr(context, global, "__host", function);
      JS_FreeValue(context, global);
      if (set < 0) {
        dropException();
        return "the door to the app could not be set";
      }
      return "";
    }

    void stop() {
      if (context != nullptr) {
        for (auto& entry : waiting) {
          JS_FreeValue(context, entry.second.resolve);
          JS_FreeValue(context, entry.second.reject);
        }
        waiting.clear();
        JS_FreeContext(context);
        context = nullptr;
      }
      if (runtime != nullptr) {
        JS_FreeRuntime(runtime);
        runtime = nullptr;
      }
    }

    void threadMain() {
      std::string error = start();
      if (!error.empty()) closing.store(true);
      {
        std::function<void(const std::string&)> tell;
        tell.swap(opened);
        guarded([&] { tell(error); });
      }

      for (;;) {
        Task task;
        {
          std::unique_lock<std::mutex> lock(mutex);
          wake.wait(lock, [this] { return !tasks.empty() || closing.load(); });
          if (closing.load()) break;
          task = std::move(tasks.front());
          tasks.pop_front();
        }
        deadlineNs.store(nowNs() + limits.timeMs * 1'000'000);
        RunResult result = runNow(task);
        deadlineNs.store(NEVER);
        guarded([&] { task.done(std::move(result)); });
      }

      stop();
      std::deque<Task> left;
      std::vector<std::function<void()>> waiters;
      {
        std::lock_guard<std::mutex> lock(mutex);
        finished = true;
        left.swap(tasks);
        waiters.swap(closeWaiters);
        answers.clear();
      }
      // freed here, not on whichever thread drops the last reference to the sandbox
      ask = nullptr;
      for (Task& task : left) {
        guarded([&] { task.done({Outcome::Closed, "the sandbox is closed"}); });
      }
      for (auto& done : waiters) guarded(done);
    }

    static void* threadEntry(void* argument) {
      std::unique_ptr<std::shared_ptr<State>> holder(static_cast<std::shared_ptr<State>*>(argument));
      (*holder)->threadMain();
      return nullptr;
    }
  };

  SandboxCore::SandboxCore(Limits limits, HostAsk ask) : _state(std::make_shared<State>()) {
    _state->limits = limits;
    _state->ask = std::move(ask);
  }

  SandboxCore::~SandboxCore() {
    close(nullptr);
  }

  void SandboxCore::open(std::function<void(const std::string& error)> opened) {
    {
      std::lock_guard<std::mutex> lock(_state->mutex);
      if (_state->started) return;
      _state->started = true;
      _state->opened = std::move(opened);
    }

    // a stack of the size asked for, whatever the platform gives a thread by default
    size_t stack = _state->limits.stackBytes + STACK_HEADROOM;
    stack = (stack + STACK_PAGE - 1) / STACK_PAGE * STACK_PAGE;
    auto* holder = new std::shared_ptr<State>(_state);
    pthread_attr_t attributes;
    pthread_t thread;
    int failed = pthread_attr_init(&attributes);
    if (failed == 0) {
      failed = pthread_attr_setstacksize(&attributes, stack);
      if (failed == 0) failed = pthread_attr_setdetachstate(&attributes, PTHREAD_CREATE_DETACHED);
      if (failed == 0) failed = pthread_create(&thread, &attributes, &State::threadEntry, holder);
      pthread_attr_destroy(&attributes);
    }
    if (failed != 0) {
      delete holder;
      std::function<void(const std::string&)> tell;
      {
        std::lock_guard<std::mutex> lock(_state->mutex);
        _state->finished = true;
        _state->closing.store(true);
        tell.swap(_state->opened);
      }
      _state->ask = nullptr;
      guarded([&] { tell("the sandbox's thread could not be started (" + std::to_string(failed) + ")"); });
    }
  }

  void SandboxCore::run(std::string code, std::string name, std::function<void(RunResult)> done) {
    {
      std::lock_guard<std::mutex> lock(_state->mutex);
      if (_state->started && !_state->finished && !_state->closing.load()) {
        _state->tasks.push_back({std::move(code), std::move(name), std::move(done)});
        _state->wake.notify_all();
        return;
      }
    }
    done({Outcome::Closed, "the sandbox is closed"});
  }

  void SandboxCore::answerHost(double call, bool ok, std::string value, std::string body) {
    std::lock_guard<std::mutex> lock(_state->mutex);
    if (_state->finished || _state->closing.load()) return;
    _state->answers.push_back({static_cast<int64_t>(call), ok, std::move(value), std::move(body)});
    _state->wake.notify_all();
  }

  void SandboxCore::close(std::function<void()> done) {
    {
      std::lock_guard<std::mutex> lock(_state->mutex);
      _state->closing.store(true);
      if (_state->started && !_state->finished) {
        if (done) _state->closeWaiters.push_back(std::move(done));
        _state->wake.notify_all();
        return;
      }
    }
    if (done) done();
  }

  size_t processHeapBytes() {
#if defined(__ANDROID__)
    return static_cast<size_t>(mallinfo().uordblks);
#elif defined(__APPLE__)
    malloc_statistics_t statistics{};
    malloc_zone_statistics(nullptr, &statistics);
    return statistics.size_in_use;
#else
    return 0;
#endif
  }

} // namespace seanime::sandbox
