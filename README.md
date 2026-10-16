# Seanime Mobile

Seanime Mobile 1.6.0, basierend auf Seanime 3.10.4.

Eigenständiger, angepasster Android-Fork mit lokalem Go-Backend und React-Oberfläche in einer Android-WebView. Paket `com.seanime.app.local`, App-Version `1.6.0`, Seanime-Version `3.10.4`, Android-VersionCode `31013`.

**App installieren:** die fertige APK unter [Releases](../../releases/latest) herunterladen und auf dem Handy öffnen. Das Repository enthält den vollständigen Quellcode zum selbst Bauen.

Die ursprüngliche Android-Portierung stammt aus [Seanime Android von Pal-droid](https://github.com/Pal-droid/Seanime-Android); Backend und Weboberfläche aus [Seanime von 5rahim](https://github.com/5rahim/seanime). Dieser Fork ist ein unabhängiges Projekt. Ursprüngliche Dokumentation: [UPSTREAM-README.md](UPSTREAM-README.md). Die bestehenden GPL-Lizenztexte und Werkzeughinweise liegen bei.

## Neu in App 1.6.0

- „Staffel / Folgen herunterladen“ in der Animeansicht: ganze Staffel, ab Folge …, einzelne Folgen. Vorhandene oder eingeplante Folgen werden übersprungen.
- Dauerhafte Download-Warteschlange (max. zwei Videos gleichzeitig), übersteht Seitenwechsel und App-Neustart; pausieren, fortsetzen, entfernen.
- Downloads-Tab mit Anime und Manga. Manga mit lokalem Cover, Infos und Kapitelübersicht; heruntergeladene Kapitel öffnen den Manga-Reader, auch offline.
- Manga-Downloads starten auf Android sofort (`startNow: true`); Routenfehler beim Öffnen eines Manga behoben.
- Mehrere Anime auswählen und gemeinsam löschen; „Anime löschen“ in der Detailansicht.

## Änderungen in App 1.5.0

- Downloads als Route `/android-downloads` in der Haupt-App mit unterer Navigation.
- Anime-Übersicht mit Covern, Folgenansicht mit Banner, Genres, Beschreibung und Folgenbildern; Bilder und Metadaten werden dauerhaft lokal gespeichert und funktionieren offline.
- Offline-Wiedergabe direkt aus der Folgenansicht.

## Änderungen in App 1.4.x

- 1.4.1: Downloads nach Anime gruppiert, Filter Alle/Bereit/Aktiv, Offline-Player (Media3/ExoPlayer) mit 16:9, Vollbild, −5/+10 s, Tempo und Untertiteln, Fortsetzungsposition.
- 1.4.0: Torrent- und Debrid-Funktionen auf Android deaktiviert (UI und API gesperrt); Offline-Downloads für direkte MP4-/HLS-Quellen.

## Änderungen in App 1.3.3

- Sichtbare, gespeicherte Kalenderquelle: Meine AniList oder Alle Anime.
- Direkte Mehrfachauswahl aller sechs AniList-Status: Schaue ich, Geplant, Pausiert, Abgeschlossen, Abgebrochen, Schaue erneut. Alle Status wählt alle Listenstatus, nicht die globale Anime-Datenquelle.
- Alle Anime fragt sämtliche AniList-Sendezeiten des ausgewählten lokalen Tages über den bestehenden Server ab, lädt alle Ergebnisseiten und entfernt doppelte Termine. Die persönlichen Statusfilter gelten nur in Meine AniList und bleiben beim Quellenwechsel erhalten.
- Globale Tagesabfragen sind fünf Minuten zwischengespeichert. Andere Kalendertage laden ihre globalen Termine erst beim Antippen; es werden keine unvollständigen globalen Monatszahlen behauptet.
- Kompaktere Überschrift, zwei Reihen Statusflächen, deutliche Terminzellen und Auswahlkontraste sowie größere Folgenkarten.
- Zusätzliche unfiltrierte Folgenbereiche aus Schedule entfernt: Die angezeigten Folgen gehören ausschließlich zum gewählten Tag und zur aktiven Quelle/Statusauswahl.
- Globale Abruffehler liefern keine scheinbar vollständige Teilliste. Laden und Fehler mit erneutem Abruf sind sichtbar.
- Sechs Unit-Tests für Pagination, lokale Tagesgrenzen, Fehler und Abbruch in `backend/seanime-web/src/app/(main)/schedule/_lib/global-schedule.test.ts`.

## Änderungen in App 1.3.2

- Schedule auf Handys als Monatskalender mit sieben Wochentagen statt langer Tagesliste.
- Veröffentlichungstage mit Folgenanzahl, ausgewählter Tag mit vollständiger Episodenliste und Anime-Links.
- Monatswechsel, Heute, Montag/Sonntag als Wochenbeginn und bestehende Status-/Gesehen-Filter.
- Kalender zuerst, danach kommende und fehlende Folgen; Kalender lädt unabhängig von fehlenden Folgen.
- Ladeanzeige sowie Fehlerzustand mit erneutem Abruf. Datumszuordnung nach lokaler Zeitzone.
- PC-Kalender bleibt erhalten. Layout- und Funktionstests auf fünf Handyformaten sowie PC-Format; direkter Laufzeittest auf S22 Ultra.

## Änderungen in App 1.3.1

- Home-Auswahlfelder umbrechen und bleiben innerhalb eines Dialogs mit Bildschirmabstand.
- Plugin-Übersicht direkt öffnen, Plugins durchsuchen, lesbare Namen und größere Pin-Flächen.
- Plugin-DOM-Beobachter nur bei aktiven Abonnements starten; Änderungen in 16-ms-Paketen verarbeiten; beim Abmelden aufräumen.
- WebSocket-Nachrichten einmal je Ereignis einlesen und Daten erst für passende Empfänger kopieren; Empfänger bleiben voneinander isoliert.
- Android-Navigationsbeobachter vermeiden unnötige Layoutabfragen; Entry-Anpassungen bündeln verzögerte Arbeiten.
- Einstellungen zeigen Backend-Version und echte installierte APK-Version getrennt.
- Beide nativen Architekturen mit dem aktualisierten Frontend neu gebaut.

## Bisherige Mobile-Korrekturen

- Aktueller Bereich in der unteren Navigation sichtbar markiert.
- Scrollbares Menü mit beschrifteten, vollständig antippbaren Zeilen; auch bei wenig Bildschirmhöhe erreichbar.
- Android-Zurück schließt Resetdialog, Navigationsbearbeitung und Menü vor dem Verlassen der Seite.
- Schnelles Schließen und Wiederöffnen erzeugt keinen unsichtbaren offenen Menü-Zustand.
- Ungültige Widget-Links öffnen eine nutzbare Startseite.
- Externe Seiten besitzen eigene Zurück-Navigation, eine 48-dp-Schließen-Fläche und werden beim Schließen freigegeben.
- Benachrichtigungsberechtigung wird einmal und nach der Dateizugriffserklärung angefragt.
- Widget-Abfragen verwenden gültige GraphQL-Variablen und stoppen den gemeinsamen App-Server nicht mehr.
- System-Dateiauswahl für Web-Importe und Android-Speicherdialog für Downloads und Blob-Exporte bis 25 MiB.
- Vorhandene Manga-Reader-, Resume-, Doppelseiten- und PiP-Korrekturen bleiben enthalten.
- WebView-Debugging nur in Debug-Builds.

## Installation

Die signierte APK `Seanime-Mobile-1.6.0.apk` (Release v1.6.0) gehört zu diesem Quellstand. Für Updates auf vorhandenen Geräten müssen Paket-ID und Signierschlüssel übereinstimmen. Die veröffentlichte APK nutzt den bisherigen lokalen Schlüssel; das öffentliche Quellarchiv enthält diesen privaten Schlüssel nicht.

ARM64 und ARMv7 werden mitgeliefert. Minimum API 21, Ziel API 36. Laufzeittests dieses Updates erfolgten auf einem Samsung Galaxy S22 Ultra. Andere Geräte, sämtliche Videoformate und alle externen Anbieter sind dadurch nicht abgedeckt.

## Bauen und prüfen

Siehe [BUILD-ANDROID.md](BUILD-ANDROID.md). Für einen lokalen Debug-Build mit vorhandenen nativen Bibliotheken:

```powershell
.\gradlew.bat :app:assembleDebug
```

Die Dateien unter `app/src/main/jniLibs` enthalten das zum gelieferten Backend- und Frontend-Quellstand gehörende native Programm. Für vollständige Backend-/Frontend-Neubauten: `Build.ps1 -RebuildBackend`, wie in der Build-Anleitung beschrieben.

Navigationstests benötigen Python und Playwright:

```powershell
python -m pip install playwright
python -m playwright install chromium
python tests/mobile_navigation.py
python tests/plugin_dom.py
```

Gerätetest für das Widget:

```powershell
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w com.seanime.app.local.test/com.seanime.app.audit.MobileInstrumentation
```

Die Instrumentierung benötigt ein eingerichtetes AniList-Konto im Testgerät, liest seine Liste und stellt den vorherigen Widget-Cache wieder her. Sie verändert keinen AniList-Fortschritt. Debug- und Test-APK müssen denselben Schlüssel verwenden; ein anders signierter Debug-Build lässt sich nicht über eine vorhandene Release-Installation installieren.

## Veröffentlichung

APK als Release-Datei veröffentlichen; Quellen, Lizenzen und Änderungen dieses Builds gemeinsam zugänglich machen. `signing/`, Passwörter, persönliche Datenbanken, lokale Konfigurationen und Debug-APKs gehören nicht in das Repository. Der private Signierschlüssel liegt außerhalb des Repositorys im Nachbarordner `../seanime-mobile-signing/`; `Build.ps1` findet ihn dort automatisch.
