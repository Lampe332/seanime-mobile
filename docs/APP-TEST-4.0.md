# App-Test Yomimi 4.0 (Block 5, Nachtlauf 15.11.2026)

Kompletter Bedien-Test auf Pixel Tablet (scratch-App, Test-Konto, schreibende Tests erlaubt) und Galaxy S22 (Test-App, Nicks echtes AniList-Konto, nur lesend). Sechs Läufe, je Gerät einer gleichzeitig, danach fünf Fix-Läufe. Belege liegen nur lokal unter `D:\SNB\belege\2026-11-15\` (nicht im Repo).

## Ergebnis

| Lauf | Gerät | Bereiche | OK | Fehler | nicht prüfbar |
|---|---|---|---|---|---|
| T1 | Tablet | Home, Listen, Entdecken, Suche, Zeitplan | 51 | 8 | 3 |
| T2 | Tablet | Manga + Leser, Erweiterungen, Playlists | 52 | 14 | 9 |
| T3 | Tablet | Menü, Einstellungen, lokale Ordner, Nakama | 47 | 8 | 11 |
| S1 | S22 | Anime-Seite, Player, Downloads, Cast-Panel | 40 | 6 | 9 |
| S2 | S22 | Torrent, Datei-Wahl, Torrent-Client, Debrid | 37 | 12 | 2 |
| S3 | S22 | Handy-Layout Home/Listen/Suche/Menü/Einstellungen, Nachprüfung F1 | 26 | 5 | 2 |

Zahlen aus den Berichten der Läufe. AniList: S22-Konto unverändert (Dr. STONE 24/24 vorher/nachher), Test-Konto am Ende leer (öffentliche API: 0 Anime, 0 Manga).

## Behoben in dieser Nacht (tsc 0 · vitest 157 Dateien / 1501 Tests · lint 0 Fehler)

| Commit | Fehler | Beleg am Gerät |
|---|---|---|
| `5672b5c6` | Cast-Panel: „Stop casting“ im Querformat sichtbar; Sitzung endet bei STOPPED vom TV; eigener Text bei gescheitertem Start-Sprung | S22-Panel ohne TV (TV war aus), Rest nur per Test |
| `bb27fa4f` | Playlist-Knopf verdeckt × des Mini-Players; „Choose source“ (Online fehlte als Standard-Quelle) | Tablet T2 (× frei) |
| `9e0b5454` | Umschalter Anime\|Manga sprang (Übergabe der Pille einen Wechsel zu spät) | Tablet, 3–11 statt 0 Zwischenbilder |
| `0056778e` | Blätter scrollen bei langsamem Wischen nicht (Filter „Year“ unerreichbar); „Pick the best torrent“ nicht gespeichert; falscher Hinweistext Torrents; „phone“ in Lösch-Dialogen | S22 (F1, S3) |
| `e40d0504` | Cache-only mode ließ sich nicht speichern (Kern kannte Route nicht); externer Player nicht abwählbar; veraltete Einstellungs-Texte | Tablet (F2) |
| `b11019f2` | Logs & cache fragte gelöschten Server ab; Download-Blatt: zwei Schnellwahlen zugleich aktiv | S22 (F3) |
| `9096c21f` | Manga-Leser vor/zurück sprang in andere Übersetzung | Tablet (F5) |
| `952bb849` | Einzelfolgen als „Batch“ (Erweiterung meldet es, App glaubt es unter 500 MiB nicht); „1 seeders“; Anime-Seite merkt den Reiter; Debrid nur mit Anbieter an (Anbieter-Zeile jetzt immer sichtbar – kleine optische Änderung); Übersichtstext Cache | S22 (F4), Batch nur per Test |

## Offen – braucht Nicks Entscheidung

- Versionsanzeige „Seanime 3.10.4 · App 4.0.0“ / Über-Seite „Seanime 3.10.4 Saisei“ statt Yomimi (`settings-phone.tsx:76`).
- Home zeigt Nakama-Bibliothek nicht: Nakama-Einträge in „Continue watching“ aufnehmen oder „Anime library“ in der Anordnung einschalten? Gast am Tablet nicht eingerichtet (Passcode von Denshi nötig).
- Dr. STONE Folgen 1–4 liegen als Dateien am S22, erscheinen nicht: Bibliotheks-Ordner steht auf „Not set“ (Nicks Einstellung).
- MangaFire-Kapitelnummern („Z=1“ → 0, „Z=232“ → 0.232): falsch geliefert von der Erweiterung; Kern könnte Nummer aus dem Titel lesen (geraten) – Entscheidung.
- Batch-Torrents: kein Datei-Auswahl-Blatt (Stream spielt sofort Folge 1, Download nimmt ganzen Torrent) – größerer Umbau.

## Offen – größere Fehler (nicht in der Nacht)

- Mini-Player erscheint/verschwindet ohne Gleiten; Steuerleiste blendet in ~120 ms praktisch ohne Übergang aus.
- Umschalter verlieren bei 2–3 von 6 Wechseln den Anfang des Gleitens (Aufbau des neuen Inhalts blockiert den UI-Faden).
- Filler-and-specials-Blatt leer.
- Vorige/Nächste-Pfeile über der Vorschau starten mit „Auto play“ sofort eine Wiedergabe.

Die übrigen kleinen Fehler stehen in den Abschnitten „Fehler“ der einzelnen Läufe unten.

## Lauf T1 – Tablet: Home, Listen, Entdecken, Suche, Zeitplan

Belege: `D:/SNB/belege/2026-11-15/apptest/T1/` (nur lokal, nicht im Repo).

Gerät: Pixel Tablet, `com.seanime.app.scratch`, Test-Konto. Zeit: 15.11.2026 ca. 02:15–02:55. Belege in `T1\`.

| Bereich | Element | Gerät | OK/Fehler | Beleg |
|---|---|---|---|---|
| Home | Leerer Zustand „Your home screen is empty“ + Trending-Karussell | Tablet | OK | 01_start.png |
| Home | „Add series to your collection“ → öffnet Discover | Tablet | Fehler: Discover öffnet mit Tastatur, ohne sichtbares Eingabefeld | 15_addseries.png |
| Home | „Customize“ öffnet Blatt „Customize Home“ (gleitet von rechts) | Tablet | OK | 02_customize.png |
| Home/Customize | „?“-Hilfe (Continue watching) + OK | Tablet | OK | 03_help.png |
| Home/Customize | Abschnitt einschalten (Aired recently) → wandert nach „On your Home“, Home zeigt ihn | Tablet | OK | 04_two_on.png |
| Home/Customize | Pfeil hoch verschieben (Aired recently vor Continue watching), Toast „Home screen updated“ | Tablet | OK | 05_moved_up.png |
| Home/Customize | Pfeile am Rand korrekt deaktiviert (oben ↑, unten ↓) | Tablet | OK | 05_moved_up.png |
| Home/Customize | Anime carousel einschalten (mehrfach anlegbar, bleibt in „More sections“) | Tablet | OK | 06_carousel_on.png, 07_onhome.png |
| Home/Customize | Liste „More sections“ komplett (13 Einträge) scrollbar | Tablet | OK | 06_carousel_on.png |
| Home/Customize | Options: Name-Feld | Tablet | OK | 09_sorting.png |
| Home/Customize | Options: Sortier-Dropdown | Tablet | Fehler: erster Tipp auf „Trending“ im offenen Menü ohne Wirkung, zweiter wirkt | 10_before_save.png, 11_trending_retry.png |
| Home/Customize | Options: Status-Chip (Releasing), Genre-Chip (Action) | Tablet | OK | 11_trending_retry.png |
| Home/Customize | Options: Save → Karussell heißt „Testkarussell“, Toast „Home layout updated“ | Tablet | OK | 12_saved.png |
| Home/Customize | Your library: „On this device“ / „Device + streaming“ umschalten, Toast „Settings saved“ | Tablet | OK | 13_ondevice.png |
| Home/Customize | Abschnitte ausschalten, Toast „Home item removed“; Ausgangszustand (nur Continue watching an, Device + streaming) wiederhergestellt | Tablet | OK | 14_restored.png, 62_home_final.png |
| Home/Customize | Toast liegt über dem Blatt-Titel „Customize Home“ | Tablet | Fehler: Toast verdeckt Überschrift (kosmetisch) | 05_moved_up.png, 14_restored.png |
| Home/Customize | × schließt Blatt | Tablet | OK | 15_addseries.png |
| Listen | Anime leer: Text + „Discover anime“ + „Search“ | Tablet | OK | 16_mylists.png |
| Listen | Filter bei leerer Liste ausgegraut | Tablet | OK | 16_mylists.png |
| Listen | Stats-Umschalter (Anime) leer | Tablet | OK | 17_stats.png |
| Listen | Manga-Umschalter + Stats (leer) | Tablet | OK | 18_manga_stats.png |
| Listen | Refresh → Toast „AniList is up to date“ | Tablet | OK | 18_manga_stats.png |
| Listen | Manga leer: „Discover manga“ + „Search“ → öffnet Manga-Suche | Tablet | OK | 19_manga_list.png, 20_search_from_manga.png |
| Listen | Eintrag erscheint nach Hinzufügen (Watching 1, 2/28, ★3) | Tablet | OK | 36_list_entry.png |
| Listen | Filter & sort-Blatt öffnen, Genre-Chip Drama → „Filtered: Drama“, Reset/Clear erscheinen | Tablet | OK | 37_list_filter.png, 38_list_sort.png |
| Listen | Sortier-Dropdown (8 Optionen) → Title (A-Z) | Tablet | OK | 39_list_sortmenu.png, 40_list_sortset.png |
| Listen | Filter-Blatt scrollen | Tablet | Fehler: Blatt scrollt nicht, Abschnitt „Year“ (und alles darunter) unerreichbar | 37_list_filter.png, 41_list_sheet_scroll2.png |
| Listen | Reset + „Show 1 anime“ | Tablet | OK | 42_list_reset.png |
| Listen | Stats mit 1 Eintrag (Watching, 2 Folgen, Wertung) | Tablet | Fehler: „0 anime started / No anime stats yet“, auch nach Refresh | 43_stats_entry.png, 44_stats_refresh.png |
| Listen | Ansicht-Umschalter (Raster/Liste) | Tablet | nicht prüfbar: kein solches Element vorhanden | 36_list_entry.png |
| Listen | Karte öffnen → Detailseite | Tablet | OK (Detailseite behält alte Scroll-Position) | 45_card_open.png |
| Suche | Manga: Sortier-Chips (Highest score … Most chapters), Untertitel passt sich an | Tablet | OK | 20_search_from_manga.png, 21_manga_mostch.png |
| Suche | Manga: Filter-Blatt (Genres, Format, Country, Year) | Tablet | OK (aber Year angeschnitten, s. u.) | 22_manga_filter.png |
| Suche | Manga: Filter Action + South Korea → Chips mit ×, „Clear filters“, Punkt am Filter-Symbol | Tablet | OK | 23_manga_filtered.png |
| Suche | Clear filters | Tablet | OK | 24_manga_noresult.png |
| Suche | Leere Suche („zzqxqvkw“) → „No manga match“ + „Try other words“ (fokussiert Feld) | Tablet | OK | 24_manga_noresult.png, 25_tryother.png |
| Suche | Nach Enter in Suchfeld: Fokus-Rahmen springt auf „Home“ in der Seitenleiste | Tablet | Fehler: Home-Eintrag grau hinterlegt, obwohl Search aktiv | 24_manga_noresult.png, 26_anime_search.png |
| Suche | Feld leeren (×) | Tablet | OK | 26_anime_search.png |
| Suche | Anime: Suche „Frieren“ → 6 Treffer, „Best match“, „That's all“ | Tablet | OK | 26_anime_search.png |
| Suche | Treffer öffnen → Detailseite | Tablet | OK | 27_detail.png |
| Suche | Anime: Filter-Blatt (Genres, Format, Season, Year …) | Tablet | Fehler: Blatt scrollt nicht, „Year“ angeschnitten/unerreichbar | 52_anime_filter.png |
| Suche | Status-Wort uneinheitlich: Discover „Releasing“, Suche „Airing“ | Tablet | Fehler: kosmetisch | 50_disc_scroll.png, 51_seeall.png |
| Liste schreiben | „+“ auf Detailseite → Eintrag „Planning“, Toast „Entry updated“ | Tablet | OK | 30_plus.png |
| Liste schreiben | Edit-Dialog: Status Watching | Tablet | OK | 32_edited.png |
| Liste schreiben | Edit-Dialog: Fortschritt +2 (2/28) | Tablet | OK | 32_edited.png |
| Liste schreiben | Edit-Dialog: Wertung +3 (3/10) | Tablet | OK | 32_edited.png |
| Liste schreiben | Save → Toast, Seite zeigt ★3 2/28 Watching | Tablet | OK (Dialog bleibt nach Save offen) | 33_saved_entry.png |
| Liste schreiben | Favorit setzen | Tablet | nicht prüfbar: kein Favoriten-Knopf in der App (Detail, „More“, Edit-Dialog) | 28_more.png, 35_about_scrolled.png |
| Liste schreiben | Notiz ändern | Tablet | nicht prüfbar: kein Notiz-Feld im Edit-Dialog | 32_edited.png |
| Liste schreiben | Löschen (Papierkorb → „Confirm“) → zurück auf 0/28 mit „+“ | Tablet | OK | 46_delete_dialog.png, 47_deleted.png |
| Detail | „More“-Blatt (AniList/AniDB/MAL, Filler, Torrent, Tabs) öffnet/schließt | Tablet | OK | 28_more.png |
| Detail | „About this anime“ aufklappen | Tablet | OK | 34_about.png |
| Discover | Reiter Anime: Genre-Chips (Comedy) filtern Hero + Reihen, Label „Comedy“ | Tablet | OK | 49_disc_comedy.png |
| Discover | Hero-Karussell + Reihen horizontal wischen | Tablet | OK | 49_disc_comedy.png |
| Discover | Reihen „Trending now“, „Top of Fall 2026“, „Best of Summer 2026“ | Tablet | OK | 50_disc_scroll.png |
| Discover | „See all“ → Suche mit Filtern Comedy/Fall/2026 (31) | Tablet | OK | 51_seeall.png |
| Discover | Erneuter Tipp auf „Discover“ in Seitenleiste | Tablet | OK (bleibt an Scroll-Position, kein Sprung nach oben) | 53_schedule.png |
| Discover | Reiter Manga: Hero, Genres, „Trending manga“ | Tablet | OK | 59_disc_manga.png |
| Discover | Manga-Hero öffnen → Manga-Detail, 1× Zurück | Tablet | OK | 60_manga_detail.png, 61_manga_back.png |
| Zeitplan | Reiter Schedule: „165 episodes in the next 2 weeks“, „Later today 18“, Zeiten plausibel (02:48 + 6 h = 8:30) | Tablet | OK | 54_schedule2.png |
| Zeitplan | Scrollen über Tage (Thursday, 19 Nov …) | Tablet | OK | 58_sched_scroll.png |
| Zeitplan | Eintrag öffnen → Detail mit „Episode 6 in about 6 hours“ | Tablet | OK | 55_sched_open.png |
| Zeitplan | Zurück aus Detail | Tablet | Fehler: erstes Zurück ohne Wirkung, erst zweites führt zum Zeitplan | 56_back_sched.png, 57_back_sched2.png |
| Allgemein | Logcat (300 Zeilen) nach error/exception | Tablet | OK (0 Treffer) | – |

#### Gegenprobe Test-Konto (öffentliche AniList-API, ohne Token)
- MediaListCollection ANIME: **0** Einträge, MANGA: **0** Einträge
- Favoriten anime: **0**, manga: **0**

#### Fehler

1. **Filter-Blätter scrollen nicht (Listen + Suche)** – groß
   Schritte: My lists → Filter (mit ≥1 Eintrag) bzw. Search → Filter → im Blatt nach oben wischen.
   Erwartet: Blatt scrollt, „Year“ und weitere Abschnitte erreichbar. Tatsächlich: kein Scrollen, „Year“ nur angeschnitten hinter dem Knopf „Show …“.
   Vermutet: `native/src/main/lists/_screens/lists-phone-filters.tsx`, `native/src/main/search/_screens/search-phone-filters.tsx` (gemeinsame Sheet-Komponente). Manga-Suche gleich betroffen (22_manga_filter.png, Year am Rand).
2. **Listen-Stats leer trotz Eintrag** – klein/mittel
   Schritte: Anime auf Liste (Watching, 2/28, ★3) → My lists → Stats (+ Refresh). Erwartet: Stats für 1 Titel. Tatsächlich: „0 anime started / No anime stats yet“. Evtl. nutzt die App AniLists `User.statistics`, die AniList verzögert neu berechnet – dann Text irreführend.
   Vermutet: `native/src/main/lists/_screens/lists-phone-stats.tsx:67`.
3. **Zurück aus Detail (vom Zeitplan) braucht 2×** – klein
   Schritte: Discover → Schedule → Zeile tippen → Zurück. Erwartet: Zeitplan. Tatsächlich: erst beim 2. Zurück. Vom Manga-Hero aus reicht 1×. Verdacht: Route wird beim Zeilen-Tipp doppelt gepusht.
4. **Tastatur ohne Eingabefeld nach „Add series to your collection“** – klein
   Schritte: Home (leer) → Customize öffnen/schließen (Name-Feld war vorher fokussiert) → „Add series …“. Erwartet: Discover ohne Tastatur. Tatsächlich: Tastatur offen, kein Feld sichtbar. Möglicherweise Restfokus aus dem Options-Namensfeld.
5. **Sortier-Dropdown im Karussell-Options-Blatt: erster Tipp ohne Wirkung** – klein
   Schritte: Customize → Anime carousel → Options → Name tippen → Sorting öffnen → „Trending“ tippen. Erwartet: Auswahl. Tatsächlich: Menü bleibt offen, erst 2. Tipp wählt. Wahrscheinlich Fokuswechsel nach Tastatur.
6. **Fokus-Rahmen springt nach Enter auf „Home“ in der Seitenleiste** – klein
   Schritte: Search → Suchfeld → Text → Enter. Tatsächlich: Home-Eintrag grau hinterlegt, Search bleibt aktiv. (Mit adb-Enter nachgestellt; mit Tastatur-Lupe nicht geprüft.)
7. **Toast verdeckt Titel des Customize-Blatts** – klein (kosmetisch).
8. **„Releasing“ (Discover) vs. „Airing“ (Suche)** – klein (Wortwahl uneinheitlich).
9. **Favorit/Notiz nicht bedienbar** – Hinweis: im Edit-Dialog und auf der Detailseite gibt es weder Favoriten-Knopf noch Notiz-Feld (grep `ToggleFavourite` in `native/src`: nur generierte Typen). Falls gewollt: Funktion fehlt.

Hinweise: Edit-Dialog bleibt nach „Save“ offen (Toast erscheint) – vermutlich gewollt. Detailseite merkt sich die Scroll-Position beim Wiederöffnen.

#### Nicht geschafft
- Home: übrige „More sections“ (Anime library, Centered title, Banner, Local library stats, Manga carousel/library, Missed sequels, My lists …) nicht einzeln eingeschaltet – nur Aired recently + Anime carousel (Budget).
- Listen: Manga-Liste mit Eintrag (Filter/Sortierung) nicht getestet – nur leer.
- Wertung/Start-/Enddatum-Kalender und „Total rewatches“ im Edit-Dialog nicht bedient.
- Keine Animations-Videos (screenrecord) – Blätter gleiten sichtbar, kein Verdacht.

## Lauf T2 – Tablet: Manga + Leser, Erweiterungen, Playlists

Belege: `D:/SNB/belege/2026-11-15/apptest/T2/` (nur lokal, nicht im Repo).

APK-Stand: `lastUpdateTime=2026-11-15 02:25:09` (Gerät) vs. Commit `bb27fa4f` 02:19:17 +0100 → APK neuer, Fix prüfbar.

| Bereich | Element | Gerät | OK/Fehler | Beleg |
|---|---|---|---|---|
| Manga | Suche Manga-Tab + Texteingabe | Tablet | OK | 02_manga_search.png |
| Manga | Such-Filter aus Anime-Suche (Comedy/Fall/2026) bleiben im Manga-Tab hängen → „No manga match“ | Tablet | Fehler: Filter werden ungefragt übernommen | 02_manga_search.png |
| Manga | „Clear filters“ | Tablet | OK | 03_manga_results.png |
| Manga | Manga-Seite öffnen (Cover, Titel, Fortschritt, Resume) | Tablet | OK | 04_manga_page.png |
| Manga | Kapitel-Nummern MangaFire („Z=1“ → Chapter 0, „Z=232“ → Chapter 0.232) | Tablet | Fehler: Nummern falsch geparst, Kapitel 0.231/0.232 sortieren unter Kapitel 1 | 04_manga_page.png, 14_goto_ch2.png |
| Manga | Quelle-Dropdown (Local/Mangadex/MangaFire) | Tablet | OK | 05_source_dropdown.png |
| Manga | Sprache-Dropdown + English wählen (1202 → 719) | Tablet | OK | 06_language_dropdown.png, 07_english_newest.png |
| Manga | Sortierung Oldest/Newest first | Tablet | OK | 07_english_newest.png |
| Manga | Übersetzer-Dropdown | Tablet | nicht prüfbar: aus Budgetgründen nicht geöffnet | – |
| Manga | Unread/All-Umschalter | Tablet | nicht prüfbar: nicht getippt (Budget) | – |
| Manga | Quelle-„More“-Blatt | Tablet | OK | 08_more_menu.png |
| Manga | „Reload source“ | Tablet | Fehler: keine sichtbare Rückmeldung (kein Toast/Spinner), Blatt bleibt offen | 09_reload_source.png |
| Manga | „Manual match“ + Suche | Tablet | OK (Treffer, nicht übernommen) | 10_manual_match.png, 11_manual_search.png |
| Manga | Linkes „More“ (AniList/MAL-Links) | Tablet | OK (Links nicht geöffnet) | 12_left_more.png |
| Manga | „About this manga“ aufklappen | Tablet | OK | 13_about.png |
| Manga | „Go to chapter“ (2) | Tablet | OK (scrollt zu Kap. 2, keine Hervorhebung) | 14_goto_ch2.png |
| Manga | Linke Navi: „Home“ hervorgehoben, obwohl Manga-Seite/Suche aktiv | Tablet | Fehler: falscher Aktiv-Zustand nach Enter/Tastatur | 02_manga_search.png, 14_goto_ch2.png |
| Leser | Öffnen Kapitel 1 | Tablet | OK | 15_reader_open.png |
| Leser | Long strip (Standard) | Tablet | OK | 16_swipe_next.png |
| Leser | Einstellungs-Blatt öffnen/schließen | Tablet | OK | 17_reader_settings.png, 24_gray_closed.png |
| Leser | Modus Single page | Tablet | OK | 18_single_page.png |
| Leser | Fit „Original“ | Tablet | Fehler: Seite nach unten versetzt, obere Bildschirmhälfte schwarz | 19_zoom_plus.png, 20_settings_scrolled.png |
| Leser | Zoom + (110 %) / Zoom-Reset | Tablet | OK | 21_zoom_plus.png, 23_zoomreset_gray.png |
| Leser | „Reset page layout for this mode“ | Tablet | Fehler: setzt Fit zurück, Zoom bleibt 110 % | 22_reset_layout.png |
| Leser | Hintergrund Grau | Tablet | OK | 24_gray_closed.png |
| Leser | Blättern Wischen + Tipp rechts (LTR) | Tablet | OK (1 → 3/12) | 25_after_swipe_and_tap.png, 26_page_counter.png |
| Leser | Mitte tippen blendet Leiste ein/aus | Tablet | OK | 25_after_swipe_and_tap.png |
| Leser | Kapitel weiter (>) | Tablet | OK, aber Fehler: springt von offizieller 1r0n-Fassung (12 S.) auf andere Übersetzung („Z=2“) | 27_next_chapter.png |
| Leser | Kapitel zurück (<) | Tablet | Fehler: landet in anderem Kap. 1 (48 S., inoffiziell) statt dem vorher gelesenen | 28_prev_chapter.png |
| Leser | Richtung Right to left + Wischen | Tablet | OK | 29_rtl_set.png, 30_rtl_swipe.png |
| Leser | Schließen (×) → Resume „Chapter 1 · Page 2“ | Tablet | OK | 31_before_close.png, 32_reader_closed.png |
| Leser | Double page / Automatic / Brightness / Toggles | Tablet | nicht prüfbar: Budget | – |
| Manga | Kapitel-Download (Queued → fertig) | Tablet | OK | 33_download_start.png, 35_downloads_manga.png |
| Downloads | Manga-Tab, Detail Dr. STONE | Tablet | OK | 35_downloads_manga.png, 36_dl_drstone.png |
| Downloads | Lösch-Dialog Text „Delete chapter from phone?“ auf Tablet | Tablet | Fehler: „phone“ statt Gerät/Tablet | 37_dl_delete_tap.png |
| Downloads | Kapitel löschen + Toast | Tablet | OK | 38_dl_deleted.png |
| Downloads | Anime-Tab „Storage 0 MB used“ obwohl Manga-Kapitel lag | Tablet | nicht prüfbar: evtl. nur Anime gezählt | 34_downloads_page.png |
| Menü | Menü-Popup (Version, Einträge) | Tablet | OK | 39_menu.png |
| Erweiterungen | Liste vorher (10: 6 Streaming, 1 Torrent, 3 Manga) | Tablet | OK | 40_extensions_before.png, 41_extensions_before_scrolled.png |
| Erweiterungen | Details Mangadex | Tablet | OK | 42_ext_mangadex_detail.png |
| Erweiterungen | Check for updates | Tablet | OK („up to date“) | 43_check_updates.png |
| Erweiterungen | Reload | Tablet | OK („reloaded successfully“) | 44_reload.png |
| Erweiterungen | Toast überdeckt Titel/× im Detail-Blatt | Tablet | Fehler: Toast oben rechts liegt über Blatt-Kopf | 43_check_updates.png, 70_saved.png |
| Erweiterungen | Uninstall-Dialog → Cancel (nicht deinstalliert: Marketplace führt keine Manga-Quellen → nicht über gleiche Quelle rückholbar) | Tablet | OK | 45_uninstall_dialog.png |
| Erweiterungen | Details MangaFire (+ Website-Eintrag) | Tablet | OK | 46_ext_mangafire.png |
| Erweiterungen | Code ansehen (nicht gespeichert), schließen | Tablet | OK | 47_ext_code.png, 48_code_closed.png |
| Erweiterungen | Marketplace-Tab (68, Filter-Chips, Hinweis) | Tablet | OK | 49_marketplace.png |
| Erweiterungen | Alle aktualisieren (oben) | Tablet | OK („All extensions are up to date“) | 50_refresh_all.png |
| Erweiterungen | ⋮-Menü (Setup tour) | Tablet | OK (Tour nicht gestartet) | 51_kebab_menu.png |
| Erweiterungen | Einstellungen je Erweiterung | Tablet | nicht prüfbar: geprüfte Erweiterungen haben keinen Einstellungs-Eintrag; restliche 8 aus Budget nicht geöffnet | – |
| Erweiterungen | Turn off / + Add / Repository ändern | Tablet | nicht prüfbar: Budget | – |
| Erweiterungen | Liste nachher = vorher (10) | Tablet | OK | 52_extensions_after.png |
| Playlists | Playlists-Knopf nur sichtbar mit Listen-Eintrag (Dr. STONE auf Planning gesetzt) | Tablet | OK | 57_plus_progress.png, 59_home_with_entry.png |
| Playlists | Home: trotz Eintrag + 2 lokaler Folgen keine Bibliothek-Sektion, nur „No episodes to continue“ | Tablet | Fehler (vermutlich): Bibliothek fehlt auf Home | 59_home_with_entry.png |
| Playlists | Blatt „No playlists yet“ + Create | Tablet | OK | 60_playlists_sheet.png, 61_create_playlist.png |
| Playlists | Name-Feld: „T2Test“ eingegeben → „TTest“ | Tablet | Fehler (unsicher, evtl. adb-Eingabe): Ziffer verschluckt | 67_review.png |
| Playlists | Sammlung-Dropdown (Current/Paused/Planning/All) | Tablet | OK | 63_collection_dropdown.png, 64_planning.png |
| Playlists | Folgen-Auswahl öffnet ungefragt die Tastatur | Tablet | Fehler: Tastatur ohne Textfeld | 65_pick_episodes.png |
| Playlists | Folgen 1+2 wählen, Review | Tablet | OK | 66_selected.png, 67_review.png |
| Playlists | Quelle je Folge Standard „Online streaming“ trotz lokaler Dateien | Tablet | Fehler (klein): lokale Datei wäre naheliegender | 67_review.png |
| Playlists | Reihenfolge ab/auf | Tablet | OK | 68_reordered.png, 69_reordered_back.png |
| Playlists | Speichern + Toast | Tablet | OK | 70_saved.png |
| Playlists | Abspielen (Anikoto, ~9 s), Pause | Tablet | OK | 71_playing.png, 72_miniplayer.png |
| Playlists | Inline-Player Anime-Seite: Playlist-Knopf überdeckt untere rechte Player-Ecke (Vollbild-Knopf/Leistenende) | Tablet | Fehler (klein) | 72_miniplayer.png |
| Playlists | **Mini-Player: Playlist-Knopf verdeckt × NICHT (Fix bb27fa4f)** | Tablet | OK | 73_miniplayer_home.png |
| Playlists | Mini-Player über × schließen | Tablet | OK | 74_mini_closed.png |
| Playlists | Bearbeiten-Blatt | Tablet | OK | 75_edit_playlist.png |
| Playlists | Löschen-Dialog + Löschen + Toast | Tablet | OK | 76_delete_dialog.png, 77_playlist_deleted.png |
| Konto | API-Prüfung Test-Konto + Aufräumen | Tablet | nicht prüfbar: Budget (100 Aufrufe) erreicht, node-fetch per Hook blockiert | – |

Logcat (`error|exception|[Core] warn/error`, letzte 600 Zeilen) nach Bereich 1: keine Treffer.

#### Fehler

1. **MangaFire Kapitelnummern** (mittel): Manga Dr. STONE → Quelle MangaFire. Titel „Z=1…“ wird zu „Chapter 0“, „Z=2“ → 0.001, „Z=232“ → 0.232. Erwartet: Kapitel 1/2/232. Folge: falsche Sortierung, Resume „Chapter 0“. Vermutlich Kapitelnummer-Parsing aus Titel (Extension MangaFire bzw. Nummern-Normalisierung im Manga-Code).
2. **Kapitel vor/zurück wechselt Übersetzung** (mittel): Kap. 1 (official 1r0n, 12 S.) → „>“ öffnet „Z=2“-Fassung; „<“ öffnet anderes Kap. 1 (48 S.). Erwartet: gleiche Übersetzer-Gruppe bleiben.
3. **Suchfilter werden zwischen Anime/Manga übernommen** (klein): Anime-Suche mit Filtern → Manga-Tab → „No manga match“.
4. **Reload source ohne Rückmeldung** (klein).
5. **Fit „Original“ versetzt Seite nach unten** (klein): Leser → Single page → Original: obere Hälfte schwarz.
6. **„Reset page layout“ lässt Zoom stehen** (klein).
7. **Lösch-Dialog sagt „phone“ auf Tablet** (klein).
8. **Toast überdeckt Blatt-Kopf/×** (klein).
9. **Navi-Aktivzustand „Home“ falsch** nach Tastatur-Enter in Suche/Go to chapter (klein).
10. **Tastatur öffnet sich in Folgen-Auswahl** ohne Textfeld (klein).
11. **Ziffer im Playlist-Namen verschluckt** (unsicher, evtl. adb `input text`).
12. **Playlist-Quelle Standard Online statt Lokal** (klein).
13. **Playlist-Knopf überdeckt Inline-Player-Ecke** auf Anime-Seite (klein); im Mini-Player ist es behoben.
14. **Home zeigt keine Bibliothek** trotz Eintrag + lokaler Dateien (vermutlich, klein–mittel).

#### Offen / Zustand
- **Test-Konto NICHT leer**: Dr. STONE (Anime) steht auf „Planning“ (Fortschritt 0) – in der App über Anime-Seite → Edit → Löschen entfernen. Manga-Lesefortschritt: Resume lokal „Chapter 1 · Page 2“, AniList-Fortschritt 0/236 (vermutlich kein Eintrag). API-Zählung nicht gemacht (Budget).
- Leser-Einstellungen in scratch geändert gelassen: Single page, Right to left, Hintergrund Grau.
- Erweiterungen unverändert (10). Playlist gelöscht. Download-Kapitel gelöscht (Iruma-kun-Download war vorher schon da, unberührt).

## Lauf T3 – Tablet: Menü, Einstellungen, lokale Ordner, Nakama

Belege: `D:/SNB/belege/2026-11-15/apptest/T3/` (nur lokal, nicht im Repo).

Gerät: Pixel Tablet, `com.seanime.app.scratch` (--user 10), AniList-Test-Konto. Belege: `D:\SNB\belege\2026-11-15\apptest\T3\`.
Bedienung: je Schritt Screenshot + UI-Baum (uiautomator) vor dem nächsten Tipp; Schalter-Tests per Skript (Zustand vor / nach 1. Tipp / nach 2. Tipp, je ein Screenshot `_0/_1/_2`).

| Bereich | Element | Gerät | OK/Fehler | Beleg |
|---|---|---|---|---|
| Schritt 0 | Dr. STONE (Planning, 0/24) aus Liste löschen: Listen-Editor → Papierkorb → Confirm | Tablet | OK – danach „Add to list“ statt „Edit“ (Planer prüft per API) | 04_editor.png, 07_remove_confirm.png, 08_removed.png |
| Schritt 0 | Listen-Editor öffnen | Tablet | Fehler: beim ersten Tipp auf den Papierkorb erschien die Bildschirmtastatur statt der Bestätigung (Fokus auf Feld?), erst 2. Tipp zeigte „Confirm“ | 05_remove_dialog.png, 06_kbd_hidden.png |
| Menü | Menü-Blatt öffnen (Seitenleiste „Menu“) | Tablet | OK | 10_menu.png |
| Menü | „App 4.0.0 · up to date“ + Update-Knopf | Tablet | OK | 11_checkupdate.png |
| Menü | Schedule | Tablet | OK (0 Folgen, Woche/Monat, Pfeile) | 12_schedule.png |
| Menü | Manga | Tablet | OK (leer, „Browse manga“) | 13_manga.png |
| Menü | Extensions | Tablet | OK (10 installiert, Installed/Marketplace) | 14_extensions.png |
| Menü | Settings | Tablet | OK | 20_settings.png |
| Menü | Refresh AniList | Tablet | OK (kein Fehler, keine sichtbare Rückmeldung) | 15_refresh_anilist.png |
| Menü | Profil-Bereich | Tablet | nicht prüfbar: im Menü gibt es keinen Profil-Bereich | 10_menu.png |
| Kopfleiste | Benachrichtigungen (Glocke) | Tablet | nicht prüfbar: keine Benachrichtigungs-Glocke in Kopf-/Seitenleiste vorhanden | 01_now.png |
| Kopfleiste | Logo oben links | Tablet | Hinweis: zeigt „S“ (Seanime-Logo), Bedienhilfe-Name „Yomimi“ | 10_menu.png |
| Einstellungen | Kopfzeile „Seanime 3.10.4 · App 4.0.0“ | Tablet | Fehler (klein): zeigt alte Seanime-Server-Version, obwohl Kern ersetzt; Name Yomimi fehlt | 20_settings.png |
| Einstellungen/App | Update progress automatically | Tablet | OK (an→aus→an) | 31_autoprog_*.png |
| Einstellungen/App | Watch history | Tablet | OK | 32_history_*.png |
| Einstellungen/App | Default episode source (Auswahl) | Tablet | nicht geöffnet (Budget) | 30_app.png |
| Einstellungen/App | Notify about new episodes | Tablet | Fehler (klein): 1. Tipp öffnet System-Abfrage „Seanime Scratch erlauben, Benachrichtigungen zu senden?“, Schalter bleibt an; mein 2. Tipp schloss sie, Schalter ging aus. Wiederhergestellt mit „Erlauben“ → an | 33_notify_*.png, 38_notify_restore.png, 39_notify_allowed.png |
| Einstellungen/App | Send a test notification | Tablet | OK (Benachrichtigung im System vorhanden, Kanal new_episodes) | 40_testnotif.png |
| Einstellungen/App | Download only on Wi-Fi | Tablet | OK | 41_wifi_*.png |
| Einstellungen/App | Hide spoilers | Tablet | OK | 42_spoiler_*.png |
| Einstellungen/App | Hide audience score | Tablet | OK | 36_audscore_*.png |
| Einstellungen/App | Adult content | Tablet | OK (aus→an→aus) | 36_audscore_*.png (Layout verschoben, Tipp traf Adult content) |
| Einstellungen/App | Sprache English → Deutsch → English | Tablet | OK, Übersetzung vollständig sichtbar | 47_lang_de.png, 48_lang_en.png |
| Einstellungen/App | Sounds | Tablet | OK; Text nennt „Watch Party“ (Hinweis, falls Watch Party entfernt sein soll) | 44_sounds_*.png |
| Einstellungen/App | Secure mode | Tablet | OK | 45_secure_*.png |
| Einstellungen/App | Show the setup tutorial | Tablet | OK („Welcome to Yomimi“, Skip schließt) | 51_tutorial.png, 52_tutorial_skip.png |
| Einstellungen/App | Back up AniList lists | Tablet | OK | 46_backup_*.png |
| Einstellungen/App | Upload local lists to AniList (Dialog) | Tablet | OK – Dialog, Cancel | 49_upload_lists.png, 50_upload_cancel.png |
| Einstellungen/App | Turn off AniList caching | Tablet | OK (Zeile „Cache-only mode“ blendet sich aus/ein → Layout springt) | 58_signout_cancel.png, 59_cache_restore.png |
| Einstellungen/App | Cache-only mode | Tablet | Fehler (mittel): Tipp → Toast „The setting could not be saved. Try again.“, Schalter bleibt aus | 60_cacheonly_1.png |
| Einstellungen/App | Fallback episode metadata | Tablet | OK | 56_fallbackmeta_*.png |
| Einstellungen/App | Customize navigation (Blatt) | Tablet | OK (6/7 in Leiste, Menu fest), ohne Änderung geschlossen | 61_customize_nav.png, 62_nav_close.png |
| Einstellungen/App | Reset navigation (Dialog) | Tablet | OK – Cancel; Text spricht von „bottom nav … floating menu“ (am Tablet Seitenleiste) – klein | 63_reset_nav.png |
| Einstellungen/App | Sign out (Dialog) | Tablet | OK – nur Cancel | 57_signout_dialog.png, 58_signout_cancel.png |
| Einstellungen/Appearance | Unwatched episodes on anime cards | Tablet | OK | 71_unwatched_*.png |
| Einstellungen/Appearance | Unread chapters on manga cards | Tablet | OK | 72_unread_*.png |
| Einstellungen/Appearance | Sortierung Continue watching (Liste) | Tablet | OK, gleiche Auswahl „Aired recently“ gewählt | 73_sort_list.png, 74_sort_same.png |
| Einstellungen/Appearance | Untertitel „Banner, sorting, …“ | Tablet | Fehler (klein): Seite hat keine Banner-Einstellung | 75_appearance_scroll.png |
| Einstellungen/Appearance | Anime/Manga library-Sortierung, Load anime pages ahead | Tablet | nicht geöffnet (Budget) | 75_appearance_scroll.png |
| Einstellungen/Playback | Built-in ↔ External player | Tablet | OK, zurück auf Built-in | 85_external.png, 86_builtin.png |
| Einstellungen/Playback | Play the next episode automatically | Tablet | OK | 82_autonext_*.png |
| Einstellungen/Playback | Encode the file path | Tablet | OK | 83_encode_*.png |
| Einstellungen/Playback | Externer Player-Chip VLC | Tablet | Fehler (klein): Chip lässt sich nicht wieder abwählen; vorher keiner gewählt, jetzt VLC gewählt (nicht wiederherstellbar) | 84_vlc_*.png |
| Einstellungen/Playback | Player link | Tablet | nicht geöffnet (Texteingabe) | 81_playback_scroll.png |
| Lokale Ordner | Seite Local library (Library folder „Not set“) | Tablet | OK | 90_locallib.png |
| Lokale Ordner | Refresh automatically / when app starts / Legacy matching | Tablet | OK | 91_*, 92_*, 93_*.png |
| Lokale Ordner | Library folder → Blatt (Pfad-Vorschlag, Choose folder, Cancel/Apply) | Tablet | OK | 94_folderpicker.png |
| Lokale Ordner | Choose folder | Tablet | OK: führt ohne Berechtigung zu Android „Zugriff auf alle Dateien“ (nicht erteilt, zurück) | 95_choosefolder.png (Statusleiste geschwärzt), 96b_after_back.png |
| Lokale Ordner | Cancel im Ordner-Blatt | Tablet | OK, Ordner weiter „Not set“ | 97_folder_cancel.png |
| Lokale Ordner | Scanner rules (Blatt) | Tablet | OK – Cancel | 99_scanner_rules.png |
| Lokale Ordner | Export library data (ohne Ordner) | Tablet | Fehler (klein): Toast „The library data could not be exported.“ – kein Hinweis, dass kein Ordner/keine Daten da sind | 101_export.png |
| Lokale Ordner | Scan-Knopf ohne Ordner | Tablet | nicht prüfbar: in den Einstellungen gibt es keinen Scan-Knopf; Torrents-Seite zeigt „No library folder is set yet“ + „Open Local library“ | 130_torrents.png |
| Lokale Ordner | Add another folder (bei leerem 1. Ordner sichtbar) | Tablet | nicht geöffnet; Hinweis klein | 90_locallib.png |
| Einstellungen/Online streaming | Online streaming / Streaming titles in lists | Tablet | OK | 121_*, 122_*.png |
| Einstellungen/Torrents | Torrent streaming | Tablet | OK | 131_torrentstream_*.png |
| Einstellungen/Torrents | Debrid service | Tablet | OK | 133_debrid_*.png |
| Einstellungen/Torrents | Default provider, Auto-select profile, Limits | Tablet | nicht geöffnet (Budget) | 130_torrents.png, 132_torrents_scroll.png |
| Einstellungen/Manga | Manga an/aus, Update progress automatically | Tablet | OK | 112_*, 113_*.png |
| Einstellungen/Manga | Default source (Liste: Automatic/Local/Mangadex/MangaFire) | Tablet | OK, Automatic bleibt | 114_manga_source.png, 115_source_same.png |
| Einstellungen/Manga | Leser-Einstellungen (Single page / RTL / Grau) | Tablet | nicht prüfbar: nicht in den Einstellungen, nur im Leser; nicht zurückgestellt | 111_manga_scroll.png |
| Einstellungen/Logs & cache | Server log (Copy/Save), Log files All/Server/Scanner | Tablet | angesehen; „No log files“; Überschrift „Server log“ (Hinweis: Server-Begriff) | 140_logs.png |
| Einstellungen/Logs & cache | Clear manga cache / online streaming cache | Tablet | OK – nur Dialog + Cancel | 142_clear_manga.png, 144_clear_online.png |
| Einstellungen/Logs & cache | Cache Size | Tablet | Hinweis: zeigt „–“ | 141_logs_scroll.png |
| Einstellungen/Logs & cache | Developer → Refresh memory statistics | Tablet | Fehler (klein, unsicher): keine sichtbare Rückmeldung/Werte | 146_developer.png, 147_memstats.png |
| Nakama | Seite (Schalter aus, Name Random, Host address/passcode Not set, Use host's library aus) | Tablet | angesehen, nichts geändert; Texte vollständig | 21_nakama_scroll.png |
| Über | Version App 4.0.0, Seanime 3.10.4 Saisei | Tablet | Hinweis: kein „Yomimi“-Name, keine Lizenzen-/Credits-Seite; Seanime-Credit nur als „Donate to the Seanime developer“ | 150_about.png |
| Über | Look for new versions | Tablet | OK | 151_lookupdates_*.png |
| Über | Check for updates now | Tablet | OK (keine Fehlermeldung, keine sichtbare Rückmeldung) | 152_checknow.png |
| Allgemein | Logcat (Fehler/Exceptions der App) | Tablet | OK – keine App-Fehler gefunden | – |

Zählung: OK 47 · Fehler 8 · nicht prüfbar/nicht geöffnet 11 (Hinweise ohne Fehler in Spalte enthalten).

#### Fehler

1. **Cache-only mode lässt sich nicht schalten** (mittel). Einstellungen → App → Metadata → „Cache-only mode“ antippen. Erwartet: Schalter an. Tatsächlich: Toast „The setting could not be saved. Try again.“, bleibt aus. Datei: `native/src/main/settings/_screens/settings-app.tsx` (~Z. 202–227, Schalter über Server-Toggle-Endpoint).
2. **Export library data ohne Ordner** (klein). Local library → Export library data. Erwartet: Datei oder klarer Hinweis „kein Ordner/keine Daten“. Tatsächlich: „The library data could not be exported.“ Datei: `native/src/main/settings/_screens/settings-library.tsx`.
3. **Kopfzeile Einstellungen zeigt „Seanime 3.10.4“**, Über zeigt „Seanime 3.10.4 Saisei“ (klein) – alte Server-Version trotz eigenem Kern; Name Yomimi fehlt. Kein Lizenzen/Credits-Bereich.
4. **Benachrichtigungs-Schalter** (klein): Schalter steht an, obwohl Android-Berechtigung fehlte; erst beim Umschalten fragt Android. Nach Ablehnen/Wegtippen springt Schalter auf aus. Erwartet: Zustand spiegelt Berechtigung.
5. **VLC-Chip nicht abwählbar** (klein): Playback → External player → Chip gewählt bleibt gewählt; kein „keiner“-Zustand mehr.
6. **Appearance-Untertitel „Banner“** (klein): kein Banner-Eintrag auf der Seite.
7. **Reset navigation-Text** (klein): „bottom nav … floating menu“ passt nicht zur Tablet-Seitenleiste.
8. **Listen-Editor: Tastatur ging auf** (klein, unsicher): erster Tipp auf Papierkorb kurz nach Öffnen öffnete die Tastatur statt „Confirm“.
9. (unsicher) Developer „Refresh memory statistics“ ohne sichtbares Ergebnis.

Hinweise (keine Fehler): „Sounds“-Text nennt „Watch Party“; „Server log“-Überschrift; Logo „S“; Android-Name der App „Seanime Scratch“ (Build-Variante).

#### Zustandsänderungen gegenüber vorher
- Dr. STONE aus Test-Konto gelöscht (Auftrag).
- Android-Benachrichtigungsrecht für scratch erteilt („Erlauben“), damit der Schalter wieder auf „an“ steht wie vorher.
- Playback → externer Player: VLC jetzt gewählt (vorher keiner; nicht abwählbar).
- Alle anderen Schalter/Sprache/Listen wie vorher.

#### Nicht geschafft (Budget)
Kopfleiste Playlists/Customize, Default episode source, Library-/Load-ahead-Listen, Player link, Torrent-Provider/Auto-select/Limits, Copy/Save log, Heap/GC, Nakama-Name-Blatt, Downloads-Eintrag der Seitenleiste.

## Lauf S1 – S22: Anime-Seite, Player, Downloads, Cast-Panel

Belege: `D:/SNB/belege/2026-11-15/apptest/S1/` (nur lokal, nicht im Repo).

AniList Dr. STONE Fortschritt: **vorher 24/24 Completed** (`01_anime_top.png`) – **nachher 24/24 Completed** (`46_final_progress.png`) → unverändert. Nichts an AniList gespeichert.

| Bereich | Element | Gerät | OK/Fehler | Beleg |
|---|---|---|---|---|
| Anime-Seite | Kopf (Cover, Titel, Jahr/Status, Fortschritt 24/24) | S22 | OK | 01_anime_top.png |
| Anime-Seite | Listen-Editor öffnen (Status-Chips, Fortschritt, Wertung, Daten, Rewatches) | S22 | OK (nur angesehen, × geschlossen) | 02_listeditor.png |
| Anime-Seite | Listen-Editor Papierkorb → „Bestätigen“ | S22 | nicht prüfbar: Tipp vom Sicherheitsfilter abgelehnt (laut Code nur 2-Stufen-Bestätigung) | 03_listeditor_trash_confirm.png (Editor ohne Tipp) |
| Anime-Seite | „Episodes & playback“ (scrollt zur Folgenliste) | S22 | OK | 12_episodes_playback_btn.png |
| Anime-Seite | „About this anime“ auf/zu | S22 | OK | 04_about.png |
| Anime-Seite | ⋮ „More“-Blatt | S22 | OK | 05_more_menu.png |
| Anime-Seite | Link AniList (Custom Tab, Dr. STONE · AniList) | S22 | OK | 06_link_anilist.png |
| Anime-Seite | Link AniDB (Custom Tab anidb.net) | S22 | OK | 07_link_anidb.png |
| Anime-Seite | Link MyAnimeList (Custom Tab MAL Dr. Stone) | S22 | OK | 08_link_mal.png |
| Anime-Seite | „Filler and specials“-Blatt | S22 | Fehler: Blatt leer (nur Titel + ×) | 09_filler_specials.png, 09b_filler_specials_after4s.png |
| Anime-Seite | „Download a torrent“-Blatt (Provider, Filter, Sprachen, Ergebnisliste) | S22 | OK (nichts geladen); Kleinkram s. Fehler 5 | 10_download_torrent_sheet.png, 11_download_torrent_results.png |
| Anime-Seite | Schalter Tabs (Torrent/Debrid/Online streaming) im More-Blatt | S22 | nicht geprüft: Gerätesetting von Nick, Debrid nur angesehen („Off in the settings“) | 05_more_menu.png |
| Anime-Seite | Teilen-Knopf | S22 | nicht vorhanden (kein Share auf der Seite gefunden, nur externe Links) | 05_more_menu.png |
| Anime-Seite | Reiter Online | S22 | OK | 01_anime_top.png |
| Anime-Seite | Reiter Torrent (Auto-Pick-Schalter, Karussell, Liste) | S22 | OK | 20_torrent_tab.png, 22_torrent_episodes.png |
| Anime-Seite | Auto-Pick aus → Folge 1 → „Stream a torrent“-Liste (nicht abgespielt), Schalter wieder an | S22 | OK | 21_torrent_autopick_off.png, 23_torrent_list_ep1.png |
| Anime-Seite | Folgen-Info (i) Blatt | S22 | OK (Lücke unter Trennlinie, kosmetisch) | 24_episode_info.png |
| Anime-Seite | Reiter Library („Not in your library“, Folgenliste) | S22 | OK (große Leerfläche unter Überschrift) | 25_library_tab.png |
| Anime-Seite | Provider-Menü (Anikoto/KickAssAnime/Find other providers) | S22 | OK | 13_provider_menu.png |
| Anime-Seite | Server-Menü (VidStreaming) | S22 | OK | 15_server_menu.png |
| Anime-Seite | Download-Blatt (Online, Season/From ep./This episode, Liste) | S22 | OK, nichts geladen; Chips „Season“ + „From ep. 1“ gleichzeitig aktiv | 16_download_sheet.png |
| Anime-Seite | Manual match-Blatt | S22 | OK | 17_manual_match.png |
| Anime-Seite | Cache-Dialog → Cancel | S22 | OK | 18_cache.png |
| Anime-Seite | Grid-Ansicht an/aus | S22 | OK | 19_grid_view.png |
| Anime-Seite | Vorige/Nächste Folge (Pfeile über Vorschau) | S22 | Fehler: Wechsel startet sofort Wiedergabe (Auto play an) – s. Fehler 2 | 13_provider_menu.png, 14_inline_after_pause.png |
| Anime-Seite | Sub/Dub-Umschalter | S22 | nicht geprüft (Budget; würde Quelle neu laden) | – |
| Anime-Seite | Zurück | S22 | OK (Custom Tabs → App; Player → Mini) | 37_back_from_player.png |
| Player | Inline-Player in Anime-Seite (Overlay: ⏭, Einstellungen, Untertitel, Audio, Cast/PiP, Vollbild) | S22 | OK | 14_inline_after_pause.png |
| Player | Vollbild/Querformat (Drehen) | S22 | OK | 26_player_open.png |
| Player | Play/Pause | S22 | OK | 31_play_controls.mp4, 31b_after_pause.png |
| Player | +10 s / −5 s | S22 | OK (0:33→0:43, →0:39) | 31_play_controls.mp4 |
| Player | Zeitleiste ziehen (pausiert) | S22 | OK (0:45→2:46, Bild aktualisiert) | 33_seek_drag.png |
| Player | Einstellungen-Blatt (Speed, Picture, Auto play, Auto next, Skip OP/ED, Volume boost, Sprachen, Delay, Caption style, Appearance, Advanced) | S22 | OK | 27_player_settings.png |
| Player | Geschwindigkeit (Slider, 0.5–2.0) + Zurück ins Hauptmenü | S22 | OK | 28_player_speed.png, 28b_after_back.png |
| Player | Untertitel-Blatt (Off/English/French/German/Italian, Pinsel) | S22 | OK | 29_subtitles_sheet.png |
| Player | Tonspur-Blatt (Japanese/English) | S22 | OK | 30_audio_sheet.png |
| Player | Lautstärke-Regler | S22 | OK | 34_volume.png |
| Player | Qualität | S22 | nicht vorhanden im Online-Player | 27_player_settings.png |
| Player | Sperren (Lock) | S22 | nicht vorhanden (kein Knopf gefunden) | 32_controls_shown.png |
| Player | Bild-in-Bild-Knopf | S22 | OK (nur angesehen) | 32_controls_shown.png |
| Player | Skip Opening-Knopf | S22 | OK (sichtbar, nicht getippt) | 32_controls_shown.png |
| Player | Exit fullscreen | S22 | nicht sauber prüfbar: Folge-Zurück aus Lautstärke-Popup landete auf Suchseite mit Mini-Player – s. Fehler 4 | 35_exit_fullscreen.png |
| Player | Minimieren (Zurück / Reiterwechsel) → Mini-Player | S22 | OK | 37_back_from_player.png, 20_torrent_tab.png |
| Player | Mini-Player antippen → Vollbild | S22 | OK | 36_mini_tap_opens.png |
| Player | Mini-Player × schließt | S22 | OK | 39_after_mini_close.png |
| Player | Nächste/Vorige-Folge-Knöpfe im Vollbild | S22 | nicht vorhanden im Vollbild-Overlay (nur ⏭ im Inline-Overlay, nicht getippt) | 14_inline_after_pause.png |
| Player | Animation Steuerleiste ausblenden | S22 | bestätigt: Ausblenden ~120 ms, Einblenden ~80 ms (Helligkeitsmessung Icon-Bereich) | 31_play_controls.mp4 |
| Player | Animation Mini-Player erscheint/verschwindet | S22 | bestätigt: kein Gleiten, Sprung in 1 Frame (Erscheinen 4.57→4.72 s, Verschwinden 6.18→6.31 s) | 38_mini_open_min_close.mp4 |
| Downloads | Reiter Anime (leer, „Search anime“, Wi-Fi-only, Speicher) | S22 | OK (0 Anime) | 40_downloads.png |
| Downloads | Reiter Manga (leer) | S22 | OK | 41_downloads_manga.png |
| Downloads | Reiter Torrents (leer) | S22 | OK; Hinweistext führt falsch (s. Fehler 6) | 42_downloads_torrents.png |
| Downloads | Warteschlange / Einträge / Löschen-Dialog | S22 | nicht prüfbar: keine Einträge vorhanden | 40_downloads.png |
| Downloads | Dr. STONE 1–4 (Dateien in Android/data/…/SeanimeNativeTest) | S22 | Fehler (bekannt): nicht in Downloads/Bibliothek; Library folder „Not set“ | 40_downloads.png, 25_library_tab.png |
| Einstellungen | Local library (Library folder Not set, Add folder, Auto-Scan aus, Scan bei Start aus, Legacy, Scanner rules) | S22 | OK; Scan-Knopf erst nach gesetztem Ordner – Ordner NICHT gesetzt (Cancel), da Konfig-Änderung an Nicks App | 44_local_library.png, 45_library_folder_tap.png |
| Cast | Cast-Panel Hoch/Quer, Geräteliste, „Stop casting“, „No TV found“ | S22 | nicht prüfbar: Cast-Knopf erscheint nur bei lokaler Datei/Torrent-Stream (`player-cast.ts:36`, online → null); lokale Dateien nicht in Bibliothek, Torrent-Wiedergabe nicht in diesem Lauf | 26_player_open.png |
| Allgemein | Logcat (Fehler/Exceptions) | S22 | OK – keine Treffer am Ende | – |

#### Fehler

1. **„Filler and specials“-Blatt leer** (klein–mittel). Dr. STONE → ⋮ → „Filler and specials“. Erwartet: Filler-Markierung (Beschreibung sagt „Mark filler episodes…“). Tatsächlich: nur Titel + ×. Ursache offensichtlich: `MetadataSheet` zeigt Inhalt nur bei `!entry.anidbId`, Filler-Teil fehlt ganz → `native/src/main/entry/_containers/entry-actions/anime-entry-phone-menu.tsx:156–185`.
2. **Vorige/Nächste-Folge-Pfeile starten sofort Wiedergabe** (mittel). Online-Reiter → „>“ dann „<“ über der Vorschau → Video lief los (wegen Einstellung „Auto play“ an). Erwartet: nur Folge auswählen. Folge: unbeabsichtigte Wiedergabe ~30 s (bis 0:31), danach Pause.
3. **Download-Blatt: „Season“ und „From ep. 1“ gleichzeitig hervorgehoben** (klein) – Segment-Auswahl wirkt doppelt aktiv. `16_download_sheet.png`.
4. **Zurück im Vollbild-Player mit offenem Lautstärke-Regler** (klein, nicht reproduziert): Zurück + Tipp → Suchseite mit Mini-Player, Anime-Seite übersprungen. Normales Zurück ohne Popup minimiert korrekt (37).
5. **Torrent-Ergebnisse**: Einzelfolgen (~150 MiB „Sub 2“) als „Batch“ markiert; „1 seeders“ statt „1 seeder“ (klein). `11_download_torrent_results.png`.
6. **Downloads → Torrents Hinweistext** „choose Download → a torrent“ – der Download-Knopf öffnet aber das Online-Download-Blatt; der Weg ist ⋮ → „Download a torrent“ (klein).
7. **Lokale Dr.-STONE-Dateien unsichtbar** (bekannt, groß für Offline): Library folder ist „Not set“; Scanner kann ohne Ordner nicht laufen. Ein Scan-Weg existiert erst nach Setzen des Ordners (Settings → Local library → Library folder, Vorschlag `/storage/emulated/0/Anime`); `Android/data/…` müsste als Ordner gewählt werden (Zugriff fraglich). Nicht gesetzt, da Konfig-Änderung – Entscheidung Nick.
8. **Animationen** (klein, bestätigt): Mini-Player ohne Gleiten; Steuerleiste blendet in ~120 ms aus.

#### Nicht geschafft / Hinweise
- Cast-Panel (Bereich 4) nicht prüfbar (siehe Tabelle). Sub/Dub, Listen-Editor-Löschbestätigung nicht geprüft.
- Wiedergaben: 2 (1× unbeabsichtigt ~30 s durch Auto play – über 15 s, 1× ~10 s). Kein Ende erreicht, max. Position 2:46 (gespult, pausiert).
- Fremdwirkung: Das gemeinsame `scratchpad\s.sh` wurde vom Tablet-Agent überschrieben; ein Aufruf lief versehentlich mit dessen Skript → 2 Tablet-Screenshots `T2\tap.png`, `T2\shot.png` angelegt, `input 700 400` scheiterte (keine Eingabe am Tablet). Danach eigenes Skript `scratchpad\S1run\h.sh`.

## Lauf S2 – S22: Torrent, Datei-Wahl, Torrent-Client, Debrid

Belege: `D:/SNB/belege/2026-11-15/apptest/S2/` (nur lokal, nicht im Repo).

Dr. STONE Fortschritt: vorher 24/24 Completed (`00_start.png`), nachher 24/24 Completed (`63_end_progress.png` + UI-Dump). Unverändert.
Wiedergaben: 2 (Ep 1 per Batch-Torrent, Ep 5 per Auto-Auswahl), je ≤ 10 s, pausiert per MEDIA_PAUSE, geschlossen über × des Mini-Players. Nichts gesendet (TV aus). Debrid-Schalter danach wieder AUS, Anbieter None.
Belege: `D:\SNB\belege\2026-11-15\apptest\S2\` (`*.png` volle Auflösung, `small_*.jpg` halbe, `cmp_*.jpg` Vergleiche).

| Bereich | Element | Gerät | OK/Fehler | Beleg |
|---|---|---|---|---|
| 1 Torrent | Tab „Torrent“ auf Anime-Seite | S22 | OK | 01_torrent_tab.png |
| 1 Torrent | Schalter „Pick the best torrent“ (aus/an, Text wechselt) | S22 | OK | 03_auto_off.png |
| 1 Torrent | Seiten-Schalter „Pick the best torrent“ bleibt gespeichert | S22 | Fehler: nach Verlassen der Seite wieder AN (Ep 5 startete ungewollt sofort) | 56_torrent_tab2.png, 60_ep5_portrait.png |
| 1 Torrent | Folgen-Liste (Watched-Markierung, ⓘ, Karussell) | S22 | OK | 02_torrent_scrolled.png |
| 1 Torrent | Blatt „Stream a torrent“ öffnet (Episode 1) | S22 | OK | 04_torrent_list.png |
| 1 Torrent | Anbieter-Chips Internet Archive / DKB, „Add“ | S22 | OK (angezeigt; Add nicht getippt) | 04_torrent_list.png |
| 1 Torrent | Suchmodus Episode/Title, Auflösung, Whole season, Dual Audio, With seeders, 10-Bit, Sprache | S22 | OK (angezeigt, Standardwerte) | 04_torrent_list.png |
| 1 Torrent | Blatt scrollen | S22 | Fehler (klein): erste 3 Wischer (400–1500 ms) scrollen nicht, erst schnelle Wischer | cmp_05_06.jpg, 08_after_swipes.png |
| 1 Torrent | Trefferliste „Results · 24“ | S22 | OK | 08_after_swipes.png |
| 1 Torrent | Treffer von DKB | S22 | Fehler (klein): alle 24 Treffer nur Internet Archive, DKB liefert nichts, kein Hinweis | 17_list_bottom.png |
| 1 Torrent | Treffer-Infos (Anbieter · Typ · Größe · Seeder · Alter) | S22 | Fehler (klein): Einzelfolgen ~150 MiB („Sub 2“) als „Batch“ markiert; „1 seeders“ Grammatik; bei Suche „Episode 1“ erscheinen Sub 2/3/5… | 08_after_swipes.png |
| 1 Torrent | Sortierung Recommended / Most seeders / Newest / Smallest | S22 | OK | cmp_sort.jpg |
| 1 Torrent | Treffer-Suchfeld + × leeren („2 of 24“) | S22 | OK | 12_search_latino.png, 13_search_cleared.png |
| 1 Torrent | More filters Show/Hide | S22 | OK | 14_more_filters.png |
| 1 Torrent | Filter Codec HEVC, Größe ≤ 500 MB (18 of 24), Any size | S22 | OK | 15_filter_500mb.png, 16_filter_hevc.png |
| 1 Torrent | Leerzustand „No torrents match the filters“ + Clear filters | S22 | OK (Knopf sichtbar, nicht getippt) | 16_filter_hevc.png |
| 1 Torrent | Treffer antippen → Wiedergabe startet (Batch S1 → Ep 1) | S22 | OK, Start ≈ 3–5 s | 18_batch_tap.png, 19_playing.png |
| 1 Torrent | Auto-Auswahl Ep 5 → Wiedergabe | S22 | OK, Start ≈ 5–7 s | cmp_57_58.jpg, 59_ep5_paused.png |
| 1 Torrent | Pause per MEDIA_PAUSE | S22 | OK | 20_paused.png, 59_ep5_paused.png |
| 1 Torrent | Ep 1 startet bei 2:53 (gespeicherte Position) | S22 | OK (vermutlich Resume) | 20_paused.png |
| 1 Cast | Cast-Panel Querformat: „No TV found“ + Hinweistext + „Search again“ | S22 | OK | 21_cast_landscape.png |
| 1 Cast | „Search again“ → „Looking for TVs…“ → No TV found | S22 | Fehler (klein): Panel springt in der Höhe (schrumpft beim Suchen, wächst danach) | cmp_22_23.jpg |
| 1 Cast | „Stop casting“ | S22 | nicht prüfbar: keine Cast-Sitzung (TV aus) | 21_cast_landscape.png |
| 1 Cast | Panel × schließen | S22 | OK | 24_cast_closed.png |
| 1 Cast | Vollbild verlassen → Hochformat-Player | S22 | OK | 25_portrait_player.png |
| 1 Cast | Cast-Panel Hochformat (Blatt unten, Texte vollständig) | S22 | OK | 26_cast_portrait.png |
| 1 Cast | Zurück-Taste schließt Cast-Blatt | S22 | OK | 27_cast_back.png |
| 1 Player | Mini-Player beim Tab-Wechsel | S22 | OK | 28_downloads_mini.png |
| 1 Player | Mini-Player × schließt Wiedergabe | S22 | OK | 37_mini_closed.png, 62_end_anime.png |
| 1 Player | Mini-Player verdeckt letzten Eintrag von Seiten | S22 | Fehler (klein): Settings „Torrents & debrid“ ganz unten → „Debrid service“-Schalter halb unter Mini-Player, Seite scrollt nicht weiter | cmp_35_36.jpg |
| 1 Nav | Zurück vom Settings zur Anime-Seite | S22 | Fehler (klein): Seite kommt mit Tab „Online“ statt zuvor gewähltem „Torrent“ zurück | 47_back3.png |
| 1 Nav | Menü-Overlay: „Menu“ und „Downloads“ gleichzeitig hervorgehoben | S22 | Fehler (klein, optisch) | 30_menu.png |
| 2 Datei-Wahl | Batch im Stream-Blatt („Dr Stone S1“, 9.8 GiB) | S22 | Fehler/Hinweis: kein Datei-Auswahl-Blatt, App wählt Ep 1 selbst und spielt sofort | 18_batch_tap.png |
| 2 Datei-Wahl | ⋮ → Download a torrent: Batch anhaken → Continue → „Download“-Blatt | S22 | Fehler/Hinweis: keine Dateiliste für Batch (9.8 GiB ganz), keine Folgen-Auswahl | 52_dl_select_s1.png, 53_continue.png |
| 2 Datei-Wahl | „Download a torrent“: Missing episodes 1–24, Checkbox-Liste, Continue | S22 | OK | 50_dl_torrent.png, 51_dl_results.png, 52_dl_select_s1.png |
| 2 Datei-Wahl | „Start download“ ohne Bibliotheksordner deaktiviert, Hinweis + „Choose a folder“ | S22 | OK | 53_continue.png |
| 2 Datei-Wahl | Back / × | S22 | OK | cmp_54_55.jpg |
| 3 Client | Downloads → Torrents: „No torrents“ | S22 | OK | 29_dl_torrents_tab.png |
| 3 Client | Hinweistext „Open an anime and choose Download → a torrent“ | S22 | Fehler (klein, bestätigt): richtiger Weg ist ⋮ → „Download a torrent“; „Download“-Knopf der Seite ist Online-Download | 29_dl_torrents_tab.png, 49_kebab.png |
| 3 Client | Laufender Stream-Torrent in Torrents-Liste / Pause / Fortsetzen / Neustart / Entfernen | S22 | nicht prüfbar: Stream-Torrents erscheinen dort nicht, kein Download-Torrent vorhanden (kein Bibliotheksordner, Start download gesperrt) | 29_dl_torrents_tab.png |
| 3 Client | Menü (⋮ unten): kein eigener „Torrents“-Eintrag | S22 | OK (Info) | 30_menu.png |
| 3 Client | ⋮ „More“: AniList/AniDB/MAL, Filler, Download a torrent, Tabs-Schalter | S22 | OK (angezeigt; externe Links nicht getippt) | 49_kebab.png |
| 3 Client | Settings öffnet direkt Unterseite „Local library“ (letzte Unterseite) | S22 | OK (Info), ← führt zu Settings | 31_settings.png, 32_settings_root.png |
| 3 Client | Torrents & debrid: Default provider, Torrent streaming, Auto-select, Preferred resolution, Auto-select profile, Download-/Upload-Limit, Gleichzeitig 3, „Open Local library“ | S22 | OK (angezeigt, nicht verändert) | cmp_33_34.jpg, cmp_35_36.jpg |
| 4 Debrid | Schalter „Debrid service“ an → Provider/Auto-select/Streaming titles | S22 | OK | cmp_38_39.jpg |
| 4 Debrid | Debrid an mit Provider „None“ ohne Warnung | S22 | Fehler (klein): kein Hinweis, dass Anbieter/Schlüssel fehlt | cmp_38_39.jpg |
| 4 Debrid | Provider-Dropdown (None/TorBox/Real-Debrid/AllDebrid/Premiumize) | S22 | OK (Liste ragt über die Tab-Leiste, lesbar) | 40_debrid_provider_dd.png |
| 4 Debrid | TorBox: API-key-Feld, Hinweis, „Save key“ leer = deaktiviert, Tippen ohne Wirkung | S22 | OK | 41_debrid_torbox.png, cmp_42_43.jpg |
| 4 Debrid | Zurück auf None + Schalter aus | S22 | OK | 44_provider_none.png, 45_debrid_off.png |
| 4 Debrid | ⋮ → Tabs „Debrid streaming: Off in the settings. Tap to turn it on.“ | S22 | OK | 49_kebab.png |
| Log | logcat (3000 Zeilen) nach error/exception | S22 | OK: keine App-Fehler | logcat_tail.txt |

Zählung: OK 37 · Fehler 12 · nicht prüfbar 2.

#### Fehler

1. **Seiten-Schalter „Pick the best torrent“ nicht gespeichert** (klein–groß, überrascht Nutzer): Torrent-Tab → Schalter aus → Folge antippen (Liste kommt) → Seite verlassen (Settings, Zurück) → Torrent-Tab: Schalter wieder AN, Antippen einer Folge startet sofort Wiedergabe. Erwartet: Wahl bleibt (oder ist an Settings „Auto-select the best torrent“ gekoppelt – dort stand die ganze Zeit AN, also widersprüchlich). Datei: `native/src/main/entry/_containers/torrent-stream/_components/stream-controls-phone.tsx:26`.
2. **Stream-Blatt scrollt erst bei schnellem Wischen** (klein): Blatt „Stream a torrent“ öffnen, langsam wischen (400–1500 ms) → bleibt stehen; schneller Wisch (300 ms) scrollt. Evtl. Geste vom Blatt-Ziehen verschluckt.
3. **DKB liefert keine Treffer, kein Hinweis** (klein): Dr. STONE Ep 1 → 24 Treffer, alle Internet Archive. Erwartet: DKB-Treffer oder „DKB: keine Treffer/Fehler“.
4. **Treffer-Infos** (klein): Einzelfolgen (~150 MiB „Dr. Stone Sub 2“) als „Batch“; „1 seeders“ (Singular fehlt); Episode-Suche „Episode 1“ zeigt Sub 2/3/5/6… vorn. Datei vermutlich `native/src/main/entry/_containers/torrent-search/_lib/torrent-search-phone.ts`.
5. **Cast-Panel springt in der Höhe** (klein): Cast-Panel → „Search again“ → Panel schrumpft auf eine Zeile „Looking for TVs…“, danach wieder groß. Erwartet: feste Höhe.
6. **Mini-Player verdeckt Seitenende** (klein): Wiedergabe → Mini-Player → Settings → Torrents & debrid ganz nach unten: „Debrid service“-Schalter halb verdeckt, kein zusätzlicher Abstand unten.
7. **Anime-Seite verliert Tab-Wahl** (klein): Torrent-Tab → Menu → Settings → Zurück ×3 → Anime-Seite steht auf „Online“.
8. **Zwei Tabs gleichzeitig hervorgehoben** (klein, optisch): Downloads offen → Menu tippen → „Menu“ und „Downloads“ beide aktiv markiert.
9. **Kein Datei-Auswahl-Blatt für Batch-Torrents** (groß, falls Funktion vorgesehen): Stream-Blatt → Batch „Dr Stone S1“ → spielt sofort Ep 1, keine Dateiliste; Download-Weg (⋮ → Download a torrent → Batch → Continue) zeigt ebenfalls keine Dateiliste, nur ganzen Torrent 9.8 GiB. Vorwahl/Vollständigkeit der Liste daher nicht prüfbar.
10. **Hinweistext Downloads → Torrents falsch** (klein, bestätigt): `native/src/main/android-downloads/_screens/torrent-downloads.tsx:90` „Open an anime and choose Download → a torrent“ – richtiger Weg ⋮ → „Download a torrent“.
11. **Debrid an ohne Anbieter, ohne Warnung** (klein): Settings → Torrents & debrid → Debrid service an → Provider None, kein Hinweis.

#### Nicht geschafft / nicht prüfbar
- Torrent-Client-Aktionen (Pause/Fortsetzen/Neustart/Entfernen-Dialog): kein Torrent in der Liste; Stream-Torrents werden dort nicht gezeigt, Download ohne Bibliotheksordner gesperrt.
- „Stop casting“: keine Cast-Sitzung (TV aus, nichts gesendet).
- Datei-Auswahl-Blatt: existiert in beiden Wegen nicht (siehe Fehler 9).

## Lauf S3 – S22: Handy-Layout Home/Listen/Suche/Menü/Einstellungen + Nachprüfung F1

Belege: `D:/SNB/belege/2026-11-15/apptest/S3/` (nur lokal, nicht im Repo).

Handy-Layout: untere Leiste Home · My Lists · Discover · Search · Menu · Downloads; Menu öffnet schwebendes Blatt (Schedule, Manga, Extensions, Settings, Refresh AniList). Nur gelesen, nichts an AniList geändert.

| Bereich | Element | Gerät | OK/Fehler | Beleg |
|---|---|---|---|---|
| F1 Nachprüfung | My lists Manga: Filter-Blatt langsam bis ganz unten (Year, Tags, „Show all 51 tags“, Ende „Zombie“) | S22 | OK – scrollt komplett | 08_manga_filter.png, 09_mf_scroll1.png, 10_mf_bottom.png, 14_alltags_end.png |
| F1 Nachprüfung | My lists Anime: Filter-Blatt langsam bis unten (Format, Airing, Season, Year, Tags, „Show all 307 tags“) | S22 | OK | 15_anime_filter.png, 19_af_scroll1.png, 20_af_bottom.png |
| F1 Nachprüfung | Suche Anime: Filter-Blatt langsam + schnell bis unten | S22 | OK | 23_search_filter.png, 24_sf_bottom.png, 25_sf_end.png |
| F1 Nachprüfung | Suche Manga: Filter-Blatt (Country, Year, Publishing status, Minimum score, Tags) bis unten | S22 | OK | 26_mangasearch_filter.png, 27_msf_mid.png, 31_msf_end.png |
| F1 Nachprüfung | Wischen mit Start auf Chip löst keinen Chip aus | S22 | OK (Zähler „Show 1 manga“ blieb) | 09_mf_scroll1.png |
| F1 Nachprüfung | Chip im Blatt reagiert auf ersten Tipp (an + aus) | S22 | OK | 11_chip_on.png, 12_chip_off.png, 29_taiwan_on.png |
| F1 Nachprüfung | „Show all … tags“ auf ersten Tipp | S22 | OK | 13_alltags.png |
| F1 Nachprüfung | Sortier-Auswahl im Blatt: erster Tipp auf „Title (A-Z)“ wirkt (Tablet-Fehler nicht bestätigt), zurück auf „Highest score“ | S22 | OK | 16_sort_open.png, 17_sort_az.png, 18_sort_restore.png |
| F1 Nachprüfung | Year-Auswahl öffnen + schließen ohne Änderung | S22 | OK | 28_year_open.png |
| F1 Nachprüfung | Reset-Knopf (Suche) erster Tipp | S22 | OK | 30_reset.png |
| F1 Nachprüfung | Stream-Blatt Torrent-Seite Dr. STONE wischen | S22 | nicht prüfbar: Tipp auf Folge (öffnet Blatt bei „Pick the best torrent“ aus) wurde vom Auto-Modus-Klassifizierer abgelehnt, nicht umgangen; Schalter sofort zurück auf an | 33_torrent.png, 34_autopick_off.png, 36_autopick_restored.png |
| F1 Nachprüfung | Lösch-Dialog mit Text „device“ (Downloads) | S22 | nicht prüfbar: keine Downloads auf dem S22 (Anime/Manga/Torrents leer) → kein Lösch-Knopf; ersatzweise „Clear the manga cache?“ geöffnet + Cancel = OK | 03_dl_anime.png, 04_dl_manga.png, 47_clear_dialog.png, 48_cancelled.png |
| Downloads | Tabs Anime/Manga/Torrents, Leer-Texte, Wi-Fi-only-Schalter (nur angesehen), Storage | S22 | OK | 00_start.png, 03_dl_anime.png, 04_dl_manga.png |
| My lists | Anime-Seite (Zähler, Status-Chips, Raster, Suchfeld) | S22 | OK | 05_mylists.png |
| My lists | Manga-Seite | S22 | OK (kein Suchfeld bei Manga, nur Hinweis) | 07_manga.png |
| My lists | Umschalter Anime↔Manga gleitet | S22 | OK – Bildfolge zeigt gleitenden Wechsel | 06_toggle.mp4, 06_toggle_tile.png |
| My lists | Stats (Anime) | S22 | OK – echte Werte (Tablet-Fehler „0 anime“ nicht bestätigt); siehe Fehler 3 zu „Started this year 0“ | 21_stats.png |
| Suche | Ergebnis-Raster „Dr. STONE“ | S22 | Fehler: zweizeiliger Titel schiebt „Completed · 2021“ direkt an das Cover der nächsten Reihe (kein Abstand) | 22_search.png, 22_zoom.png |
| Suche | Text „Show all 349“ (Suche, lila links) vs. „Show all 307 tags“ (My lists, grau mittig) | S22 | Fehler (kosmetisch): uneinheitlich | 25_sf_end.png, 20_af_bottom.png |
| Anime-Seite | Dr. STONE: Library/Torrent/Online-Tabs, Torrent-Liste | S22 | OK | 32_drstone.png, 33_torrent.png |
| Zeitplan | Week-Liste (Today/Tomorrow/Datum) | S22 | OK | 38_schedule.png |
| Zeitplan | Detail öffnen + 1× Zurück → Zeitplan | S22 | OK – 1× Zurück genügt (Tablet-Fehler nicht bestätigt) | 39_40.png |
| Home | Continue watching, Currently watching | S22 | OK | 41_42.png |
| Entdecken | Anime/Schedule/Manga, Genre-Chips, Trending | S22 | OK | 41_42.png |
| Navigation | Markierung Home/My Lists/Discover/Search/Downloads/Menu | S22 | OK – immer genau ein Eintrag markiert (Tablet-Doppelmarkierung nicht bestätigt) | 00_start.png, 05_mylists.png, 22_search.png, 37_menu.png, 41_42.png |
| Navigation | Auf Zeitplan/Einstellungen/Anime-Seite ist kein Eintrag markiert (auch nicht „Menu“) | S22 | Hinweis (klein) | 38_schedule.png, 43_44.png |
| Menü | Schwebendes Menü: „App 4.0.0 · up to date“, Schedule, Manga, Extensions, Settings, Refresh AniList | S22 | OK (Schedule + Settings geöffnet; Manga/Extensions/Refresh nicht getippt) | 37_menu.png |
| Einstellungen | Übersicht 11 Seiten, Texte nicht abgeschnitten | S22 | OK | 43_44.png |
| Einstellungen | Kopfzeile „Seanime 3.10.4 · App 4.0.0“ | S22 | Fehler (klein): wie Tablet – alte Server-Version, Name Yomimi fehlt | 43_44.png |
| Einstellungen | Untertitel Appearance „Banner, …“ | S22 | Fehler (klein): wie Tablet (nicht erneut geöffnet) | 43_44.png |
| Einstellungen/Logs & cache | Beim Öffnen Fehler-Kasten „Error: GET /api/v1/logs/filenames needs the server, the app runs without it“; Cache-Size „–“ | S22 | Fehler (mittel) | 45_46.png |
| Einstellungen/Logs & cache | Clear the manga cache → Dialog → Cancel | S22 | OK | 47_clear_dialog.png, 48_cancelled.png |
| Allgemein | Logcat (App-Fehler/Exceptions) | S22 | OK – keine Treffer | logcat_errors.txt |

Zählung: OK 26 · Fehler 5 (+1 Hinweis) · nicht prüfbar 2.

Nicht geschafft (Budget 100 Aufrufe): Einstellungs-Unterseiten App, Appearance, Playback, Local library, Online streaming, Torrents & debrid, Manga, Nakama, About nicht einzeln geöffnet; Auswahl-Listen dort nicht geprüft; Menü-Einträge Manga/Extensions/Refresh AniList; Home-Customize/Filter; Discover-Unterseiten; Zeitplan Month/Filter.

#### Fehler

1. **Logs & cache: Fehler-Kasten beim Öffnen (mittel).** Menu → Settings → Logs & cache. Erwartet: Log-Dateien-Liste bzw. ruhiger Leer-Zustand. Tatsächlich: roter Kasten „Error: GET /api/v1/logs/filenames needs the server, the app runs without it“, Cache „Size –“. Der eigene Kern bedient den Endpunkt nicht. Vermutet: Logs-Seite unter `native/src/main/settings/…` ruft `logs/filenames` (Endpunkt in `native/src/api/generated/endpoints.ts`).
2. **Suche: Karten-Text stößt an nächste Reihe (klein).** Search → „Dr. STONE“. Erwartet: Abstand zwischen Meta-Zeile und nächstem Cover. Tatsächlich: bei zweizeiligem Titel klebt „Completed · 2021/2022“ direkt am Cover darunter (Reihenhöhe fest?). Beleg 22_zoom.png.
3. **Stats „Started this year 0 / No activity“ (klein, unsicher).** My lists → Stats. Laufende Fall-2026-Serien sind auf Watching, trotzdem 0 in diesem und letztem Jahr – Zählung wirkt falsch.
4. **Kopfzeile Einstellungen „Seanime 3.10.4 · App 4.0.0“ (klein).** Wie Tablet bestätigt. Datei: `native/src/main/settings/_screens/settings-phone.tsx:76`.
5. **„Show all …“-Link uneinheitlich (kosmetisch).** Suche: „Show all 349“ lila links; My lists: „Show all 307 tags“ grau mittig.

Hinweis: Auf Zeitplan/Einstellungen/Anime-Seite ist kein Leisten-Eintrag markiert (über Menü erreicht → evtl. „Menu“ erwartet).

Tablet-Fehler am S22 widerlegt: Filter-Blätter scrollen jetzt komplett (F1 wirkt), Sortier-Auswahl reagiert auf ersten Tipp, Zeitplan-Zurück 1×, keine Doppel-Markierung in der Leiste, Stats zeigen Werte.

Regel-Hinweis: Ein Tipp auf eine Folge (für das Stream-Blatt) wurde vom Klassifizierer abgelehnt; nicht umgangen. „Pick the best torrent“ kurz aus- und sofort wieder eingeschaltet (vorher/nachher-Screenshot 33/36). Lock `device.lock` entfernt.
