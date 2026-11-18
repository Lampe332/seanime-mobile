# geschrieben nach: modules/core-torrent/android/CMakeLists.txt (16-KB-Seiten, verborgene statische Bibliothek); keine Vorlage
cmake_minimum_required(VERSION 3.22.1)
project(SeanimeCoreSodium C)

# libsodium 1.0.22 as the static target `sodium`
include(${CMAKE_SOURCE_DIR}/libsodium.cmake)

# The JNI side of CoreSodiumModule.kt: each function calls one libsodium function
add_library(seanime-core-sodium SHARED src/main/cpp/sodium-jni.c)
target_compile_options(seanime-core-sodium PRIVATE -Wall -Wextra -O2)
target_link_libraries(seanime-core-sodium sodium)

# 16 KB pages, unused parts of libsodium dropped, nothing of libsodium visible outside of this library
target_link_options(seanime-core-sodium PRIVATE
        "-Wl,-z,max-page-size=16384"
        "-Wl,--gc-sections"
        "-Wl,--exclude-libs,ALL"
)
