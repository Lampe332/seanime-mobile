# Changelog

Alle Versionen von Seanime Mobile. Downloads: [Releases](https://github.com/Lampe332/seanime-mobile/releases).

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
