# Android Plugins, Pins und Playlists — 19.10.2026

Nick — Ausgang: sauberer `main` auf `cfa3948178fe27e6be979c88899daf63050e0433`, reguläres Samsung SM-S908B (`R3CT60PD7YA`) mit `com.seanime.app.local` 1.9.6/31031. `origin` ist das private `Lampe332/seanime-mobile-dev`, `upstream` bleibt `Lampe332/seanime-mobile`. Privatsphäre, Standardbranch `main` und deaktivierte Actions über GitHub API geprüft. Keine fremden Änderungen vorhanden. Kein Tag, Release oder Push zum öffentlichen Repository.

## Ursachen und Umsetzung

Nick — Der bisherige Home-Einstieg stellte nur die Plugins-Auswahl dar. Alle Runtimes lagen absichtlich in einem versteckten Container, damit sie nach Schließen der Auswahl weiterleben; daneben fehlte jedes sichtbare Rendering der gespeicherten Pins. Die geöffneten Inhalte benutzten weiterhin Desktop-Popover/Drawer mit Plugin-Mindesthöhen und einer 35-rem-Scrollgrenze. Weitere Ebenen existieren als Registry-Modal/Popover, serverseitiger Aktionsdialog und Command-Palette. Deshalb genügte eine Änderung des Auswahlmenüs nicht.

Nick — Gemeinsamer, ausdrücklich eingebundener `MobileWorkspace`: begrenzte mobile Höhe, Plugin-Identität, erreichbares Schließen/Zurück, innere Scrollfläche und eigener Aktionsbereich. Native Samsung-IME-Insets und `visualViewport` begrenzen die Fläche oberhalb der Tastatur; Safe-Area/oberes Inset werden berücksichtigt. Android-Zurück behandelt Auswahlmenüs und oberste Dialoge zuerst. Fokus-Rückgabe mit `preventScroll` und eine nur für offene Workspaces geltende Root-Scrollsperre erhalten Home-Position und geben Scrollen wieder frei. Der alte pauschale native Modal-Padding-Patch schließt diese neue Komponente ausdrücklich aus; andere Oberflächen behalten ihre Regeln.

Nick — Plugin-Renderantworten werden im dauerhaft gemounteten Tray empfangen, bevor dessen sichtbarer Inhalt öffnet. Dadurch gehen frühe Antworten nicht verloren. Hooks liegen vor bedingten Rückgaben; der bisherige verzögerte globale `body.pointerEvents`-Eingriff entfällt. Registry-eigene Layouts, Felder, Formulare, Buttons, Tabs und Menüs erhalten begrenzte mobile Klassen. Select-Menüs liegen über den Workspaces. Numerische Select-Werte behalten ihren Typ; ein gespeicherter Wert außerhalb der angebotenen Presets, hier `0.7`, wird sichtbar, ohne Runden oder automatische Änderung. Vorhandene Renderer-Fehler können lokal mit Retry angezeigt werden.

Nick — Gemeinsame Regeln verändern keine beliebigen Plugin-HTML-Bäume und löschen keine DOM-Knoten. Eine getrennte Anpassung in `mobile-plugin-adapters.css` gilt ausschließlich für das installierte **Watch Next**: vier Desktopfilter werden zu zwei Spalten; zuvor nur per Maus-Hover sichtbare Add-Aktionen erhalten sichtbare Touchflächen. Handler, Inhalte und Datenspeicherung bleiben beim Plugin. Sandboxed HTML-/Iframe-Webviews behalten ihren bisherigen Sicherheits- und Nachrichtenvertrag; insbesondere wird die separate Download-Notifier-Seite im ausgeschlossenen Download-Bereich nicht umgebaut.

Nick — Pins erscheinen unmittelbar neben dem Plugins-Einstieg, in gespeicherter Reihenfolge und mit Original-Icon, Ersatzsymbol und zugänglichem Namen. Die Gruppe scrollt horizontal und hat keine Eintragsgrenze. Nicht registrierte IDs erzeugen keinen kaputten Button, bleiben aber in den gespeicherten Einstellungen erhalten. Menü und Header nutzen denselben optimistischen Zustand. Ein synchroner Lock verhindert doppelte Requests; die Speicherung wartet auf die Settings-Aktualisierung, bevor der Lock gelöst wird. Damit überschreibt ein schneller Folgeklick keine gerade gespeicherten Pins. Ohne Pins bleibt der bisherige kompakte Home-Header unverändert.

