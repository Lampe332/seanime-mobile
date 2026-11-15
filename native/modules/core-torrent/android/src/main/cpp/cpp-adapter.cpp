// geschrieben nach: Plan „Eigener Kern" Stufe 6b-1 (Muster: modules/core-sandbox) und der öffentlichen Doku von Nitro Modules (JNI_OnLoad eines C++-Moduls); keine Vorlage
#include "SeanimeCoreTorrentOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

// Android loads the library (SeanimeCoreTorrentOnLoad.kt): the torrent session becomes known to Nitro
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() { margelo::nitro::seanime::coretorrent::registerAllNatives(); });
}
