# geschrieben nach: Plan „Eigener Kern" Stufe 6b-1 und dem Bautest aus Phase 6a (docs/EIGENER-KERN.md §4q); Aufbau wie modules/core-sandbox (Nitro-C++-Modul); libtorrent und TLS in cmake/libtorrent.cmake
cmake_minimum_required(VERSION 3.22.1)
project(SeanimeCoreTorrent CXX)

set(PACKAGE_NAME SeanimeCoreTorrent)

# libtorrent 2.1.2, the Boost headers and BoringSSL: loaded once into the Gradle cache, not part of the repository
include(${CMAKE_SOURCE_DIR}/../cmake/fetch-deps.cmake)

# libtorrent as a static library inside this module, with TLS (BoringSSL) for HTTPS trackers and HTTPS web seeds
include(${CMAKE_SOURCE_DIR}/../cmake/libtorrent.cmake)

# The module: the session (shared C++, the same files for iOS) and the Android entry
add_library(${PACKAGE_NAME} SHARED
        ../cpp/TorrentCore.cpp
        ../cpp/TorrentServe.cpp
        ../cpp/StreamServer.cpp
        src/main/cpp/cpp-adapter.cpp
)
set_target_properties(${PACKAGE_NAME} PROPERTIES
        CXX_STANDARD 20
        CXX_STANDARD_REQUIRED ON
)
target_compile_options(${PACKAGE_NAME} PRIVATE -Wall -Wextra)

# The specs Nitrogen generated
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/SeanimeCoreTorrent+autolinking.cmake)

target_include_directories(${PACKAGE_NAME} PRIVATE
        "src/main/cpp"
        "../cpp"
)

target_link_libraries(
        ${PACKAGE_NAME}
        torrent-rasterbar
        # the outlet's one line per request (StreamServer.cpp)
        log
)

# 16 KB pages (the NDK does it by itself from r28 on; said here so that it does not depend on that), unused parts of
# libtorrent dropped, and nothing of libtorrent visible outside of this library
target_link_options(${PACKAGE_NAME} PRIVATE
        "-Wl,-z,max-page-size=16384"
        "-Wl,--gc-sections"
        "-Wl,--exclude-libs,ALL"
)