Nick — Playlists benutzen mobil einen zusammenhängenden Ablauf: Übersicht/Leerzustand, Entwurf mit Name, Anime-Suche und vorhandenen Sammlungsfiltern, Episoden mit Einzel-/Sammelauswahl und Anzahl, Auswahlprüfung, Reihenfolge/Entfernen/Quelle, explizites Speichern, erneutes Bearbeiten und Löschbestätigung. Das geschieht innerhalb einer Oberfläche. Zurück erhält den Entwurf; Abbruch speichert nichts. Fehler behalten Name und Auswahl. Ein synchroner Mutationsschutz umfasst auch die anschließende Query-Aktualisierung. Externe Anime-/Episodeneinstiege bleiben möglich; die ausstehende Episode darf nur beim ursprünglich angeforderten Anime landen.

Nick — Vorhandene Episodenidentität, Reihenfolge, 200er-Grenze, Wiedergabequellen, Nakama-Zuordnung und `startPlaylist`-Übergabe bleiben erhalten. Die laufende Playlist hat ebenfalls einen mobilen Rahmen mit erreichbaren Vorher/Nächste/Erneut-öffnen/Stoppen-Aktionen. Die vorhandene Fortschrittsfrage bleibt erhalten. Neue App-Texte und Playlist-Toasts verwenden die vorhandene DE/EN-Lokalisierung. Plugin-eigene englische Texte werden nicht eigenmächtig umgeschrieben.

## Abnahme der vorhandenen Funktionen

| Bereich | Tatsächlicher Nachweis |
|---|---|
| Plugins öffnen/schließen | Menü und richtiger Header-Pin, sechs zusätzliche Öffnen-/Schließenzyklen, keine doppelten Flächen/Scrollsperren, Home-Scrollposition erhalten |
| Plugin-Inhalte | Acht reale Plugins; Scrollen, Felder, Provider-Auswahl, Tastatur, Android-Zurück; Watch-Next-Suche/Filter und eigene Rücknavigation ohne Hinzufügen |
| Weitere Runtime-Ebenen | Echte React-/Radix-Komponenten mit isoliertem Eventtransport: verschachtelte Modals/Popover, serverseitiger Aktionsdialog und Command-Suche mit ursprünglichen Handler-IDs |
| Pins | Sofort sichtbar, Lösen, mehrere Pins, schnelle Mehrfachtipps, Reihenfolge, unbekannte IDs, 320px/200%, Home nach My Lists und echter Prozessneustart |
| Übersicht/Entwurf | Tatsächlicher leerer Ausgangsbestand; Create, Name mit echter Samsung-Tastatur, Suche/Filter, mehrere Anime, Einzel-/Sammelauswahl und Rücknavigation |
| Speichern/Bearbeiten | Nur benannte Testplaylist; explizites Speichern, Mehrfachtippen, Öffnen, Umbenennen, Reihenfolge, Entfernen, Löschabbruch und bestätigtes Löschen |
| Fehler/Abbruch | Fehlgeschlagener Save und Retry im kontrollierten vollständigen React-Bedienpfad; Abbruch ohne Store-Änderung auf Samsung |
| Wiedergabe | Auf Samsung richtiger gespeicherter Playlist-Auftrag, laufende Liste und Fortschrittsfrage; Kommandos am WebSocket-Ausgang abgefangen, kein Start/Fortschrittsupdate |
| Große Darstellung | 320 CSS-Pixel und 200% Root-Schrift; lange Titel, sichtbare Episoden und vollständig umbrechende Hauptaktion; keine Änderung der Android-Systemschrift |
| Längere Listen | Reale Watch-Next-Auswahl und Marketplace+-Einstellungen; zusätzlich isolierter Entwurf mit 200 Episoden, Mutation am Endpunkt blockiert, anschließend komplett verworfen |

Nick — Auf Samsung tatsächlich geöffnet: **AnimeThemes Player, Episodes History, Dub Schedule, Marketplace+, Manga Source Updates, Watch Next, Watch Order und Picked For You**. Die ausgeführten ungefährlichen Unterpfade stehen in `device-checks.json` und `tested-plugin-surfaces.json`. Episodes History und Picked For You standen in ihrer Setup-Ansicht; kein künstlicher Verlauf und keine Empfehlungen wurden gespeichert. Watch Order zeigte den Hinweis, zuerst eine Anime-Seite zu öffnen. Manga Source Updates war ohne verbundenes Konto; Scan/Sync/Connect wurden nicht ausgelöst. Keine realen Lösch-, Bereinigungs-, Synchronisations- oder Kontoaktionen eines Plugins ausgeführt.

