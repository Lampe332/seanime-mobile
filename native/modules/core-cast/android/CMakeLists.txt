# geschrieben nach: Plan „Eigener Kern" Phase 7c-1; Aufbau wie modules/core-sandbox (öffentliche Doku von Nitro Modules)
cmake_minimum_required(VERSION 3.13.0)
project(SeanimeCoreCast CXX)

set(PACKAGE_NAME SeanimeCoreCast)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The module: the search (shared C++, the same files for iOS) and the Android entry
add_library(${PACKAGE_NAME} SHARED
        ../cpp/SsdpSearch.cpp
        src/main/cpp/cpp-adapter.cpp
)

# The specs Nitrogen generated (with the JNI side of the Kotlin lock)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/SeanimeCoreCast+autolinking.cmake)

include_directories(
        "src/main/cpp"
        "../cpp"
)

# 16 KB pages (the NDK does it by itself from r28 on; said here so that it does not depend on that)
target_link_options(${PACKAGE_NAME} PRIVATE "-Wl,-z,max-page-size=16384")
