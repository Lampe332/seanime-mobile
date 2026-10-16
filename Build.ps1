param(
    [Parameter(Mandatory=$true)][string]$ToolchainRoot,
    [string]$WorkDirectory = (Join-Path $env:TEMP 'Seanime-Android-Build'),
    [switch]$RebuildBackend
)
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$ToolchainRoot = (Resolve-Path -LiteralPath $ToolchainRoot).Path
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
if ($WorkDirectory.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a build work directory outside the delivered source project.'
}
New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
$buildRoot = Join-Path $WorkDirectory ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildRoot | Out-Null
& robocopy $sourceRoot $buildRoot /E /XD .gradle build node_modules /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw 'Source staging failed.' }
$env:ANDROID_HOME = Join-Path $ToolchainRoot 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $ToolchainRoot 'gradle-cache'
$signingRoot = Join-Path (Split-Path $sourceRoot -Parent) 'seanime-mobile-signing'
if (-not $env:SEANIME_SIGNING_STORE -and (Test-Path -LiteralPath (Join-Path $signingRoot 'seanime-android.p12'))) {
    $env:SEANIME_SIGNING_STORE = Join-Path $signingRoot 'seanime-android.p12'
}
if (-not $env:SEANIME_SIGNING_PASSWORD) {
    $signingPasswordFile = Join-Path $signingRoot 'password.txt'
    if (-not (Test-Path -LiteralPath $signingPasswordFile)) {
        throw 'Set SEANIME_SIGNING_STORE, SEANIME_SIGNING_ALIAS and SEANIME_SIGNING_PASSWORD for a signed release. Use gradlew.bat :app:assembleDebug for a local debug build.'
    }
    $env:SEANIME_SIGNING_PASSWORD = (Get-Content -LiteralPath $signingPasswordFile -Raw).Trim()
}
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'))) {
    throw 'Android SDK platform 36 is required.'
}
if ($RebuildBackend) {
    $env:GOPATH = Join-Path $ToolchainRoot 'gopath'
    $env:GOMODCACHE = Join-Path $env:GOPATH 'pkg\mod'
    $env:GOCACHE = Join-Path $ToolchainRoot 'go-cache'
    $env:npm_config_cache = Join-Path $ToolchainRoot 'npm-cache'
    $env:SEA_PUBLIC_PLATFORM = 'mobile'
    Push-Location (Join-Path $buildRoot 'backend\seanime-web')
    try {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build or TypeScript check failed.' }
    } finally { Pop-Location }
    # Keep the supplied embedded bundle as a reference; build from a clean web directory.
    $embedded = Join-Path $buildRoot 'backend\web'
    $reference = Join-Path $buildRoot 'supplied-web-bundle'
    if (-not $embedded.StartsWith($buildRoot,[StringComparison]::OrdinalIgnoreCase) -or
        -not $reference.StartsWith($buildRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path.' }
    Move-Item -LiteralPath $embedded -Destination $reference
    New-Item -ItemType Directory -Path $embedded | Out-Null
    Copy-Item -Path (Join-Path $buildRoot 'backend\seanime-web\out\*') -Destination $embedded -Recurse
    $env:GOOS = 'android'
    $env:CGO_ENABLED = '1'
    $env:CGO_LDFLAGS = '-Wl,-z,max-page-size=16384'
    $ndkBin = Join-Path $env:ANDROID_HOME 'ndk\29.0.14206865\toolchains\llvm\prebuilt\windows-x86_64\bin'
    foreach ($target in @(
        @{Arch='arm64'; Abi='arm64-v8a'; Compiler='aarch64-linux-android21'},
        @{Arch='arm'; Abi='armeabi-v7a'; Compiler='armv7a-linux-androideabi21'}
    )) {
        $env:GOARCH = $target.Arch
        $env:GOARM = '7'
        $env:CC = Join-Path $ndkBin ($target.Compiler + '-clang.cmd')
        $env:CXX = Join-Path $ndkBin ($target.Compiler + '-clang++.cmd')
        $nativeFile = Join-Path $buildRoot ('app\src\main\jniLibs\' + $target.Abi + '\libseanime.so')
        & (Join-Path $ToolchainRoot 'go\bin\go.exe') build -C (Join-Path $buildRoot 'backend') -p 2 -buildvcs=false -trimpath -buildmode=pie -tags=nosystray -ldflags='-s -w -checklinkname=0' -o $nativeFile .
        if ($LASTEXITCODE -ne 0) { throw ('Native build failed: ' + $target.Abi) }
    }
}
Push-Location $buildRoot
try {
    & '.\gradlew.bat' --no-daemon --console=plain --max-workers=2 :app:assembleRelease :app:lintRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }
} finally { Pop-Location }
$apk = Join-Path $buildRoot 'app\build\outputs\apk\release\app-release.apk'
& (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat') verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
& (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\zipalign.exe') -c -P 16 4 $apk
if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
$result = Join-Path $WorkDirectory 'Seanime-Mobile-1.3.3-31009.apk'
Copy-Item -LiteralPath $apk -Destination $result -Force
Write-Output ('PASS: signed APK built and verified: ' + $result)
