# Home-Nachbesserung 1.9.5 — 19.10.2026

## Umfang und Umsetzung

Vier vom Nutzer anhand von Screenshots gemeldete Stellen, ausschließlich Android Home und zugehöriger Anpassungsdialog:

1. Anpassungsdialog: dunkler violetter Verlauf, eingerückte abgerundete Fläche, klare Bibliotheksauswahl mit Häkchen, Bereichssymbole und Positionsnummern, kompakte beschriftete Aktionen. Eine bestehende Android-Regel erzwang Vollbreite und 3,5 rem oberen Abstand; die Home-Klasse überschreibt diese Eigenschaften gezielt. Andere Dialoge unverändert.
2. Fortsetzungskarten: vorhandenes Szenenbild als durchgehende Fläche mit dunklem Verlauf, lesbarer Titel/Folge/Laufzeit und klarer Fortsetzen-Fläche. Seriendetails bleiben separates Ziel, Kontextfunktionen und bestehender Fortsetzungspfad erhalten.
3. Reihenpfeile: Der globale Aired-Recently-Carousel legte seine Schaltflächen mit `top:-3.5rem` über den Container. Der umschließende Home-Bereich clippt diese Fläche. Home positioniert die Pfeile nun innerhalb der Abschnittsüberschrift, reserviert Platz für lange Überschriften und verwendet 44-Pixel-Touchflächen. Gemeinsame Carousel- und Schedule-Quellen unverändert.
4. Hintergrund: Das 1900×400-Banner wurde zuvor in eine 384×403-Fläche gezoomt. Nun flacherer Bildbereich, mittiger Bildausschnitt, eigener weicher Bild-Fade und ruhiger violetter Übergang. Kein Scroll-Abonnement, fixer Hintergrund, Blur oder neue Animation.

Ausgang: sauberer Branch `main`, Commit `4e289961cd30200c2113852d0d2acaf0abe91659`, regulär installierte Version 1.9.4/31029. Remotes geprüft: privates `origin` ist `Lampe332/seanime-mobile-dev`, `upstream` ist `Lampe332/seanime-mobile`. Keine Übertragung an Upstream, kein Tag/Release.

## Verifikation

- TypeScript und Produktionsbuild erfolgreich; alle 154 Dateien aus `out` identisch in `backend/web`.
- Beide eingebetteten Go-Backends neu gebaut, ARM64 und ARMv7 stimmen mit den APK-Einträgen überein.
- Frontend: 17 Dateien / 101 Tests bestanden.
- Android: 13 Unit-Tests mit `--rerun-tasks` neu ausgeführt, 24 Gradle-Tasks tatsächlich ausgeführt; Release-Build und Release-Lint erfolgreich.
- Signatur gültig und mit Vorgängerzertifikat identisch; 16-KiB-Ausrichtung geprüft.
- Bestehende Updater-Menü-, Navigations- und Navigationsmigrationstests erfolgreich.
- Samsung SM-S908B, `R3CT60PD7YA`: **36 Geräteprüfungen bestanden**. Richtige Fortsetzungsserie 209983/Folge 11 einschließlich Provider-Anfrage, getrennte Seriendetails und Posterziele, Filter, persistierte Reihenfolge, Optionen, Abschnitt hinzufügen/entfernen, Android-Zurück, Lade-/Leer-/Fehler-/Retry-/Bildfehlerzustände, Deutsch, 320 Pixel/200 % Schrift, reduzierte Bewegung, freie letzte Inhaltszeile. Zusätzliche Regression: Pfeile oben/seitlich erreichbar und tatsächliche Reihenbewegung nach Klick. Dialog und Bereichsaktionen bei 320 Pixel/200 % Schrift ohne horizontalen Überlauf.
- Der erste Pfeiltest verwendete die rechteckigen Ecken einer runden Schaltfläche als Trefferpunkte. Diese liegen außerhalb der sichtbaren Kreisfläche. Der korrigierte Test prüft die oberen/seitlichen Randmittelpunkte und die tatsächliche Aktion; keine Produktänderung auf Basis dieses Testfehlers.
- Physischer Samsung-Stress: zehn Dialogzyklen, vier Pfeilklicks, zwölf schnelle Wischgesten, fünf volle Home→Discover→Home-Wechsel. Keine unbehandelten JavaScript-Fehler.
- Isolierter Browser-Stress: 11 Prüfungen erfolgreich, drei Anzeigegrößen, 20 Dialogzyklen, 30 Genre-Umschaltungen, zehn Home-Reloads, 96 klar markierte kontrollierte Einträge. Originaldaten anschließend wiederhergestellt. Kein Benchmark eines Samsung mit 96 echten Einträgen.

## Scrollmessung und Grenzen

Vorher 1.9.4, nachher 1.9.5: aktuelle reale Home-Konfiguration mit vier Abschnitten, zwei Fortsetzungsfolgen, insgesamt 41 Karten im DOM; keine Änderung gespeicherter Konfiguration für diese Messungen. 384×823 CSS-Pixel, sechs identische physische ADB-Swipes (600 ms, 400 ms Pause). Main-Thread-rAF und CDP-Skriptzeit; keine GPU-Präsentationsmessung.

