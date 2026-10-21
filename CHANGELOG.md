# Changelog

Alle Versionen von Seanime Mobile. Downloads: [Releases](https://github.com/Lampe332/seanime-mobile/releases).

## 1.9.38 — 22.10.2026 (versionCode 31089)

- 🎉 Player: Subtitles can be translated from the phone player menu (Google works without a key)
- ⚡️ Player: Back closes the built-in player on phones instead of shrinking it to a mini player that keeps playing

## 1.9.37 — 21.10.2026 (versionCode 31088)

- 🎉 Settings: New phone settings screen: each area opens in place, every change is saved at once without a Save button, and Back closes sheets and pages first
- 🎉 Playback: Episodes from your local library play in the app's built-in player
- 🎉 Playback: One-tap external player presets for VLC, MX Player, mpv and Just Player
- 🎉 Library: Library folders and the local manga folder can be picked with Android's folder picker
- 🎉 Player: The phone player menu has the libass renderer, the subtitle blacklist and skip patterns
- 🎉 Settings: The current server log can be saved as a file through Android's Save dialog
- ⚡️ Settings: Settings for programs the app cannot run (desktop players, transcoding, Discord, sidebar, keyboard shortcuts, server notifications, Nakama hosting) no longer show on Android
- ⚡️ Settings: Background and banner images take an https link
- ⚡️ Settings: Deleting logs and clearing caches ask first; developer tools are folded away under "Developer"
- 🦺 Settings: Saving the appearance settings no longer stores default values in fields you did not touch
- 🦺 Settings: "Export local file data" saves the file on Android instead of doing nothing
- 🦺 Settings: "Apply to this client" appears when only the desktop custom CSS differs
- 🦺 Settings: Back closes the settings drawer on tablets instead of leaving the page
- 🦺 Player: The 1.0s subtitle delay preset shows as chosen
- 🦺 Navigation: The "Reset navigation" dialog follows the app language
- 🦺 App: Pages no longer send failing auto-downloader requests on Android

## 1.9.36 — 21.10.2026 (versionCode 31087)

- ⚡️ My lists, Discover, Search: Switching tabs on the phone is quicker, because a card's long-press menu is only built when the card is touched

## 1.9.35 — 21.10.2026 (versionCode 31086)

- ⚡️ My lists: Searching and filtering stay fast on the phone after scrolling far into a long list
- ⚡️ Discover: Switching genres and tabs on the phone is quicker and no longer reloads rows loaded in the last 5 minutes
- ⚡️ Search: Long result lists on the phone use far less memory while scrolling
- 🦺 Search: Back from a title deep in the results returns to the same covers on the phone

## 1.9.34 — 21.10.2026 (versionCode 31085)

- 🦺 Discover: When AniList can't load a chosen genre on the phone, the genre chips stay visible, so "All" is one tap away

## 1.9.33 — 21.10.2026 (versionCode 31084)

- 🎉 Lists: Covers on the phone's My lists, Discover and Search tabs open a menu on long press with preview, continue watching (My lists), add to playlist and plugin actions
- 🎉 Lists: My lists on the phone searches titles as you type and refreshes your AniList lists from its header
- 🎉 Discover: Rows on the phone's Discover tab have "See all", which opens Search with the matching filters
- 🎉 Search: Filters on the phone's Search tab show as chips that can be removed one by one, and more results load as you scroll
- ⚡️ Lists: Redesigned the phone My lists tab like Home and Manga: Anime, Manga and Stats as tabs, list statuses with counts, covers with progress, new episodes and next airing, all filters and sorting in one sheet, stats as facts and bars
- ⚡️ Discover: Redesigned the phone Discover tab like Home: a swipeable spotlight, one genre row, rows for trending, aired recently, this and last season, missed sequels, coming soon and movies, a day-by-day schedule and manga, manhwa and manhua
- ⚡️ Search: Redesigned the phone Search tab: search field, Anime and Manga, sort chips, all filters in one sheet, covers with your list status
- ⚡️ Lists, Discover, Search: German texts, loading, empty and error states with "Try again" on the phone
- 🦺 Lists: "Title (Z-A)" sorts from Z to A instead of A to Z
- 🦺 Search: The minimum score filter now works for anime on the phone
- 🦺 Search: Opening Search from another link while it is already open applies the new filters on the phone

## 1.9.32 — 21.10.2026 (versionCode 31083)

- 🦺 Tutorial: The setup tour's hint no longer covers the title of the repository sheet on the phone

## 1.9.31 — 21.10.2026 (versionCode 31082)

- 🎉 Extensions: Each type on the phone's Installed tab has an "Add" action that opens the marketplace on that type
- 🎉 Extensions: The setup tour can be started from the Extensions tab's ⋮ menu
- ⚡️ Extensions: Online streaming and Manga stay on the phone's Installed tab when no source is installed, saying what is missing with a button to find one
- ⚡️ Extensions: The phone marketplace shows four extensions per type with "Show all", so large repositories stay browsable; extensions in the app language come first
- ⚡️ Extensions: A type a repository has nothing of says so in the phone marketplace, with a way to change the repository
- ⚡️ Tutorial: The setup tour names the buttons of the new Extensions tab, is available in German and has larger buttons on the phone

## 1.9.30 — 21.10.2026 (versionCode 31081)

- ⚡️ Extensions: A repository on GitHub is named by its owner and repository in the phone marketplace
- ⚡️ Extensions: Long repositories scroll more smoothly in the phone marketplace
- 🦺 Extensions: The manifest link in an extension's sheet is shown on its own line instead of a ragged right-aligned block

## 1.9.29 — 21.10.2026 (versionCode 31080)

- ⚡️ Extensions: Redesigned the phone Extensions tab like Home and Manga: a quiet title with icon actions, Installed and Marketplace as tabs, updates and extensions that need attention first, then streaming, manga, plugins, custom sources and disabled extensions as lists
- ⚡️ Extensions: Each extension on the phone opens one sheet with all of its actions (update with its changes, preferences, check for updates, reload, code, documentation, website, turn on/off, uninstall with a confirmation) instead of small icons spread over the card
- ⚡️ Extensions: Plugin permission requests and load errors are explained in the extension's sheet on the phone, with the requested rights and the error details
- ⚡️ Extensions: Checking for updates on the phone keeps the list on screen and says how many updates were found; "Update all" reports when it is done
- ⚡️ Extensions: Redesigned the phone marketplace with the repository and its change action on top, type chips with counts, search and language, and one install button per extension
- ⚡️ Extensions: Adding extensions from a link or a repository and changing the repository open as phone sheets with a paste button; preferences open as a sheet too
- ⚡️ Extensions: German texts for the phone Extensions tab
- ⚡️ Extensions: Extensions without an image icon show their first letter instead of an empty placeholder

## 1.9.28 — 21.10.2026 (versionCode 31079)

- 🦺 Manga: Closing the filter sheet on the phone Manga tab puts the focus back on the filter button, so TalkBack continues where it was

## 1.9.27 — 21.10.2026 (versionCode 31078)

- 🎉 Manga: The phone Manga tab starts with "Continue reading": manga you are reading, with their chapter progress and new chapters, open the reader where the manga page would continue
- 🎉 Manga: Completed and Dropped manga appear on the phone Manga tab, next to Reading, Planning and Paused as tabs with counts
- 🎉 Manga: The library sorting can be changed from the phone Manga tab
- ⚡️ Manga: Redesigned the phone Manga tab like Home and Downloads: a quiet title with search, source refresh and filter actions, a cover grid with chapter progress and a calm new-chapter badge, and fewer, wider cards with a large system font
- ⚡️ Manga: Genres, "only new chapters" and the new-chapter badges moved into one filter sheet on phones
- ⚡️ Manga: Loading, empty and error states on the phone Manga tab keep the page; an error offers to try again or read downloaded chapters instead of jumping back to Home
- ⚡️ Manga: The source refresh opens as a phone sheet with German texts
- ⚡️ Manga: Relations and recommendations on the manga page use Home's section headings and German labels

## 1.9.26 — 21.10.2026 (versionCode 31077)

- ⚡️ Calendar: "All anime" shows how many episodes air on each day in the month grid and the day strip

## 1.9.25 — 21.10.2026 (versionCode 31076)

- 🎉 Calendar: A week view lists the episodes of the next 7 days on the phone
- ⚡️ Calendar: Redesigned the phone calendar with filters in a bottom sheet, a cleaner month grid and German date names
- 🦺 Calendar: "All anime" now shows upcoming episodes for today and future days instead of only already aired ones or an error

## 1.9.24 — 21.10.2026 (versionCode 31075)

- 🦺 Tutorial: The Manga tab in the last step can be tapped again, followed by a step to install a manga source
- 🦺 Navigation: The bottom bar comes back after the repository dialog closes, instead of staying hidden until another menu is opened

## 1.9.23 — 21.10.2026 (versionCode 31074)

- ⚡️ AniList: Redesigned the login as a bottom sheet with two clear steps, a paste button and German texts

## 1.9.22 — 21.10.2026 (versionCode 31073)

- ⚡️ First start: Redesigned setup as a single screen with language, online streaming and manga
- 🏗️ First start: Removed the anime library folder step, which could not be used on a phone

## 1.9.21 — 20.10.2026 (versionCode 31072)

- 🦺 Downloads: The cover grid now really switches to two wider cards with a large system font (1.9.20 did not take effect on the phone).

## 1.9.20 — 20.10.2026 (versionCode 31071)

- 🦺 Downloads: With a large system font the cover grid shows two wider cards instead of three cramped ones.

## 1.9.19 — 20.10.2026 (versionCode 31070)

- ⚡️ Downloads: Paused and failed downloads keep showing how far they got.
- ⚡️ Downloads: "Continue offline" and the resume button skip episodes that were only opened for a few seconds.
- 🦺 Downloads: Fixed the last finished manga chapter sometimes not appearing until the app was reopened.
- 🦺 Downloads: Fixed the Back button leaving the "Delete chapter" sheet open while going back to the manga list.
- 🦺 Downloads: Fixed selection mode staying active after switching tabs, and the "Active" filter turning itself back on.
- 🦺 Downloads: Fixed the Downloads list and "On this phone" sometimes staying empty right after starting the app.
- 🦺 Anime: "On this phone" shows queued, preparing and failed episodes with the right status.

## 1.9.18 — 20.10.2026 (versionCode 31069)

- 🦺 Downloads: Fixed the item count overlapping the Anime / Manga switch and the black band above the Downloads title.

## 1.9.17 — 20.10.2026 (versionCode 31068)

- 🎉 Downloads: Episodes you started offline appear in a "Continue offline" row and play from where you stopped.
- ⚡️ Downloads: Redesigned the Downloads tab like Home and the anime and manga pages: running downloads come first with progress and pause / resume, a cover grid with filter counts, and anime and manga pages with one resume / watch action, quiet episode and chapter rows and phone sheets for deleting.
- ⚡️ Downloads: The Downloads tab and the anime page's "On this phone" list only check for progress while a download is running, instead of every one or two seconds.

## 1.9.16 — 20.10.2026 (versionCode 31067)

- 🎉 Player: The picture-in-picture window has back 10 s, play/pause and forward 10 s buttons; the play/pause icon follows the video.
- 🎉 Player: Phones can pick the default subtitle and audio language (Japanese, German, English) in the player settings.
- 🎉 Anime: Episodes downloaded to the phone appear under Local library on the anime page and play offline from there.
- 🎉 Home: Filter for Currently watching can narrow the list by genre.
- 🎉 Manga: The phone reader has a page slider, tap-the-middle to show or hide the controls, and new settings: keep the screen on, background (black / gray / white), brightness, and hiding the controls while scrolling down.
- ⚡️ Player: Redesigned the player settings on phones: grouped into Playback, Language & subtitles and Display, Auto play / Auto next / Skip OP/ED switch directly in the list, and Back returns to the overview from a sub page.
- ⚡️ Manga: Redesigned the manga page like the anime page: compact header with progress, AniList edit and the start / continue / resume reading button, grouped source options, Online reading / Downloaded tabs, Unread / All switch, a chapter list with download buttons, plugin actions and the menu as a compact row of icon buttons, the top bar Downloads shortcut opening the Downloads tab on Manga, and the anime page's manual match sheet.
- ⚡️ Manga: Redesigned the reader settings on phones as a grouped sheet (Reading, Page, Display) with segmented choices, zoom and width steppers and switches; options that only apply to the current mode appear only then; the reader bar uses equal round buttons with the chapter between its arrows.
- ⚡️ Anime: The audio toggle reads Sub / Dub.
- ⚡️ Anime: Redesigned Manual match (title pre-filled, one search row, large results), the stream cache sheet and the download episodes sheet.
- ⚡️ Player: Quality, audio and subtitle menus use the phone sheet; Skip opening / ending is a solid button at the bottom right.
- ⚡️ Menu: Sign out always sits at the bottom of the menu, away from everyday entries.
- ⚡️ Plugins: The plugin button uses a clear puzzle icon, the plugin list explains pinning, and opening it no longer highlights the close button.
- ⚡️ Anime: Plugin actions on the anime page appear as one row of round icon buttons, keeping each plugin's own icon.
- ⚡️ Home: Carousels are swiped without desktop arrows and use the same card size as Currently watching.
- ⚡️ Navigation: Bottom bar labels are larger and easier to read.
- ⚡️ Manga: The manga page has a title with the genre filter at the top, and chapter rows no longer repeat the chapter number.
- 🦺 Player: Fixed the video continuing to play in the background after closing the picture-in-picture window.
- 🏗️ Anime / Manga: Removed the "Save locally" button; it belonged to the removed desktop offline mode, Downloads replaces it on Android.
- 🏗️ Player: Removed desktop-only options from the phone player settings: Anime4K, Preferences (keyboard shortcuts, screenshot folder), custom subtitle font files and keyboard hints; the manga reader no longer offers its fullscreen toggle.

## 1.9.15 — 20.10.2026 (versionCode 31044)

- 🎉 Player: On phones, tapping the speaker icon opens a volume slider instead of muting.
- ⚡️ Anime: Redesigned the download sheet with a short header, quick selection chips, a compact episode list that marks saved episodes and a fixed download button.
- ⚡️ Anime: Source options are much more compact: provider and server form one group, Subtitles / Dub and Download share a line, and Manual match, Cache and the list/grid toggle are small secondary actions.
- ⚡️ Anime: Redesigned the AniList list entry sheet with status chips, -/+ buttons for progress and score, dates side by side and a separated remove action.
- 🦺 Anime: Fixed the provider icon showing as a detached block next to the provider picker.
- 🦺 Anime: Fixed tapping an episode's thumbnail or play icon doing nothing; it now starts the episode like tapping its title.
- 🏗️ Anime: Removed the separate "Download to phone" and "Downloads" buttons; a single episode is now saved with "This episode" in the download sheet, and downloads stay in the Downloads tab.
- 🏗️ Anime: Removed the repeated anime title under the current episode; previous / next are now compact arrow buttons.

## 1.9.14 — 20.10.2026 (versionCode 31040)

- ⚡️ Anime: Source, audio (subtitles/dub) and download options are always visible instead of hidden in a collapsible section.
- ⚡️ Anime: Larger AniList edit button and a cleaner list, progress and rating sheet.
- ⚡️ Plugins: The top bar of every screen uses the same Plugins menu as Home.
- 🏗️ Anime: Removed the separate Play / continue button; playback starts from the player.
- 🏗️ Home: Removed the accent marks before section headings.

## 1.9.13 — 20.10.2026 (versionCode 31039)

- ⚡️ Anime: Redesigned the anime page in the style of Home with fewer frames, a clear play action, a calmer episode list and horizontal rows for related anime and recommendations.
- ⚡️ Navigation: Plugins in the top bar is now a quiet icon button on every phone screen.
- 🦺 Anime: Fixed relation labels covering the dub badge on related anime.

## 1.9.12 — 20.10.2026 (versionCode 31038)

- 🦺 Home: Fixed sections such as Missed sequels not appearing after adding them in Customize Home; they now show a loading state, an empty note or a retry.
- ⚡️ Home: Added a subtle theme-colour background and accent marks to section headings.

## 1.9.11 — 20.10.2026 (versionCode 31037)

- 🏗️ Home: Removed the genre filter row from Home.
- ⚡️ Home: Refined Home styling with clearer section headings, a subtle theme-colour header glow and more even spacing.

## 1.9.10 — 20.10.2026 (versionCode 31036)

- 🎉 Home: Added a "?" button to every section in Customize Home that explains what the section shows.
- ⚡️ Home: Simplified Home with fewer frames and buttons; Playlists, Customize and Plugins are now icon buttons beside the title.
- ⚡️ Home: Redesigned Customize Home with an on/off switch per section, simpler reordering and tidier section options.
- 🦺 Home: Fixed Continue only opening the series page; it now starts the episode in the player at the saved position.
- 🏗️ Home: Removed the separate "Series details" link from Continue watching cards.
- 🏗️ Navigation: Removed the sidebar (☰) button on phones; the Menu tab in the bottom bar is unchanged.

## 1.9.9 — 20.10.2026 (versionCode 31035)

- ⚡️ Anime: Redesigned the anime details header, episode list and online-stream episode selection for phones.
- ⚡️ Home: Switched Home, the plugin chooser, playlists and plugin workspaces to neutral surfaces, keeping the theme colour for accents.
- ⚡️ Home: Arranged the Customize Home section actions in even columns, with a single column for large text.
- ⚡️ Home: Aired Recently and Missed Sequels no longer auto-scroll or start hover trailers on phones.
- ⚡️ Performance: Reduced main-thread work while scrolling and when opening Home sheets.
- 🦺 Home: Fixed the plugin chooser search and close button moving off-screen while the keyboard is open.
- 🦺 Home: Fixed misaligned manga and carousel sections and the dub badge covering airing information.
- 🦺 Plugins: Fixed memory growing each time Home was revisited while plugins decorate its cards.

## 1.9.8 — 19.10.2026 (versionCode 31033)

- 🦺 Home: Show pinned plugins as compact icon buttons, keeping their names available to screen readers without overflowing the header.

## 1.9.7 — 19.10.2026 (versionCode 31032)

- ⚡️ Plugins: Added a shared phone layout for plugin contents and nested settings, with touch controls, keyboard-aware scrolling and Android Back navigation.
- ⚡️ Playlists: Reworked browsing, drafts, anime and episode selection, editing and active playlist controls into consistent mobile surfaces.
- 🦺 Plugins: Show saved pins beside the Home Plugins button, open the correct plugin directly and keep pin state consistent during saving.
- 🦺 Plugins: Display numeric selection values without changing the value type sent to plugins.
- 🦺 Playlists: Preserve drafts after failed saves, prevent repeated submissions and keep externally requested episodes associated with the correct anime.

## 1.9.6 — 19.10.2026 (versionCode 31031)

- ⚡️ Home: Replaced the background banner with a compact, image-independent header, integrated Plugins action and subtle static background accents.
- ⚡️ Plugins: Refined the Home chooser into a compact bottom sheet with separate open and pin targets, clear pinned states and keyboard-aware scrolling.

## 1.9.5 — 19.10.2026 (versionCode 31030)

- ⚡️ Home: Refined the banner crop and fade, image-led continuation cards and the customization sheet with clearer section controls.
- 🦺 Home: Fixed clipped carousel arrows on mobile Home sections.

## 1.9.4 — 19.10.2026 (versionCode 31029)

- 🎉 Home: Made existing section selection, options and reordering accessible on phones with touch controls.
- ⚡️ Home: Redesigned the mobile header, continuation cards, library rows and labeled actions while preserving the saved section order and settings.
- ⚡️ Home: Replaced the scrolling animated background with a compact static banner and manual continuation rows to reduce work during scrolling.
- ⚡️ Home: Improved genre filters, loading and retry states, long titles, touch targets and reduced-motion support.
- 🦺 Home: Avoid a duplicate settings request from the closed customization dialog on each Home load.

## 1.9.3 — 19.10.2026 (versionCode 31028)

- ⚡️ Updates: Redesigned the update menu and dialog with clearer versions, compact actions, download size and consistent progress, permission and error states.
- ⚡️ Updates: Improved text wrapping, reduced-motion support and localized release information headings.
- 🦺 Updates: Keep the update dialog above the Android navigation menu so its controls remain reachable.

## 1.9.2 — 18.10.2026 (versionCode 31027)

- 🦺 Update menu: Fixed the menu closing when checking for app updates.
- ⚡️ Update checks: Added a localized loading indicator, clearer errors, and a retry action.

## 1.9.1 — 18.10.2026 (versionCode 31026)

- 🎉 Updates: Download, verify and install newer APK releases through Android PackageInstaller, with source permission and system confirmation when required
- 🎉 Updates: Confirm the actual installed version once after a successful app replacement and offer an app-opening notification when notifications are allowed
- ⚡️ Updates: Preserve installation state across process restarts and reuse verified APKs after denied permission or cancelled installation
- ⚡️ Updates: Check on app start or resume with an hourly freshness limit instead of periodic release polling
- 🦺 Navigation: Simplified the Home roof and Download Notifier arrow in the shared outline catalogue, including saved navigation icons

## 1.8.8 — 18.10.2026 (versionCode 31023)

- 🦺 Navigation: Redrew the existing control icons with consistent outline geometry across tabs, Menu and navigation customization
- 🦺 Navigation: Renewed saved built-in icons without resetting tab placement, order or hidden entries
- 🦺 Updates: Verify downloaded APK size, checksum, package, version, signing certificate and device compatibility before reporting success
- ⚡️ Updates: Keep downloads running through Android DownloadManager with progress, retry and restored status after restarting the app
- ⚡️ Updates: Show the available version and shared download status in Menu and the update window
- 🎉 Updates: Added an explicit action to open a verified downloaded APK

## 1.8.6 — 18.10.2026 (versionCode 31021)

- 🏗️ Player: Removed the floating Hoster Player launcher from its local plugin source
- 🦺 Navigation: Removed the styles that painted dark backgrounds behind menu labels
- 🏗️ Android: Replaced the legacy Offline page with Downloads; old Offline links now open Downloads
- 🦺 Navigation: Preserved the order and placement of saved entries when removing legacy Offline navigation

## 1.8.4 — 17.10.2026 (versionCode 31019)

- ⚡️ Navigation: Made the bottom tab bar easier to read, with larger icons and labels and a clearer active state

## 1.8.5 — 18.10.2026 (versionCode 31020)

- 🎉 Navigation: Added tools to move and reorder entries between the bottom bar and Menu
- ⚡️ Navigation: Refreshed the mobile bottom bar and Menu panel with the installed design
- 🦺 Navigation: Reset restores the default Downloads tab

## 1.8.3 — 17.10.2026 (versionCode 31018)

- 🦺 Updates: The update popup now compares the installed Android app version against stable releases of `Lampe332/seanime-mobile` instead of desktop Seanime releases
- ⚡️ Updates: The download button saves the matching `Seanime-Mobile-<version>.apk` directly to Downloads
- 🏗️ Updates: Desktop server updates, their changelogs and announcements are no longer fetched on the phone, and the desktop update channels are hidden

## 1.8.2 — 17.10.2026 (versionCode 31017)

- **18+ wieder einstellbar** (GitHub-Version): *Settings → Enable adult content* und *Blur adult content* sind zurück, wie im Original-Seanime, standardmäßig aus. Dazu wieder der „Adult“-Schalter in Suche und Listen.

## 1.8.1 — 17.10.2026 (versionCode 31016)

- **Frisch installiert zeigt die App keine Animes und Mangas mehr.** Startseite, Discover, Suche, Kalender, Listen, Manga und Detailseiten bleiben leer (Hinweis „No content yet"), bis ein AniList-Token hinzugefügt oder eine Inhalts-Erweiterung (Online-Streaming, Manga, Torrent, Custom Source) installiert ist, z. B. über ein eigenes Marketplace-Repository. Plugins zählen nicht. Einstellungen, Erweiterungen und Downloads bleiben erreichbar. Das Backend fragt bis dahin auch nichts bei AniList ab.

## 1.8.0 — 16.10.2026 (versionCode 31015)

- **App komplett auf Englisch**, Deutsch bleibt wählbar: *Settings → App language* (English / Deutsch). Gilt für Downloads, Folgen-Auswahl, Kalender, Manga-Downloads, Offline-Player, Benachrichtigungen und Meldungen. Standard ist Englisch.
- Die Sprachwahl wird an die nativen Android-Teile (Offline-Player, Download-Benachrichtigung) weitergegeben; nach dem Umschalten lädt die App einmal neu.
- Englische Mehrzahlformen korrigiert („1 chapter“ statt „1 chapters“).

## 1.7.0 — 16.10.2026 (versionCode 31014)

- **Einrichtungs-Tutorial beim ersten Start:** Eine interaktive Tour führt Schritt für Schritt durch Menu → Extensions → Marketplace → Repository hinzufügen → Streaming-Erweiterung installieren, inklusive Manga-Hinweis. Der hervorgehobene Knopf wird jeweils selbst angetippt, „Skip" ist jederzeit möglich.
- Tutorial erneut starten: *Settings → Extensions → Show tutorial*. Wer schon eine Streaming-Erweiterung hat, bekommt es nach dem Update nicht automatisch angezeigt.
- Einrichtungs-Assistent auf Android verkürzt: kein Player-Schritt mehr, keine Desktop-Optionen (Discord, Transcoding). Online Streaming ist standardmäßig an, NSFW aus.
- Tour-System robuster: Taps im Spotlight erreichen den echten Knopf, die Tour liegt über dem Android-Menü, Ziele werden mittig gescrollt, Tippen in Textfeldern schaltet die Tour nicht weiter.

## 1.6.0 — 16.10.2026 (versionCode 31013)

- **Staffel / Folgen herunterladen** in der Animeansicht: ganze Staffel, ab Folge …, einzelne Folgen. Vorhandene oder eingeplante Folgen derselben Sprachfassung werden übersprungen.
- **Dauerhafte Download-Warteschlange**: Quellen werden erst bei freiem Platz aufgelöst, maximal zwei Videos gleichzeitig. Übersteht Seitenwechsel und App-Neustart; pausieren, fortsetzen, entfernen.
- **Downloads-Tab mit Anime und Manga.** Manga mit lokal gespeichertem Cover, Infos und Kapitelübersicht; heruntergeladene Kapitel öffnen den Manga-Reader, auch offline.
- Manga-Downloads starten auf Android sofort (`startNow: true`).
- Routenfehler beim Öffnen eines Manga behoben (numerische IDs werden normalisiert).
- Mehrere Anime auswählen und gemeinsam löschen; „Anime löschen“ in der Detailansicht.

## 1.5.0 (31012)

- Downloads als Route `/android-downloads` in der Haupt-App, mit unterer Navigation und aktivem Tab.
- Anime-Übersicht mit Covern; Folgenansicht mit Banner, Jahr, Format, Bewertung, Genres, Beschreibung und Folgenbildern.
- Bilder und Metadaten werden dauerhaft lokal gespeichert und funktionieren offline.
- Offline-Wiedergabe direkt aus der Folgenansicht; Fehler beim direkten Player-Start behoben.

## 1.4.1 (31011)

- Downloads nach Anime gruppiert und nach Folgennummer sortiert; Filter Alle / Bereit / Aktiv; Speicherübersicht.
- Offline-Player (Media3/ExoPlayer): 16:9, Querformat-Vollbild, −5/+10 s, Doppeltippen, Tempo 0,5–2×, Untertitel.
- Wiedergabeposition wird gespeichert; nächste gespeicherte Folge wird angeboten.

## 1.4.0 (31010)

- Torrent- und Debrid-Funktionen auf Android deaktiviert (Oberfläche und API gesperrt).
- Offline-Downloads für direkte MP4- und HLS-Quellen.

## 1.3.3 (31009)

- Kalenderquelle wählbar: Meine AniList oder Alle Anime.
- Mehrfachauswahl aller sechs AniList-Status.
- Alle Anime lädt sämtliche Sendezeiten des gewählten Tages; fünf Minuten Zwischenspeicher.
- Kompaktere Überschrift, deutlichere Terminzellen, größere Folgenkarten; sichtbare Lade- und Fehlerzustände.
- Sechs Unit-Tests für den globalen Sendeplan.

## 1.3.2

- Sendeplan auf Handys als Monatskalender mit Folgenanzahl je Tag, Monatswechsel, Heute-Knopf, wählbarem Wochenbeginn.

## 1.3.1

- Home-Auswahlfelder bleiben im Dialog; Plugin-Übersicht mit Suche und größeren Pin-Flächen.
- Plugin-DOM-Beobachter und WebSocket-Verarbeitung effizienter.
- Einstellungen zeigen Backend-Version und APK-Version getrennt.

## Frühere Mobile-Korrekturen

- Aktiver Bereich in der unteren Navigation markiert; scrollbares, beschriftetes Menü.
- Android-Zurück schließt Dialoge und Menü vor dem Verlassen der Seite.
- Externe Seiten mit eigener Zurück-Navigation; Benachrichtigungsberechtigung wird einmal angefragt.
- System-Dateiauswahl für Importe, Android-Speicherdialog für Downloads und Exporte bis 25 MiB.
- Manga-Reader-, Resume-, Doppelseiten- und Bild-im-Bild-Korrekturen.
- WebView-Debugging nur in Debug-Builds.
