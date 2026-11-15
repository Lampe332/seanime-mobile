# Building Seanime Mobile

The app is the Expo / React Native project in `native/`, with its own core in TypeScript (`native/src/core/`). There is no Go server, no `backend/` folder and no `libseanime.so` any more; the build script checks that the APK carries none.

Everything below is for Windows 10/11 with PowerShell, because the build script is a PowerShell script.

## 1. Prerequisites

The script `native/scripts/build-android.ps1` expects one toolchain folder of your own, passed as `-ToolchainRoot`. It reads these parts of it:

| Path inside `-ToolchainRoot` | Used for |
|---|---|
| `android-sdk\` | Android SDK; the script sets `ANDROID_HOME` and `ANDROID_SDK_ROOT` to it |
| `android-sdk\cmake\3.31.6\` | CMake with a long-path-aware ninja for the React Native C++ builds. Missing, the script stops and prints the `sdkmanager` command that installs it |
| `android-sdk\build-tools\36.0.0\` | `apksigner`, `zipalign` and `aapt2` for checking the finished APK |
| `gradle-cache\` | Gradle's cache (the script links it to a short path in the work directory) |
| `npm-cache\` | npm's cache |

Besides that you need, on `PATH`:

- **Node.js with npm** (`npx` runs `patch-package` and `expo prebuild`). The script's notes refer to Node 24.
- **A JDK** for Gradle (`JAVA_HOME` or `java` on `PATH`; the script does not set one).
- **The Android NDK** in the SDK, in the version React Native's Gradle setup asks for (`ndkVersion` in `native/node_modules/react-native/gradle/libs.versions.toml`).

Install the JavaScript dependencies once (this also applies the library patches in `native/patches/` through `postinstall`):

```powershell
cd native
npm install
```

## 2. App variants

`native/app-variants.json` lists the variants. `app.config.js` and `src/lib/app-variant.ts` both read it; the build script switches `current` only in its staged copy, never in the checkout.

| Variant | How to build | Package | Signed with |
|---|---|---|---|
| `test` (default) | `-Variant test` or nothing | `com.seanime.app.native` | debug key |
| `scratch` | `-Variant scratch` | `com.seanime.app.scratch`, debuggable (`adb shell run-as` can read its files) | debug key |
| `release` | `-Release` | `com.seanime.app.local` | the project's release key (not part of this repository) |

The variants have different package names, so they install side by side.

## 3. Build

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File native\scripts\build-android.ps1 -ToolchainRoot <your toolchain folder> -Variant scratch
```

or from `native/` with the same parameters after `--`:

```powershell
npm run build:android -- -ToolchainRoot <your toolchain folder>
```

Parameters:

| Parameter | Meaning |
|---|---|
| `-ToolchainRoot <path>` | Required. Your toolchain folder (section 1) |
| `-Variant test\|scratch` | Which variant; default `test` |
| `-Release` | The release variant. Needs the release signing key, which is read at build time from a `seanime-mobile-signing` folder next to the repository or from `SEANIME_SIGNING_STORE`, `SEANIME_SIGNING_PASSWORD` and `SEANIME_SIGNING_ALIAS`. Refused together with `-Variant scratch` or `-Debuggable` |
| `-Debuggable` | A debuggable build of the test variant |
| `-WorkDirectory <path>` | Where the build runs and the APK lands; default `D:\SNB`. Must be outside the repository. Keep it short: ninja on Windows fails on object paths over 260 characters |

What the script does:

1. Mirrors `native/` into `<WorkDirectory>\s` (without `android/`, which is generated) and sets the variant there.
2. Runs `patch-package` and `expo prebuild --platform android --clean`.
3. Builds with `gradlew assembleRelease` (the `test` and `scratch` variants are signed with the debug key; `-Release` is signed again with the release key).
4. Checks the APK: one signer (the expected certificate), 16 KiB alignment, package name, version name and code, app label, debuggable flag, and that no `libseanime.so` is inside.
5. Copies it to `<WorkDirectory>\Seanime-Native-<version>-<variant>.apk` (release: `Seanime-Mobile-<version>.apk`) and prints `PASS: …` with its size.

Install it on a device with `adb install -r <apk>`.

## 4. Checks

Run these in `native/` before a commit:

```powershell
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run lint        # expo lint
```

The tests need no device: the core runs against Node's built-in SQLite and test doubles for the network.
