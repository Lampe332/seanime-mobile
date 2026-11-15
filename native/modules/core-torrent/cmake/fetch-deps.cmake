# geschrieben nach: Plan „Eigener Kern" Stufe 6b-1 und der CMake-Doku (file(DOWNLOAD), file(ARCHIVE_EXTRACT), file(LOCK)); keine Vorlage
#
# libtorrent and the Boost headers are not in the repository (Boost alone is 187 MB unpacked). They come from the
# official release archives, each with a fixed version and SHA-256, and are kept outside of the repository in the Gradle
# cache: <GRADLE_USER_HOME or ~/.gradle>/caches/seanime-core-torrent/. Once that folder is filled, a build needs no
# network. Runs inside a build (include) and alone (cmake -P fetch-deps.cmake).
#
# Out: SEANIME_LIBTORRENT_DIR (the source tree), SEANIME_BOOST_DIR (the folder that holds boost/),
# SEANIME_BORINGSSL_DIR (the source tree).

set(SEANIME_LIBTORRENT_FOLDER libtorrent-rasterbar-2.1.2)
set(SEANIME_LIBTORRENT_URL https://github.com/arvidn/libtorrent/releases/download/v2.1.2/libtorrent-rasterbar-2.1.2.tar.gz)
set(SEANIME_LIBTORRENT_SHA256 3362546d9cd71b9e49ee6cac7d3f1f914ce9cdb217c86b63d5b22cbed0334dbc)

set(SEANIME_BOOST_FOLDER boost_1_92_0)
set(SEANIME_BOOST_URL https://archives.boost.io/release/1.92.0/source/boost_1_92_0.tar.gz)
set(SEANIME_BOOST_SHA256 c4a3b310ddd2472416e091067166b0713be97c63f38c212c484ada022fd296ce)

# TLS for libtorrent (HTTPS trackers, HTTPS web seeds): BoringSSL, the release archive of its GitHub release
set(SEANIME_BORINGSSL_FOLDER boringssl-0.20261105.0)
set(SEANIME_BORINGSSL_URL https://github.com/google/boringssl/releases/download/0.20261105.0/boringssl-0.20261105.0.tar.gz)
set(SEANIME_BORINGSSL_SHA256 2df2b287f3406a3d2f7f51dccb82cffbddf6cf981811e8edcfffe8fbf02c3ac4)

if(DEFINED ENV{GRADLE_USER_HOME} AND NOT "$ENV{GRADLE_USER_HOME}" STREQUAL "")
    file(TO_CMAKE_PATH "$ENV{GRADLE_USER_HOME}" seanime_gradle_home)
elseif(CMAKE_HOST_WIN32)
    file(TO_CMAKE_PATH "$ENV{USERPROFILE}/.gradle" seanime_gradle_home)
else()
    file(TO_CMAKE_PATH "$ENV{HOME}/.gradle" seanime_gradle_home)
endif()
set(SEANIME_DEPS_DIR "${seanime_gradle_home}/caches/seanime-core-torrent")
file(MAKE_DIRECTORY "${SEANIME_DEPS_DIR}")
# one configure step at a time fills the cache (released at the end of this file, or when CMake ends)
file(LOCK "${SEANIME_DEPS_DIR}" DIRECTORY TIMEOUT 3600)

# name: the archive's file name; folder: its top folder; check: a file that is there after unpacking;
# further arguments: what to unpack (everything when missing)
function(seanime_fetch name url sha256 folder check)
    set(stamp "${SEANIME_DEPS_DIR}/${folder}.sha256")
    if(EXISTS "${stamp}" AND EXISTS "${SEANIME_DEPS_DIR}/${folder}/${check}")
        file(READ "${stamp}" have)
        string(STRIP "${have}" have)
        if(have STREQUAL sha256)
            return()
        endif()
    endif()
    set(archive "${SEANIME_DEPS_DIR}/${name}")
    set(have "")
    if(EXISTS "${archive}")
        file(SHA256 "${archive}" have)
    endif()
    if(NOT have STREQUAL sha256)
        message(STATUS "core-torrent: loading ${url}")
        file(DOWNLOAD "${url}" "${archive}.part" EXPECTED_HASH SHA256=${sha256} TLS_VERIFY ON STATUS status)
        list(GET status 0 code)
        if(NOT code EQUAL 0)
            file(REMOVE "${archive}.part")
            message(FATAL_ERROR "core-torrent: ${url} could not be loaded (${status}). Without a network, put the archive (SHA-256 ${sha256}) at ${archive}")
        endif()
        file(RENAME "${archive}.part" "${archive}")
    endif()
    message(STATUS "core-torrent: unpacking ${name}")
    file(REMOVE_RECURSE "${SEANIME_DEPS_DIR}/${folder}")
    if(ARGN)
        file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${SEANIME_DEPS_DIR}" PATTERNS ${ARGN})
    else()
        file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${SEANIME_DEPS_DIR}")
    endif()
    if(NOT EXISTS "${SEANIME_DEPS_DIR}/${folder}/${check}")
        message(FATAL_ERROR "core-torrent: ${name} was unpacked, but ${folder}/${check} is missing")
    endif()
    file(WRITE "${stamp}" "${sha256}")
    # the unpacked tree is what a build uses; the archive (Boost: 235 MB) is not kept beside it
    file(REMOVE "${archive}")
endfunction()

seanime_fetch(libtorrent-rasterbar-2.1.2.tar.gz "${SEANIME_LIBTORRENT_URL}" ${SEANIME_LIBTORRENT_SHA256} ${SEANIME_LIBTORRENT_FOLDER} CMakeLists.txt)
# of Boost only the headers and its license
seanime_fetch(boost_1_92_0.tar.gz "${SEANIME_BOOST_URL}" ${SEANIME_BOOST_SHA256} ${SEANIME_BOOST_FOLDER} boost/version.hpp
        "${SEANIME_BOOST_FOLDER}/boost/*" "${SEANIME_BOOST_FOLDER}/LICENSE_1_0.txt")

# of BoringSSL what its CMake build of libcrypto and libssl reads (without the test vectors and fuzzing data: 150 MB)
set(seanime_boringssl_parts CMakeLists.txt LICENSE build.json)
foreach(part bench cmake crypto decrepit gen include pki rust ssl tool util third_party/fiat third_party/googletest third_party/benchmark)
    list(APPEND seanime_boringssl_parts "${part}/*")
endforeach()
list(TRANSFORM seanime_boringssl_parts PREPEND "${SEANIME_BORINGSSL_FOLDER}/")
seanime_fetch(boringssl-0.20261105.0.tar.gz "${SEANIME_BORINGSSL_URL}" ${SEANIME_BORINGSSL_SHA256} ${SEANIME_BORINGSSL_FOLDER} CMakeLists.txt
        ${seanime_boringssl_parts})

set(SEANIME_LIBTORRENT_DIR "${SEANIME_DEPS_DIR}/${SEANIME_LIBTORRENT_FOLDER}")
set(SEANIME_BOOST_DIR "${SEANIME_DEPS_DIR}/${SEANIME_BOOST_FOLDER}")
set(SEANIME_BORINGSSL_DIR "${SEANIME_DEPS_DIR}/${SEANIME_BORINGSSL_FOLDER}")
file(LOCK "${SEANIME_DEPS_DIR}" DIRECTORY RELEASE)
