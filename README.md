<h1 align="center">Seanime Mobile</h1>

<p align="center">
  <a href="https://github.com/Lampe332/seanime-mobile/releases/latest"><img src="https://img.shields.io/github/v/release/Lampe332/seanime-mobile?style=for-the-badge&color=8b75ff&label=Version" alt="Latest version"></a>
  <img src="https://img.shields.io/badge/Android-7.0%2B-3ddc84?style=for-the-badge&logo=android&logoColor=white" alt="Android 7.0+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-555?style=for-the-badge" alt="GPL-3.0"></a>
</p>

<p align="center"><a href="https://github.com/Lampe332/seanime-mobile/releases/latest"><b>Download the latest APK</b></a> &nbsp;·&nbsp; <a href="#install-and-update">Install</a> &nbsp;·&nbsp; <a href="#first-start">First start</a> &nbsp;·&nbsp; <a href="#faq">FAQ</a> &nbsp;·&nbsp; <a href="CHANGELOG.md">Changelog</a></p>

Watch anime and read manga on your Android phone or tablet, with your AniList lists in sync. Stream or download episodes, read chapters online or offline, send an episode to your TV over DLNA, or play the library of the Seanime on your PC through Nakama. The sources come from extensions you install yourself.

## What 4.0 changes

Up to 3.0, the APK carried a whole Seanime server and ran it in the background next to the screens. In 4.0 that server is gone. The app does the work itself, with its own core written in TypeScript and a few native modules for torrents, casting and extensions.

You notice it in three places. The download shrank from about 107 MB to about 71 MB. The app uses less memory and less CPU while it sits idle. And Home shows your lists right after start, because nothing has to wait for a server to boot.

## Screenshots

<p align="center">
  <img src="docs/images/readme/phone-discover.png" alt="Discover with the season spotlight, genre chips and Trending now" width="24%">
  <img src="docs/images/readme/phone-schedule.png" alt="The schedule with tomorrow's episodes and their airing times" width="24%">
  <img src="docs/images/readme/phone-search.png" alt="Search with results for a typed title" width="24%">
  <img src="docs/images/readme/phone-anime.png" alt="An anime page with progress, Add to list, Episodes and playback, and the Library, Torrent and Online tabs; the source name is blurred" width="24%">
</p>
<p align="center">
  <img src="docs/images/readme/phone-menu.png" alt="The menu with Incognito mode, Updates, Schedule, History, Manga, Scan summaries, Extensions, Settings, Nakama and Refresh AniList" width="24%">
  <img src="docs/images/readme/phone-marketplace.png" alt="The Add marketplace sheet: one link field and a Paste link button" width="24%">
  <img src="docs/images/readme/phone-settings.png" alt="The Settings overview with its areas" width="24%">
</p>
<p align="center">
  <img src="docs/images/readme/tablet.png" alt="An anime page on a tablet: side navigation, cover and progress on the left, the online streaming tab with the episode preview on the right; the source name is blurred" width="860">
</p>

<p align="center"><sub>Version 4.0 on a Galaxy S22 Ultra and a Pixel Tablet.</sub></p>

<p align="center">
  <a href="docs/images/readme/intro.mp4"><img src="docs/images/readme/intro.gif" alt="A cut of the intro video: Home scrolls on a phone, a cover opens its anime page, an episode plays in the box on the page, the phone turns for fullscreen, the mini player keeps playing while browsing, then Discover, the schedule, Search and the tablet layout" width="860"></a>
</p>

<p align="center"><sub>The intro video was recorded with version 3.0 on a Galaxy S22 Ultra and a Pixel Tablet. Most screens still look like this; some details have changed since.</sub></p>

## What it does

**Watch and download.** Open an anime, pick a source and Sub or Dub, press play. The episode starts in a box on the page, goes fullscreen with one tap and drops into a mini player when you leave. The player is mpv, so AC3, DTS, ASS subtitles and every track of an MKV just play. Downloaded episodes play without a connection, and if you like, the app fetches the next one to three episodes of what you're watching on its own (Wi-Fi only, off until you switch it on under Downloads).

**AniList, even when it's down.** Discover, the schedule and Search come from AniList, and changes in My lists go back to your account. When AniList is down or you're offline, the app keeps your changes on the phone and sends them once AniList answers. A small pill on Home and My lists says how many are still waiting. No account? The local account keeps lists and progress on the device, and *Upload local lists* moves them to AniList later.

**History, Updates and incognito.** *Menu → History* lists what you watched and read, day by day. *Menu → Updates* gathers new episodes and chapters since your last visit, and the app can notify you when a manga you follow gets a new chapter. Incognito mode stops the history and the automatic progress updates; an episode you mark yourself still goes to AniList.

**Manga.** The Manga tab picks up where you stopped. Chapters can be downloaded for offline reading.

**Widget and backup.** The *Continue watching* widget puts what you're in the middle of on your home screen (add it from *Settings → App*). *Settings → App → Backup* writes settings, watch positions, playlists, extensions and the local account's lists into one file. Restore shows what the file holds before it changes anything, and you can undo the last restore. Tokens and passwords never go into the file.

