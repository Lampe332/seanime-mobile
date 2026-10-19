# Android Home — Prüfstand 19.10.2026

**Geräteabnahme abgeschlossen:** Das finale immersive Layout wurde nach Entsperren auf dem Samsung geprüft, mit echten Inhalten getestet, gestresst und erneut gemessen. Artefakt und Daten wurden verglichen; der Commit wird ausschließlich nach privatem `origin/main` übertragen.

## Identität und Umfang

- Repository: `D:\Seanime-Build\seanime-mobile-dev-setup-20261018-08a6462d`, Branch `main`.
- Ausgangscommit: `d50c3223dadeb824cc6ba068f2f637345c60472d`, sauberer Arbeitsbaum vor Beginn.
- `origin`: privates `https://github.com/Lampe332/seanime-mobile-dev.git`; Privatstatus mit GitHub CLI bestätigt.
- `upstream`: `https://github.com/Lampe332/seanime-mobile.git`. Keine Änderungen dorthin übertragen.
- Reguläre App: `com.seanime.app.local`, Samsung SM-S908B, ADB `R3CT60PD7YA`.
- Ausgangsversion am Gerät: 1.9.3 / 31028. Neu gebaut und mit `adb install -r` installiert: 1.9.4 / 31029.
- Keine Deinstallation, kein `pm clear`, kein Daten-/Navigationsreset, kein Tag/Release.
- Native Navigation, Menü, Updater, Player und Backendquellen unverändert. Gemeinsame React-Komponenten haben Home-Optionen mit unveränderten Standardwerten.

## Implementierung

- Kompakter Home-Kopf mit vorhandenem Anime-Bild als ruhigem Hintergrund hinter Titel/Aktionen, weich in den Inhalt ausgeblendet; kein fixer/parallaxer Scroll-Hintergrund, kein Blur.
- Native horizontale Fortsetzungsreihe ohne automatisches Weiterschalten. Serienname, Folge, Lauf-/Restzeit und sichtbares Fortsetzen; separate Seriendetails ohne verschachtelte Klickziele.
- Bestehender `usePlayNext`-Pfad, Offline-/Override-Routen und bestehende Kontinuitätsberechnung erhalten.
- Beschriftete Home-Aktionen, Genre-Schaltflächen, Ungesehen-Filter und kompakte Bibliothekskarten. Dub-Plugin-Status auf Home lesbar beschriftet.
- Vorhandene Abschnittsauswahl, Optionen und Reihenfolge auf dem Handy bedienbar; vorhandene Speicherung verwendet.
- Home-eigene Lade-/Leer-/Retry-Zustände, Bildfehlerbehandlung, Umbruch bei großer Schrift und reduzierte Bewegung.
- Anpassungsdialog erhält die bereits abgefragten Home-Einstellungen vom HomeScreen; keine zweite Abfrage beim späteren Mounten.

## Nachgewiesene Performancebefunde

Messskripte und Rohdaten liegen ausschließlich lokal unter `D:\Seanime-Build\home-evidence-1.9.4`.

Samsung-Ausgangsprobe: 384 × 823 CSS-Pixel, zwei Fortsetzungsfolgen (209983/11 und 21087/8), drei Anime-Karten. Sechs ADB-Swipes bei 1440 × 3088 Pixeln: abwechselnd `(720,2300) → (720,850)` und zurück, 600 ms, 400 ms Pause. JavaScript-`requestAnimationFrame`-Abstände und CDP Performance-Metriken; Long-Task-/Layout-Shift-Beobachter.

| Probe | p95 Frame-Abstand | Skriptzeit | Style-Neuberechnungen |
|---|---:|---:|---:|
| Ausgang warm 1 | 16,7 ms | 1,607 s | 762 |
| Ausgang warm 2 | 16,6 ms | 1,686 s | 634 |
| Ausgang, nur Header-Scroll-Abonnement vorübergehend pausiert | 8,4 ms | 0,641 s | 301 |
| Erstes kompaktes Redesign, warm 1 | 8,4 ms | 0,295 s | 8 |
| Erstes kompaktes Redesign, warm 2 | 8,4 ms | 0,328 s | 8 |
| Finales immersives Home, warm 1 | 8,4 ms | 0,274 s | 8 |
| Finales immersives Home, warm 2 | 8,4 ms | 0,270 s | 8 |
| Ausgang, Cache deaktiviert | 16,7 ms | siehe Rohdaten | siehe Rohdaten |
| Final, Cache deaktiviert | 8,4 ms | 0,301 s | 9 |

