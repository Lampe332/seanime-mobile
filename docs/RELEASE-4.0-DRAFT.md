# Release-Text 4.0.0 (final, nicht veröffentlicht)

Stand 15.11.2026 abends, HEAD `61c8d142` (Quellen: `git log d59d183..HEAD`, `docs/EIGENER-KERN.md` §4s, §9 „Nachtlauf 15.11.2026“, `docs/APP-TEST-4.0.md`). Letzter Code-Commit `61c8d142` (tote eingebaute Manga-Quelle „Local“ entfernt), der Text gilt für diesen Code-Stand. Kein Tag, kein Upload, Veröffentlichung nur auf Nicks Go.

**Vor dem Veröffentlichen prüfen:**
- Asset-Name genau `Seanime-Mobile-4.0.0.apk` (nur diesen Namen bieten die In-App-Updater an), Tag `v4.0.0`, kein Pre-Release, kein Entwurf; GitHub muss eine SHA-256 zum Asset zeigen (ohne lädt 3.0.0 nichts).
- Bau: `build-android.ps1 -Release` (Paket `com.seanime.app.local`, versionName 4.0.0, versionCode 40000, Zertifikat von 2.0.33/3.0.0, keine `libseanime.so`). Release-APK vom 15.11. abends (HEAD `61c8d142`, ohne die Quelle „Local“): 71 351 444 Bytes (68,0 MiB), SHA-256 `74b38fc93c8664c1682e7399b5f8c2054213ef4aae13c566ca89b19ae032e331`, App-Name „Seanime Mobile“, Zertifikat gleich 3.0.0, 0 `libseanime.so`; Dev-Links (`dev/intro`, `dev/anilist-down`, `dev/check-updates`) nur test/scratch (`native/src/lib/app-links.ts:240`).
- Ungeprüft am Gerät ohne Server: Untertitelspur beim Cast am TV, Cast-Panel-Änderungen am TV (TV war aus), Watch Party (nicht gebaut). Jede Zeile vor dem Veröffentlichen gegen den Stand prüfen (AGENTS.md).
- `CHANGELOG.md` hat den Abschnitt 4.0.0 mit denselben Zeilen (Datum beim Veröffentlichen eintragen).

## Fertiger Text (Englisch, Stil `AGENTS.md`)

```markdown
## What's new?

- 📝 BREAKING: Updating from 2.0.33: the updater in 2.0.33 refuses this version ("APK does not support this device"). Download `Seanime-Mobile-4.0.0.apk` below and install it over the app; your data stays. From 3.0.0 the app updates itself as usual
- 🏗️ BREAKING: App: The built-in Seanime server is gone. The app now does everything itself, with no server running in the background
  - No longer available: plugins, filler marking, custom source lists, debrid downloads into a folder, tracking in external players, Nakama watch parties and cloud rooms, Discord status, searching other manga sources, local manga and the double-page reader view
  - The extension marketplace no longer lists plugins, the Manga settings no longer ask for a local folder, and the non-working built-in local manga source is gone
- 🎉 Backup: Back up and restore all app data in Settings → App → Backup
  - Save the file to a folder you pick, or share it
  - Restore shows what the file holds before anything changes, and "Undo last restore" brings the old state back
  - Tokens, passwords and keys never go into the file
- 🎉 AniList sync: The app keeps working when AniList is down or you are offline. Your changes wait on the phone and go out when AniList answers again
  - A small pill on Home and My lists shows how many are waiting, with "Send now"
- 🎉 Widget: "Continue watching" home screen widget, with a button in Settings → App to add it
- 🎉 Sign-in: After you copy your code on AniList, the app picks it up when you come back and offers Connect. Pasting by hand still works
- 🎉 Extensions: Marketplaces you added before can be added again with one tap
- 🎉 History: Menu → History lists what you watched and read, by day. Tap to continue, remove single entries or clear it; your AniList stays untouched
- 🎉 Incognito mode: Pauses the watch history and automatic progress updates. Progress you change yourself still syncs
- 🎉 Updates: Menu → Updates shows new episodes and chapters since your last visit
- 🎉 Notifications: Get notified when a manga on your list has a new chapter
- 🎉 Downloads: Download the next 1 to 3 episodes of the anime you are watching automatically (Wi-Fi only, off by default)
- 🎉 Downloads: Delete watched episodes automatically (off by default)
- 🎉 Cards: Long-press a card for quick actions: add to list, +1 episode or chapter, Continue reading
- 🎉 Search: Your recent searches show up under the empty search field
- 🎉 About: Tap the version number a few times for a small surprise
- ⚡️ App: Smaller download (about 71 MB instead of about 107 MB), less memory and less CPU while idle
- ⚡️ Home: Your lists show right after start instead of waiting for the server
- ⚡️ First start: One step: pick your language and go. Streaming and manga are on and can be changed in Settings
- ⚡️ Extensions: Adding a marketplace is simpler: paste the link, check the preview, add
- ⚡️ Downloads: Downloaded episodes, manga chapters and installed extensions from earlier versions are taken over on the first start
- ⚡️ Local account: Works fully without AniList; lists, progress and status stay on the device
- ⚡️ Home: Continue watching also shows anime you started without adding them to a list
- ⚡️ Extensions: Extensions check for updates and show a badge when one is available
- ⚡️ Online streaming: The online source is remembered per anime
- ⚡️ Lists: The "Add to list" button is clearer, with an icon and a label
- 🦺 Local account: "Upload local lists" after signing in to AniList works again
- 🦺 Schedule: No longer fails right after start when AniList rate-limits the app
- 🦺 Home: An anime no longer shows up twice in Continue watching
- 🦺 Search: The keyboard no longer pops up again on other screens after opening a result
- 🦺 Cast: "Stop casting" is reachable in landscape
- 🦺 Sheets: Sheets scroll on slow swipes, so lower filters like "Year" are reachable
- 🦺 Torrents: "Pick the best torrent" is remembered, single episodes are no longer labelled as batches, and "1 seeder" is spelled right
- 🦺 Manga: Previous/next chapter in the reader stays in the language and scanlator you are reading
- 🦺 Playlists: The playlist button no longer covers the mini player's close button
- 🦺 Lists: The Anime | Manga switch glides instead of jumping
- 🦺 Settings: An external player can be unselected again
- 🦺 Anime page: A library default source no longer opens an empty starting tab
- 🏗️ Settings: About and Settings show only the app version, no Seanime desktop version
- 🏗️ Settings: "Export library data" is gone; Backup replaces it
- 🏗️ Settings: Removed settings that had no effect: Secure mode, Fallback episode metadata, Back up AniList lists (auto-sync to the local account) and Legacy matching
- 🏗️ About: The donate link is gone
```
