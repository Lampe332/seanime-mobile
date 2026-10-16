# Foreground services - Play Console declaration (play flavor)

Text for Play Console > App content > Foreground service permissions.
Everything below is taken from the code (`app/src/main/AndroidManifest.xml`,
`SeanimeService.kt`, `offline/EpisodeDownloadService`). Re-check it against the code before submitting.

## 1. `SeanimeService` - `FOREGROUND_SERVICE_SPECIAL_USE`

Subtype (manifest property `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`):
"User-started local media library and HTTP streaming server used by the app WebView and external players"

**Description (EN):**
The app is a media-library manager. Its user interface is a local web UI that is
served by a small HTTP server running inside the app's own process
(Go binary `libseanime.so`, bound to 127.0.0.1 only). The foreground service
hosts this server. It is started when the user opens the app and is stopped
with the "Exit" action of its notification. While it runs, the app shows an
ongoing, non-dismissable notification ("... is running in the background")
with an Exit button.

**Why no other type fits:** the service does not play media itself
(not `mediaPlayback`), does not transfer user data on request (not `dataSync`),
and does not use location, camera, microphone, etc. Playback and the UI are
served over loopback HTTP, so the server must stay alive while the user moves
to an external player app or switches apps; otherwise the UI/stream breaks.

**User impact if the service is not allowed to run:** the local server is
killed by the system as soon as the app is in the background, so the library
UI and streams to external players stop.

**Demo video should show:** opening the app (notification appears), switching
to another app while the UI is still reachable, pulling down the notification
and tapping "Exit" (service stops).

## 2. `EpisodeDownloadService` - `FOREGROUND_SERVICE_DATA_SYNC`

**Description (EN):**
Started only when the user taps a download button (single episode or "download
season"). It downloads the chosen files to app storage with a progress
notification, so the transfer continues when the user leaves the app.
It stops itself when the queue is empty.

**Demo video should show:** starting a download, leaving the app, the progress
notification, completion.

## 3. Other declared permissions to justify

- `POST_NOTIFICATIONS`: required to show the notifications above.
- `WAKE_LOCK`: keeps the CPU awake during downloads/serving (verify usage in code before declaring).
- `RECEIVE_BOOT_COMPLETED`: declared in the manifest, but no boot receiver exists in the code -
  remove it from the play flavor or justify it. (Open point, see report.)

## Not to be written in the console

Nothing here is claimed beyond what the code does. If `dataSync` is limited by
the 6-hour Android 15 timeout, long season downloads need a resume path
(Media3 `DownloadService` restarts via `PlatformScheduler`, already present).