- CPU-Profil und isolierte A/B-Probe belegen Arbeit durch `LibraryHeader`/`useWindowScroll` und die daraus folgenden Animations-/DOM-Änderungen. Das Home verwendet diesen Header auf Mobile nicht mehr. Die anderen Seiten behalten ihn.
- Cache-deaktivierte Reloads wurden zusätzlich getrennt erfasst (`before-cold.json`, `after-cold.json`). Das ist kein Beweis für einen vollständig kalten Bilddecoder-/GPU-Cache.
- Finale Messungen: `final-warm-1.json`, `final-warm-2.json`, `final-cold.json`. Für dieselbe ursprüngliche Zwei-Abschnitt-Anordnung wurde ausschließlich die GET-Antwort für Home-Einstellungen vorübergehend mit `{data:null}` beantwortet. Echte zwei Fortsetzungsfolgen und drei Anime-Karten, gleiche Swipe-Sequenz und 384×823. Die gespeicherten vier Abschnitte wurden nicht überschrieben und nach Entfernen der Antwortkontrolle wieder geladen.
- Finale warme Proben: 6,829 / 6,709 Sekunden, p99 8,5 / 8,4 ms, Maximum jeweils 16,7 ms, keine Abstände über 25 ms, keine beobachteten Long Tasks, CLS 0. Cache-deaktivierter Lauf: 6,865 Sekunden, p95 8,4 ms, Maximum 16,7 ms, CLS 0. Ausgang warm: Maximum 66,7 / 33,3 ms. Keine statistische Aussage für alle Geräte/Inhalte aus drei kurzen Läufen.
- rAF-Abstände sind ein reproduzierbarer Main-Thread-Indikator, kein vollständiger Nachweis der tatsächlich präsentierten GPU-Frames.
- Unabhängiger Anfragenbefund im Stresstest: zehn volle Home-Reloads lösten zunächst 20 Home-Einstellungsabfragen aus. Nach Übergabe der geladenen Daten an den Dialog: genau 10 Home-Abfragen und 10 Bibliotheksabfragen. Kein globaler Cache-/Backend-Umbau.

## Ausgeführte Prüfungen

- TypeScript und Produktionsbuild erfolgreich; `backend/web` vollständig aus dem Produktionsbundle ersetzt.
- Go-Backends für `arm64-v8a` und `armeabi-v7a` neu gebaut und in die APK eingebettet.
- Frontend: 17 Testdateien / 101 Tests erfolgreich, davon fünf gezielte Fortsetzungs-Routingfälle.
- Android: 13 Unit-Tests; abschließend mit `--rerun-tasks` tatsächlich neu ausgeführt (24 Gradle-Tasks ausgeführt).
- Release-Lint erfolgreich, bestehende Warnungen im Report; Signatur und 16-KiB-Ausrichtung erfolgreich geprüft.
- Bestehende Tests für Updater-Menü, Navigation und Navigationsmigration erfolgreich.
- `tests/mobile_home_device.py`: 32 erfolgreiche Geräte-/WebView-Prüfungen am finalen immersiven Layout einschließlich geprüfter Wiederherstellung der Wiedergabefelder. Unter anderem echte Provider-Anfrage 209983/Folge 11, Seriendetails, Poster, Filter, Optionen, Hinzufügen/Entfernen, Reihenfolge, Android-Zurück, Laden/Fehler/Retry, fehlendes Bild, 320 Pixel / 200 % Root-Schrift, Deutsch und letzte Kartenzeile. Echte Android-Systemschrift 2,0 zusätzlich geprüft und wieder auf 1,0 gestellt.
- Der Gerätetest blockiert WebView-Kontinuitätsanfragen während der Probewiedergabe. Ein dennoch außerhalb dieser Sperre gespeicherter kurzer Testmarker wurde erkannt und auf die ursprünglichen 1,451407 Sekunden zurückgesetzt. Der Test sichert jetzt zusätzlich die ursprünglichen Wiedergabefelder und stellt ausschließlich kurze Marker derselben getesteten Folge bei unveränderter Dauer wieder her; bei anderen Änderungen bricht er ab. Zeitstempel sind keine bytegleichen Vergleichswerte mehr.
- `tests/mobile_home_stress.py`: **11 Prüfungen erfolgreich**, mit Produktionsbundle, read-only weitergeleiteten Daten und isoliertem Headless-Browser. Drei Displaygrößen (320×740, 384×823, 740×360), schnelle vertikale/horizontale Wechsel, 20 Dialogzyklen, 30 Genre-Umschaltungen, zehn vollständige Home-Reloads sowie 96 eindeutig markierte kontrollierte Anime-Einträge. Originalinhalte anschließend wiederhergestellt, keine unbehandelten JavaScript-Fehler.
- Finaler Samsung-Stress: zehn Anpassungsdialog-Zyklen, zwölf schnelle physische Wischgesten und fünf vollständige Wechsel Home → Discover → Home; keine unbehandelten JavaScript-Fehler, gespeicherte vier Abschnitte unverändert. `final-device-stress.json`.
- Finale echte Android-Systemschrift 2,0 sichtbar geprüft und auf 1,0 zurückgestellt; Home bleibt bedienbar. Die unveränderte untere Navigation kürzt bei großer Schrift bestehend Beschriftungen ab.
- Diese Headless-Stressprüfung ist ausdrücklich **keine Samsung-Frame-Messung**. Bestehende große Raster behalten ihre vorhandene Lazy-Grid-Implementierung.

