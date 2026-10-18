# Android self-update validation — 2026-10-18

## Scope and identity

Private development repository `Lampe332/seanime-mobile-dev`, `main`; initial clean commit `394d1c0a2a54cbc6d8f8b5aba09d7adc6b848bc6`. Remote main was fetched and matched. Repository privacy and disabled Actions were checked before and after implementation. No releases, tags or public repository writes were made.

Samsung SM-S908B, serial R3CT60PD7YA, Android 16 / API 36. Sole application target: `com.seanime.app.local`. Initial installation: 1.8.8 / 31023. Neither the separate v183test application nor the Play Store edition was used.

## Implementation

- Only `home` and `notifier` catalogue paths changed. Home is a closed roof/body outline with a door and no chimney or crossing lines. Notifier is a centered download arrow over a tray. Existing 1.8 stroke width, sizing, route mappings and surfaces remain. The existing saved-icon renewal path updates geometry without resetting navigation.
- One explicit Download and update action authorizes download and subsequent replacement. The interruption notice is visible before that action. There is no additional app confirmation dialog. Android source permission, installer confirmation and package-verifier UI remain platform controlled.
- Existing DownloadManager transfer, byte count, GitHub digest, exact package/version, signing-certificate and ABI checks remain; minimum Android compatibility is also checked. A validated copy in private app storage is hashed again immediately before writing a PackageInstaller session.
- Before session commit, SharedPreferences.commit persists source version code, validated target code, session ID, timestamp and installation state. The callback is an explicit mutable broadcast PendingIntent to a non-exported receiver. Pending user action launches the actual Android confirmation intent; if not in the foreground it remains actionable from the update panel and an app-opening notification.
- `USER_ACTION_NOT_REQUIRED` is requested on API 31+ with `UPDATE_PACKAGES_WITHOUT_USER_ACTION`. The permission is not a promise that Samsung, Android or a package verifier will accept a silent update. Source permission is requested through Android settings and only its matching return can resume automatically. Denial and cancellation require an explicit retry. Repeated taps share a transfer/session; existing verified APKs survive failed installations. Missing sessions and stale transactions become retryable failures rather than reopening dialogs repeatedly.
- UI states distinguish idle/available, downloading, verifying, permission, confirmation, preparing, installing, failed and actually installed. Menu and modal use the same native state. Reading bridge state no longer hashes a 67 MB file on the WebView bridge thread.
- Only a real installed version-code advance satisfying the saved transaction confirms success. Acknowledgement is persisted and prevents the toast repeating. Download completion and installer callbacks alone do not confirm a package replacement.
- `MY_PACKAGE_REPLACED` reconciles the transaction and posts a direct Activity PendingIntent notification when notifications are permitted. No unsupported background foreground-launch claim or alarm/restart workaround is implemented. With notifications disabled, the next normal start still reconciles and confirms.
- Public release source remains `https://api.github.com/repos/Lampe332/seanime-mobile/releases?per_page=30`, with the existing strict stable-release/exact-APK selection. No tokens or private feed were embedded. Start/resume checks use one-hour freshness and no recurring release polling.

## Controlled real-device sequence

The existing signed 1.8.8 APK was pulled before overwriting it; this is an APK backup, not an app-data backup. Signing certificate compatibility was verified using the supplied existing key. Initial installation time remained `2026-10-17 02:42:30`.

An initial 1.8.9 / 31024 baseline exercised the installer and reached 1.9.0 / 31025 through app session 173827711. An earlier session was rejected by the Android verifier. A transient system parser dialog was also seen in this preliminary forced-confirmation exercise; its presence did not prove installation failure, because the system subsequently reported the installed package and matching APK hash. It was not seen in the final normal-path installation. No AndroidRuntime app crash was recorded; instrumentation termination during package replacement is expected.

After Nick requested one app tap without another app confirmation, the final UI was rebuilt and a matching 1.9.0 / 31025 baseline was provisioned with ADB. ADB was used only for baseline provisioning and instrumentation, never as the successful target-version installer. The final 1.9.1 / 31026 APK came from the same implementation source with normal production configuration; the baseline differs in version metadata.

The controlled offer uses the pre-existing in-process instrumentation provider, not a persistent preference, JS override, intent override or altered production feed. A localhost-only HTTP server and temporary ADB reverse provided the APK. A second in-process instrumentation flag requests USER_ACTION_REQUIRED solely to verify the mandatory confirmation fallback; its normal default is false.

Observed final-APK sequence:

