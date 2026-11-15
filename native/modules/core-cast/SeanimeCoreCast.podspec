# geschrieben nach: Plan „Eigener Kern" Phase 7c-1 und der öffentlichen Doku von Nitro Modules (podspec eines Nitro-C++-Moduls); für iOS bisher ungebaut
require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "SeanimeCoreCast"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/Lampe332/seanime-mobile"
  s.license      = package["license"]
  s.authors      = "Seanime Mobile"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :path => "." }

  # The search (shared C++, the same files as for Android). iOS asks for the multicast entitlement before it lets an app search.
  s.source_files = ["cpp/*.{hpp,cpp}"]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES",
    "HEADER_SEARCH_PATHS" => "\"${PODS_TARGET_SRCROOT}/cpp\""
  }

  load "nitrogen/generated/ios/SeanimeCoreCast+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
