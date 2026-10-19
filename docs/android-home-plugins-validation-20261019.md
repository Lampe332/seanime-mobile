# Android Home und Plugins — 19.10.2026

## Ausgang und Umfang

Sauberer Branch `main`, Ausgang `d728773a7712b81b9fe2e51d8f4ea863e797a630`; Samsung SM-S908B (`R3CT60PD7YA`) mit regulärem `com.seanime.app.local` 1.9.5/31030. Remotes geprüft: privates `origin` ist `Lampe332/seanime-mobile-dev`; `upstream` ist `Lampe332/seanime-mobile`. Keine fremden Änderungen vorhanden. Ausschließlich privater Push nach `origin/main`, kein neuer Tag und kein Release.

## Gestaltung und Verhalten

- Bildunabhängiger, kompakter Home-Kopf: Seanime-Marke, Home-Titel und integrierte Plugins-Aktion auf eingefassten violetten Flächen. Statisches Linienmotiv; vorhandene Playlists-/Customize-Aktionen schließen direkt an. Kein Anime-Banner und keine zusätzliche Bildabfrage im Kopf.
- Nachträglich gewünschter Home-Hintergrundeffekt: feine violette Lichtpunkte als statisch gekachelter CSS-Verlauf und ein auf 24 rem begrenzter Lichtschein. Keine Animation, fixer Hintergrund, Filter, Blur oder zusätzliche DOM-Ebene.
- Neues Erweiterungs-/Sockelmotiv als 24-Pixel-SVG mit 2-Pixel-Strich. Beschrifteter Einstieg mit mindestens 44-Pixel-Touchfläche und gedrücktem, geöffnetem sowie sichtbarem Fokuszustand.
- Home-eigenes Radix Bottom Sheet mit Titel, tatsächlicher Anzahl, Schließen, fokussierbarer Suche, separaten Öffnen-/Pin-Zielen, eingerahmten Original-Icons und Ersatzsymbol für fehlende/defekte Icons. Kompakte Zeilen, sichtbarer Pin-Status und scrollbar bis zum letzten Eintrag. Bestehende Sortierung und gespeicherte Pin-Reihenfolge erhalten.
- Plugin-Liste stammt aus bestehenden WebSocket-Registrierungen und besitzt keinen eigenen Lade-/Fehlerstatus. Keine solchen Zustände erfunden. Vorhandene Settings-Lade-/Fehlerzustände, Retry und fehlgeschlagene Pin-Speicherung werden angezeigt; leere Liste und keine Suchtreffer sind unterscheidbar.
- Plugin-Runtimes bleiben beim Schließen der Auswahl verfügbar; Suchzustand bleibt lokal in der Auswahl. Bestehende Plugin-Klick-/Renderereignisse bleiben unverändert. Programmatisches Öffnen schließt die Auswahl auch bei derselben zuvor geöffneten Plugin-ID.
- Root-Scrollsperre berücksichtigt Androids scrollendes HTML-Element; Fokus kehrt mit `preventScroll` zum Einstieg zurück. Kein scrollabhängiger React-Zustand. Tastatur öffnet beim Menüstart nicht automatisch.
- Samsung behält bei sichtbarer IME eine unveränderte `visualViewport`-Höhe. Die bereits ermittelten nativen Insets senden deshalb zusätzlich ein Ereignis; ausschließlich das neue Sheet nutzt es zur Größenbegrenzung. Vorhandenes natives Padding bleibt unverändert. Suche, Schließen und letzter Eintrag bleiben oberhalb der Tastatur.
- Fortsetzungskarten, Bibliotheksreihen, Reihenpfeile, Anpassungsdialog, untere Navigation und andere Seiten behalten ihre Implementierung. Gemeinsame Navbar/Plugin-Komponenten besitzen eine abgegrenzte Home-Variante. Kein Backend-/Plugin-System-Umbau und keine neue UI-Bibliothek.

## Verifikation