1. A single actual UI action started the 67,163,561-byte transfer, without an app confirmation. Visible progress was sampled at 38%; modal and menu status agreed and the action was disabled during transfer.
2. The app was force-stopped while the transfer was pending. Starting it again restored the existing download and validated the completed archive. Exactly one current test transfer remained; the server received one request for the 1.9.1 APK.
3. Source permission was deliberately denied by returning from the regular settings page without granting it. Native state became failed with `Install permission denied. You can retry.`; no success was shown.
4. The user-facing Menu retry reused the validated APK. Source permission was granted through normal Android UI, and the app resumed correctly.
5. With only the instrumentation fallback flag enabled, session 923140193 returned STATUS_PENDING_USER_ACTION and showed `Möchtest du diese App aktualisieren?`. Abbrechen yielded STATUS_FAILURE_ABORTED / `INSTALL_FAILED_ABORTED: User rejected permissions`. The installed version stayed 1.9.0 / 31025, with no success toast.
6. The process was stopped again. After restart without the fallback flag, failure and the same verified APK were retained; no automatic confirmation or restart loop occurred.
7. Six rapid retry clicks created one new session, 244346180. On the normal USER_ACTION_NOT_REQUIRED path, no PackageInstaller confirmation callback/dialog occurred. Google Play Protect independently displayed App-Scan empfohlen. The Ohne Scan installieren link did not respond to automation or Nick's physical attempt. Nick chose App scannen; Play Protect reported Diese App ist anscheinend sicher, after which the regular Installieren action continued. No protection setting was disabled.
8. PackageInstaller recorded session 244346180 installed at 20:29:39; the app callback recorded STATUS_SUCCESS and actual/target code 31026. PackageManager confirmed 1.9.1 / 31026 under the same package. Installed base.apk SHA-256 exactly matched the host target APK.
9. Samsung returned to the launcher, with no automatic foreground reopen. Notification ID 1403 in app_updates had Update installed / Open app and a direct startActivity PendingIntent. Tapping it opened Seanime and displayed Update successfully installed – Version 1.9.1. Both screenshot and UI dump captured that actual toast.
10. Subsequent process starts showed idle and no toast. Raw instrumentation confirmed install_status=installed, from_code=31025, target_code=31026, session_id=244346180, success_unread=false, auto_install=false. The final Menu showed Installed: 1.9.1 and Up to date with no test offer.

The locally served offer, server, reverse mapping, debugging forward and current test DownloadManager artifact were removed. Normal application starts have WebView debugging disabled. Test screenshots and manifests are outside Git. The existing signed instrumentation package is retained; no app was uninstalled.

## Data and icons on the phone

All 125 pre-existing offline media/artwork files, totalling 441,743,449 bytes, had identical per-file SHA-256 manifests on original 1.8.8, immediately before the final replacement and on final 1.9.1. Existing lists and progress remained visible, including Current, Repeating and Planning sections. The app remained logged in with Sign out available.

Nick explicitly confirmed changing his navigation during this session. The resulting Home / My Lists / Discover / Search / Menu / Downloads order, placements and hidden/menu ordering were captured before the final replacement and matched afterward. No reset was performed.

Real phone screenshots cover active Home, inactive Home and normal/active Download Notifier. The notifier active row had float-nav-item--current and the correct new shared SVG. A separate before/after image presents the actual catalogue vectors at their small normal/active sizes. A Playwright screenshot on the lists page timed out after navigation; native screenshots and the live list DOM supplied the verification instead.

## Checks executed

- Mobile TypeScript check and production frontend build.
- Embedded web bundle regenerated and both Go Android backends rebuilt for arm64-v8a and armeabi-v7a.
- 13 Vitest bridge/routing tests passed, including distinct installation states, duplicate-request coalescing, no desktop fallback and bounded resume checks. An existing routing mock lacked knownAppUpdate; it was completed before the successful run.
- 13 Android unit tests passed: 11 release-policy tests plus 2 transaction-policy tests covering actual-code success, missing transaction, unchanged/equal and older codes.
- 84 Playwright navigation checks passed across three viewport sizes; saved-icon and legacy navigation migration checks passed, including the notifier catalogue mapping.
- Release lint passed; signed release build passed. Existing lint warnings remain, including intentional synchronous preference persistence at transaction boundaries.
- apksigner verified APK v1/v2 signatures; zipalign checked 16 KiB alignment. Certificate SHA-256: a5da25c722fd776fe92935544801f2661d0690b0afd73d69e4cba58f1f23a7d4.
- Packaged icons matched source exactly; both packaged native backends matched their rebuilt source artifacts. android_source_removal.py passed, ensuring earlier removed Android UI stayed absent.
- Final APK: D:\Seanime-Build\outputs\android-update-20261018\Seanime-Mobile-1.9.1.apk.
- SHA-256: f1e92040a501a8964b6e62e6577a5fc926ee1ef030be28fbea2048c98480411a.
- Version 1.9.1, versionCode 31026, package com.seanime.app.local. No artificially higher test version remains.

## Limits

The final successful path included recovery from deliberately denied permission and cancellation; it was not an uninterrupted silent update. Android allowed the normal self-update session without its own install confirmation, but Play Protect still required its separate scan/install UI. No universal silent-update or automatic-reopen guarantee is made. No public release was created to test real production release discovery end to end; selection and no-newer-release behavior were verified against the unchanged feed and tests.

Older Android versions, storage exhaustion, a corrupt certificate fault, reboot during session commit, a 30-minute stale-session timeout and simultaneous real media playback/download interruption were not physically fault-injected on this phone. The interruption notice is present; no playback progress or user media was deliberately changed for that test. No uninstall, pm clear, app-data deletion, navigation reset, root, accessibility, device-owner privilege or ADB product updater is used.

Official rules consulted: [SessionParams.setRequireUserAction](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)), [MY_PACKAGE_REPLACED](https://developer.android.com/reference/android/content/Intent#ACTION_MY_PACKAGE_REPLACED), [background activity starts](https://developer.android.com/guide/components/activities/background-starts).