| Probe | p95 rAF ms | Maximum ms | Skriptzeit s | Long Tasks |
|---|---:|---:|---:|---:|
| before-warm | 8.4 | 25.1 | 0.916 | 0 |
| before-warm-2 | 8.4 | 25.1 | 0.824 | 0 |
| after-warm-1 | 16.7 | 25.1 | 1.036 | 0 |
| after-warm-2 | 16.6 | 33.4 | 0.982 | 0 |
| before-cold | 16.6 | 108.2 | 1.147 | 1 |
| after-cold | 16.7 | 175.1 | 1.270 | 2 |
| paired-old-style-1 | 8.4 | 16.7 | 0.829 | 0 |
| paired-new-style-1 | 8.5 | 33.3 | 0.948 | 0 |
| paired-old-style-2 | 8.5 | 33.4 | 0.991 | 0 |
| paired-new-style-2 | 8.5 | 33.3 | 0.993 | 0 |

Die ersten finalen warmen Läufe sind schwächer als die Ausgangsläufe. Bei der anschließenden Untersuchung meldete das Gerät **Thermalstatus 2** (Skin 41,5 °C); für die früheren Ausgangsläufe wurde kein Thermalstatus erfasst. Daraus lässt sich weder ein allgemeiner Leistungsgewinn noch eine eindeutig vom neuen Layout verursachte Regression ableiten.

Zusätzlich wurde auf derselben installierten APK der vorherige Home-Stil ausschließlich temporär im DOM wiederhergestellt und abwechselnd gegen den finalen Stil gemessen. Die alten Regeln wurden nach jeder Probe entfernt. Dies ist eine Stil-Isolation, kein vollständiger APK-Vergleich. Die Tabelle enthält alle Läufe, keine Auswahl nur günstiger Werte. Die warmen Paare liegen nahe beieinander; die wenigen Proben beweisen keine statistische Gleichwertigkeit. Kein neuer nachgewiesener Main-Thread-Engpass durch diese vier Änderungen; kein spekulativer Cache-/Backend-/Memoizing-Umbau.

Cache-deaktivierte Reloads separat: Netzwerk, Dekodierung und zeitabhängige globale Inhalte machen diese Proben variabler. Der finale Lauf enthält lange Tasks und höhere Spitzen. Ein vollständig kalter Bilddecoder-/GPU-Cache ist dadurch nicht garantiert. CLS war in allen oben aufgeführten Läufen 0. Die Aufnahme allein gilt nicht als Leistungsnachweis.

## Datenerhalt und Auslieferung

- Reguläres Paket `com.seanime.app.local` mit `adb install -r` datenerhaltend aktualisiert, keine Deinstallation, kein `pm clear`, kein Daten-/Navigationsreset.
- Gespeicherte vier Home-Abschnitte, fünf Navigationswerte und 336 Anime-Listenwerte (Fortschritt/Status/Bewertung) identisch zum Anfang dieses Nachbesserungsauftrags.
- Acht Kontinuitätseinträge in Wiedergabefeldern identisch; die Gerätesuite sperrt WebView-Schreibanfragen und stellt ausschließlich kurze native Testmarker derselben Folge bei unveränderter Dauer gezielt wieder her. Zeitstempel nicht als bytegleich behauptet.
- 125 Offline-Dateien per Dateiliste/Größe/SHA-256 identisch.
- Temporäre Darstellungsdaten/Styles entfernt, Sprache/Viewport/Bewegung zurückgestellt, echte Android-Systemschrift 2,0 zusätzlich aufgenommen und wieder auf 1,0 gestellt. USB-Wachhalten auf ursprünglichen Wert 0 zurückgestellt, normale Release-App nach Audit gestartet.
- APK: `D:\Seanime-Build\home-evidence-1.9.5\Seanime-Mobile-1.9.5.apk`, Version **1.9.5**, Code **31030**.
- Gebaute und abschließend zurückgelesene installierte APK SHA-256: `fa8cf17451cd386570cda954a6c5a47e06448c2e24410b3c66f639b78f644c1b`.
- `build-retention-proof.json` enthält Bundle-, native Binär-, APK-, Test- und Datenabgleiche. Commit und Remote-Identität nach Push in lokalem `publication-proof.json`.

## Aufnahmen

Lokal außerhalb des Repositorys unter `D:\Seanime-Build\home-evidence-1.9.5`:

- `final-home.png`: endgültiger Bildausschnitt und Fortsetzungskarte auf Samsung.
- `final-settings.png`: endgültiger Anpassungsdialog.
- `final-arrows.png`: vollständige Reihenpfeile.
- `final-interaction.mp4`: 35 Sekunden Bedienung und Scrollen.
- `small-customize-200-percent.png`, `small-200-percent.png`, `system-font-200.png`: Schrift-/Displaygrenzen.
- Vom Nutzer gelieferte vier Screenshots bilden die Vorher-Referenz; temporäre `preview-*`-Aufnahmen sind keine finalen APK-Aufnahmen.

Bekannte Grenze außerhalb des Auftrags: Die unveränderte untere Navigation kürzt bei Android-Systemschrift 200 % weiterhin ihre Beschriftungen ab. Kein vollständiger thermisch kontrollierter Langzeit-/GPU-/Akku-Benchmark und keine Garantie für externe Provider-Verfügbarkeit.
