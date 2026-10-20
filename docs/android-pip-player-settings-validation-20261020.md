# Android PiP controls, player settings sheet and Sub label — 2026-10-20

Baseline: clean ffe313a (1.9.15 / 31044), main == origin/main. Device SM-S908B / R3CT60PD7YA, Android 16, com.seanime.app.local 1.9.15 / 31044. Shipped as 1.9.16 / 31061 (31045-31060 were intermediate device builds).

## Changes

- Anime audio toggle: label `Sub` (EN and DE), `aria-label` stays `Subtitles` / `Untertitel`.
- PiP (`PiPManager`, `PiPControls`): RemoteActions rewind 10 s, play/pause, forward 10 s (play/pause only when `getMaxNumPictureInPictureActions()` < 3). Immutable broadcast PendingIntents with explicit package, runtime receiver `RECEIVER_NOT_EXPORTED` (API 33+) plus a per-process token for older releases, registered only while PiP is active. The PiP video's play/pause events call `AndroidBridge.setPiPPlaying` which updates the params (no polling). Commands go through the `seanime:pip-command` event to video-core's `vc_dispatchAction` (`togglePlay`, `seek` with its existing 0..duration clamp); a direct `<video>` fallback with the same clamp is used only when no player handles the event. `setSeamlessResizeEnabled(false)` on API 31+. No source-rect hint (the video is moved to a fixed full-window layer, a hint from its inline box would mismatch) and no auto-enter (would change behaviour).
- Fix: closing the PiP window (X) left the video playing in the background (same code path in 1.9.15). `onStop` after a PiP session now pauses all videos; expanding resumes the activity and is unaffected.
- Player settings on Android phones (smallest screen side < 600 CSS px; tablets/desktop keep the old list): grouped Playback / Subtitles / Display, Auto play / Auto next / Skip OP/ED as in-row switches writing the same atoms, 48 dp rows, values in tabular numerals. Portrait: docked bottom sheet; landscape: groups side by side. Sub pages reuse the existing menus with the same rhythm; Escape/Android Back steps back one page, then closes. Opening Preferences closes the sheet. Leaving fullscreen closes the sheet (native Back in fullscreen exits fullscreen first; native back handling was out of scope).

- Follow-up: phone player settings drop what does not work on phones. Anime4K needs WebGPU (`navigator.gpu.requestAdapter()` returns no adapter on the SM-S908B WebView), Preferences is the desktop modal (keyboard shortcuts, screenshot directory, chapter regex, API-key subtitle translation), the custom subtitle font needs a file in the desktop assets folder, plus the "Shift + Up/Down" and drag-and-drop hints. New phone page Languages sets the existing `preferredSubtitleLanguage` / `preferredAudioLanguage` codes (Japanese, German, English) and updates the subtitle managers. Volume boost stays: on the device 150 % drives a running Web Audio gain of 1.5 and Off returns it to 1.

- Second follow-up (phone only):
  - Local library tab lists episodes saved by the Android download manager (`SeanimeOffline.snapshot`, filtered by media id, refreshed every 2 s and on focus) as "On this phone" rows that play through the existing offline `play` action; those episode numbers are removed from "not in your library". "Manage" opens the anime in Downloads.
  - Manual match: bottom sheet with current match, one search row pre-filled with the title before its subtitle (the provider answers long titles with an error), dub switch, 48 dp result rows, external link; provider errors show the no-results hint.
  - Stream cache: bottom sheet with Clear / Cancel; closes after clearing.
  - Quality, audio and subtitle player menus use the phone sheet (`VideoCoreMenu` applies it on phones).
  - Skip opening / ending: solid 48 dp pill at the bottom right of the player.

- Third follow-up (phone only): stream cache sheet closes as soon as clearing starts (the mutation stays pending until the episode source is fetched again; a toast confirms); redesigned download episodes sheet (anime card with cover, segmented Season / From ep. / This episode, "Clear selection", grouped episode rows with checkboxes or a Saved badge, full-width download button); Home "Currently watching" filter is a sheet with the unwatched switch plus genre chips (all selected genres must match, counts per genre, Reset / Show N series). Device: 8/8 incl. genre narrowing 4 -> 3 series and toast after clearing.

