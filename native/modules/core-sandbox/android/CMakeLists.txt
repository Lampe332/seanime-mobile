# geschrieben nach: Plan „Eigener Kern" Stufe 3a; Aufbau wie bei einem Nitro-C++-Modul üblich (öffentliche Doku von Nitro Modules, Vergleich mit react-native-mmkv 4), Quell-Liste des Kerns aus der CMakeLists.txt von quickjs-ng (ohne quickjs-libc)
cmake_minimum_required(VERSION 3.13.0)
project(SeanimeCoreSandbox C CXX)

set(PACKAGE_NAME SeanimeCoreSandbox)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# QuickJS itself: the core only (no std, no os), unchanged sources, as a static library inside this module
set(QUICKJS_DIR ${CMAKE_SOURCE_DIR}/../cpp/third_party/quickjs-ng)
add_library(quickjs_core STATIC
        ${QUICKJS_DIR}/dtoa.c
        ${QUICKJS_DIR}/libregexp.c
        ${QUICKJS_DIR}/libunicode.c
        ${QUICKJS_DIR}/quickjs.c
)
set_target_properties(quickjs_core PROPERTIES
        C_STANDARD 11
        C_STANDARD_REQUIRED ON
        POSITION_INDEPENDENT_CODE ON
)
# NDEBUG: a value left behind by stopped code must not end the app through an assert when the engine is freed
target_compile_definitions(quickjs_core PRIVATE _GNU_SOURCE NDEBUG)
target_compile_options(quickjs_core PRIVATE -funsigned-char -w)
target_include_directories(quickjs_core PUBLIC ${QUICKJS_DIR})

# The module: the sandbox (shared C++, the same files for iOS) and the Android entry
add_library(${PACKAGE_NAME} SHARED
        ../cpp/SandboxCore.cpp
        src/main/cpp/cpp-adapter.cpp
)

# The specs Nitrogen generated
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/SeanimeCoreSandbox+autolinking.cmake)

include_directories(
        "src/main/cpp"
        "../cpp"
)

target_link_libraries(
        ${PACKAGE_NAME}
        quickjs_core
        m
)

# 16 KB pages (the NDK does it by itself from r28 on; said here so that it does not depend on that), and nothing of
# QuickJS visible outside of this library
target_link_options(${PACKAGE_NAME} PRIVATE
        "-Wl,-z,max-page-size=16384"
        "-Wl,--exclude-libs,libquickjs_core.a"
)
