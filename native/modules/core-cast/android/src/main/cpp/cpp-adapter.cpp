// geschrieben nach: Plan „Eigener Kern" Phase 7c-1 und der öffentlichen Doku von Nitro Modules (JNI_OnLoad eines C++-Moduls); keine Vorlage
#include "SeanimeCoreCastOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

// Android loads the library (SeanimeCoreCastOnLoad.kt): the search and the lock become known to Nitro
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() { margelo::nitro::seanime::corecast::registerAllNatives(); });
}
