# Building Seanime Mobile

Step-by-step guide for Windows 10/11 (PowerShell). Applies to app 2.0.0 (versionCode 31095) with Seanime backend 3.10.4.

There are two ways to build:

| Path | When | Requires |
|---|---|---|
| **A: Android app only** | You change Kotlin code (`app/`) | JDK 21 + Android SDK |
| **B: Everything** | You change the backend (`backend/`) or the UI (`backend/seanime-web/`) | additionally Go, Node.js, Android NDK |

Path A uses the prebuilt backend binaries shipped in `app/src/main/jniLibs/<abi>/libseanime.so`.

---

## 1. Install the tools

### JDK, Node.js and Git

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Reopen PowerShell afterwards and check:

```powershell
java -version    # openjdk version "21..."
node -v          # current LTS
```

Gradle itself (9.2.1, via `gradlew.bat`) and the Android Gradle Plugin (9.0.1) are downloaded automatically on the first build.

### Create a toolchain folder

`Build.ps1` expects all Android and Go tools in **one** folder that you pass as `-ToolchainRoot`. Any location works; this guide uses `C:\Android-Toolchain` as an example:

```
C:\Android-Toolchain\
├─ android-sdk\
│  ├─ platforms\android-36\
│  ├─ build-tools\36.0.0\
│  ├─ platform-tools\
│  └─ ndk\29.0.14206865\          (path B only)
├─ go\bin\go.exe                  (path B only)
├─ gradle-cache\                  (created by the build)
└─ gopath\  go-cache\  npm-cache\ (created by the build, path B only)
```

### Android SDK