Nick — Nicht vollständig geprüft: Delete Watched Episodes, MangaUpdates Sync, MyDubList, Seanime Download Notifier und Skip Data Manager. Ebenso keine Zusage für beliebige zukünftige Plugins, eigenständige HTML-Layouts oder externe Provider-Verfügbarkeit. Registry-Aktionsdialoge und Command-Palette sind zusätzlich kontrolliert getestet; nicht jede installierte Erweiterung bietet solche Ansichten an. Plugin-interne Navigation verwendet weiterhin die vom Plugin angebotenen Aktionen, beispielsweise „Back to List“; Android-Zurück schließt ansonsten die oberste App-Fläche.

## Ausgeführte Prüfungen

Nick — Frontend: **19 Vitest-Dateien / 108 Tests**, TypeScript und Produktionsbuild erfolgreich. **29** echte React-/Radix-Menü-/Pin-Prüfungen, **32** vollständige Playlist-Prüfungen und **17** Runtime-Prüfungen mit isolierten Transport-/API-Grenzen erfolgreich. Die Playlist-Prüfung verwendet den echten Produktionsbutton, damit dessen frühere `nowrap`-Regel im 200%-Fall tatsächlich erfasst wird. Der Speicher-Helfertest ersetzt diese Bedienpfade nicht.

Nick — Final installierter Samsung-Build: **51 Geräteprüfungen erfolgreich**. Zusätzlich echter Wechsel My Lists/Home mit erhaltenem Pin sowie sechs Persistenz-/Wiederherstellungsnachweise über zwei Prozessneustarts. Gerätetests: `tests/mobile_workflows_device.py`; kontrollierte Tests: `tests/mobile_home_plugins.py`, `tests/mobile_plugin_runtime.py`, `tests/mobile_playlists.py`. Bestehende Navigation, Navigationsmigration, Updater-Menü und Plugin-DOM-Beobachtung ebenfalls erfolgreich ausgeführt.

Nick — Android: **13 Unit-Tests**, Release-Lint **0 Fehler / 64 Warnungen**. Beide Go-Backends ARM64 und ARMv7 neu gebaut. **154** Produktionsdateien bytegleich in `backend/web`; beide APK-Backends stimmen mit den gebauten nativen Dateien überein. Signatur gültig und Zertifikat identisch mit der zurückgelesenen Vorgängerversion; 16-KiB-Zipausrichtung erfolgreich. Keine neue Bibliothek, keine Player-/Backend-Semantikänderung.

## Performance und Grenzen

Nick — rAF-Abstände/CDP-Skriptzeit und Long Tasks auf dem Samsung, keine Messung tatsächlich präsentierter GPU-Frames. Home: dieselben 41 Karten, zwei Fortsetzungen und vier gespeicherten Abschnitte bei 384×823 CSS-Pixeln; sechs gleiche physische ADB-Swipes je Lauf. Vorher ist die installierte 1.9.6. Die zusätzliche Plugin-Baseline lädt deren unveränderten eingebetteten Frontend-Bundle temporär in derselben finalen nativen Hülle; keine gespeicherten Daten oder Navigationsbelegung werden ersetzt.

| Probe | Vorher p95 / Max. rAF ms | Final p95 / Max. rAF ms |
|---|---:|---:|
| Home Lauf 1 | 8.4 / 41.7 | 16.7 / 33.5 |
| Home Lauf 2 | 8.4 / 25.1 | 16.7 / 33.4 |
| Marketplace+ Lauf 1 | 16.7 / 75.0 | 16.7 / 133.3 |
| Marketplace+ Lauf 2 | 16.7 / 75.0 | 16.7 / 133.5 |
| Isolierter 200-Episoden-Entwurf | 41.7 / 241.7 | 16.7 / 83.4 |

