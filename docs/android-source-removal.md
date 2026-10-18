# Android source removal (1.8.6 / 31021)

## Hoster launcher

The installed `hoster-player` is a local plugin with no manifest URI or payload URI.
The backend reads its JSON file in `extension_repo.loadExternalExtension`, then runs
the payload through the plugin VM/UI bridge. Its `ensureLauncher` function created
the floating element; `updateVisibility`, DOM-ready, main-tab-ready and screen-state
callbacks restored it. The `pe-host-*` IDs came from the plugin DOM bridge.

`mobile/hoster-player.js` retains the inspected plugin's provider helpers, episode
selection, source selection and overlay playback implementation. Launcher creation,
launcher styling, its click handler, launcher state and all restoration calls are
removed. No replacement container or DOM cleanup runs. `UIHosterPlayerPatch.kt` and
its injection were deleted.

On Android only, the loader replaces the exact legacy local payload (SHA-256
`547e6b1b4f6d5a10edf39dcacf9050ce8ff859c99b8cf540e211fcafcc1ab3fc`)
with the corrected embedded source, atomically persisting it before plugin load.
Different revisions, remote/development plugins and unrelated plugins are untouched.
The plugin stays enabled. Remaining `Hoster-Player` text belongs to the retained
player panel/error messages, not a launcher. Normal streaming uses the existing
online-stream page and video player, which were not changed.

## Navigation labels

The original `.float-nav-tooltip` rule in `UIBottomNav.kt` no longer declares a
background, border, corner radius, shadow or backdrop filter. Earlier neutralizing
paint overrides on menu labels, bottom-bar labels and drag labels were removed.
Typography, label layout, icon surfaces, menu panel, dialog and active-tab paint
remain. There is no CSS hiding rule for any removed component.

## Legacy Offline screen

The mobile rsbuild module alias replaces the `/sync` page import with
`src/mobile/legacy-sync-redirect.tsx`. The Android dependency graph therefore never
includes the old page or its private selection modal. The compatibility component
replaces the current history entry with `/android-downloads`. Desktop resolves the
original page. The already platform-guarded sidebar excludes the old registration;
the old page's auto-sync settings are also excluded from the mobile build.

Saved navigation migration removes verified `/sync` targets and the historical
`__float_Offline` identity, including stale float-order metadata. Other entries keep
their order, placement and hidden state; Downloads is not moved or inserted twice.
An unrelated saved item reusing the Offline label is preserved.

`app/.../offline`, `SeanimeOffline`, `OfflineActivity`, Media3 downloads and local
playback remain: these implement Android Downloads, not the removed `/sync` page.
Shared backend sync/cache APIs, sync listener and desktop offline components remain
for existing consumers. No user media, download metadata or cache is deleted.

## Reproducible checks

- `npm test` in `backend/seanime-web` (92 tests).
- `SEA_PUBLIC_PLATFORM=mobile npm run build` (TypeScript and mobile bundle).
- `python tests/mobile_navigation.py` (84 checks at three viewport sizes).
- `python tests/mobile_navigation_migration.py` (full and identity-only legacy state).
- `node tests/hoster_source.cjs` (initial load and repeated lifecycle events).
- `go test ./internal/extension_repo -run TestMobileHoster -count=1` in `backend`.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` with the existing SDK/signing environment.
- `python tests/android_source_removal.py <signed-apk>` compares both packaged native
  binaries byte-for-byte with the rebuilt files, searches them and the mobile web
  bundles for removed implementation markers, and checks DEX for the deleted patch.

Both ARM backends must be rebuilt after frontend changes. `backend/web` is the
actual Go embed input; changing only the frontend source or `out` is insufficient.
Device screenshots, original APK and private state snapshots are kept outside Git.
