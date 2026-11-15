# geschrieben nach: Plan „Eigener Kern" Stufe 6b-1/6b-3, docs/EIGENER-KERN.md §4q, den CMakeLists.txt von libtorrent 2.1.2 (Schalter, Suche nach OpenSSL::SSL) und von BoringSSL (Ziele crypto und ssl); keine Vorlage
#
# libtorrent as a static library with TLS, for the module's CMakeLists.txt of each platform.
# In: SEANIME_LIBTORRENT_DIR, SEANIME_BOOST_DIR, SEANIME_BORINGSSL_DIR (fetch-deps.cmake). Out: the target torrent-rasterbar.

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
# BoringSSL's tests need Go; only its two libraries are built
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# hidden only for the libraries inside: the module's own code keeps the visibility Nitro's types need
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

# TLS: BoringSSL (libcrypto + libssl), static. It builds with CMake and the NDK alone (OpenSSL's build wants Perl and
# make on the build machine). libtorrent takes TLS when the targets OpenSSL::SSL and OpenSSL::Crypto exist; they are
# imported names for BoringSSL's two libraries, so that libtorrent's own search (FindOpenSSL) has nothing to find.
add_subdirectory("${SEANIME_BORINGSSL_DIR}" boringssl EXCLUDE_FROM_ALL)
foreach(part crypto ssl)
    # small instead of fast (after the build type's -O2, so it wins), and every function droppable by the linker
    target_compile_options(${part} PRIVATE -Os -ffunction-sections -fdata-sections -w)
endforeach()
add_library(OpenSSL::Crypto INTERFACE IMPORTED)
target_link_libraries(OpenSSL::Crypto INTERFACE crypto)
add_library(OpenSSL::SSL INTERFACE IMPORTED)
target_link_libraries(OpenSSL::SSL INTERFACE ssl)

# libtorrent: no WebTorrent, no I2P, no deprecated functions
set(webtorrent OFF CACHE BOOL "" FORCE)
set(deprecated-functions OFF CACHE BOOL "" FORCE)
set(i2p OFF CACHE BOOL "" FORCE)
set(Boost_INCLUDE_DIR "${SEANIME_BOOST_DIR}" CACHE PATH "" FORCE)
add_subdirectory("${SEANIME_LIBTORRENT_DIR}" libtorrent EXCLUDE_FROM_ALL)
unset(CMAKE_C_VISIBILITY_PRESET)
unset(CMAKE_CXX_VISIBILITY_PRESET)
unset(CMAKE_VISIBILITY_INLINES_HIDDEN)
target_compile_options(torrent-rasterbar PRIVATE -Os -ffunction-sections -fdata-sections -w)

# a build without TLS must not pass unnoticed (HTTPS trackers and web seeds would fail at run time only)
get_target_property(seanime_torrent_defines torrent-rasterbar INTERFACE_COMPILE_DEFINITIONS)
if(NOT "${seanime_torrent_defines}" MATCHES "TORRENT_USE_OPENSSL")
    message(FATAL_ERROR "core-torrent: libtorrent was configured without TLS (${seanime_torrent_defines})")
endif()
