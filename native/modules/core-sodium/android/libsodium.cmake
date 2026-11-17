# geschrieben nach: modules/core-torrent/cmake/fetch-deps.cmake (Laden mit fester SHA-256 in den Gradle-Cache) und build.zig von libsodium 1.0.22 (Quellen und Schalter für Linux); keine eigene Kryptografie
#
# libsodium 1.0.22 from its official release archive (GitHub release 1.0.22-RELEASE, signed by the libsodium minisign
# key RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3; the signature was checked once when the hash below was
# taken). The archive is not part of the repository: it is loaded once into <GRADLE_USER_HOME or ~/.gradle>/caches/
# seanime-core-sodium/ and checked against its SHA-256 on every load. Built here as a static library with the same
# source list and switches as libsodium's own build.zig uses for Linux (every .c file; the .S files are x86-64 only).
#
# Out: the target `sodium` (static, its headers public).

set(SEANIME_SODIUM_FOLDER libsodium-1.0.22)
set(SEANIME_SODIUM_URL https://github.com/jedisct1/libsodium/releases/download/1.0.22-RELEASE/libsodium-1.0.22.tar.gz)
set(SEANIME_SODIUM_SHA256 adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349)

if(DEFINED ENV{GRADLE_USER_HOME} AND NOT "$ENV{GRADLE_USER_HOME}" STREQUAL "")
    file(TO_CMAKE_PATH "$ENV{GRADLE_USER_HOME}" seanime_gradle_home)
elseif(CMAKE_HOST_WIN32)
    file(TO_CMAKE_PATH "$ENV{USERPROFILE}/.gradle" seanime_gradle_home)
else()
    file(TO_CMAKE_PATH "$ENV{HOME}/.gradle" seanime_gradle_home)
endif()
set(seanime_sodium_cache "${seanime_gradle_home}/caches/seanime-core-sodium")
file(MAKE_DIRECTORY "${seanime_sodium_cache}")
# one configure step (one ABI) at a time fills the cache
file(LOCK "${seanime_sodium_cache}" DIRECTORY TIMEOUT 3600)

set(seanime_sodium_dir "${seanime_sodium_cache}/${SEANIME_SODIUM_FOLDER}")
set(seanime_sodium_stamp "${seanime_sodium_cache}/${SEANIME_SODIUM_FOLDER}.sha256")
set(seanime_sodium_have "")
if(EXISTS "${seanime_sodium_stamp}" AND EXISTS "${seanime_sodium_dir}/src/libsodium/include/sodium.h")
    file(READ "${seanime_sodium_stamp}" seanime_sodium_have)
    string(STRIP "${seanime_sodium_have}" seanime_sodium_have)
endif()
if(NOT seanime_sodium_have STREQUAL SEANIME_SODIUM_SHA256)
    set(archive "${seanime_sodium_cache}/${SEANIME_SODIUM_FOLDER}.tar.gz")
    message(STATUS "core-sodium: loading ${SEANIME_SODIUM_URL}")
    file(DOWNLOAD "${SEANIME_SODIUM_URL}" "${archive}.part" EXPECTED_HASH SHA256=${SEANIME_SODIUM_SHA256} TLS_VERIFY ON STATUS status)
    list(GET status 0 code)
    if(NOT code EQUAL 0)
        file(REMOVE "${archive}.part")
        message(FATAL_ERROR "core-sodium: ${SEANIME_SODIUM_URL} could not be loaded (${status}). Without a network, unpack the archive (SHA-256 ${SEANIME_SODIUM_SHA256}) into ${seanime_sodium_cache} and write its SHA-256 into ${seanime_sodium_stamp}")
    endif()
    file(RENAME "${archive}.part" "${archive}")
    file(REMOVE_RECURSE "${seanime_sodium_dir}")
    file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${seanime_sodium_cache}"
            PATTERNS "${SEANIME_SODIUM_FOLDER}/src/libsodium/*" "${SEANIME_SODIUM_FOLDER}/builds/msvc/version.h" "${SEANIME_SODIUM_FOLDER}/LICENSE")
    if(NOT EXISTS "${seanime_sodium_dir}/src/libsodium/include/sodium.h")
        message(FATAL_ERROR "core-sodium: the archive was unpacked, but src/libsodium/include/sodium.h is missing")
    endif()
    file(WRITE "${seanime_sodium_stamp}" "${SEANIME_SODIUM_SHA256}")
    file(REMOVE "${archive}")
endif()
file(LOCK "${seanime_sodium_cache}" DIRECTORY RELEASE)

# version.h comes from version.h.in through configure; the release archive carries it ready-made in builds/msvc/
# (build.zig copies it the same way)
set(seanime_sodium_gen "${CMAKE_CURRENT_BINARY_DIR}/sodium-gen")
configure_file("${seanime_sodium_dir}/builds/msvc/version.h" "${seanime_sodium_gen}/sodium/version.h" COPYONLY)

file(GLOB_RECURSE seanime_sodium_sources "${seanime_sodium_dir}/src/libsodium/*.c")
add_library(sodium STATIC ${seanime_sodium_sources})
target_include_directories(sodium
        PUBLIC "${seanime_sodium_gen}" "${seanime_sodium_dir}/src/libsodium/include"
        # version.h (generated folder) includes "export.h" from include/sodium
        "${seanime_sodium_gen}/sodium" "${seanime_sodium_dir}/src/libsodium/include/sodium")
target_compile_definitions(sodium PRIVATE
        _GNU_SOURCE=1 CONFIGURED=1 NATIVE_LITTLE_ENDIAN=1
        HAVE_ATOMIC_OPS=1 HAVE_C11_MEMORY_FENCES=1 HAVE_GCC_MEMORY_FENCES=1 HAVE_INLINE_ASM=1
        HAVE_INTTYPES_H=1 HAVE_STDINT_H=1
        ASM_HIDE_SYMBOL=.hidden TLS=_Thread_local
        HAVE_CLOCK_GETTIME=1 HAVE_GETPID=1 HAVE_MADVISE=1 HAVE_MLOCK=1 HAVE_MMAP=1 HAVE_MPROTECT=1 HAVE_NANOSLEEP=1
        HAVE_POSIX_MEMALIGN=1 HAVE_PTHREAD=1 HAVE_RAISE=1 HAVE_SYSCONF=1 HAVE_SYS_AUXV_H=1 HAVE_GETAUXVAL=1
        HAVE_SYS_MMAN_H=1 HAVE_SYS_PARAM_H=1 HAVE_WEAK_SYMBOLS=1)
# 128-bit integers only on 64-bit ABIs (arm64-v8a, x86_64)
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    target_compile_definitions(sodium PRIVATE HAVE_TI_MODE=1)
endif()
# randombytes: without HAVE_GETRANDOM libsodium calls the getrandom system call itself (any Android version) and falls
# back to /dev/urandom
target_compile_options(sodium PRIVATE -O3 -fPIC -fvisibility=hidden -fno-strict-aliasing -fno-strict-overflow -fwrapv
        -flax-vector-conversions -Werror=vla -w)
