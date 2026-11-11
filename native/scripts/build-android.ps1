# Builds the native APK: Go server -> Expo prebuild -> Gradle release.
# Usage (Git Bash, never with exported Go env):
#   env -u GOROOT -u GOTOOLCHAIN -u GOPATH -u GOCACHE powershell.exe -NoProfile -ExecutionPolicy Bypass \
#     -File native/scripts/build-android.ps1 -ToolchainRoot '<tools>' [-WorkDirectory 'D:\SNB'] [-SkipGoBuild] [-Release]
# Default: the test app (app-variants.json "test": com.seanime.app.native, port 43212, debug key, green icon)
#   -> <WorkDirectory>\Seanime-Native-<version>-test.apk
# -Release: the app that replaces Seanime Mobile 2.0.33 (app-variants.json "release": com.seanime.app.local, port 43211,
#   versionCode above 31128, real icon), signed with the real key -> <WorkDirectory>\Seanime-Mobile-<version>.apk, the
#   only asset name the 2.0.33 updater accepts (AppReleasePolicy.kt). The key is read at build time from
#   ..\seanime-mobile-signing\ next to the repository (seanime-android.p12 + password.txt, like Build.ps1) or from
#   SEANIME_SIGNING_STORE / SEANIME_SIGNING_PASSWORD / SEANIME_SIGNING_ALIAS; it is never copied or printed.
# -SkipGoBuild reuses the libseanime.so files already in jniLibs (only when backend/ did not change since they were built).
# Keep WorkDirectory short: CMake puts the staged source path twice into object file paths, and ninja on Windows
# fails above 260 characters (D:\Seanime-Native-Build was already too long for react-native-reanimated).
param(
    [Parameter(Mandatory=$true)][string]$ToolchainRoot,
    [string]$WorkDirectory = 'D:\SNB',
    [switch]$SkipGoBuild,
    [switch]$Release
)
$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $nativeRoot -Parent
$ToolchainRoot = (Resolve-Path -LiteralPath $ToolchainRoot).Path
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
if ($WorkDirectory.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a build work directory outside the repository.'
}
New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $nativeRoot 'app.json') -Raw | ConvertFrom-Json).expo.version
$variantName = if ($Release) { 'release' } else { 'test' }
$variant = (Get-Content -LiteralPath (Join-Path $nativeRoot 'app-variants.json') -Raw | ConvertFrom-Json).variants.$variantName
if (-not $variant) { throw "app-variants.json has no variant $variantName." }
# Certificate of Seanime Mobile 2.0.33 (public, printed by apksigner for the GitHub release APK). A release signed with
# another key would never install over it.
$releaseCertSha256 = 'a5da25c722fd776fe92935544801f2661d0690b0afd73d69e4cba58f1f23a7d4'
$oldAppVersionCode = 31128
if ($Release) {
    if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "app.json version $version is not x.y.z (the release tag and versionName)." }
    if ($variant.versionCode -le $oldAppVersionCode) { throw "Release versionCode must be above $oldAppVersionCode." }
    $signingRoot = Join-Path (Split-Path $repoRoot -Parent) 'seanime-mobile-signing'
    $signingStore = if ($env:SEANIME_SIGNING_STORE) { $env:SEANIME_SIGNING_STORE } else { Join-Path $signingRoot 'seanime-android.p12' }
    $signingAlias = if ($env:SEANIME_SIGNING_ALIAS) { $env:SEANIME_SIGNING_ALIAS } else { 'seanime-android' }
    if (-not (Test-Path -LiteralPath $signingStore)) { throw 'Release signing key not found (seanime-mobile-signing next to the repository, or SEANIME_SIGNING_STORE).' }
    $passwordSet = [bool]$env:SEANIME_SIGNING_PASSWORD
    if (-not $passwordSet) {
        $passwordFile = Join-Path $signingRoot 'password.txt'
        if (-not (Test-Path -LiteralPath $passwordFile)) { throw 'Release signing password not found (password.txt or SEANIME_SIGNING_PASSWORD).' }
    }
}

$env:ANDROID_HOME = Join-Path $ToolchainRoot 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
# CMake/ninja (React Native C++ builds) fail on paths over 260 characters, and prefab paths inside the Gradle cache
# get that long under a deep toolchain folder. A short junction keeps the shared cache under a short path.
$gradleHome = Join-Path $WorkDirectory 'g'
if (-not (Test-Path -LiteralPath $gradleHome)) {
    New-Item -ItemType Junction -Path $gradleHome -Target (Join-Path $ToolchainRoot 'gradle-cache') | Out-Null
}
$env:GRADLE_USER_HOME = $gradleHome
$env:npm_config_cache = Join-Path $ToolchainRoot 'npm-cache'
$env:CI = '1'
# uniwind's Tailwind scanner (@tailwindcss/oxide, Rust/rayon) makes Node crash with 0xC0000005 while exiting after the
# JS bundle is written (Windows, Node 24); Gradle then fails :app:createBundleReleaseJsAndAssets. One rayon thread avoids it
# (0/8 crashes vs. ~1/4 without, measured 02.11.2026).
$env:RAYON_NUM_THREADS = '1'