1. Download the [Android command-line tools](https://developer.android.com/studio#command-line-tools-only) for Windows.
2. Extract them to `C:\Android-Toolchain\android-sdk\cmdline-tools\latest\` (so that `bin\sdkmanager.bat` exists there).
3. Install the packages:

```powershell
$sdk = 'C:\Android-Toolchain\android-sdk'
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;29.0.14206865"
```

The NDK (about 1 GB) is only needed for path B. `Build.ps1` uses exactly NDK `29.0.14206865` and build-tools `36.0.0`.

### Go (path B only)

Download [Go for Windows (ZIP)](https://go.dev/dl/) and extract it so that `C:\Android-Toolchain\go\bin\go.exe` exists. If your Go is older than the version required by `backend/go.mod`, Go downloads the required toolchain automatically on the first build.

---

## 2. Get the source

```powershell
git clone https://github.com/Lampe332/seanime-mobile.git
cd seanime-mobile
```

---

## 3A. Build the Android app only (debug)

```powershell
$env:ANDROID_HOME = 'C:\Android-Toolchain\android-sdk'
.\gradlew.bat --no-daemon :app:assembleDebug
```

Output: `app\build\outputs\apk\debug\app-debug.apk`

Install it on a phone (USB debugging enabled):

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

> A debug build is signed with a different key and uses the same package ID (`com.seanime.app.local`) as a release. It **cannot** be installed over an installed release. Uninstall first, or build a signed release (see section 4).

## 3B. Build everything (backend + UI + app)

```powershell
.\Build.ps1 -ToolchainRoot 'C:\Android-Toolchain' -WorkDirectory 'D:\Seanime-Build' -RebuildBackend
```

Parameters:

| Parameter | Required | Meaning |
|---|---|---|
| `-ToolchainRoot` | yes | The toolchain folder from section 1. |
| `-WorkDirectory` | no | Where staging copies and the final APK go. Default: `%TEMP%\Seanime-Android-Build`. `D:\Seanime-Build` above is only an example. It must be **outside** your checkout. |
| `-RebuildBackend` | no | Also rebuild the UI and the Go backend. |

The script:

1. copies the source into a new staging folder `<WorkDirectory>\<random id>\` (your checkout stays clean; staging folders are not deleted automatically),
2. builds the React UI (`npm ci`, `npm run build`, which includes the TypeScript check) and embeds it into `backend/web`,
3. compiles the Go backend for `arm64-v8a` and `armeabi-v7a` as `libseanime.so` (with 16 KiB page alignment),
4. runs `:app:assembleRelease :app:lintRelease`, then verifies the APK signature (`apksigner verify`) and 16 KiB zip alignment (`zipalign -c -P 16 4`),
5. copies the result to `<WorkDirectory>\Seanime-Mobile-<versionName>.apk` and prints `PASS: signed APK built and verified: ...`.

Without `-RebuildBackend` only steps 1, 4 and 5 run. Node.js and `npm` must be on `PATH` for step 2.

`<versionName>` is read from the default value in `app/build.gradle.kts` (currently `2.0.0`), so the output is `Seanime-Mobile-2.0.0.apk`.

`Build.ps1` always produces a **signed** release and therefore needs a signing key (next section).

---

## 4. Signing

Android only installs an update if it is signed with **the same key** as the installed app. The private key of the official releases is not part of this repository, so builds you sign yourself cannot update an official installation (and vice versa).

### Create your own key (once)

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore <path-to-your-key>.p12 -alias seanime-android -keyalg RSA -keysize 4096 -validity 10000
```

Keep the key file and its password safe and outside the repository. Without them you cannot build updates for your own installation. The build uses the same password for the keystore and the key, which is the default for PKCS12 keystores.

### Provide the key

Either through environment variables (read by `app/build.gradle.kts`):

```powershell
$env:SEANIME_SIGNING_STORE    = '<path-to-your-key>.p12'
$env:SEANIME_SIGNING_ALIAS    = 'seanime-android'   # optional, this is the default
$env:SEANIME_SIGNING_PASSWORD = '<your password>'
```

or as a folder **next to** the repository, which is picked up automatically:

```
seanime-mobile\                  (this repository)
seanime-mobile-signing\
├─ seanime-android.p12
└─ password.txt                  (only the password, one line)
```

Then:

```powershell
.\Build.ps1 -ToolchainRoot 'C:\Android-Toolchain'
```

Without a key, `.\gradlew.bat :app:assembleRelease` produces an unsigned APK that cannot be installed, and `Build.ps1` stops with an error.

### Version numbers for releases

Release APKs must use a `versionName` of the form `X.Y.Z`. The in-app updater (`app/src/main/java/com/seanime/app/AppReleasePolicy.kt`) only accepts GitHub release tags `X.Y.Z` (optionally prefixed with `v`), ignores drafts and pre-releases, and only downloads an asset named `Seanime-Mobile-X.Y.Z.apk`. Change `versionName` and `versionCode` in `app/build.gradle.kts` together; `versionCode` must increase with every release.

---

## 5. Tests

```powershell
# Android lint
.\gradlew.bat :app:lintRelease

# UI: TypeScript + unit tests
cd backend\seanime-web
npm ci
npm run typecheck
npm test
cd ..\..

# Browser tests (Python + Playwright); need npm ci in backend\seanime-web first
python -m pip install playwright
python -m playwright install chromium
python tests\mobile_navigation.py
python tests\plugin_dom.py
```

More UI harnesses live in `tests\` (see [DEVELOPMENT.md](../DEVELOPMENT.md)).

On-device test (phone via USB, AniList account signed in inside the app). Instrumentation tests are built against the **release** build type, so a signing key is required (section 4):

```powershell
.\gradlew.bat :app:assembleRelease :app:assembleReleaseAndroidTest -PseanimeAuditRunner=com.seanime.app.audit.MobileInstrumentation
adb install -r app\build\outputs\apk\release\app-release.apk
adb install -r app\build\outputs\apk\androidTest\release\app-release-androidTest.apk
adb shell am instrument -w com.seanime.app.local.test/com.seanime.app.audit.MobileInstrumentation
```

This instrumentation reads the AniList list and restores the previous widget cache afterwards; it does not change AniList progress. Without `-PseanimeAuditRunner` the test APK uses the default runner `com.seanime.app.audit.OfflineInstrumentation`.

### Test a first start without touching the installed app

A copy with its own package ID (`com.seanime.app.local.fresh`) can be installed next to the normal app and starts completely empty, including the setup wizard and tutorial:

```powershell
.\gradlew.bat :app:assembleRelease -PseanimeAppIdSuffix=.fresh
adb shell am force-stop com.seanime.app.local
adb install -r app\build\outputs\apk\release\app-release.apk
```

Both apps use the same local server port (`127.0.0.1:43211`). Stop the normal app first, otherwise the test copy connects to its server. Remove it afterwards with `adb uninstall com.seanime.app.local.fresh`.

### Phones and tablets

One APK serves both. At start the web app checks the screen: when its smaller side is 600 CSS px or more (the Android sw600dp rule), it is a tablet (`IS_TABLET_UI` in `src/lib/tablet-ui.ts`), and `main.tsx` sets `html[data-layout="tablet"]`. The native injections use the same rule (`UIBottomNav.kt`, `UIDiscoverPatch.kt`, `VideoControlInjector.kt`).

- A tablet shows the phone screens. `isAndroidPhone()` is true on every Android device, and `layoutWidth()` reports a phone width to the width breakpoints in JavaScript.
- `postcss.config.cjs` keeps every width media query above 430 px for phones (scoped to `:not([data-layout="tablet"])`) and adds a copy that resolves it for tablets as on a phone held upright. `:where()` keeps the specificity, so the cascade does not change on either.
- `src/app/tablet.css` lays the phone screens out for the tablet by its real width (navigation rail, two panes, side sheets). Every rule is scoped to `html[data-layout="tablet"]`.

---

## How the app is put together

```
┌──────────────── Android APK ────────────────┐
│  Kotlin shell (app/)                        │
│   • SeanimeService (foreground service)     │
│   • WebView → http://127.0.0.1:43211        │
│   • Offline player (Media3/ExoPlayer)       │
│   • Download queue                          │
│                                             │
│  libseanime.so = Go program (backend/)      │
│   • Seanime server incl. embedded           │
│     React UI (backend/web)                  │
└─────────────────────────────────────────────┘
```

`libseanime.so` is not a JNI module but an executable Go program (PIE). Android extracts it from the APK (`useLegacyPackaging = true`) and `SeanimeService` starts it from `nativeLibraryDir`. More details: [upstream/DEVELOPMENT.md](upstream/DEVELOPMENT.md).

## Troubleshooting

| Error | Fix |
|---|---|
| `Android SDK platform 36 is required.` | Run `sdkmanager "platforms;android-36"`, check `-ToolchainRoot` |
| `Set SEANIME_SIGNING_STORE, SEANIME_SIGNING_ALIAS and SEANIME_SIGNING_PASSWORD ...` | Provide a signing key, see section 4 |
| `APK signature verification failed.` | The keystore path is wrong or missing, so Gradle built an unsigned APK; check `SEANIME_SIGNING_STORE` |
| `Choose a build work directory outside the delivered source project.` | Pass a `-WorkDirectory` outside your checkout |
| `Native build failed: arm64-v8a` | NDK `29.0.14206865` is missing, or `go\bin\go.exe` is not in the toolchain folder |
| `npm ci failed.` | Is Node.js installed? Reopen PowerShell after installing it |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Different signing key than the installed app; uninstall the old app |
