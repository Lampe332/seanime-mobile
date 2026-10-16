# Changelog

Alle Versionen von Seanime Mobile. Downloads: [Releases](https://github.com/Lampe332/seanime-mobile/releases).

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