**Phones and tablets.** One APK covers both. Tablets get a navigation rail, settings in two panes, and anime pages where the cover stays put while the episodes scroll.

## Good to know

The app ships without streaming, torrent or manga sources. You add them from a community marketplace ([First start](#first-start)); this project doesn't link to any.

It runs on 64-bit and 32-bit ARM devices with Android 7.0 or newer. There is no iOS version.

Torrents only work with torrent providers you install, and they use your connection, mobile data included. The app asks before a torrent starts on mobile data.

Not everything is tested on real hardware. Debrid isn't yet. Nakama was tested as a guest of Seanime on a PC (library and playback), and casting over DLNA on an LG TV, without checking subtitles on the TV.

### Gone in 4.0

Some features needed the built-in server and did not come back: plugins, Discord status, Nakama watch parties and cloud rooms, filler marking, custom source lists, debrid downloads into a folder, tracking in external players, searching other manga sources, local manga and the double-page reader view. *Export library data* is gone too; Backup replaces it.

## Install and update

1. On your device, open the **[latest release](https://github.com/Lampe332/seanime-mobile/releases/latest)** and download `Seanime-Mobile-4.0.0.apk` under *Assets*.
2. Open the file. The first time, Android asks you to allow **Install unknown apps** for your browser or file manager. Allow it and go back.
3. Tap **Install**.

> [!NOTE]
> **Play Protect** may warn you because the app doesn't come from the Play Store. Choose *More details → Install anyway*.

**Coming from 3.0.0?** The app offers the update itself, as usual.

**Coming from 2.0.33?** Its updater refuses 4.0. Download the APK by hand and install it over the old app; your data stays. Downloaded episodes, manga chapters and installed extensions are taken over on the first start.

The app checks this repository for new releases when it starts, and it installs an update only when the download matches the checksum GitHub publishes for it.

## First start

1. **Pick your language** (English or Deutsch) and tap **Get started**. Streaming and manga are on; you can change that later in Settings.
2. **Log in with AniList.** Allow access on AniList and copy the code it shows. When you come back, the app finds the code and offers **Connect**. No account? Make one for free at [anilist.co](https://anilist.co), or tap **Not now**.
3. **Add sources.** A short tour shows the way: *Menu → Extensions → Marketplace*, paste the link of a community marketplace, check the preview, add it. Then install a streaming source and a manga source. This project doesn't link to any marketplace and has nothing to do with their content.

## FAQ

<details>
<summary><b>The pages say "No content yet"</b></summary>

Normal on a fresh install. Connect AniList to see your lists and the catalog, and install a streaming or manga source to watch and read ([First start](#first-start), step 3).
</details>

<details>
<summary><b>An episode won't play</b></summary>

It's almost always the source. Pick another server or source on the anime page, and keep your extensions up to date (*Menu → Extensions*).
</details>

<details>
<summary><b>"App not installed" when updating</b></summary>

An update has to be signed with the same key as the installed app, and every release here is. If you installed a self-built or third-party version before, uninstall it first; its downloads go with it.
</details>

<details>
<summary><b>Do I still need Seanime on my PC?</b></summary>

No. Since 4.0 the app needs no Seanime server at all, not even inside itself. Seanime on a PC only comes in if you want to play its library through Nakama.
</details>

<details>
<summary><b>How is this different from Seanime Tenji?</b></summary>

[Tenji](https://seanime.app/docs/tenji) is the official Seanime app for phones. It's a client for a Seanime server on your computer or on the phone. Seanime Mobile works on its own. If you prefer the official route, use Tenji.
</details>

Found a bug or have an idea? [Open an issue](https://github.com/Lampe332/seanime-mobile/issues) with your device model, Android version and app version (*Settings → About*).

## Build it yourself

The app lives in `native/`: React Native and Expo in TypeScript, the core in `native/src/core/`, the native modules in `native/modules/`. Build instructions are in [docs/BUILD.md](docs/BUILD.md).

## Credits and license

Seanime Mobile is built on [**Seanime**](https://github.com/5rahim/seanime) by **5rahim**, licensed under the GPL-3.0. It started as a fork of Seanime; the screens are derived from Seanime's web interface, and the extension format and contract are Seanime's. Seanime Mobile is not the official Seanime app and is not affiliated with Seanime or 5rahim.

- [**Seanime Android**](https://github.com/Pal-droid/Seanime-Android) by Pal-droid: the original Android port ([original README](docs/upstream/README.md))
- [**mpv**](https://mpv.io) through [expo-mpv](https://www.npmjs.com/package/expo-mpv): the player
- [**libtorrent**](https://www.libtorrent.org) (BSD-3-Clause), [**BoringSSL**](https://boringssl.googlesource.com/boringssl), [**Boost**](https://www.boost.org) (Boost Software License 1.0) and [**quickjs-ng**](https://github.com/quickjs-ng/quickjs) (MIT) in the native modules

The full license texts of these and the bundled JavaScript libraries are in [`licenses/`](licenses/). The old server code and the earlier apps are still in the git history.

Seanime Mobile is licensed under the **GPL-3.0** ([LICENSE](LICENSE)). The app hosts no content; it only shows what your installed extensions provide.