## Datenerhalt und Artefakt

- Alle 336 AniList-Einträge: Fortschritt, Status und Bewertung unverändert.
- 125 Offline-Dateien, insgesamt 441.743.449 Bytes: Dateiliste und SHA-256 vor/nach den Updates identisch.
- Fünf gespeicherte Navigationswerte (Reihenfolge, Belegung, versteckte/floating Einträge) nach finalem Update mit dem Ausgangssnapshot identisch.
- Zuletzt vorliegende gespeicherte Home-Konfiguration: vier Abschnitte. Diese aktuelle Konfiguration wurde beim letzten Installationsschritt erhalten; nicht pauschal auf den anfänglichen API-Default zurücksetzen. Lokale Vergleichssnapshots: `home-config-current.json`, `home-config-final-after-install.json`.
- APK: `D:\Seanime-Build\home-evidence-1.9.4\Seanime-Mobile-1.9.4.apk`.
- SHA-256: `9b416547c8d93a510a0b2487940194551d7ef9a0282306a31c06f88f111ac62b`.
- Aus der regulären Installation zurückgelesen: `installed-final.apk`, SHA-256 identisch.
- Signierzertifikat SHA-256: `a5da25c722fd776fe92935544801f2661d0690b0afd73d69e4cba58f1f23a7d4`, zur vorherigen regulären Installation identisch. Geheimnisse wurden nur lokal verwendet.

## Aufnahmen und Abschlussnachweis

Alle Aufnahmen liegen lokal außerhalb des Repositorys unter `D:\Seanime-Build\home-evidence-1.9.4`:

- `before.png`, `before-scroll.mp4`: Samsung-Ausgangsversion 1.9.3.
- `immersive-after.png`: finales Samsung-Home mit echten Inhalten und Originalkonfiguration.
- `final-home-interaction.mp4`: 35 Sekunden Samsung-Dialogbedienung und schnelle Scrollgesten.
- `controlled-empty.png`, `controlled-error.png`, `controlled-loading.png`, `controlled-missing-image.png`: klar bezeichnete temporäre Darstellungsproben, anschließend entfernt.
- `small-200-percent.png`, `home-german.png`, `home-bottom.png`, `final-system-font-200.png`: finale Grenzfälle auf dem Samsung.
- Produktionsbundle und `backend/web`: alle 154 Dateien identisch; beide nativen APK-Einträge identisch mit den gebauten Quelldateien. Regulär installierte APK abschließend erneut zurückgelesen (`installed-final-verified.apk`): SHA-256 identisch zum gebauten Artefakt.
- Temporäre Font-/Bewegungs-/Größen-/Sprachproben zurückgestellt; USB-Wachhalten auf ursprünglichen Wert 0 zurückgestellt; normale Release-App nach Audit neu gestartet.
- Kein vollständiger GPU-/Thermal-/Langzeitakku-Benchmark und kein reales Samsung mit 96 Bibliothekskarten verfügbar. Große Datenmenge ausschließlich isoliert geprüft. Keine Aussage über externe Provider-Verfügbarkeit; richtige Fortsetzungsanfrage wurde geprüft.
- Lokaler Commit und Remote-HEAD werden nach dem Push in `publication-proof.json` im lokalen Evidenzordner festgehalten. Kein neuer Tag oder GitHub Release.