Nick — Home-Skriptzeit vorher 0.801/1.045 s, final 1.134/1.042 s; beide finalen Home-Läufe ohne Long Task. Final Home p95 16.7 ms gegenüber 8.4 ms der kühleren Basis. Watch Next mit längerer realer Auswahl final p95 16.7/16.7 ms, Maxima 100.0/157.8 ms. Marketplace+ Öffnen einschließlich Automationsanteil 1083/843 ms gegenüber 690/743 ms; keine reine App-Latenz. Ein früherer finaler Zwischenlauf hatte dort eine **208-ms-Spitze**; diese Rohdaten werden nicht verworfen. Keine allgemeine Regressionsfreiheit oder Beschleunigung behauptet. Thermalstatus vorher Home 0, final 1 (Skin 37.9 °C); Bedingungen thermisch nicht gleich. Der statische Hintergrund und fehlender scrollabhängiger Header-Zustand bleiben im Code erhalten. Die 200-Episoden-Probe verwendet ausschließlich temporäre GET-Testdaten; kein Speichern möglich. Einzelproben, kein Langzeit-/Akku-/GPU-Benchmark. Die vorliegenden Messdateien einschließlich der ungünstigen Zwischenprobe bleiben lokal erhalten.

## Datenerhalt und Auslieferung

Nick — Ausschließlich `adb install -r`, keine Deinstallation, kein `pm clear`, Daten- oder Navigationsreset. Vorhandener Playlistbestand war leer und ist wieder leer; geschützte bestehende Playlists werden zusätzlich im kontrollierten Bedienpfad geprüft. Nur Namen mit Präfix `__Codex_Mobile_197_20261019__` wurden testweise gespeichert und wieder entfernt. Original-Pins waren leer, wurden nach Pin-/Neustarttests wiederhergestellt und erneut nach Neustart geprüft. Alle 16 Plugin-Berechtigungseinträge und vollständigen Plugin-Einstellungen stimmen mit dem Ausgang überein.

Nick — Home-Konfiguration, **336** Listenwerte (Fortschritt/Status/Bewertung), **8** Wiedergabeeinträge einschließlich Zeitpositionen, **5** Navigationswerte sowie **125** Offline-Dateien mit Dateiliste/Größe/SHA-256 erhalten. Keine reale Episode gestartet. Alle abgefangenen Wiedergabeaufträge sind in `isolated-playback-commands.json` dokumentiert. Die Audit-Debugfreigabe ist nach normalem Release-Start beendet; der eigene ADB-Debugforward wurde entfernt. Anmeldung und reguläres Home sind sichtbar.

Nick — Version **1.9.7 / 31032**, Paket **com.seanime.app.local**. APK: `D:\Seanime-Build\mobile-workflows-evidence-1.9.7\Seanime-Mobile-1.9.7.apk`. SHA-256 gebaut und vom Gerät zurückgelesen: `477abde47c05108b594e4f667ad5112c6273ec00274079abcfd5ffaf6cfb11d0`. `build-proof.json` enthält Bundlemanifest/native Hashes; `build-retention-proof.json` den Daten-/Installationsabgleich; `publication-proof.json` nach privatem Push Commit, `origin/main`, sauberen Arbeitsbaum und Artefakthash. Signiergeheimnisse bleiben ausschließlich lokal.

## Aufnahmen

Nick — Lokale Nachweise unter `D:\Seanime-Build\mobile-workflows-evidence-1.9.7`:

| Vorher | Nachher |
|---|---|
| `before-animethemes-player.png` | `final-animethemes.png` |
| `before-playlists.png` | `final-playlists.png` |
| `provided-before-editor.png` (Nicks bereitgestellter Screenshot) | `final-playlist-editor.png` |
| `provided-before-episodes.png` (Nicks bereitgestellter Screenshot) | `final-episodes.png` |

Nick — Weitere Aufnahmen: `final-pinned-header.png` demonstriert drei Testpins, die anschließend zurückgesetzt wurden; `final-normal-launch.png` zeigt den tatsächlichen normalen Endzustand ohne Pins. `final-watch-next-search.png`, `plugin-keyboard.png`, `playlist-keyboard.png`, `header-320-200.png`, `plugin-320-200.png`, `playlist-320-200.png` und `final-active-playlist.png` dokumentieren Unteransichten und Grenzfälle. Kurze Bedienaufnahmen des finalen Builds: `final-plugins-interaction.mp4` und `final-playlists-interaction.mp4` (Entwurf anschließend verworfen). Gespeicherte Zwischenstände und Automationsfehler zählen nicht als finale Abnahme.
