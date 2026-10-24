# Development

Guide for contributors to Seanime Mobile, the Android app that bundles the Seanime server and UI.

## Repository layout

| Path | Contents |
|---|---|
| `app/` | Android app (Kotlin): WebView shell, `SeanimeService`, offline player, downloads, in-app updater |
| `app/src/main/jniLibs/<abi>/libseanime.so` | Prebuilt Go backend, packaged as an executable native library |
| `backend/` | Seanime server (Go), an Android-only fork of Seanime 3.10.4 |
| `backend/seanime-web/` | React UI, embedded into `backend/web` by the release build |
| `tests/` | Python/Playwright UI harnesses and helpers |
| `docs/` | Build guide, README images, the original Android port's README |
| `Build.ps1` | Release build script (Windows/PowerShell) |
| `CHANGELOG.md` | App changelog |

## Building

See **[docs/BUILD.md](docs/BUILD.md)**. Kotlin-only changes need just the Android SDK (`.\gradlew.bat :app:assembleDebug`); UI or backend changes need `.\Build.ps1 -RebuildBackend`.

## UI

The UI lives in `backend/seanime-web/src` and only targets the Android app, on phones and tablets:

- screens build on the shared phone kit in `app/(main)/_features/phone-screen` (`phone-screen.tsx`, `phone-screen.css`),
- a tablet (smaller screen side of 600 CSS px or more) gets `html[data-layout="tablet"]` from `src/lib/tablet-ui.ts`, and `src/app/tablet.css` lays the same screens out for its width.

Reuse the phone kit instead of adding screen-specific styling. The Kotlin injections (`UIBottomNav.kt`, `UIHomePatch.kt`, `VideoControlInjector.kt`) read data attributes and classes of the React DOM, so check them before renaming one.

## Checks

Run from `backend/seanime-web` (after `npm ci`):

```powershell
npx tsc --noEmit
npx vitest run
```

UI harnesses in `tests/` need Python with Playwright (`python -m pip install playwright`, `python -m playwright install chromium`) and the `node_modules` from `backend/seanime-web`. Run them from the repository root:

```powershell
python tests/<name>.py [screenshot-dir]
```

Most harnesses (`mobile_*.py` with a matching `mobile_*_bundle.cjs`) bundle the real page with stubs via esbuild, load it in headless Chromium and save screenshots to the optional directory. They take the app's CSS from a local `npm run build` (`backend/seanime-web/out`) or, without one, from the committed `backend/web` (`tests/web_build.py`). A few scripts differ: `mobile_navigation.py` takes an optional repository root instead, and `*_device.py` scripts need a connected phone.

Before a pull request, also run `.\gradlew.bat :app:lintRelease` for Kotlin changes.

## Versioning

`app/build.gradle.kts` defines the version:

- `versionCode` defaults to its literal fallback, overridable with `-PseanimeBaselineCode=...`.
- `versionName` defaults to its literal fallback, overridable with `-PseanimeBaselineVersion=...`.

`Build.ps1` names its output after the literal `versionName` fallback, so bump both literals for a release. `versionCode` must always increase.

Release versions must use the form `X.Y.Z`: the in-app updater (`app/src/main/java/com/seanime/app/AppReleasePolicy.kt`) only accepts release tags `X.Y.Z` (optionally `vX.Y.Z`) and assets named `Seanime-Mobile-X.Y.Z.apk`.

## Changelog and release notes

Changelog entries and GitHub release notes follow the style defined in **[AGENTS.md](AGENTS.md)** (English, `## What's new?`, fixed emoji markers per change type). Read it before editing `CHANGELOG.md` or preparing a release.