- TypeScript und Produktionsbuild erfolgreich; alle 154 Produktionsdateien bytegleich in `backend/web`. Beide Go-Backends ARM64/ARMv7 neu gebaut; APK-Binärdateien mit den gebauten Dateien identisch.
- Frontend: 17 Testdateien, 101 Tests erfolgreich. Neue tatsächliche React-/Radix-Klickpfade: 23 Prüfungen mit kontrollierten Backend-/Runtime-Grenzen, darunter getrennte Pin-Ziele, Suche, Fehler/Retry, Iconfehler, leerer Zustand, 320 Pixel/200 % Schrift, programmatisches Öffnen, Root-Scrollsperre und native Tastatur-Inset-Behandlung. Keine Tests, die nur CSS-Werte nachbilden.
- Android: 13 Unit-Tests erfolgreich; zusätzlich mit `--rerun-tasks` frisch ausgeführt. Release-Lint erfolgreich, 0 Fehler und 64 Warnungen im Report. Signaturprüfung und 16-KiB-Zipausrichtung erfolgreich; Zertifikat identisch mit tatsächlich zurückgelesener Vorgängerversion.
- Bestehende Navigations-, Navigationsmigrations- und Updater-Menütests erfolgreich.
- Finaler Samsung-Build: 33 Geräteprüfungen erfolgreich. Öffnen, Schließen/Wiederöffnen, Android-Zurück, physischer Outside-Tap/-Swipe, Home-Scrollposition, Suche mit/ohne Treffer und Löschen, letzter Listeneintrag, Original-Icons, Pin/Lösen ohne Start, reale Tastatur, 320 CSS-Pixel mit 200 % Root-Schrift, bestehende Home-Anpassung und Navigation.
- Nur das ungefährliche **Episodes History** geöffnet; genau ein `tray:clicked` für `episodeshistory` protokolliert. Keine Lösch-/Bereinigungsaktion ausgeführt.
- Weitere 3 Prüfungen: Test-Pin über echten Prozessneustart erhalten, über UI zurückgesetzt, Original-Pins über zweiten Neustart erhalten.
- Alle Bildanfragen vorübergehend blockiert: Header unverändert vollständig und gleich hoch. Anfragekontrolle anschließend entfernt und echte Inhalte neu geladen. Zusätzlich acht Öffnen-/Schließen-Zyklen und 25-Sekunden-Bedienaufnahme.
- Kontrollierte Fixtures laufen ausschließlich im temporären Testbrowser. Auf Samsung keine Home-/Navigationsfixtures gespeichert; echte Test-Pin-Änderungen zurückgesetzt. Viewport-/Schriftüberschreibungen und Bildblockade entfernt. 200 % beziehen sich auf die Root-Schrift im 320-Pixel-Test; keine zusätzliche Android-Systemschriftänderung in diesem Auftrag.

## Performance und Grenzen

Identische echte Home-Konfiguration mit vier gespeicherten Abschnitten, zwei Fortsetzungsfolgen (209983/11 und 21087/8), 41 Karten im DOM und 384×823 CSS-Pixeln. Nachladen vor den finalen Messungen abgeschlossen. Sechs gleiche physische ADB-Swipes: abwechselnd `(720,2300) → (720,850)` und zurück, 600 ms, 400 ms Pause. rAF-Abstände, CDP-Skriptzeit und Long Tasks; keine Messung präsentierter GPU-Frames.

| Home-Probe | p95 rAF ms | Maximum ms | Skriptzeit s | Long Tasks |
|---|---:|---:|---:|---:|
| Vorher 1.9.5, Lauf 1 | 16.7 | 41.6 | 0.914 | 0 |
| Vorher 1.9.5, Lauf 2 | 8.4 | 25.0 | 0.725 | 0 |
| Final 1.9.6 mit Hintergrundeffekt, Lauf 1 | 8.4 | 25.1 | 0.877 | 0 |
| Final 1.9.6 mit Hintergrundeffekt, Lauf 2 | 8.4 | 50.0 | 0.783 | 1 |

Plugins: jeweils Öffnen, gleiche Suchtexte mit/ohne Treffer, Löschen und Scrollen bis zum letzten Eintrag, dann Schließen. Gleiche 13 Plugins. Die Probe enthält Automationsarbeit, feste Wartezeiten und im ersten Lauf einen Screenshot; die protokollierte Gesamt-Öffnungszeit ist daher keine reine App-Latenz.