# 1. Go server -> modules/seanime-server/android/src/main/jniLibs/<abi>/libseanime.so (same ABIs and flags as Build.ps1,
#    plus the tag nowebui: the native app draws its own screens, so the web UI stays out of the binary, backend/web_none.go).
# tools\go is too old for backend/go.mod; use the downloaded go1.27.1 toolchain directly.
$goRoot = Join-Path $ToolchainRoot 'gopath\pkg\mod\golang.org\toolchain@v0.0.1-go1.27.1.windows-amd64'
if (-not (Test-Path -LiteralPath (Join-Path $goRoot 'bin\go.exe'))) { throw "Go toolchain missing: $goRoot" }
$goVars = 'GOROOT','GOTOOLCHAIN','GOPATH','GOMODCACHE','GOCACHE','GOOS','GOARCH','GOARM','CGO_ENABLED','CGO_LDFLAGS','CC','CXX'
$env:GOROOT = $goRoot
$env:GOTOOLCHAIN = 'local'
$env:GOPATH = Join-Path $ToolchainRoot 'gopath'
$env:GOMODCACHE = Join-Path $env:GOPATH 'pkg\mod'
$env:GOCACHE = Join-Path $ToolchainRoot 'go-cache'
$env:GOOS = 'android'
$env:CGO_ENABLED = '1'
$env:CGO_LDFLAGS = '-Wl,-z,max-page-size=16384'
$ndkBin = Join-Path $env:ANDROID_HOME 'ndk\29.0.14206865\toolchains\llvm\prebuilt\windows-x86_64\bin'
$jniLibs = Join-Path $nativeRoot 'modules\seanime-server\android\src\main\jniLibs'
try {
    foreach ($target in @(
        @{Arch='arm64'; Abi='arm64-v8a'; Compiler='aarch64-linux-android21'},
        @{Arch='arm'; Abi='armeabi-v7a'; Compiler='armv7a-linux-androideabi21'}
    )) {
        $env:GOARCH = $target.Arch
        $env:GOARM = '7'
        $env:CC = Join-Path $ndkBin ($target.Compiler + '-clang.cmd')
        $env:CXX = Join-Path $ndkBin ($target.Compiler + '-clang++.cmd')
        $out = Join-Path $jniLibs ($target.Abi + '\libseanime.so')
        if ($SkipGoBuild) {
            if (-not (Test-Path -LiteralPath $out)) { throw "-SkipGoBuild, but no Go server built yet: $out" }
            Write-Output ('Go server reused: ' + $out + ' (' + (Get-Item -LiteralPath $out).LastWriteTime.ToString('s') + ')')
            continue
        }
        & (Join-Path $goRoot 'bin\go.exe') build -C (Join-Path $repoRoot 'backend') -p 2 -buildvcs=false -trimpath -buildmode=pie '-tags=nosystray,nowebui' -ldflags='-s -w -checklinkname=0' -o $out .
        if ($LASTEXITCODE -ne 0) { throw ('Go build failed: ' + $target.Abi) }
        Write-Output ('Go server built: ' + $out + ' (' + [Math]::Round((Get-Item -LiteralPath $out).Length / 1MB, 1) + ' MB)')
    }
} finally {
    # CMake (React Native C++ builds) reads CC/CXX; never let the Go cross-compilers leak into Gradle.
    foreach ($name in $goVars) { Remove-Item -Path ('Env:' + $name) -ErrorAction SilentlyContinue }
}

