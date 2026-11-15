// geschrieben nach: Plan „Eigener Kern" Stufe 3a und der öffentlichen Doku von Nitro Modules (JNI_OnLoad eines C++-Moduls); keine Vorlage
#include "SeanimeCoreSandboxOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

// Android loads the library (SeanimeCoreSandboxOnLoad.kt): the sandbox's HybridObjects become known to Nitro
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() { margelo::nitro::seanime::coresandbox::registerAllNatives(); });
}
