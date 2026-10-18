# Android icon and updater validation — 2026-10-18

Scope: private `Lampe332/seanime-mobile-dev`, `main`, regular `com.seanime.app.local` only. Baseline clean `db80c0bd6bff718fa70789f03835611836ba1b5c`; Samsung SM-S908B / R3CT60PD7YA initially 1.8.6 / 31021. Final 1.8.8 / 31023. No public push, tag or release; Actions remain disabled.

## Findings and changes

- Icons mixed 512-unit stroked paths, filled outlines and 24-unit strokes. The old Home roof and chimney intersected, and several open-path definitions used different caps and optical sizes. Saved navigation retained complete old SVG markup indefinitely; only Menu was canonicalized. Sidebar snapshots also carried presentation/transform classes. There was no evidence that multiple whole SVG layers were drawn over each other.
- One shared `mobile-icons/icons.json` catalogue now supplies Android injection and frontend menu/update controls. Existing house, checklist, compass, magnifier, hamburger, download, notification/download, logout, refresh, gear, puzzle, book, calendar, wrench, close, check and grip motifs use 24-unit outlines with explicit rounded caps and joins. Known stable IDs, routes and action identities override saved SVGs; geometry-only copies or the existing circle fallback serve unknown entries. Order, placement and hidden maps are retained. Removed Offline and Hoster launcher sources stay removed.
- The old copier emitted success after the stream copy without checking length, archive metadata, signature or checksum. It had no durable progress/completion state and repeated requests could create duplicate files. A copy finishing is not sufficient evidence of a compatible APK.
- Contrary to the initial suspicion, the old test-copy download did produce a real official 1.8.4 APK: 67,147,022 bytes, SHA-256 `4b1ac62fdddfeedb83c583f982a682541324b7f9c2b2f9692a5c729a9e1fe2e1`, matching the public release asset. Two further same-size copies were present. The test app was not modified. The exact screenshot's perceived instantaneous transfer was not reproduced as a missing-file failure.
- Android DownloadManager now owns the persistent transfer. Querying its actual record restores progress after page changes and process termination. Duplicate starts reuse the active job; the same verified completed version is reused. Completion requires readable bytes, expected length, optional release SHA-256, valid APK parsing, same package and signing certificate, matching offered version, higher installed version/code and a supported native ABI.
- The React mobile update owner renders both modal and Menu portal from one native download state. Dismissal only acknowledges the prompt. Check failures remain failures; an installed-version-scoped last known release can survive a failed check. No installer is opened automatically. The optional Open APK button is explicit.

## Update source and controlled tests

Production source remains `https://api.github.com/repos/Lampe332/seanime-mobile/releases?per_page=30`. Only stable newer releases with their exact `Seanime-Mobile-VERSION.apk` asset URL are selected. Public latest was 1.8.4, older than the development app. No token or private release feed was embedded.

Device instrumentation has an in-process Kotlin offer provider, inaccessible through the JS bridge, preferences or intents. It defaults to null. Controlled offers were installed only in the instrumentation process, never in final build configuration. The local HTTP server used ADB reverse on 18787, redirects and throttled transfer; it was stopped and its reverse removed. Test-only DownloadManager jobs and acknowledgement markers were removed afterward. The production feed and idle/current state were rechecked.

The separately built 1.8.9 / 31024 fixture differed in version metadata, used the same package/signing key, and was never installed. Downloaded and validated on installed 1.8.8: 67,154,647 bytes; SHA-256 `18150cacc0b4ea7eb15fdca65e18e6e31381bb657276f26f9c81fe09cd1cd84e`. Both host and device hashes matched. It exercised the actual Android download and archive parser, not a fabricated JS bridge. A final narrow icon fallback correction was subsequently rebuilt and reinstalled; updater implementation and embedded frontend were unchanged by that correction.

## Executed checks

- Mobile frontend TypeScript check and production build; rebuilt embedded `backend/web` and Go Android binaries for arm64-v8a and armeabi-v7a.
- 9 Vitest bridge checks: unavailable bridge, checks, accepted vs completed, errors, concurrent correlation, timeout, duplicate tap coalescing and native state restoration.
- 11 Android release-policy unit tests: numeric versions, stable releases, exact repository/name/tag, foreign/desktop assets, expected size/digest preservation and cross-version asset rejection.
- 84 Playwright navigation checks across 360x740, 412x883 and 740x360; saved-navigation migration and shared catalogue geometry/fallback checks.
- Release lint and signed release build; apksigner certificate compatibility; zipalign 16 KiB alignment. `android_source_removal.py` verified both packaged backend binaries against source and kept removed UI out.
- Real phone: modal starts with one tap, visible 11% state before completion, HTTP redirect, HTTP 404 and successful Menu retry, multiple taps with exactly one native record, page change, background/process stop and restored completion, existing verified APK reuse, closed prompt available from Menu, equal status in visible surfaces, no newer production update and no stale notice after installation.
- Invalid body tests: 23-byte HTML with wrong expected size was rejected as incomplete; with matching size and absent optional digest it was rejected by Android APK parsing. These negative body cases ran on intermediate 1.8.7; HTTP failure/retry and successful full transfers also ran on final updater 1.8.8.
- Real phone icons: bottom bar, Menu, editor, normal/active state, disabled download button, 1.7x SVG detail view and portrait/landscape. Add/return Schedule succeeded; the exact pre-test navigation values were restored. Actual Android Back closed the editor/menu and retained the route.

## Deliverable

Final signed installation APK: `Seanime-Mobile-1.8.8.apk`; SHA-256 `46bd5b88f5c2eee4885bed36d4654da54c37de8ea5d3ead2b6a6cbfb1c65961a`.
Certificate SHA-256: `a5da25c722fd776fe92935544801f2661d0690b0afd73d69e4cba58f1f23a7d4`.
Original app installation timestamp 2026-10-17 02:42:30 remained. Logged-in lists/watch progress, six-tab order and menu hidden/order preferences remained observable. During the last in-place reinstall, all 125 local media/artwork files (441,743,449 bytes) had identical per-file SHA-256 manifests before and after. Local screenshots, manifests and APK backups are kept outside Git in this task's outputs directory. The installed base APK hash matches the final deliverable exactly.

## Limits

No uninstall, pm clear, blanket navigation reset or app-data backup was used. The APK backup is not a data backup. Storage-full faults, legacy Android 23–28 permission denial, a deliberately interrupted TLS transfer and a deliberately incompatible signing certificate were not fault-injected on the Samsung. The explicit installer-opening action was not exercised, to leave the installed regular app at the requested tested final build. Long-version wrapping is implemented with flex wrapping and word breaks; an exhaustive typography/accessibility matrix was not run. No claim is made about every unrelated app view or media playback path.
