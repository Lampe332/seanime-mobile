# Changelog

Alle Versionen von Seanime Mobile. Downloads: [Releases](https://github.com/Lampe332/seanime-mobile/releases).

## 1.9.16 — 20.10.2026 (versionCode 31063)

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