| Menü-Probe | p95 rAF ms | Maximum ms | Long Tasks, Dauer ms |
|---|---:|---:|---|
| Vorher, Lauf 1 | 16.6 | 183.4 | 102 |
| Vorher, Lauf 2 | 16.7 | 75.0 | 71 |
| Final, Lauf 1 | 8.4 | 66.6 | 53 |
| Final, Lauf 2 | 8.5 | 66.7 | 73 |

**Kein Leistungsgewinn behauptet.** Vorher Thermalstatus 1/Skin 36,8 °C, final nach Abkühlpause Status 0/33,1 °C. Zwischenstände erreichten Status 2/39,2 °C und eine Menüspitze von 225 ms. Die Bedingungen sind hinsichtlich Daten, Viewport und Ablauf vergleichbar, thermisch jedoch nicht identisch. Im finalen zweiten Scrolllauf trat ein 51-ms-Long-Task auf; kein Beweis allgemeiner Regressionsfreiheit. Keine Akku-/GPU-/Langzeitmessung. Der statische Hintergrund erzeugt keine fortlaufende Animation oder JavaScript-Arbeit; sein Energiebedarf wurde nicht separat gemessen.

Erste Nachher-Proben enthielten erst 8 nachgeladene Karten und wurden nicht als gleichwertiger Vergleich verwendet. Rohdaten sämtlicher Läufe bleiben lokal erhalten (`after-*`, `after-matched-*`, `final-effect-*`); keine Auswahl nur günstiger Messwerte.

## Datenerhalt und Artefakt

Reguläres Paket datenerhaltend mit `adb install -r` aktualisiert. Keine Deinstallation, kein `pm clear`, Daten- oder Navigationsreset. Home-Konfiguration, fünf Navigationswerte, 336 Listenwerte (Fortschritt/Status/Bewertung), acht Wiedergabeeinträge (Serie/Folge/Dauer unverändert; sieben Zeitmarker identisch) sowie 125 Offline-Dateien per Dateiliste/Größe/SHA-256 erhalten. Original-Pins wiederhergestellt und erneut geladen. Der Zeitmarker von 209983/Folge 11 wurde während der Arbeitspause am 19.10. um 08:44:03 Uhr MESZ von 1,337446 auf 5,555688 Sekunden fortgeschrieben, nach dem ersten erfolgreichen Datenabgleich um 07:57 Uhr und vor dem finalen Hintergrundeffekt-Build. Der neuere Wert bleibt erhalten; kein Rücksetzen auf den früheren Audit-Snapshot. Details in `continuity-diff.json` und `prior-retention-proof.json`.

- Version **1.9.6**, Versionscode **31031**, Paket **com.seanime.app.local**.
- APK: `D:\Seanime-Build\home-plugins-evidence-1.9.6\Seanime-Mobile-1.9.6.apk`.
- Gebaute und vom Gerät zurückgelesene installierte APK SHA-256: `58bfa55cb291f8d9e28d81f1fa50f61ed50ab5c0eccff9d0a863cfa99a39d06b`.
- `build-proof.json` enthält Bundlemanifest und native Hashes; `build-retention-proof.json` enthält Installations-/Datenabgleich. `publication-proof.json` hält finalen Commit, `origin/main`, Arbeitsbaum und Artefakthash nach Push fest. Diese lokalen Nachweise enthalten keine Signiergeheimnisse.

## Aufnahmen

Unter `D:\Seanime-Build\home-plugins-evidence-1.9.6`:

- `before-home.png` / `final-home.png`: Home vorher/nachher, final einschließlich statischem Hintergrundeffekt.
- `before-plugins.png` / `final-plugins.png`: Auswahl vorher/nachher.
- `final-interaction.mp4`: 25 Sekunden Bedienung, Suche, Scrollen, Schließen/Wiederöffnen und ungefährliches Episodes History.
- `plugins-keyboard.png`, `plugins-last.png`, `home-320-200.png`, `plugins-320-200.png`, `controlled-no-images-home.png`: Grenzfälle und Nachweise.

Bekannte Grenze: Die unveränderte untere Navigation kann bei großer Schrift Beschriftungen kürzen. Externe Plugin-/Provider-Verfügbarkeit wird durch diese UI-Abnahme nicht garantiert.