- Manga page (Android): same mobile header as the anime page (`MobileAnimeHeader*` now type-aware: "About this manga", "Chapters & reading" to `#manga-chapters`, rereads), page root carries `data-mobile-anime` (so the native "More info" injection skips it) and `data-mobile-manga`; source / language / scanlator in one grouped block with Refresh source and Manual match as quiet actions; read button with chapter (and page when resuming); Unread / All switch and Downloaded filter; chapter rows (title, chapter · scanlator · language, download / queued / saved) paged by 30 with "Show more"; "Download unread (N)" uses the existing confirmation. Device: 11/11 (no reader opened, no list or download change).

- Manga follow-up: the manga top bar continues the page tint at 56 px (no black band); the header's primary action is the start / continue / resume reading button (published by the chapter list through `mobileMangaReadActionAtom`), the in-list button and the jump link are gone; "Save locally" (desktop offline mode, removed /sync page) is hidden on Android for anime and manga; plugin manga page buttons are text chips; source select on its own row, language / scanlator below; manga manual match uses the anime sheet (pre-filled title, cover rows, preview before saving). The two plugin windows (Manga Source Updates, MangaUpdates Sync by Carloss616) are sandboxed third-party iframes and are not restyled. Device 16/16, anime 31/31.

- Manga actions: plugin page buttons and the menu form one compact row of 44 dp round icon buttons (library, link, more; names as accessible labels); the manga top bar Downloads pill is a plain icon that opens Downloads on the Manga tab (same server downloads with the app's reader) instead of the desktop drawer. Device 18/18.

- Manga tabs: "Online reading" and "Downloaded · N" use the anime page's tab bar; the Downloaded tab lists saved / queued chapters as rows (tap reads, trash deletes after confirmation) and replaces the old desktop "Downloaded chapters" table at the page bottom and the Downloaded filter chip. Device 21/21.

- Manga reader settings (Android): bottom sheet with Reading (mode, direction only for paged modes, page offset only for double page), Page (fit as 2x2 segments, zoom stepper with reset, page width only for Overflow, "same width for all pages" only where stretch applies, reset page layout) and Display (gap, gap shadow, progress bar, hide reader controls). Same atoms, so per-manga settings and storage are unchanged. Removed on phones: the fullscreen toggle (the app is already edge to edge); keyboard shortcuts were already hidden on phones. Harness `tests/mobile_reader_settings.py` 12/12; device in the real reader 6/6 with localStorage restored exactly.

## Verification

| Check | Result |
|---|---|
| `tsc` (via `npm run build`) | pass |
| Vitest | 22 files / 135 tests pass |
| Android unit tests (`testReleaseUnitTest`) | 17/17 incl. new `PiPControlsTest` (4) |
| `lintRelease`, apksigner, zipalign | pass |
| Harness suites (anilist, anime, anime_download, home_customize, home_plugins, navigation, navigation_migration, playlists, plugin_runtime, update_menu, plugin_dom, volume) | all pass |
| New `tests/mobile_player_settings.py` | 27/27 (incl. no Anime4K/Preferences, no font-file option, no keyboard hint, Languages page stores codes) (grouping, 48 dp, no scroll portrait/landscape, switches write `sea-media-core-preferences` and restore, speed page, delay page saves via subtitle manager, Back levels, tap outside, 320 px at 200 %) |
| Device `tests/mobile_anime_device.py` (incl. new Sub label check) | 31/31 |
| Device PiP (real taps on the system PiP menu) | 11/11: play, pause, −10 s 159.84→149.84, +10 s →159.84, +10 s →169.84, −10 s at 4 s → 0, return restores video into the player at 2:10 with the player time display `2:10 / 23:40`, zoom 1, no PiP style; close stops the video, no stray `<video>` |
| Device settings sheet | 12/12 portrait, Volume boost Web Audio gain, Languages page, landscape fullscreen, switch write/restore, Android Back levels, preferences unchanged |

Data: continuity restored to the pre-test snapshot (209983 episode 11, 2.27 s); localStorage (incl. `sea-media-core-preferences`, `sea-video-core-anime4k`) identical to the snapshot; home items, playlists and plugin settings identical.
