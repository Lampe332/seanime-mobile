# Android PiP controls, player settings sheet and Sub label — 2026-10-20

Baseline: clean ffe313a (1.9.15 / 31044), main == origin/main. Device SM-S908B / R3CT60PD7YA, Android 16, com.seanime.app.local 1.9.15 / 31044. Shipped as 1.9.16 / 31047 (31045 and 31046 were intermediate device builds).

## Changes

- Anime audio toggle: label `Sub` (EN and DE), `aria-label` stays `Subtitles` / `Untertitel`.
- PiP (`PiPManager`, `PiPControls`): RemoteActions rewind 10 s, play/pause, forward 10 s (play/pause only when `getMaxNumPictureInPictureActions()` < 3). Immutable broadcast PendingIntents with explicit package, runtime receiver `RECEIVER_NOT_EXPORTED` (API 33+) plus a per-process token for older releases, registered only while PiP is active. The PiP video's play/pause events call `AndroidBridge.setPiPPlaying` which updates the params (no polling). Commands go through the `seanime:pip-command` event to video-core's `vc_dispatchAction` (`togglePlay`, `seek` with its existing 0..duration clamp); a direct `<video>` fallback with the same clamp is used only when no player handles the event. `setSeamlessResizeEnabled(false)` on API 31+. No source-rect hint (the video is moved to a fixed full-window layer, a hint from its inline box would mismatch) and no auto-enter (would change behaviour).
- Fix: closing the PiP window (X) left the video playing in the background (same code path in 1.9.15). `onStop` after a PiP session now pauses all videos; expanding resumes the activity and is unaffected.
- Player settings on Android phones (smallest screen side < 600 CSS px; tablets/desktop keep the old list): grouped Playback / Subtitles / Display, Auto play / Auto next / Skip OP/ED as in-row switches writing the same atoms, 48 dp rows, values in tabular numerals. Portrait: docked bottom sheet; landscape: groups side by side. Sub pages reuse the existing menus with the same rhythm; Escape/Android Back steps back one page, then closes. Opening Preferences closes the sheet. Leaving fullscreen closes the sheet (native Back in fullscreen exits fullscreen first; native back handling was out of scope).

## Verification

| Check | Result |
|---|---|
| `tsc` (via `npm run build`) | pass |
| Vitest | 22 files / 135 tests pass |
| Android unit tests (`testReleaseUnitTest`) | 17/17 incl. new `PiPControlsTest` (4) |
| `lintRelease`, apksigner, zipalign | pass |
| Harness suites (anilist, anime, anime_download, home_customize, home_plugins, navigation, navigation_migration, playlists, plugin_runtime, update_menu, plugin_dom, volume) | all pass |
| New `tests/mobile_player_settings.py` | 21/21 (grouping, 48 dp, no scroll portrait/landscape, switches write `sea-media-core-preferences` and restore, speed page, delay page saves via subtitle manager, Back levels, tap outside, 320 px at 200 %) |
| Device `tests/mobile_anime_device.py` (incl. new Sub label check) | 31/31 |
| Device PiP (real taps on the system PiP menu) | 11/11: play, pause, −10 s 159.84→149.84, +10 s →159.84, +10 s →169.84, −10 s at 4 s → 0, return restores video into the player at 2:10 with the player time display `2:10 / 23:40`, zoom 1, no PiP style; close stops the video, no stray `<video>` |
| Device settings sheet | 8/8 portrait, landscape fullscreen, switch write/restore, Android Back levels, preferences unchanged |

Data: continuity restored to the pre-test snapshot (209983 episode 11, 2.27 s); localStorage (incl. `sea-media-core-preferences`, `sea-video-core-anime4k`) identical to the snapshot; home items, playlists and plugin settings identical.