# 2. Stage native/ outside the repo (short path for CMake; android/ is generated there, never in the checkout).
$stage = Join-Path $WorkDirectory 's'
# Full paths: a bare "/XD android" would also skip every node_modules/**/android folder.
& robocopy $nativeRoot $stage /MIR /XD (Join-Path $nativeRoot 'android') (Join-Path $nativeRoot 'docs-shots') (Join-Path $nativeRoot '.expo') (Join-Path $stage 'android') /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw 'Staging failed.' }
# The variant switch: app.config.js (native side) and src/lib/app-variant.ts (JS bundle) both read app-variants.json.
# Only the staged copy changes; robocopy /MIR puts the repository's "test" back on the next build.
$stagedVariants = Join-Path $stage 'app-variants.json'
$variantsJson = Get-Content -LiteralPath $stagedVariants -Raw | ConvertFrom-Json
$variantsJson.current = $variantName
[IO.File]::WriteAllText($stagedVariants, ($variantsJson | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
Write-Output ('Variant: ' + $variantName + ' (' + $variant.applicationId + ', port ' + $variant.serverPort + ', versionCode ' + $variant.versionCode + ')')

Push-Location $stage
try {
    # Library patches (native/patches, e.g. expo-mpv next/previous): node_modules is mirrored, so they are normally in
    # already; this applies any that are missing (a checkout without postinstall) and logs one line per patch.
    & npx.cmd patch-package --error-on-fail
    if ($LASTEXITCODE -ne 0) { throw 'patch-package failed.' }

    # 3. Expo prebuild -> android/
    & npx.cmd expo prebuild --platform android --clean --no-install
    if ($LASTEXITCODE -ne 0) { throw 'expo prebuild failed.' }

    # AGP's default CMake 3.22.1 ships ninja 1.10, which cannot create paths over 260 characters even with Windows
    # long paths enabled; React Native codegen object paths are longer. ninja 1.12 (CMake 3.31.6) is long-path aware.
    $cmakeDir = Join-Path $env:ANDROID_HOME 'cmake\3.31.6'
    if (-not (Test-Path -LiteralPath (Join-Path $cmakeDir 'bin\ninja.exe'))) {
        throw "CMake 3.31.6 missing: sdkmanager --sdk_root=$env:ANDROID_HOME `"cmake;3.31.6`""
    }
    Add-Content -LiteralPath (Join-Path $stage 'android\local.properties') -Value ('cmake.dir=' + ($cmakeDir -replace '\\','/'))

    # 4. Gradle release build. The Expo template signs release builds with android/app/debug.keystore.
    Push-Location (Join-Path $stage 'android')
    try {
        & .\gradlew.bat --no-daemon --console=plain assembleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }

$apk = Join-Path $stage 'android\app\build\outputs\apk\release\app-release.apk'
$buildTools = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
$apksigner = Join-Path $buildTools 'apksigner.bat'

# 5. Release: replace the debug signature with the real key (apksigner keeps the 16 KiB alignment of the .so files).
if ($Release) {
    $signed = Join-Path $stage 'android\app\build\outputs\apk\release\app-release-signed.apk'
    try {
        if (-not $passwordSet) {
            $env:SEANIME_SIGNING_PASSWORD = (Get-Content -LiteralPath (Join-Path $signingRoot 'password.txt') -Raw).Trim()
        }
        & $apksigner sign --ks $signingStore --ks-type PKCS12 --ks-key-alias $signingAlias --ks-pass env:SEANIME_SIGNING_PASSWORD --key-pass env:SEANIME_SIGNING_PASSWORD --out $signed $apk
        if ($LASTEXITCODE -ne 0) { throw 'apksigner sign failed.' }
    } finally {
        if (-not $passwordSet) { Remove-Item -Path Env:SEANIME_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
    }
    $apk = $signed
}

# 6. Verify signature (release: the 2.0.33 certificate, test: debug key), 16 KiB alignment, package and the Go server.
$certs = & $apksigner verify --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$certs | Select-String -Pattern 'Signer #\d+ certificate (DN|SHA-256 digest)' | ForEach-Object { Write-Output $_.Line }
$signers = @($certs | Select-String -Pattern '^Signer #\d+ certificate DN').Count
if ($signers -ne 1) { throw "APK has $signers signers, expected 1." }
if ($Release) {
    if (-not ($certs -match "certificate SHA-256 digest: $releaseCertSha256")) { throw 'APK is not signed with the certificate of Seanime Mobile 2.0.33.' }
} elseif (-not ($certs -match 'CN=Android Debug')) { throw 'APK is not signed with the debug key.' }
& (Join-Path $buildTools 'zipalign.exe') -c -P 16 4 $apk
if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
$badging = & (Join-Path $buildTools 'aapt2.exe') dump badging $apk
$package = ($badging | Select-String '^package:' | Select-Object -First 1).Line
Write-Output $package
Write-Output (($badging | Select-String "^application-label:" | Select-Object -First 1).Line)
Write-Output (($badging | Select-String "^(min)?[sS]dkVersion:" | Select-Object -First 1).Line)
if ($package -notmatch "name='$([regex]::Escape($variant.applicationId))'") { throw "Unexpected applicationId (must be $($variant.applicationId))." }
if ($package -notmatch "versionName='$([regex]::Escape($version))'") { throw "versionName is not $version." }
if ($package -notmatch "versionCode='$($variant.versionCode)'") { throw "versionCode is not $($variant.versionCode)." }
if (-not ($badging -match "^application-label:'$([regex]::Escape($variant.name))'$")) { throw "App name is not $($variant.name)." }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    foreach ($abi in 'arm64-v8a','armeabi-v7a') {
        if (-not ($zip.Entries | Where-Object FullName -eq "lib/$abi/libseanime.so")) { throw "libseanime.so missing for $abi" }
    }
} finally { $zip.Dispose() }

$name = if ($Release) { 'Seanime-Mobile-' + $version + '.apk' } else { 'Seanime-Native-' + $version + '-test.apk' }
$result = Join-Path $WorkDirectory $name
Copy-Item -LiteralPath $apk -Destination $result -Force
$sizeMb = [Math]::Round((Get-Item -LiteralPath $result).Length / 1MB, 1)
Write-Output ('PASS: ' + $variantName + ' APK built and verified: ' + $result + ' (' + $sizeMb + ' MB)')
