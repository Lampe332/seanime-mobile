# Android update presentation inventory and acceptance — 2026-10-19

Baseline: clean 44b55f2e0529363c8fca4630b6701bfd337cbb1a, main; private origin Lampe332/seanime-mobile-dev, upstream Lampe332/seanime-mobile. Device SM-S908B / R3CT60PD7YA, com.seanime.app.local 1.9.2 / 31027. Actions disabled. No foreign changes.

Inventory captured before redesign. All menu/sidebar/dialog panels belong to MobileUpdateModal; AppUpdater and UpdateInstaller remain the authoritative state owners.

| Existing state | Existing visible surface | Required acceptance |
|---|---|---|
| idle / unavailable check | Menu and sidebar | Installed version, clear status, manual check |
| initial / manual query pending | Menu and sidebar | Real-request spinner; disabled repeat check; menu and scroll retained |
| query current | Menu and sidebar | Current-version result in same area |
| query error / timeout | Menu and sidebar | Understandable error, fresh retry; late responses ignored |
| release available | Menu, sidebar, automatic dialog | Distinct installed/available versions, shared state, download-and-update action |
| release information | Dialog, UpdateChangelogBody | Existing release bullets, localized heading, long text wrapping, empty-notes text |
| starting download | Menu/dialog | Pending action disabled, no false completed download |
| downloading, unknown/known size, paused | Menu/dialog and system DownloadManager notification | Existing percent plus available bytes, indeterminate progress, waiting message |
| verifying | Menu/dialog | APK validation status, no installation success |
| complete / verified | Menu/dialog | Ready-to-install status and existing action |
| preparing | Menu/dialog | Preparation status and disabled action |
| permission | Menu/dialog, Android settings | App explanation and existing permission action; system UI unchanged |
| confirmation | Menu/dialog, actual Android installer, app notification 1403 | App explanation and existing continuation; system UI unchanged |
| installing | Menu/dialog | Waiting for Android, success only after version advance |
| failed / error, including denial/cancellation | Menu/dialog | Error detail preserved, retry download or reuse verified APK as before |
| resume / reopening | Menu/dialog | Current shared state, no new transfer or transaction |
| installed | Menu/dialog plus existing Sonner toast and app notification 1403 | Only native confirmed state can show success; acknowledgement unchanged |

Notification review: native standard Android notification templates already use app title, localized installed/confirmation text, Open app action and direct Activity PendingIntent. DownloadManager controls transfer notification layout. Keep those platform templates and their existing localized copy; do not invent custom system UI or alter installer executable code.

Presentation-only implementation boundary: mobile-update-modal.tsx markup/copy/CSS; mobile-only release heading and empty release text. No AppUpdater, UpdateInstaller, UpdateInstallPolicy, release source, bridge, menu injector or query transitions changed. Version increases to 1.9.3 / 31028.

Validation results and limitations are recorded below after execution. Controlled presentation fixtures prove rendering only, not APK validation or installation success.
## Executed validation

- Mobile TypeScript and production frontend build passed. All 154 files in `backend/web` match the frontend output by SHA-256. Both ARM Go backends were rebuilt with that bundle; both packaged libraries match the tracked rebuilt artifacts byte for byte. The redesigned assets and overlay correction are present in each backend.
- 13 Vitest bridge/routing tests, 13 Android unit tests, 39 React/menu checks and 84 navigation checks passed. Saved-navigation migration passed. Release lint and signed release assembly passed. Existing build warnings remain (Browserslist age, an ambiguous existing Tailwind easing utility, existing Android lint warnings); no new dependencies were added.
- Menu regressions cover one real bridge request per manual action, menu openness and scroll retention, disabled repeated taps, query error, retry, timeout, late response rejection, close/reopen, available release and Android Back.
- Added focused presentation checks cover all native download/installation statuses, known/unknown total, waiting message, bytes/percent, shared menu/dialog text, reduced motion, long errors and 320px/200% font wrapping. Controlled success checks acknowledge only the native `installed` input. These tests do not validate an installation.
- On final Samsung APK: 20 checks passed for the real production query, retained menu and scroll, controlled slow/error responses, duplicate taps, release dialog/notes, every installation presentation state, reopening during progress, simulated confirmed success, and removal of process-local fixtures. Six further device checks passed for physical Android Back, reopening, the existing verified-APK retry and combined download retry, German text, and 320 CSS-pixel/200% text rendering with long notes and reachable controls.
- The first device pass exposed the menu's native z-index 999998 covering the update modal, plus native global `!important` modal sizing. Scoped update-overlay stacking and sizing overrides corrected this. The final real dialog close control was clicked successfully and has a localized accessible label and 44px target.
- No production Kotlin installer, updater, transaction policy, bridge, query hook, menu injector or release URL changed. No complete PackageInstaller self-update run was repeated because executable installation code is unchanged. The package was updated in place with ADB from 1.9.2/31027 to 1.9.3/31028; subsequent final presentation corrections were installed in place at the same new version. No uninstall, data clear or navigation reset.

