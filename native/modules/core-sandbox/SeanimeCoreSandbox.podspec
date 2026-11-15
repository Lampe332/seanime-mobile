# geschrieben nach: Plan „Eigener Kern" Stufe 3a und der öffentlichen Doku von Nitro Modules (podspec eines Nitro-C++-Moduls); für iOS bisher ungebaut
require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "SeanimeCoreSandbox"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/quickjs-ng/quickjs"
  s.license      = package["license"]
  s.authors      = "Seanime Mobile"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :path => "." }

  s.source_files = [
    # The sandbox (shared C++, the same files as for Android)
    "cpp/*.{hpp,cpp}",
    # QuickJS: the core only
    "cpp/third_party/quickjs-ng/*.{h,c}",
  ]
  s.private_header_files = "cpp/third_party/quickjs-ng/*.h"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES _GNU_SOURCE NDEBUG",
    "OTHER_CFLAGS" => "$(inherited) -funsigned-char -w",
    "HEADER_SEARCH_PATHS" => "\"${PODS_TARGET_SRCROOT}/cpp\" \"${PODS_TARGET_SRCROOT}/cpp/third_party/quickjs-ng\""
  }

  load "nitrogen/generated/ios/SeanimeCoreSandbox+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