## Final artifact and retained data

- Package `com.seanime.app.local`, version 1.9.3, versionCode 31028.
- APK: `D:\Seanime-Build\outputs\update-redesign-20261019\Seanime-Mobile-1.9.3.apk`.
- APK SHA-256: `6e6af8059d3a98c180ed89913acbc73392790e1689628c5967b0e87b02421d88`.
- The pulled final installed base.apk has the same SHA-256. apksigner verifies v1/v2 signatures; certificate SHA-256 remains `a5da25c722fd776fe92935544801f2661d0690b0afd73d69e4cba58f1f23a7d4`. zipalign 16 KiB verification passed.
- Installed arm64 backend SHA-256 `73c887fe7e7ffaedf88c8cb65ad641f4f21c6fa1f6b595bbf88e36d88c8ba6d8`; ARMv7 backend `5e280548d6843263f0a1b6c6be1dc62f8fea05680c01937427fbe8c7bfc8defe`.
- Initial installation timestamp remains 2026-10-17 02:42:30. All 125 offline video/artwork files, 441,743,449 bytes, have identical per-file SHA-256 manifests before and after the final normal launch. All captured navigation localStorage values match exactly. Login and existing watching progress remain visible.
- Process-only bridge fixtures and controlled query data were discarded by reload and process restart. Original app language and release-prompt acknowledgement were restored. The final normal launch has native idle/current-version state, the production bridge/source, no fixture globals, no controlled release and WebView debugging disabled. The temporary CDP forward was removed. No test APK offer, HTTP server, reverse mapping or persistent test preference was used.
- Repository remains private with Actions disabled. Final source, complete embedded bundle and rebuilt native libraries are committed and pushed only to private origin/main. No tag, release or public write is part of this task. The exact commit/push identity is in the local delivery manifest (avoids a self-referencing commit hash here).

## Evidence

All evidence is outside Git under `D:\Seanime-Build\outputs\update-redesign-20261019`:

- `before.png`, `final.png`: normal before/after Samsung menu.
- `device-controlled-available-dialog.png`, `device-controlled-available-menu.png`: explicitly controlled version 1.9.4 preview, no published release.
- `device-controlled-search.png`, `device-controlled-check-error.png`, `device-controlled-downloading.png`, `device-controlled-reopened-download.png`, `device-controlled-verifying.png`, `device-controlled-preparing.png`, `device-controlled-permission.png`, `device-controlled-confirmation.png`, `device-controlled-installing.png`, `device-controlled-failed.png`, `device-controlled-error.png`, `device-controlled-complete.png`, `device-controlled-installed.png`: presentation fixtures on the actual device.
- `device-german-current.png`, `device-controlled-320px-200percent.png`, `device-controlled-small-dialog.png`: German and controlled viewport/font checks. Viewport/font emulation was removed afterward; system display/font settings were not changed.
- `real-production-check.mp4`: short native screen recording of real-source checks, menu close and reopen. It does not claim an APK installation. The earlier unfinished recording was rejected after ffprobe detected its missing MP4 index; it is not a deliverable.
- `menu-tests.json`, `navigation-tests.json`, `device-tests.json`, `device-extra-tests.json`, `embedded-web-manifest.json`, `identity-retention.json`, `apk-verification.txt`, build logs and normal-launch evidence contain the detailed checks.

## Explicit limitations

The download, validation, permission, installer confirmation, cancellation and success screenshots are controlled display inputs, not newly executed native update transactions. Actual native APK validation, permission denial/cancellation, PackageInstaller replacement, process-death transaction recovery and notification delivery were established by the prior validation and were not physically repeated here. Native notification code and platform templates were inspected and preserved; no new notification was triggered in this run. Only the normal public query and the dataloss-free ADB installation were exercised with real production services in this task. No claim of universally silent installation or automatic reopening is made.

The narrow viewport and enlarged type were emulated inside the real Samsung WebView; no second physical small-screen device, TalkBack session or Android OS font-scale change was tested. Long technical Android errors retain their original diagnostic detail under the localized app status. Android installer and Play Protect UI remain outside the redesign.
