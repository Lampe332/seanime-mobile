# Eigener Kern – Ziel, Regeln, Stand

**Für wen:** jeden, der am eigenen Kern (`native/src/core/`) baut oder ihn prüft.
**Stand:** 13.11.2026, Stufe 0 gebaut auf Branch `eigener-kern` (ab `d59d183`, nicht veröffentlicht).
Gesamtplan mit allen Stufen, Risiken und Entscheidungen (für Nick): `<home>\Desktop\aktuelle projekte\md fiels\Seanime_Eigener_Kern_Plan.md`.
Karte des nativen Umbaus bis 3.0: `docs/NATIVE-UMBAU.md`.

---

## 1. Ziel

Heute besteht die App aus zwei Programmen: der Oberfläche (`native/`, TypeScript) und Seanimes Go-Server (`backend/`, eigener Prozess, HTTP + WebSocket auf `127.0.0.1`).

Ziel ist **eine App**: Alles, was der Server heute tut, macht eigener, neu geschriebener Code in `native/src/core/` (TypeScript, dazu wenig Kotlin, später Swift). Aussehen, Funktionen und Nutzerdaten bleiben. Am Ende wird `backend/` gelöscht.

Der Weg ist **Ablösen statt Umwerfen**: Bereich für Bereich wandert hinter einem Schalter in den Kern. Der Server bleibt Rückfall, bis er leer ist.

## 2. Regeln

1. **Vorlage ist Verhalten, nicht Quelltext.** Ein Bereich wird nach drei Dingen geschrieben: aufgezeichnete Antworten des Servers (§6), App-Code in `native/` und öffentliche Doku (AniList, HLS, BitTorrent, die `.d.ts`-Dateien des Erweiterungs-Vertrags).
2. **Wer am Kern arbeitet, öffnet `backend/` dafür nicht.** Einzige Ausnahme: die öffentlichen Vertrags-Beschreibungen der Erweiterungen (`backend/internal/extension_repo/goja_*_test/*.d.ts`, `goja_plugin_types/*.d.ts`).
3. **Nie Go nach TypeScript übersetzen**, auch nicht stückweise.
4. **Herkunfts-Zeile:** Jede Datei in `native/src/core/` beginnt mit `// geschrieben nach: …`. Ein Test prüft das (`core.test.ts`).
5. **Der Kern kennt keine Oberfläche:** kein React, kein Import von außerhalb des Ordners. Einzige Ausnahme seit Phase 1b: das Paket `drizzle-orm` (reines TypeScript, beschreibt die eigenen Tabellen, §4a). Er läuft in den Logik-Tests ohne Gerät. Auch das prüft `core.test.ts`. Zweite Ausnahme seit Phase 3a, nur für eine Datei: `extensions/sandbox/node-engine.ts` darf `quickjs-emscripten` einbinden (Unterbau des Sandkastens für die Tests); der Test prüft zugleich, dass keine andere Datei des Kerns diese Datei einbindet, sie also nie in die App gerät.
6. **Die Oberfläche kennt nur, was `native/src/core/index.ts` herausgibt.**
7. **Eigene Namen, eigener Aufbau, eigenes Datenbank-Schema.**
8. **Schalter bleiben bis zum Schluss.** Jeder Bereich kann einzeln zurück auf den Server.
9. Jede Stufe: erst hinter dem Schalter in der Test-App, dann Vergleich mit den Aufzeichnungen, dann Messung (§5). Wird ein Messwert schlechter, geht die Stufe nicht raus.
10. Lizenz und Nennung von Seanime bleiben, solange Seanime-Code im Repo oder in der APK steckt.

## 3. Der Schalter

Fast alle Aufrufe der Oberfläche laufen durch `buildSeaQuery` (`native/src/api/client/requests.ts`). Dort fragt die App zuerst `coreRequestFor` (`native/src/api/client/core-switch.ts`):

- Hat der Kern Code für diese Schnittstelle (**Register** `native/src/core/registry.ts`)? Dann antwortet der Kern direkt, ohne HTTP.
- Sonst scheitert die Anfrage sofort mit 503 „needs the server, the app runs without it“ (seit 8a-1 kein Server mehr; seit 8b-3 gibt es keine Bereichs-Schalter und keinen Weg „mit Server“ mehr, §4s).

Die 176 Hooks in `native/src/api/hooks/` bleiben, wie sie sind.

| Was | Wo |
|---|---|
| Bereiche | `CORE_AREAS` in `switches.ts`, seit 8b-3 nur noch Namen für Register und Log (`extensions`, `streams`, `settings`, `anilist`, `manga`, `offline`, `library`, `playback`, `torrent`, `debrid`, `cast`) |
| Standard | seit 8b-3 kein Schalter mehr: jeder Bereich ist immer der des Kerns (`isCoreAreaOn`, `isServerOff`, `setCoreArea`, MMKV `seanime-core-areas` entfernt) |
| Register | `CORE_ROUTES` in `registry.ts`: Bereich, Methode, Adresse wie in `api/generated/endpoints.ts` (mit `{id}`-Teilen), Antwort-Funktion |
| Fehler | Der Kern wirft `CoreError` (Status + Text). `core-switch.ts` macht daraus denselben axios-Fehler mit `{ "error": "…" }`, den die Hooks vom Server kennen |
| Umgebung | Netz (`fetch`), gesicherter Speicher (`secret`, seit §4d), Datenbank (`database`) und Uhr (`now`) werden dem Kern hineingereicht (die Rückfrage beim Server `server`/`serverListening` ist seit 8b-3 weg); seit §4f dazu `onlyAccount` (das eine Konto, das der Kern ändern darf) und `unasked` (Arbeit, die keine Anfrage ausgelöst hat: das spätere Senden der Warteschlange). Tests geben ihm aufgezeichnete Antworten und eine SQLite im Arbeitsspeicher |
| Einschalten | entfällt (Link `core?area=` seit 8b-1 weg, Schalter seit 8b-3). Weitere Links, nur Test- und scratch-App: `core?move=again` (§4c), `core?write-account=<AniList-Nummer>` und `core?anilist=down` / `up` (§4f) |
| Log | `[Core] info … answered by the core, no HTTP (… ms)` je Antwort; `[Core] info areas answered by the core: …` beim Umschalten |

Am Gerät:

```
adb shell am start --user <nutzer> -a android.intent.action.VIEW -d 'seanime-native://core?area=extensions&on=1' com.seanime.app.native
```

**Eine Schnittstelle umziehen:** aufzeichnen (§6) → Funktion in `native/src/core/<bereich>/` schreiben → in `CORE_ROUTES` eintragen → Test gegen die Aufzeichnung → in der Test-App einschalten und vergleichen.

### Probe-Schnittstelle: Manifest einer Erweiterung lesen

`POST /api/v1/extensions/external/fetch` → `native/src/core/extensions/fetch-manifest.ts`.

Warum diese:

- Sie liest nur. Installiert wird erst mit einer anderen Schnittstelle, die beim Server bleibt.
- Sie braucht nichts vom Server: nur zwei öffentliche Abrufe (Manifest, Code der Erweiterung). Kein Konto, kein Token, keine Datenbank.
- Die Oberfläche benutzt sie mit einem Tipp (Erweiterung → „Check for updates“), also am Gerät zeigbar.
- Sie ist das erste Stück des Bereichs Erweiterungen (Stufe 3).

Verworfen: die AniList-Suche und alle anderen öffentlichen AniList-Abrufe. Ihre Antworten enthalten `title.userPreferred`, und das hängt vom angemeldeten Konto ab (aufgezeichnet: englische Titel statt Romaji). Ohne das AniList-Token, das heute nur der Server hat, wäre die Antwort eine andere. Das gehört in Stufe 2.

Wie sie geschrieben wurde: Der Server bekam 98 Manifeste vorgesetzt, gute und kaputte (`record-server.mjs manifest-cases`). Aus seinen Antworten stehen die Regeln im Code: Pflichtfelder, Reihenfolge der Prüfungen, welche Felder leer wegfallen, Wortlaut der Fehler. Die 98 Fälle liegen als Testdaten in `fetch-manifest.recorded.json`; der Test spielt alle nach (44 Antworten Feld für Feld gleich, 54 Ablehnungen gleich).

Zwei bewusste Abweichungen im Wortlaut: Wo der Server-Text aus seiner Laufzeit stammt (Netz- und JSON-Fehler), bleibt nur der feste Anfang gleich („failed to fetch extension manifest, …“), der Rest ist eigener Text. Und nach 30 s ohne Antwort gibt der Kern auf; die Grenze des Servers zeigen die Aufzeichnungen nicht.

Am Gerät (S22, 13.11. 09:40–09:41): Schalter aus → Server-Log `POST 200 /api/v1/extensions/external/fetch` (640 ms). Schalter an → App-Log `POST /api/v1/extensions/external/fetch answered by the core, no HTTP (135 ms)`, keine Zeile im Server-Log, gleiche Meldung „This extension is up to date“.

## 4. Stufen

| Stufe | Inhalt | Fertig, wenn | Stand |
|---|---|---|---|
| **0 Messen + Netz** | Messwerte, Aufzeichnung, Schalter, zwei Proben, automatische Prüfung | Zahlen liegen vor, Schalter leitet eine Probe-Schnittstelle um | ✅ gebaut 13.11.2026 (dieses Dokument), nicht veröffentlicht |
| **1 Fundament** | Datenbank, Einstellungen, Hintergrund-Faden, Ereignis-Verteiler, Daten-Umzug | App zeigt Einstellungen ohne Server, Umzug an 3 Datenkopien fehlerfrei | ✅ abgeschlossen 13.11.2026 (1e: Test-App auf beiden Geräten aktualisiert, Messwerte §5 „nach Stufe 1“, alle Kern-Bereiche aus), nicht veröffentlicht. 1a ✅ (scratch, Aufzeichnung schreibend, DB-Kopien), 1c ✅ (Ereignis-Verteiler, Faden-Wächter, Datenbank auf eigenem Faden, §4b), 1b ✅ (Datenbank + Bereich `settings`, §4a); 1d ✅ (Daten-Umzug, §4c: drei Kopien ohne Abweichung, am Gerät belegt) |
| **2 AniList** | Anmeldung, Listen, Fortschritt mit Warteschlange, Metadaten | Home, Listen, Anime-Seite erscheinen, bevor der Server gestartet ist | ✅ abgeschlossen 13.11.2026 (2d: Test-App auf beiden Geräten aktualisiert, Messwerte §5 „nach Stufe 2“, alle Kern-Bereiche aus; Schreibwege am Gerät §4f), nicht veröffentlicht. 2a ✅ AniList lesen im Kern (11 Schnittstellen, eigener Speicher, §4d); 2c ✅ Start ohne Warten auf den Server (§4e: Home 0,5 s statt 2,3 s, vor `server-ready`); 2b ✅ AniList ändern mit Warteschlange (§4f). Offen daraus: §4g |
| **3 Erweiterungen + Online-Stream** | Sandkasten, Verwaltung, Abspielen | alle Test-Quellen liefern gleiche Ergebnisse wie vorher, Dr. STONE spielt ohne Server | ⏳ (25 Schnittstellen im Kern: Manifest lesen + Verwaltung 3e-1 + 3e-2 + Online-Stream 3f-1). 3f-1 ✅ 13.11.2026: sieben Online-Stream-Schnittstellen im Kern (Bereich `streams`, §4m), eigene Auswahl, Zuordnungen in `core.db` (Schritt 8) mit einmaligem Umzug, Cache; S22 Folgen-Listen und Quellen für `aq-anikoto` und `kaa` bei zwei Anime gleich wie Server, Suche `aq-anikoto` 30 statt 49 (`$scannerUtils` fehlt); Abspielen ohne Server offen (3f-2). 3f-2 ✅ 13.11.2026: Dr. STONE spielt am S22 mit Quelle aus dem Kern direkt in mpv (keine Proxy-, keine Online-Stream-Anfrage beim Server), `$scannerUtils` (aq-anikoto-Suche 49 = Server), Wächter mit Messpunkten, Fehler beim Schließen eines Sandkastens behoben (§4m 3f-2). 3f-3 ✅ 13.11.2026: Downloads im versteckten WebView unterbunden, „needs the user“ als Satz über den Fehler-Weg, Prüf-Links für Installieren und Zuordnung; am Tablet (scratch) Vergleich der fünf Quellen (Suchen, Folgen-Listen, Fehler gleich wie Server), Dr. STONE spielt mit `aq-anikoto` ohne Server, Zuordnung setzen/entfernen/Cache leeren im Kern, Installieren im Vordergrund 1602 ms (§4m 3f-3). 3f-4 ✅ 14.11.2026: Quellen aller Server (AniStar 4/2, AniWorld 2/1 = Server), Wächter vergisst Warten ohne Fortsetzung (2351 ms weg), Dateien der Erweiterungen über den Modul-Faden (Installieren 31,6 → 15,6 ms), S22 `episode-source` beim Abspielen 1150 → 54 ms (§4m 3f-4). **Stufe 3 fertig bis auf:** Kern-Stücke über 8 ms (Übergabe großer `fetch`-Antworten an den Sandkasten bis 99,8 ms, Prüfen eines Manifests bis 18 ms, vor dem ersten `fetch` 15,6 ms, `episode-source` am S22 54,2 ms „after start, until file names“), verschlüsselter Stream nicht verfügbar. 3e-2 ⏳ 13.11.2026: Installieren, Repository, Deinstallieren, Code bearbeiten, Aus/Ein im Kern mit Server-Mitziehen, Listen aus `core.db` ohne Sandkasten (§4l); am Tablet Installieren, Update, Aus mit Rückweg belegt, Rest offen. 3e-1 ✅ 13.11.2026: Erweiterungs-Verwaltung im Kern (§4l), Vorspann-Cache (längstes Stück 7,8 → 4,7 ms), S22 Liste mit Schalter an gleich wie aus. 3d ✅ 13.11.2026: `ChromeDP` über ein verstecktes WebView und Cloudflares automatische Prüfung in `fetch` (§4k), Selbsttest am S22 15 von 15, eigene Erweiterung mit `ChromeDP` und AniStar-Suche am Gerät belegt; interaktive Prüfungen bewusst nicht. 3c ✅ 13.11.2026: mittlere Hilfsfunktionen (`LoadDoc`/`Doc`, `$habari`, `$torrentUtils`, `$goFeed`), Selbsttest am S22 14 von 14, Zeitgeber-Verspätung als App-Arbeit außerhalb des Kerns belegt (§4j). 3b ✅ 13.11.2026: leichte Hilfsfunktionen (`fetch`, `console`, `URL`, `atob`/`btoa`, `Buffer`, `CryptoJS`, `FormData`, `$sleep`, `$store`, Einstellungen) im Sandkasten, Selbsttest am S22 13 von 13, Vorspann 24 ms (§4i). 3a ✅ 13.11.2026: Sandkasten am Gerät belegt (§4h): geteiltes C++-Modul um quickjs-ng 0.18.0, über Nitro angebunden (statt Kotlin um quickjs-kt, das zu Kotlin 2.2.0 der App nicht passt); Selbsttest am S22 12 von 12, längstes Stück im Faden der Oberfläche 1,5 ms; für iOS ungebaut. Nichts in der App benutzt den Sandkasten schon (3e–3f offen) 3e (Verwaltung) am Gerät a–f belegt, Rückweg grün; offen: zwei Kern-Stücke über 8 ms (Code-Ansicht 31 ms, Installieren 22 ms, §4l) |
| **4 Manga + Offline** | Manga, Leser, eigener Download-Dienst | Download läuft bei gesperrtem Bildschirm durch, alte Downloads sichtbar | ⏳ in Arbeit. 4a-1 ✅ 14.11.2026: sechs lesende Manga-Schnittstellen im Kern (Bereich `manga`, §4n), Zuordnungen in `core.db` (Schritt 9) mit einmaligem Umzug; Seitenbilder mit Kopfzeilen laufen weiter über den Bild-Proxy des Servers (offen). Offen: 4a-2 (Vorlieben, Zuordnung setzen/löschen, Cache leeren, Quellen-Auffrischen), 4b/4c (Downloads). **Abnahme 14.11.2026 (4c):** alte Downloads sichtbar: **ja für Folgen** (Tablet, aus alten Dateien gespielt, Rückweg grün), **ja für Manga-Kapitel seit 4c-2** (Tablet, aus alten Dateien gelesen, Rückweg grün, §4o 4c-2); „Download bei gesperrtem Bildschirm“: **teilweise belegt (14.11., Tablet, §4o „Gerätetest gesperrter Bildschirm“)** – lief gesperrt 170 s ohne Abbruch weiter (0 → 40 %), fertig erst nach dem Entsperren von Hand; gesperrt deutlich langsamer (≈ 1,6 gegen ≈ 8 MB/s) → Lauf ohne Eingriff bis `done` offen |
| **5 Wiedergabe-Rest** | Wiedergabe-Verwaltung, Playlists, lokale Ordner | ein normaler Tag braucht keinen Server | ⏳ in Arbeit. 5a-1 14.11.2026: Status ganz vom Kern, Anime-Seite und Folgen-Sammlung im neuen Bereich `library` mit Folgen-Metadaten von ani.zip (§4p); 5a-2 bis 5a-4 Fortschritt, Verlauf, Home, Playlists; 5b-1/5b-2 ✅ lokale Ordner im Kern (Scan, Datei-Änderungen, Dateibaum, leere Ordner, Vorschläge, Scan beim Start; lokale Folge am Tablet per `file://` gespielt, §4p). Offen: 42,2 ms im Scan, kein Ordner-Wächter. 5c-1/5c-2 ✅ ohne Server (Link `core?server=off`, §4p, Messung §5 „Nach Stufe 5“). **Abnahme 14.11.2026: ein normaler Tag ohne Server: ja** (Tablet: Home, Listen, Anime-Seite, Online-Stream, Manga, Downloads, Einstellungen; S22: Home und Anime-Seite lesend; Home 1,1–1,2 s früher). Speicher ohne Server: Tablet −48 MB, S22 −67 MB (5c-3, 3 Läufe; früherer Befund +35 MB richtiggestellt). Beim Server bleibt: Torrent/Debrid (Stufe 6), Nakama, Cast, Plugins, Discord (Stufe 7), filler, `manga/source-refresh`, custom-source |
| **6 Torrent + Debrid** | Torrent-Modul, Suche, Debrid | Torrent-Stream mit Springen funktioniert | ⏳ **6f ✅ 14.11.2026:** Torrent-Client im Kern (Liste, Pause/Fortsetzen, Entfernen, Download-Blatt in den Bibliotheks-Ordner, Neustart aus Resume-Daten, Vordergrund-Dienst beim Laden; S22 belegt, §4q). **6b-3 ✅ 14.11.2026 (§4q):** Torrent-Modul mit TLS (BoringSSL 0.20261105.0, APK +1,61 MiB, 16-KB-Seiten ✅), Start in Zahlen im Log, Torrent über seine `.torrent`-Datei; **echter Torrent-Stream am S22 bis ins Bild in mpv, mit Sprung auf 70 %** (Internet Archive, ohne Seeder über Web-Seeds, vier Range-Zeilen des Ausgangs, nach dem Schließen 0 Reste, 0 Torrent-Anfragen beim Server, AniList unverändert). **Abnahme „Torrent-Stream mit Springen“: am Gerät belegt (ein Torrent).** Offen: Schwarm mit vielen Seedern und Dateiliste von Peers am Gerät, Datei-Wahl in Sammlungen, HTTPS-Web-Seed nicht einzeln belegt. **Gerätetest echter Torrent 14.11.2026 (§4q):** kein Stream zustande gekommen (Auto-Auswahl wählte einen Torrent ohne Peers in 60 s, keine Metadaten); dabei behoben: Player-Schließen beendet den Torrent-Stream, Suche mit mehreren Anbietern; 0 Torrent-Anfragen beim Server, AniList unverändert. Offen: Wiedergabe in mpv über den Ausgang mit Sprung, echter Schwarm. **Abnahme-Stand 14.11.2026 (6c-2):** „Torrent-Stream mit Springen“: **Ausgang mit Sprung belegt** (6b-2: Sprung auf 70 % am S22, 206, SHA-256 gleich, erstes Byte nach 538 ms); **offen bis zur Freigabe:** Wiedergabe in mpv über den Ausgang und ein echter Schwarm (DHT/Tracker). 6b-2 ✅ Torrent-Stream im Kern (Bereich `torrent`); 6c-1 ✅ Suche und Auto-Auswahl; 6c-2 ✅ Debrid im eigenen Bereich `debrid` (vier Anbieter nach öffentlicher Doku, nur unter vitest, kein Konto), Torrent-Client bleibt begründet beim Server (§4q). 6a ✅ 14.11.2026: Vorprüfung (§4q) – libtorrent 2.1.2 (C++) für arm64-v8a mit dem NDK der App gebaut, 2,78 MB, 16-KB-Seiten ✅; Empfehlung: eigenes Nitro-Modul mit libtorrent 2.1, lokaler HTTP-Ausgang mit Range. Offen: TLS, Boost im Bau holen, 6b Modul; 6b-1 ✅ 14.11.2026: natives Torrent-Modul `core-torrent` (libtorrent 2.1.2 hinter Nitro), am S22 per Prüf-Link belegt (§4q); offen 6b-2 (HTTP-Ausgang, Anbindung), 6c |
| **7 Rest** | Nakama, Cast, Plugins-Entscheidung | je Funktion: geht oder ist bewusst entfernt | ⏳ in Arbeit. 7a 14.11.2026: ohne Server bewusst entfernt – Plugins, Nakama-Cloud-Räume, Discord, Fehlerbericht (leise bzw. „not available without the server“, §4r). 7e 14.11.2026: Nakama-Gast im Kern (Verbindung, Gastgeber-Bibliothek, Abspielen mit Token-Kopfzeile, §4r), Gerät offen; Watch Party nicht gebaut. Offen: 7b WLAN-Ausgang, 7c DLNA/Google Cast |
| **8 Abschluss** | `backend/`, alte App `app/`, Server-Dienst löschen | APK ohne `libseanime.so`, Messwerte besser als Stufe 0 | ⏳ in Arbeit. **8a-1 ✅ 14.11.2026 (§4s):** Server-Modul aus der App, App läuft immer ohne Server; APK ohne `libseanime.so` (Test-App 117,2 → 71,0 MB, scratch 130,9 → 79,9 MB); S22 + Tablet ohne Server-Prozess, Daten da; PSS S22 276 MB / Tablet 268 MB gegen App + Server in Stufe 0 352 / 348 MB. **8a-2 ✅ 14.11.2026 (§4s):** `backend/` und `app/` aus dem Repo (Erweiterungs-Vertrag nach `native/src/core/extensions/contract/`), Anfragen ohne Server-Weg, WebSocket, Startschranke, Seite „Server-Status“ weg. **8b-1 ✅ 14.11.2026 (§4s, §5 „Endmessung“):** Schalter-Links und Kern-gegen-Server-Vergleich weg, alle Hauptbildschirme an beiden Geräten ✓ (Reader Seite 1 aus dem 4c-2-Download), PSS 288 / 272 MB gegen 352 / 348 MB, APK 70,95 MB; Tablet-CPU im Leerlauf schlechter (offen). **8b-2 14.11.2026 (§4s): Stufe 8 noch nicht fertig.** Tablet-CPU kein Rückschritt (Stufe 0 maß die nicht debuggable Test-App, jetzt die debuggable scratch-App; gegen scratch mit Server aus Stufe 5 gleich; Kern-Fäden still), Ruckeln auf der Stufe-0-Liste Ø 1,49 gegen 1,06 % (leicht schlechter), Tablet-PSS streut am selben Build um 43 MB (Grafik, Code). Offen für 8b-3: Ruckeln, Quelle der Worklet-Schleife je Bild, außerdem: Release-Weg von 2.0.33, Name, README, `isServerOff()`/Bereichs-Schalter im Kern samt Tests, Ausblend-Stellen aus 7a/7f, `server-url.ts` |

## 4a. Eigene Datenbank und Bereich `settings` (Phase 1b)

### Datenbank

Der Kern hat eine eigene SQLite-Datei, `core.db` im App-eigenen Datenordner (expo-sqlite legt sie unter `files/SQLite/` ab). Sie entsteht erst, wenn ein Bereich sie zum ersten Mal braucht; eine App mit allen Schaltern aus legt sie nie an. Die Datenbank des Servers (`seanime.db`) wird nicht angefasst.

| Teil | Wo | Was |
|---|---|---|
| Schema | `native/src/core/database/schema.ts` | Tabellen als Drizzle-Beschreibung (`drizzle-orm/sqlite-core`); gegen sie sind die Abfragen geschrieben |
| Schritte | `native/src/core/database/migrations.ts` | `SCHEMA_STEPS`: Liste von Schritten mit SQL, je einmal genommen, vermerkt in `schema_steps` |
| Öffnen | `native/src/core/database/database.ts` | `openCoreDatabase(driver, now)` nimmt offene Schritte und gibt die Drizzle-Datenbank zurück; `inOrder` lässt Arbeiten an einer Datenbank streng nacheinander laufen |
| Treiber Gerät | `native/src/api/client/core-database.ts` | führt eine Anweisung des Kerns auf expo-sqlite aus, seit Phase 1c auf dessen eigenem Faden (`prepareAsync`, `executeForRawResultAsync`; Grund in §4b) |
| Treiber Test | `native/test/expo-sqlite.ts` | dieselben Aufrufe auf Nodes eingebautem `node:sqlite`, im Arbeitsspeicher (vitest-Alias für `expo-sqlite`) |

Der Kern kennt weder expo-sqlite noch Node: Er bekommt eine Funktion, die **eine** SQL-Anweisung ausführt (`SqlDriver`), und spricht sie über Drizzles `sqlite-proxy` an. Darum laufen Schema, Schritte und Abfragen auf dem Gerät und im Test unverändert, und die Tests prüfen gegen eine echte SQLite, nicht gegen eine Attrappe.

Eigene Tabellen (Schritt 1), nichts davon ist eine Server-Tabelle:

| Tabelle | Zweck | Spalten |
|---|---|---|
| `schema_steps` | welche Schritte diese Datenbank genommen hat | `step`, `name`, `applied_at` |
| `settings_sections` | Einstellungen, eine Zeile je Abschnitt (`library`, `mediaPlayer`, `torrent`, `manga`, `anilist`, `autoDownloader`, `discord`, `notifications`, `nakama`). Keine Zeilen = Erststart noch nicht passiert | `section`, `content` (JSON), `changed_at` |
| `appearance` | Aussehen der App (das „Theme“). Eine Zeile (id 1) ab dem ersten Speichern | `id`, `content` (JSON), `created_at`, `changed_at` |
| `home_items` | Zeilen des Home-Bildschirms in der Reihenfolge des Nutzers | `position`, `item_id`, `kind`, `schema_version`, `options` (JSON) |

Seit Schritt 2 (Phase 1d, §4c) dazu:

| Tabelle | Zweck | Spalten |
|---|---|---|
| `account` | das AniList-Konto, eine Zeile (id 1) oder keine. **Ohne Token** – der liegt im gesicherten Speicher des Geräts | `id`, `username`, `viewer` (Text, wie gespeichert), `created_at`, `changed_at` |
| `watch_positions` | wo der Nutzer aufgehört hat zu schauen, eine Zeile je Anime | `media_id`, `kind`, `episode_number`, `position_seconds`, `duration_seconds`, `filepath`, `added_at`, `changed_at`, `expires_at` |
| `move_parts` | der Umzug, eine Zeile je Teil; irgendeine Zeile = der Umzug ist gelaufen | `part`, `outcome`, `count`, `detail` (JSON: Feldnamen, Grund), `leftovers` (JSON), `moved_at` |

Zeiten sind Millisekunden seit 1970.

**Migrations-Weg für spätere Stufen:**

1. Tabellen in `schema.ts` ergänzen oder ändern.
2. In `SCHEMA_STEPS` einen **neuen Schritt ans Ende** hängen (nächste Nummer, SQL). Ein ausgelieferter Schritt wird nie mehr geändert.
3. `database.test.ts` prüft: Die Schritte ergeben auf leerer Datenbank genau die Tabellen und Spalten aus `schema.ts`; Nummern steigen lückenlos; ein neuer Schritt läuft allein nach und lässt Daten stehen.

Jeder Schritt läuft in einer Transaktion (ganz oder gar nicht). Kennt die Datenbank einen Schritt, den die App nicht kennt (Datei von einer neueren App), wird sie abgelehnt und nicht angefasst. `drizzle-kit` und sein Migrations-Ordner sind bewusst nicht dabei: Der Drizzle-Migrator liest Dateien, die es auf dem Gerät nur über einen zusätzlichen Babel-/Metro-Umbau gäbe; die Schritt-Liste braucht keine weitere Abhängigkeit.

### Bereich `settings`

Schalter `settings`, Standard aus. Ist er an, beantwortet der Kern (`native/src/core/settings/settings.ts`, Feldliste in `shape.ts`):

| Schnittstelle | Adresse | Antwort |
|---|---|---|
| `SETTINGS.GettingStarted` | `POST /api/v1/start` | Status |
| `SETTINGS.SaveSettings` | `PATCH /api/v1/settings` | Status |
| `SETTINGS.PatchSetting` | `PATCH /api/v1/settings/path` | Status |
| `SETTINGS.SaveMediaPlayerSettings` | `PATCH /api/v1/settings/media-player` | `true` |
| `THEME.UpdateTheme` | `PATCH /api/v1/theme` | das Theme |
| `STATUS.GetHomeItems` | `GET /api/v1/status/home-items` | Liste oder `null` |
| `STATUS.UpdateHomeItems` | `POST /api/v1/status/home-items` | leer (der Server schickt keinen JSON-Körper) |
| `STATUS.GetStatus` | `GET /api/v1/status` | Status des Servers, zwei Felder ersetzt (unten) |

**Zwischenlösung GetStatus:** Die App liest Einstellungen und Theme als Teil des Status, der auch Konto, AniList und Server-Angaben trägt (Stufe 2). Solange das so ist, holt der Kern den Status weiter vom Server (über denselben Weg wie `buildSeaQuery`, gleiche Kopfzeilen, gleiche Fehler) und ersetzt genau die Felder `settings` und `themeSettings` durch die Werte aus `core.db`. Fällt der Server aus, bekommt die App dessen eigenen Fehler (Wiederholen beim Start, Anmelde-Prüfung bleiben, wie sie sind). Ein eigener Lese-Weg an der App vorbei wurde verworfen: Er hätte jede Stelle ändern müssen, die den Status liest.

**Leere Datenbank = Erststart:** `settings` ist `null`, das Theme hat id 0 und die Zeit `0001-01-01T00:00:00Z`, Home-Elemente `null` – wie in der Aufzeichnung der frischen scratch-App. Die App zeigt dann den Erststart-Bildschirm. Seit Phase 1d bleibt die Datenbank nur leer, wenn auch der Server nichts hat: Vor dem ersten Lesen läuft der Umzug (§4c).

**Folge, solange andere Bereiche beim Server liegen:** Der Server erfährt von Änderungen im Kern nichts und arbeitet mit seinem eigenen, älteren Stand der Einstellungen (z. B. ob Online-Streaming an ist). Der Bereich ist deshalb nur zum Testen an; für Nutzer wird er erst eingeschaltet, wenn die Bereiche, die Einstellungen lesen, auch umgezogen sind.

**Aus den Aufzeichnungen übernommen** (`api-schreibend`, 13.11.2026; Auszug als Testdaten in `settings.recorded.json`):

- Der Erststart speichert drei Werte anders, als die App sie schickt: `library.includeOnlineStreamingInLibrary` false → true, `torrent.defaultTorrentClient` "none" → "seanime", `discord.richPresenceUseMediaTitleStatus` true → false. Die Regel dahinter zeigt die eine Aufzeichnung nicht; der Kern setzt genau diese drei Werte (`FIRST_START_FIXED`).
- Der Erststart legt `autoDownloader` mit festen Werten an (Intervall 20, automatisch laden an, erweiterte Suche an); `SaveSettings` trägt diesen Abschnitt nicht und lässt ihn stehen. `listSync` ist immer `null`.
- `settings.id` ist 1, `settings.createdAt` immer `0001-01-01T00:00:00Z`, `updatedAt` die Zeit der letzten Änderung (auch wenn `PatchSetting` denselben Wert noch einmal setzt).
- Das Theme bekommt beim ersten Speichern id 1 und `createdAt` = `updatedAt`; id und Zeiten aus der Anfrage zählen nicht.
- Home-Elemente bekommen `schemaVersion: 0`, wenn die Anfrage keine nennt. Im Status bleibt `themeSettings.homeItems` `null`; das Ändern der Home-Elemente zählt als Änderung des Themes (`updatedAt`, DB-Kopie b).

**Nicht aufgezeichnet, im Kern selbst entschieden** (eigener Wortlaut, Status 500; Tests unter „what no recording shows“): falsche Art eines Werts, unbekannter Pfad bei `PatchSetting`, Speichern vor dem Erststart werden abgelehnt; unbekannte Felder fallen weg, fehlende bekommen den leeren Wert ihrer Art; ein zweites Speichern des Themes behält `createdAt`; Home-Elemente ohne gespeichertes Theme legen kein Theme an; eine leere Liste Home-Elemente liest sich wieder als `null`. Zeiten haben Millisekunden (der Server schreibt Nanosekunden). Für diese Fälle fehlen Aufzeichnungen.

**Ereignisse:** Der Server kennt `settings-changed`; die App holt daraufhin den Status neu (`client-providers.tsx`). Nötig ist das hier nicht: Jeder der Hooks macht nach Erfolg selbst `GetStatus` bzw. `GetHomeItems` ungültig (`settings.hooks.ts`, `theme.hooks.ts`, `status.hooks.ts`). Der Kern sendet deshalb kein Ereignis. Den Verteiler gibt es seit 1c (§4b); auch danach sendet `settings` nichts, aus demselben Grund.

**Testweg:** `database.test.ts` (10 Tests: Schritte auf leerer Datenbank, einmalig, Rückrollen, neuere Datenbank abgelehnt, Schema = Tabellen, Drizzle lesen/schreiben, Neustart), `settings.test.ts` (20 Tests: leere Datenbank = Erststart; die fünf aufgezeichneten Aufrufe in aufgezeichneter Reihenfolge, Antwort und Zustand danach Feld für Feld samt Feld-Reihenfolge, nur die Zeiten sind die des Laufs; Home-Elemente; Neustart; eigene Entscheidungen), `requests.test.ts` (Schalter aus: Status und Theme gehen unverändert an den Server; an: Theme ohne Anfrage an den Server, Status mit genau einer Anfrage an den Server; Fehler des Servers und des Kerns in der Form, die die Hooks kennen).

**Am Gerät** (Pixel Tablet, Nutzer 10, scratch-App, 13.11. 12:55–12:57; Bilder und DB-Kopie in `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\1b-*`):

1. Schalter an (`seanime-scratch://core?area=settings&on=1`) → App-Log `[Core] info areas answered by the core: settings`, danach `GET /api/v1/status answered by the core, no HTTP (117 ms)`. Die leere `core.db` zeigt den Erststart-Bildschirm (`1b-03-erststart.png`), obwohl der Server der scratch-App längst Einstellungen hat.
2. „Start Seanime“ → `POST /api/v1/start answered by the core, no HTTP (86 ms)`.
3. Einstellungen → App → „Watch history“ aus → `PATCH /api/v1/settings/path answered by the core, no HTTP (60 ms)` (`1b-08-geaendert.png`, `1b-09-neu-geoeffnet.png`).
4. Server-Log im selben Zeitraum: nur `GET /api/v1/status` (die Rückfrage der Zwischenlösung), **keine** Zeile für `/api/v1/start` oder `/api/v1/settings…`.
5. Die Datei `files/SQLite/core.db`, per `run-as` vom Gerät kopiert (`1b-core.db`): Schritt 1 vermerkt, neun Abschnitte, `library.enableWatchContinuity` = false, `includeOnlineStreamingInLibrary` = true.
6. Schalter aus → `areas answered by the core: none`, der Status kommt wieder ganz vom Server.

Nicht am Gerät gezeigt: ein Neustart des App-Prozesses (`am force-stop` ist an den Geräten verboten; `am start -n` holt nur die laufende App nach vorn). Dass die Werte einen Neustart überstehen, zeigen die Datei auf dem Gerät (Punkt 5) und die Tests („is all still there after a new start“).

Zwei Dinge fielen dabei auf und sind behoben: Die scratch-App nahm den Schalter-Link nicht an (nur Variante `test` und Schema `seanime-native` waren erlaubt; jetzt auch `scratch` mit `seanime-scratch`, die Release-Variante weiterhin nicht). Und nach dem Umschalten liest die App jetzt alles neu (`queryClient.invalidateQueries()` in `app-links-handler.ts`), sonst zeigte sie bis zum nächsten Neustart die Antworten der anderen Seite.

## 4b. Ereignis-Verteiler und Faden der Oberfläche (Phase 1c)

### Ereignis-Verteiler

Was der Server der App ungefragt mitteilt, kommt als Nachricht `{ type, payload }` über seinen WebSocket. Der Kern teilt dasselbe in derselben Form mit.

| Teil | Datei | Aufgabe |
|---|---|---|
| Verteiler | `native/src/core/events.ts` | `emitCoreEvent(type, payload)` sendet, `onCoreEvent(hörer)` hört und gibt die Abmelde-Funktion zurück. Ohne React. Die Liste `CORE_EVENT_TYPES` ist dieselbe wie `WSEvents` in `ws-events.ts`; ein Test und der Compiler halten beide gleich |
| Beide Quellen | `native/src/lib/server/server-events.ts` | `listenForServerEvent` und `listenForPluginEvent`: hören auf den WebSocket **und** auf den Kern, ohne React |
| Hooks | `native/src/main/_hooks/handle-websockets.ts` | `useWebsocketMessageListener` und `useWebsocketPluginMessageListener` rufen nur noch die beiden Funktionen auf. Aufruf und Abhängigkeiten sind unverändert, die Aufrufstellen auch |

Regeln des Verteilers:

- Ein Ereignis kommt **später** an, in einem eigenen Durchlauf (`setTimeout 0`), nie mitten in der Arbeit des Kerns. So ist es auch beim Server.
- Der Inhalt wird beim Senden als JSON festgehalten. Der Hörer bekommt also nur, was auch eine Nachricht tragen könnte, und spätere Änderungen des Senders erreichen ihn nicht. Jeder Hörer bekommt wie bisher eine eigene Kopie.
- Wer sich abmeldet, bekommt auch ein schon unterwegs befindliches Ereignis nicht mehr. Ein Hörer, der scheitert, hält die anderen nicht auf.
- Ohne Verbindung zum Server hören die Hooks jetzt trotzdem auf den Kern. Vorher hörten sie ohne Verbindung auf nichts.
- Nicht verbunden sind `client-identity` und `pong` in `websocket-provider.tsx`: Sie gehören zur Verbindung selbst, nicht zu den Mitteilungen.

Noch sendet kein Bereich etwas: `settings` braucht es nicht (§4a), `extensions` hat nur die Probe-Schnittstelle, nach der auch der Server nichts sendet.

### Wie lange hält der Kern den Faden der Oberfläche?

Regel aus dem Plan: nichts über **8 ms** am Stück im Faden, in dem auch die Logik der Bildschirme läuft.

**Der Wächter** (`native/src/core/blocking.ts`, eingehängt in `core-switch.ts`): Er misst jedes Stück, in dem Kern-Code den Faden ohne Pause hält. Ein Stück beginnt, wenn Kern-Code anfängt zu laufen, und endet dort, wo der Kern wirklich wartet (Netz, Server, Datenbank-Anweisung) oder fertig ist. Jedes Stück steht im App-Log (`[Core] info … held the app's thread for 2.1 ms in one piece`), über 8 ms als Warnung (`[Core] warn …, more than the 8 ms allowed`). Er läuft in jeder Variante mit, solange ein Bereich an ist. Ein erster Versuch, das Ende eines Stücks an einem Durchlauf der Ereignis-Schleife zu erkennen, taugte nichts: Bei 2 von 4 Status-Abfragen kam der Durchlauf zu spät, und das Stück enthielt die Wartezeit auf den Server (61,0 und 48,8 ms).

**Messung** (Pixel Tablet, Nutzer 10, scratch-App, Bereich `settings` an, 13.11.; App-Log in `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\1c-logcat-2-async.txt`, Bilder `1c-*.png`):

| Aufruf | Anweisungen im aufrufenden Faden (Stand 1b) | Anweisungen im Faden von expo-sqlite (Stand 1c) |
|---|---|---|
| `PATCH /api/v1/settings/path` (Schalter „Watch history“, 4-mal) | längstes Stück **24,0 / 41,2 / 19,7 / 22,9 ms**; gesamt 66 / 76 / 43 / 51 ms | längstes Stück **3,1 / 2,1 / 3,2 / 2,0 ms**; gesamt 63 / 60 / 79 / 64 ms |
| `GET /api/v1/status` (6-mal) | längstes Stück 4,1 / 2,8 / 2,8 / 12,3 / 2,5 ms, das erste nach dem Start mit dem Öffnen der Datei **44,9 ms**; gesamt 44–104 ms | längstes Stück 3,7 / 1,6 / 1,7 / 1,0 / 1,1 ms, das erste nach dem Start 4,5 ms; gesamt 91–106 ms, das erste 152 ms |

Die früheren Zahlen „60 ms“ und „117 ms“ (§4a) waren die Gesamtzeit. Davon blockierte beim Speichern rund die Hälfte den Faden, beim Lesen wenig; der Rest war Warten auf den Server (die Rückfrage der Zwischenlösung).

### Probe: Kern in einem Hintergrund-Faden von react-native-worklets

`native/src/lib/worklet-probe.ts` (in Phase 1e samt Link und Test entfernt; das Ergebnis steht nur noch hier), gestartet nur in der scratch-App per Link (`seanime-scratch://core?probe=worklets` und `…?probe=worklets-sqlite`), nicht mit dem Kern verdrahtet. react-native-worklets 0.13.0, „Bundle Mode“ aus (so ist die App gebaut). Ergebnis aus dem App-Log (`1c-logcat-1.txt`, Zeilen `[CoreProbe]`):

| Was der Kern braucht | Ergebnis | Beleg |
|---|---|---|
| `setTimeout` | **geht** | `fires on the thread, 50 ms after asking for 50 ms` |
| `fetch` | **geht nicht** | `fetch` und `XMLHttpRequest` sind dort `undefined`. Laut Typ-Beschreibung des Pakets gibt es sie nur im Bundle Mode |
| expo-sqlite | **geht nicht** | `globalThis.expo` ist dort `undefined`, die nativen Module sind nur im Haupt-Faden angemeldet. Eine übergebene Datenbank kommt ohne ihren nativen Teil an: `TypeError: Cannot read property 'prepareSync' of undefined` |
| drizzle-orm | **geht nicht** (nur mit Umweg) | `[Worklets] Tried to synchronously call a Remote Function`: Ohne Bundle Mode läuft dort nur Code, der als Worklet markiert ist, kein importiertes Paket. Umweg wäre der Bundle Mode (eigener Metro-Aufbau, zweites Bündel) |

### Entscheidung

Der Kern bleibt im Faden der Oberfläche, die Datenbank nicht.

- Über 8 ms lag nur die Datenbank: Schreiben 20–41 ms, Öffnen 45 ms. Das eigene Rechnen des Kerns liegt bei 0–4 ms je Stück.
- Der Worklet-Weg ist nicht holprig, sondern heute zu: Drei der vier Dinge, die der Kern braucht, gibt es dort nicht. Er hätte außerdem genau das Teure nicht gelöst, weil expo-sqlite dort nicht erreichbar ist.
- Der kleinste Umzug, der die Regel erfüllt: Der Treiber ruft expo-sqlite über dessen `…Async`-Aufrufe, die Anweisungen laufen damit im eigenen Faden von expo-sqlite. Geändert sind `core-database.ts` und das Öffnen in `core-switch.ts`. Die Schnittstelle des Kerns war schon asynchron, kein Aufrufer ändert sich, und es kommt keine neue Abhängigkeit dazu. Dass sich dabei keine zwei Antworten in die Quere kommen, regelt wie bisher `inOrder` (§4a): Lesen und Schreiben einer Datenbank laufen streng nacheinander.
- Der Wächter bleibt und meldet, wenn ein späterer Bereich die 8 ms reißt (große Listen umformen, JSON von mehreren MB). Erst dann lohnt der Bundle Mode oder ein eigenes natives Modul.

Preis: Jede Anweisung wechselt jetzt viermal den Faden. Das Speichern einer Einstellung dauert gleich lang (60–79 ms statt 43–76 ms), die Status-Abfrage direkt nach dem Umschalten eher länger (91–106 ms statt 44–104 ms), weil der Faden der Oberfläche in dem Moment alle Abfragen neu rechnet und die Antworten der Datenbank dahinter warten. Die Oberfläche bleibt dafür bedienbar.

## 4c. Daten-Umzug (Phase 1d)

Was der Server in seinen eigenen Dateien gespeichert hat, wird **einmal** gelesen und in `core.db` geschrieben. Die Dateien des Servers werden dabei nur gelesen und bleiben, wie sie sind; der Server arbeitet mit ihnen weiter.

| Teil | Wo | Was |
|---|---|---|
| Umzug | `native/src/core/move/move.ts` | die fünf Teile, die Regeln, Ergebnis je Teil; kennt weder Gerät noch Dateisystem |
| Beobachtetes Schema | `native/src/core/move/move.observed.json` | die drei gelesenen Tabellen, wie die DB-Kopien sie zeigen (nur Schema) |
| Geräte-Seite | `native/src/api/client/core-move.ts` | liest die Dateien des Servers, gesicherter Speicher |
| Auslöser | `native/src/api/client/core-switch.ts` | `moveIn` beim Öffnen von `core.db`, `prepareCore`, `repeatCoreMove` |
| Prüf-Skript | `native/scripts/check-migration.mjs` | Umzug gegen Kopien außerhalb der App |

### Quellen und Ziele

Der Server legt seine Daten im Dateien-Ordner der App ab (`files/`, §6): `files/seanime.db` und den Datei-Cache `files/cache/<name>.cache`.

| Teil | Quelle | Ziel |
|---|---|---|
| `account` | `seanime.db`, Tabelle `accounts` (`username`, `token`, `viewer`) | Tabelle `account`; **Token → gesicherter Speicher** (`expo-secure-store`, Name `seanime-core.account-token`) |
| `settings` | Tabelle `settings` (eine Zeile, 111 Spalten) | `settings_sections`, neun Abschnitte, Form wie im Bereich `settings` |
| `appearance` | Tabelle `themes` (eine Zeile) | `appearance` (id 1), dazu `unpinnedMenuItems` |
| `homeItems` | `themes.home_items` (JSON als Blob) | `home_items`, Reihenfolge wie gespeichert |
| `watchHistory` | `files/cache/watch_history.cache` (JSON: AniList-Id → `{ value, expiration }`) | `watch_positions` |

**Spalte → Feld:** Der Feldname der App wird zum Spaltennamen (`libraryPath` → `library_path`, `openWebURLOnStart` → `open_web_url_on_start`, `…AniList…` → `…anilist…`). Zwei Abschnitte tragen ihren Namen vor jeder Spalte (`auto_downloader_…`, `nakama_…`), ein Feld heißt anders (`mediaPlayer.host` → `player_host`). Abgelesen aus den DB-Kopien und dem aufgezeichneten Status; `move.test.ts` prüft, dass jedes Feld aus `shape.ts` genau eine Spalte der beobachteten Tabelle trifft.

**Arten der Werte, wie in den Kopien beobachtet:** ja/nein steht als 0/1, Listen als JSON (in allen drei Kopien `NULL`, das ist die leere Liste), JSON-Stücke als Blob, Zeiten als `2026-11-13 10:28:00.123456789+00:00` (Datenbank) oder `2026-11-12T19:00:32.180207533Z` (Datei-Cache). Der Kern hält Millisekunden; was feiner ist, fällt weg. Das ist das Einzige, was der Umzug kürzt.

**Lesen ohne Anfassen:** `seanime.db` wird nie an Ort und Stelle geöffnet (SQLite dürfte dann schreiben, und der Server hat die Datei offen). Die App liest die Bytes der Datei und öffnet sie als Datenbank im Arbeitsspeicher (`deserializeDatabaseAsync`). Es entsteht keine Kopie auf der Platte – auch keine mit dem Token. Der Server schreibt mit Rollback-Journal, nicht WAL (Kopf der drei Kopien): Die Hauptdatei ist für sich vollständig. Schreibt der Server genau im Moment des Lesens, kann das Abbild unbrauchbar sein; der Teil meldet dann `failed`, und der Umzug lässt sich wiederholen.

### Regeln

1. **Einmal je `core.db`.** Der Vermerk ist die Tabelle `move_parts`: Hat sie eine Zeile, läuft der Umzug nicht von selbst noch einmal. Geprüft wird beim Öffnen der Datenbank, also bevor irgendetwas aus ihr gelesen wird.
2. **Auslöser:** Wird ein Bereich eingeschaltet, öffnet die App die Datenbank sofort (`prepareCore`); ist ein Schalter beim App-Start schon an, passiert es mit der ersten Anfrage an den Kern. Eine App mit allen Schaltern aus legt weiterhin keine `core.db` an und zieht nichts um.
3. **Gezielt wiederholen:** Link `seanime-scratch://core?move=again` (Test-App: `seanime-native://…`; die Release-Variante nimmt ihn nicht an). Oder `core.db` löschen: Eine neue Datenbank zieht neu um.
4. **Nichts überschreiben:** Hat der Kern für einen Teil schon eigene Daten (Zeilen in der Ziel-Tabelle), bleibt der Teil, wie er ist – Ergebnis `kept`. Darum ändert eine Wiederholung nichts an dem, was schon da ist; sie holt nur nach, was beim ersten Mal leer war, fehlte oder scheiterte.
5. **Jeder Teil einzeln,** je in einer eigenen Transaktion. Scheitert einer, laufen die anderen. Ergebnis je Teil: `moved` (übernommen, Anzahl), `empty` (der Server hat nichts), `kept`, `missing` (Datei fehlt), `failed` (Datei da, aber nicht lesbar; mit festem Grund-Text).
6. **Nichts verwerfen:** Spalten und Felder, für die der Kern noch keinen Platz hat, wandern unverändert nach `move_parts.leftovers` (heute: `settings.automatic_sync`, `settings.sync_origin`). Ein Wert von falscher Art (Text, wo eine Zahl stehen müsste) landet ebenfalls dort; das Feld bekommt den leeren Wert seiner Art, und das Ergebnis nennt das Feld unter `unfitFields`. Nicht mitgenommen werden nur die Zeilen-Nummern (`id`): Der Kern hat seine eigene.
7. **Token:** nur im gesicherten Speicher. Nicht in `core.db`, nicht im Ergebnis, nicht im Log. Eine unbekannte Spalte von `accounts`, deren Name nach Geheimnis klingt (`token`, `secret`, `password`, `key`), geht ebenfalls dorthin statt in die Reste. Ergebnis und Log-Zeile tragen nur Zahlen und Feldnamen; Fehlertexte aus SQLite oder dem JSON-Leser (die Werte zitieren können) werden nie durchgereicht.

Log-Zeile der App (ein Beispiel mit erfundenem Stand): `[Core] info move from the server: account moved 1, settings moved 9 (extra: automatic_sync sync_origin), appearance moved 1, homeItems empty 0, watchHistory moved 3`.

### Neue Abhängigkeit

`expo-secure-store` (~58.0.3): der einzige Weg im Expo-Baukasten, einen Wert mit einem Schlüssel aus dem Android Keystore zu verschlüsseln. Der Kern kennt das Paket nicht; er bekommt zwei Funktionen (`SecretStore`: lesen, schreiben). In den Tests steht dafür ein Speicher im Arbeitsspeicher (`native/test/expo-secure-store.ts`), ebenso ein leerer Dateien-Ordner (`native/test/expo-file-system.ts`).

### Bewusst später

| Was | Wo es beim Server liegt | Kommt mit |
|---|---|---|
| Erweiterungen und ihre Einstellungen | Datei-Cache `extension-settings`, `plugin-settings`, Tabelle `plugin_data` | Stufe Erweiterungen |
| Offline-Folgen, lokale Dateien | `local_files`, `shelved_local_files`, `scan_summaries`, `offline/local.db`, `mobile-offline/queue.json` | Stufe Offline |
| Manga-Downloads und -Vorlieben | `chapter_download_queue_items`, Datei-Cache `manga-preferences` | Stufe Manga |
| Zuordnungen | `onlinestream_mappings`, `manga_mappings`, `media_metadata_parents`, `media_fillers` | ihre Stufen |
| Torrent-, Debrid-, Transcoding-Einstellungen | `torrentstream_settings`, `debrid_settings`, `mediastream_settings` | ihre Stufen (eigene Schnittstellen, nicht Teil des Status-Felds `settings`) |
| Playlists, Auto-Downloader, Stummschaltungen | `playlists`, `auto_downloader_*`, `silenced_media_entries` | ihre Stufen |

Der Kern liest Konto und Schau-Fortschritt in dieser Phase noch nicht aus (Stufe 2 bzw. Wiedergabe); sie liegen bereit.

### Testweg

`move.test.ts` (14 Tests): Die Server-Datenbank wird im Test aus dem beobachteten Schema gebaut und mit erfundenen Werten gefüllt, je Spalte ein anderer. Geprüft: jedes Feld hat genau eine Spalte; Feld-für-Feld-Vergleich aller fünf Teile; Reste samt Namen; Token nur im (im Test gedoubelten) gesicherten Speicher, nirgends in Datenbank, Ergebnis oder Log-Zeile; der Bereich `settings` liefert danach die umgezogenen Werte; einmal je Datenbank, Wiederholung ändert nichts; vorhandene Kern-Daten bleiben; leerer Server; fehlende Dateien; ein kaputter Teil hält die anderen nicht auf (und sein Fehlertext wird nicht durchgereicht); Werte falscher Art.

### An den drei Kopien

`node scripts/check-migration.mjs <Ordner> …` führt den Umzug gegen Kopien aus (Datenbank nur lesend geöffnet, `core.db` im Arbeitsspeicher), vergleicht danach unabhängig jeden Quell-Wert mit dem, was im Kern steht, wiederholt den Umzug und prüft die Prüfsummen der Quelldateien. Ausgabe nur Zahlen und Feldnamen. Lauf vom 13.11.2026 gegen `db-kopien\a-scratch-frisch`, `b-scratch-nach-aufzeichnung`, `c-test` (bereinigt):

| Teil | (a) scratch frisch | (b) scratch danach | (c) Test-App |
|---|---|---|---|
| `account` | leer | leer | übernommen 1 (6 Werte verglichen) |
| `settings` | leer | übernommen 9 (109 Werte) | übernommen 9 (109 Werte) |
| `appearance` | leer | übernommen 1 (43 Werte) | übernommen 1 (43 Werte) |
| `homeItems` | leer | übernommen 1 (5 Werte) | leer |
| `watchHistory` | Datei fehlt | leer | übernommen 3 (25 Werte) |
| Abweichungen | 0 | 0 | 0 |
| Wiederholung ändert nichts | ja | ja | ja |
| Quelldateien unverändert | ja | ja | ja |

Mitgenommen als Rest in (b) und (c): `automatic_sync`, `sync_origin`. In (c) steht statt des Tokens `<redacted>`; geprüft ist damit der Weg (Wert der Spalte landet im gesicherten Speicher und nirgends in der Datenbank), nicht ein echter Token.

### Am Gerät

Pixel Tablet, Nutzer 10, scratch-App, 13.11.2026 13:52–13:57; Bilder, die kopierte `core.db` und die Kopie der Server-Dateien der scratch-App liegen in `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\1d-*`. Vorher: neue scratch-APK per `install -r`, `files/SQLite/core.db` der scratch-App per `run-as` gelöscht.

1. Schalter an (`seanime-scratch://core?area=settings&on=1`) → App-Log `[Core] info areas answered by the core: settings`, eine halbe Sekunde später `move from the server: account empty 0, settings moved 9 (extra: automatic_sync sync_origin), appearance moved 1, homeItems moved 1, watchHistory empty 0`, danach `GET /api/v1/status answered by the core, no HTTP (393 ms)` (die erste Antwort wartet auf den Umzug).
2. Die App zeigt Home, **nicht** den Erststart-Bildschirm wie in 1b mit leerer `core.db` (`1d-02-nach-umzug.png`). Einstellungen → App zeigt die Werte des Servers der scratch-App: „Update progress automatically“ an, „Watch history“ an, „Hide audience score“ an (`1d-04-einstellungen.png`).
3. `core.db` per `run-as` kopiert (`1d-core.db`): Schritte 1 und 2 vermerkt; `settings_sections` 9, `appearance` 1, `home_items` 1, `account` 0, `watch_positions` 0, `move_parts` 5 (zwei `empty`, drei `moved`; Reste nur bei `settings`: `automatic_sync`, `sync_origin`). Verglichen mit der im selben Moment kopierten `seanime.db` der scratch-App: 106 von 106 Einstellungs-Feldern und 40 von 40 Feldern des Aussehens gleich. `check-migration.mjs` gegen diese Kopie: 0 Abweichungen.
4. Die Datei des Servers ist unverändert: `files/seanime.db` vor dem Einschalten und nach dem Umzug gleiche Prüfsumme (SHA-256), gleiche Größe, Änderungszeit weiter 10:29.
5. Wiederholen (`seanime-scratch://core?move=again`) → `move from the server (again): account empty 0, settings kept 0, appearance kept 0, homeItems kept 0, watchHistory empty 0`. Längstes Stück des Umzugs im Faden der Oberfläche: 6,3 ms (Grenze 8 ms), keine Warnung des Wächters.
6. Schalter aus → `areas answered by the core: none` (`1d-05-schalter-aus.png`).

Nicht am Gerät gezeigt: ein Konto mit Token im gesicherten Speicher und Schau-Fortschritt – die scratch-App hat beides nicht (kein AniList-Konto, leerer Verlauf). Der Weg ist durch die Tests und durch Kopie (c) belegt, das Schreiben in den echten Android Keystore noch nicht. Ebenfalls nicht gezeigt: der Auslöser „Schalter ist beim App-Start schon an“ (dafür müsste der Prozess neu starten; `am force-stop` ist verboten).

Aufgefallen: Der Wächter für den Faden der Oberfläche führt nur **ein** laufendes Stück. Läuft der Umzug, während die App schon Status-Anfragen an den Kern stellt, schreibt er Stücke des Umzugs der Anfrage zu (im Log `GET /api/v1/status held …` und zwei Zeilen ohne Namen). Die Dauer stimmt, nur der Name nicht. Das ist dieselbe Eigenschaft wie bei zwei gleichzeitigen Anfragen und nicht Teil dieser Phase.

## 4d. AniList lesen (Phase 2a, Bereich `anilist`)

Der Kern liest Listen, Titel, Suchen und Statistik selbst bei AniList (GraphQL, `https://graphql.anilist.co`). Dieser Abschnitt ist das Lesen: `askAnilist` schickt keine Mutation und lehnt ein Dokument ab, das eine ist. Das Ändern (Listen-Eintrag, Fortschritt, Löschen) steht in §4f. Bereich `anilist`, Standard aus.

| Teil | Wo | Was |
|---|---|---|
| Client | `native/src/core/anilist/client.ts` | eine Abfrage über `fetch` (vom Wirt), Token als `Authorization: Bearer`, Rate-Limit, Fehler als `AnilistFailure` |
| Abfragen | `native/src/core/anilist/queries.ts` | die GraphQL-Dokumente; ihre Felder sind die der Aufzeichnungen (Test hält beide nebeneinander) |
| Speicher | `native/src/core/anilist/store.ts` | Titel, Listen-Einträge, sonstige Antworten in `core.db` |
| Antworten | `native/src/core/anilist/anilist.ts` | je Schnittstelle: fragen, Form wie aufgezeichnet, speichern; bei Ausfall aus dem Speicher |
| Testdaten | `native/src/core/anilist/anilist.recorded.json` | die Aufzeichnungen vom 13.11., gekürzt (wenige Einträge je Liste, gleiche Form) |

**Token und Nutzer:** Der Token kommt aus dem gesicherten Speicher (`seanime-core.account-token`, vom Umzug §4c dort abgelegt); der Wirt reicht dafür `secret(name)` in die Umgebung. Ohne Token fragt der Kern öffentlich. Den Nutzernamen für die Listen nimmt er aus der Tabelle `account`, fehlt er, fragt er AniList (`Viewer { name }`). Der Token steht nie in einem Log, einem Fehlertext oder der Datenbank.

**Form der Antworten:** wie aufgezeichnet. Der Server lässt in Listen, Titeln, Suchen und Studio jedes `null` und jede leere Liste weg (in den Aufzeichnungen kein einziges `null`, kein `[]`), leere Objekte bleiben (`"startedAt": {}`); der Kern macht es genauso. Nur die Statistik behält ihre leeren Listen (aufgezeichnet: `"genres": []`). `GET /anilist/collection` ist die rohe Sammlung ohne eigene Listen des Nutzers (`isCustomList`), so beschreibt es `endpoints.ts`; in der Aufzeichnung sind beide gleich.

### Rate-Limit

AniList erlaubt 90 Anfragen je Minute, bei Störung 30, und sagt in jeder Antwort `X-RateLimit-Limit`/`-Remaining`. Der Client führt die Anfragen der letzten Minute (eine Liste für die ganze App) und wartet, bevor eine weitere die Grenze überschreiten würde; die Grenze übernimmt er aus der Kopfzeile. Auf 429 wartet er so lange, wie `Retry-After` sagt, und fragt bis zu zweimal neu. Eine Wartezeit über 10 s wird nicht abgesessen: Die Anfrage gilt dann als „AniList nicht erreichbar“, und die Antwort kommt sofort aus dem Speicher. Nach 15 s ohne Antwort gibt der Client auf.

### Speicher und Ausfall

Schema-Schritt 3 (`SCHEMA_STEPS`):

| Tabelle | Zweck | Spalten |
|---|---|---|
| `anilist_media` | ein Titel (Anime oder Manga) mit **eigener Kennung** `id`, AniList-Nummer daneben (`anilist_id`, eindeutig) | `id`, `anilist_id`, `kind`, `content` (JSON, wie die Listen ihn lesen), `details` (JSON, Detail-Seite), `changed_at` |
| `anilist_list_entries` | die Listen-Einträge des Nutzers, Stand des letzten vollständigen Lesens | `id` (eigene), `anilist_id` (des Eintrags), `media` (→ `anilist_media.id`), `kind`, `list` (Platz der Liste), `position`, `content` (JSON, Eintrag ohne Titel), `changed_at` |
| `anilist_answers` | die letzte Antwort auf jede andere Frage (Suchseite, Studio, Statistik, Tags, Köpfe der Listen) | `question`, `answer` (JSON), `changed_at` |

Jede gelesene Antwort aktualisiert den Speicher. Eine Sammlung ersetzt alle Einträge ihrer Art (was der Nutzer anderswo entfernt hat, verschwindet auch hier); ein Titel wird an Ort und Stelle aktualisiert und behält seine Kennung. Scheitert das Speichern, bekommt die App trotzdem die Antwort.

**Ist AniList nicht erreichbar** (kein Netz, Zeitüberschreitung, 5xx, Rate-Limit, abgelehnte Anfrage), antwortet der Kern mit dem letzten gespeicherten Stand derselben Frage, in derselben Form. Nur wenn nichts gespeichert ist, kommt der Fehler, den der Server in diesem Fall gibt (aufgezeichnet bei einem unbekannten Studio): Status 500, `{ "error": "no cached data available" }`.

### Schnittstellen im Kern

| Schnittstelle | Antwort |
|---|---|
| `GET /api/v1/anilist/collection` | Anime-Sammlung ohne eigene Listen |
| `GET /api/v1/anilist/collection/raw` | Anime-Sammlung, alle Listen |
| `GET /api/v1/anilist/collection/raw/tags` | Tag-Namen je Titel der Anime-Listen |
| `GET /api/v1/manga/anilist/collection/raw` | Manga-Sammlung, alle Listen |
| `GET /api/v1/manga/anilist/collection/raw/tags` | Tag-Namen je Titel der Manga-Listen |
| `GET /api/v1/anilist/media-details/{id}` | Anime-Details |
| `GET /api/v1/anilist/studio-details/{id}` | Studio mit seinen Anime |
| `POST /api/v1/anilist/list-anime` | Anime-Suche (Discover, Suche); nur die in `endpoint.types.ts` genannten Variablen gehen weiter |
| `POST /api/v1/manga/anilist/list` | Manga-Suche; `year` wird zu „Start in diesem Jahr“ (`startDate_greater/lesser`) |
| `POST /api/v1/anilist/list-recent-anime` | kürzlich ausgestrahlte Folgen (Zeitplan) |
| `GET /api/v1/anilist/stats` | Statistik des Nutzers (braucht den Token) |

### Bewusst später

| Was | Warum |
|---|---|
| `POST /api/v1/anilist/collection` (neu laden) | Antwort nicht aufgezeichnet; lädt beim Server auch die Manga-Sammlung und schickt ein Ereignis |
| `GET /api/v1/manga/collection` | eigene Gliederung des Servers (Listen nach Status mit `listData`), aus zwei aufgezeichneten Listen nicht sicher abzulesen |
| `GET /api/v1/anilist/list-missed-sequels` | Auswahl-Regeln des Servers nicht aus der Aufzeichnung ablesbar |
| `GET/POST /api/v1/anilist/cache-layer/status` | Schalter des Servers für seinen eigenen Zwischenspeicher |
| Anime-/Manga-Einträge (`/library/anime-entry/…`, `/manga/entry/…`) | mischen lokale Dateien, Downloads, Zuordnungen |
| ~~alles Schreibende~~ | seit Phase 2b im Kern, §4f |

Bewusste Abweichung: Die Statistik der Aufzeichnung hat leere Listen (Genres, Formate, …). Der Kern fragt AniList nach ihnen und gibt sie gefüllt zurück (Felder wie in `AL_UserGenreStats` usw. in `types.ts`).

### Testweg

`anilist.test.ts` (ohne Netz; AniList spielt ein Test-Double mit den Aufzeichnungen, inklusive der `null` und `[]`, die AniList schickt): Abfragen enthalten jedes Feld der Aufzeichnungen; Antworten gleich der Aufzeichnung; eigene Listen fallen nur ohne `raw` weg; Nutzername aus `account`, sonst `Viewer`; Ausfall → Antwort aus dem Speicher (alle Arten); neue Sammlung ersetzt die alte im Speicher; nichts gespeichert → Fehler wie aufgezeichnet; 429 mit `Retry-After` (warten und neu fragen, nach zwei Versuchen aufgeben, langes `Retry-After` → sofort Speicher); Grenze 30 aus der Kopfzeile; Token nur als Kopfzeile; Schalter aus → alles zum Server, schreibende Schnittstellen auch bei Schalter an beim Server.

### Am Gerät

Pixel Tablet, Nutzer 10, Test-App (mit angemeldetem AniList-Konto), 13.11.2026 14:37–14:39. Neue Test-APK per `install -r`; Bilder und Log-Auszug in `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\2a-*`. In der App wurde nichts geändert, nur Home und „My Lists“ angesehen.

1. Schalter an (`seanime-native://core?area=anilist&on=1`) → `areas answered by the core: anilist`, Umzug in die neue `core.db` der Test-App (`account moved 1, settings moved 9 …`), danach `GET /api/v1/anilist/collection answered by the core, no HTTP (1707 ms)` (die erste Antwort wartet auf den Umzug). Home wie gewohnt (`2a-01-anilist-an-home.png`).
2. „My Lists“ → `…/manga/anilist/collection/raw/tags` (244 ms), `…/manga/anilist/collection/raw` (264 ms), `…/anilist/collection/raw/tags` (1018 ms), `…/anilist/collection/raw` (1435 ms), alle vom Kern. Die Listen erscheinen vollständig mit Zählern je Status (`2a-02-anilist-an-listen.png`). Im Server-Log zwischen An und Aus keine Zeile für diese Adressen, nur für Schnittstellen, die noch beim Server sind (`/manga/collection`, `/manga/latest-chapter-numbers`, …).
3. Schalter aus → `areas answered by the core: none`; sofort wieder Server-Zeilen `GET 200 /api/v1/anilist/collection`, `…/collection/raw`, `…/raw/tags`; Home normal (`2a-03-anilist-aus.png`).

### Faden der Oberfläche beim Laden der Sammlung (Korrektur 13.11.2026, 15:03–15:06)

Der Wächter meldete beim ersten Lesen der Anime-Sammlung (gut 1 MB, 339 Titel) Stücke von 126 ms, 466 ms und 500 ms, sonst 8–27 ms. Nachgemessen am Tablet (Log `2a-korrektur-logcat-*.txt`, Bilder `2a-korrektur-*.png` im selben Ordner):

| Ursache | vorher | Abhilfe | nachher |
|---|---|---|---|
| Warten auf den Text der Antwort (`response.text()`) war nicht als Warten gemeldet; der Wächter zählte es als Arbeit des Kerns und verlor dabei den Namen der Anfrage | 466 / 500 ms | `core-switch.ts`: das Lesen des Textes ist eine eigene Wartestelle | entfällt (war kein Blockieren) |
| `JSON.parse` der Antwort, ein Stück, nicht teilbar | steckte in den 466 / 500 ms | – | **20–37 ms** (Anime), 14 ms (Tags) |
| Ausdünnen (`withoutEmpty`) über den ganzen Baum | 22 ms | Eintrag für Eintrag, dazwischen `environment.pause()`: gibt den Faden ab, sobald ein Stück 4 ms läuft (`blocking.ts`) | keine Warnung |
| Speichern: Drizzle setzte jede Anweisung Zeile für Zeile zusammen, 8–30 ms je Anweisung, mit 25 Zeilen wie mit 100 | 8–30 ms, 7 bis 27 Warnungen | `store.ts`: je 40 Zeilen als ein JSON-Text, SQLite zerlegt ihn im Faden der Datenbank (`json_each`) | beim Home-Laden keine Warnung; bei „My Lists“ (vier Anfragen gleichzeitig) 2–3 Stücke von 10–42 ms |
| Erste Benutzung des Kerns nach dem App-Start (Datenbank öffnen, Code des Kerns zum ersten Mal laden) | 126–139 ms | – | 11–32 ms |

Home-Laden nachher: 2 Warnungen (32 ms erste Benutzung, 37 ms `JSON.parse`), vorher 10 (längstes 500 ms). „My Lists“ nachher: 7 Warnungen, längstes 42 ms, vorher 9 (längstes 466 ms). Der Wächter nennt jetzt den Teil der Arbeit (`… (reading AniList's answer) held the app's thread …`).

Offen:
- `JSON.parse` von 1 MB liegt mit 20–37 ms über der Grenze. Kleiner geht es nur, wenn die Sammlung in Stücken geholt wird (`MediaListCollection(chunk, perChunk)`); dabei ist ungeprüft, ob die Listen in derselben Reihenfolge zusammenkommen, und es kostet mehrere Anfragen bei einer Grenze von zurzeit 30 je Minute.
- Laufen mehrere Anfragen des Kerns zugleich, misst der Wächter ein gemeinsames Stück und nennt die Anfrage, die zuletzt begann; die Stücke von 10–42 ms bei „My Lists“ sind deshalb noch keiner Arbeit sicher zugeordnet.
- Wird die Test-App kalt über den Schalter-Link gestartet, bleibt sie auf dem Startbild stehen, bis sie noch einmal nach vorn geholt wird (am 13.11. einmal beobachtet). Untersucht in §4e: alt, nicht aus dem Kern.

## 4e. Start ohne Warten auf den Server (Phase 2c)

Mit den Bereichen `settings` **und** `anilist` an zeigt die App Home, bevor der Server bereit ist. Mit einem der beiden aus bleibt der Start, wie er war. Code: `native/src/core/start/start.ts` (Kern), `native/src/lib/server/start-gate.ts` (Seite der Oberfläche), je eine Zeile in `requests.ts`, `server-data-wrapper.tsx`, ein Block in `client-providers.tsx`.

### `GetStatus` zerlegt

Die erste Frage der App ist der Status. Felder nach der Aufzeichnung `STATUS.GetStatus` vom 13.11.:

| Feldgruppe | Wer liefert vor dem Server | Grund |
|---|---|---|
| `settings`, `themeSettings` | **Kern**, sofort (Tabellen `settings_sections`, `appearance`) | gehören seit 1b dem Kern |
| `user` (`viewer`, `isSimulated`) | **Kern**, sofort: `viewer` aus der Tabelle `account` (vom Umzug §4c), `isSimulated: false` | Nur wenn ein Konto da ist **und** der Token im gesicherten Speicher liegt. Sonst wartet die App wie bisher: den nachgestellten Nutzer ohne Konto kennt nur der Server |
| `user.token` | **Kern**: leerer Text | Der Token steht nie in einer Antwort des Kerns; kein Bildschirm liest ihn aus dem Status (geprüft per Suche im App-Code) |
| `version`, `versionName`, `os`, `clientDevice`, `clientPlatform`, `clientUserAgent`, `dataDir`, `anilistClientId`, `featureFlags`, `disabledFeatures`, `serverHasPassword`, `contentLocked`, `isOffline`, `updating` | **letzter Stand vom Server** (Tabelle `server_answers`), nach „bereit“ frisch vom Server | Kennt nur der Server (Version des Servers, Datenordner, was er gerade tut). Feste Werte wären geraten; der letzte Stand ist das, was die App beim letzten Lauf gesehen hat |
| `mediastreamSettings`, `torrentstreamSettings`, `debridSettings` | **letzter Stand vom Server**; `debridSettings.apiKey` wird dabei geleert | Eigene Tabellen des Servers, noch nicht umgezogen. Sie bestimmen z. B., welche Ansicht die Anime-Seite zuerst zeigt – Leerlauf-Werte würden die Seite nach dem Start umspringen lassen. Der Schlüssel eines Bezahldienstes wird nicht in `core.db` kopiert |
| `serverReady` | **Kern**: `false`, bis der Server selbst `true` meldet | ist die Wahrheit |

Ablauf in `startStatus` (Antwort auf `GET /api/v1/status`):

1. `anilist` aus → Status vom Server mit eigenen Einstellungen (`statusWithOwnSettings`, wie seit 1b). Nichts wird aufgehoben.
2. Fehlt dem Kern eines von drei Dingen – Einstellungen, Konto mit Token, letzter Stand des Server-Teils – dann wie 1. (wartet auf den Server, „L o a d i n g“ wie bisher). Der Server-Teil wird bei jedem Status mit `serverReady: true` gespeichert; der **erste** Start nach dem Einschalten wartet also noch.
3. Sonst: Meldet der Server-Prozess, dass er lauscht (`SeanimeServer.getStatus().state === "ready"`, über `connectServerState`), wird er gefragt. Ist er bereit → sein Status, fertig. Lädt er noch oder antwortet nicht → eigener Teil + Server-Teil, `serverReady: false`.
4. Lauscht er noch nicht: Antwort **ohne** jede Anfrage an den Server (am Gerät 82 ms).

### Start-Schranke

- Antwortet der Kern nach 3./4., **hält er Anfragen an den Server zurück** (`isServerHeldBack()`), bis ein Status mit `serverReady: true` kommt. `buildSeaQuery` wartet in dieser Zeit mit allem, was noch dem Server gehört (`serverWait()`); die Hooks stehen so lange auf „lädt“ und füllen sich danach von selbst. Schnittstellen des Kerns (AniList, Home-Elemente, Einstellungen) antworten sofort.
- `ServerDataWrapper` zeigt „L o a d i n g“ nur noch, wenn der Server nicht bereit ist **und** nichts zurückgehalten wird (`waitsForServer`). Ohne Status bleibt das Logo wie bisher.
- Der Status wird wie bisher alle 2 s neu gefragt, bis `serverReady` stimmt, zusätzlich beim Ereignis `server-ready`.
- Kommt der Server nicht: Nach 60 s gibt `core-switch.ts` auf (`giveUpServerWait`), die Anfragen gehen raus und scheitern wie früher; dieser Lauf der App fragt den Status dann wieder auf dem alten Weg.
- Bereiche aus (oder per Link ausgeschaltet): nichts wird zurückgehalten, `buildSeaQuery` prüft nur einen Wahrheitswert.

### Home und Anime-Seite: letzter Stand des Servers

Home hängt an `GET /api/v1/library/collection`, die Anime-Seite an `GET /api/v1/library/anime-entry/{id}`. Beide mischen lokale Dateien, Downloads, Zuordnungen und Folgen-Metadaten (Aufzeichnung: `unmatchedLocalFiles`, `libraryData`, `downloadInfo`, `episodes`, `stream.continueWatchingList`); der Kern kann sie nicht eindeutig selbst zusammensetzen. Deshalb:

- Beide laufen bei `anilist` an durch den Kern (`lastStateOf`), der Kern **baut sie nicht**, er hebt die letzte Antwort des Servers auf (Schema-Schritt 4, Tabelle `server_answers`: `question`, `answer`, `changed_at`; von den Einträgen einzelner Anime die 60 zuletzt gelesenen).
- Wird zurückgehalten und ist eine Antwort aufgehoben → sie wird gezeigt. Ist keine da (Anime nie geöffnet) → die Anfrage wartet auf den Server; die Details (`media-details`) lädt der Kern schon vorher, die Seite selbst braucht aber den Eintrag und zeigt bis dahin ihren Ladezustand. Ein halber Eintrag nur aus AniList-Daten (ohne Fortschritt, ohne Folgen) würde kurz „nicht in der Liste“ zeigen – nicht eindeutig, nicht gebaut.
- Sobald der Server bereit ist, liest die App genau diese beiden Abfragen neu (`readAgainAfterStart`, Log: `Server ready after a start from the core, reading its answers again`).

„My Lists“ kommt wie seit 2a vom Kern (AniList direkt, bei Ausfall eigener Speicher) und braucht den Server nicht.

### Testweg

`native/src/core/start/start.test.ts` (17 Fälle: Bereiche aus; `settings` allein wie bisher; Kern-Felder sofort ohne Anfrage an den Server; Server kommt später – lauscht, lädt, bereit; fehlende Teile → alter Weg; Aufgeben; letzter Stand zeigen, neu lesen, warten; nichts Geheimes in `server_answers`; Begrenzung auf 60) und `native/src/lib/server/start-gate.test.ts` (8 Fälle: Schranke an/aus, Nachladen genau einmal). Alle persönlichen Werte erfunden.

### Am Gerät

Pixel Tablet, Nutzer 10, Test-App, 13.11.2026 15:27–15:40, Build `D:\SNB\build-kern-2c.log`. Belege: `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\2c\`. In der App wurde nichts geändert; kein Tipp, nur Links.

Gemessen wird der Start nach `install -r` (Android startet die App danach selbst neu, Prozess und Server neu). Bildschirmaufnahme, 10 Bilder/s, gezählt vom ersten Bild mit App-Fenster bis zum ersten Bild von Home mit Covern (`2c-aus-bogen.png`, `2c-an-bogen.png`), je 1 Lauf, gleiche APK:

| | Bereiche aus | `settings` + `anilist` an |
|---|---|---|
| App-Fenster → Home-Gerüst | 1,8 s | 0,1 s |
| **App-Fenster → Home mit Covern** | **2,3 s** | **0,5 s** |
| Bild „L o a d i n g“ | ja | nein |
| Start (Log) → Status in der App | 0,61 s (vom Server) | 0,49 s (vom Kern, 82 ms, keine Anfrage) |
| Start (Log) → Server meldet `server-ready` | 2,04 s | 1,92 s |

Log mit Bereichen an (`2c-an-logcat.txt`), Home hat seinen Inhalt 1,17 s vor `server-ready` und noch vor „Seanime started“:

```
15:38:56.603 START u10 … MainActivity
15:38:57.089 [Core] GET /api/v1/status answered by the core, no HTTP (82 ms)
15:38:57.240 SeanimeBackend … Seanime started at http://127.0.0.1:43212
15:38:57.306 [Core] GET /api/v1/status/home-items answered by the core, no HTTP (88 ms)
15:38:57.352 [Core] GET /api/v1/library/collection answered by the core, no HTTP (134 ms)
15:38:58.522 SeanimeBackend … ws > Sending message type=server-ready
15:38:58.742 [Data Wrapper] Server ready after a start from the core, reading its answers again
15:38:59.162 [Core] GET /api/v1/library/collection answered by the core, no HTTP (420 ms)   ← frisch vom Server
```

Dr. STONE (`seanime-native://entry?id=105333`) mit beiden Bereichen an: Seite vollständig mit Fortschritt und Folgen (`2c-01-an-drstone.png`), Eintrag und Details liefen durch den Kern. Danach beide Bereiche aus (`areas answered by the core: none`), Status und Listen wieder vom Server, Home normal (`2c-02-aus-home.png`).

Nicht am Gerät belegt: die Anime-Seite **vor** `server-ready` (dafür müsste die App direkt nach der Installation per Link gestartet werden, das löst den Hänger unten aus); der Fall ist in den Tests.

### Hänger beim Start über einen Link direkt nach der Installation (aus 2a gemeldet)

**Alt, nicht aus dem Kern-Umbau.** Untersucht mit der APK von vor 2c (Stand 2a-Korrektur) und mit der neuen, Bereiche jeweils aus (`2c-p4-*`, Lebenszyklus aus `logcat -b events` in `2c-p4-lebenszyklus.txt`):

- Nach `install -r` einer App, die vorn war, startet Android (`systemui`) ihre Aufgabe 1–4 s später selbst neu (`START … flg=0x8000`, Grund `clear-task-all`). Startet man in dieser Zeit selbst (`am start`, mit oder ohne Link), entsteht die Activity **zweimal** kurz nacheinander; `Running "main"` steht zweimal im Log. Das passiert mit der alten APK genauso (15:27:35 und 15:27:38).
- Die erste Activity wird erst zerstört, **nachdem** die zweite schon läuft (alt: zweite `resume` 15:27:38.361, erste `destroy` 15:27:38.725; neu: 15:34:23.482 / danach). React Natives Zeitgeber (`JavaTimerManager.onHostDestroy`) räumt dabei seinen Takt ab und setzt ihn erst beim nächsten `resume` wieder. Danach laufen in JS keine Zeitgeber mehr: kein erneuter Versuch, kein 2-s-Nachfragen.
- Folge hängt vom Zeitpunkt ab. Alte APK, Abstand 2,4 s: Der Status war schon da (15:27:37.894), die App lief normal weiter. Neue APK, Abstand 1,0 s: Der erste Status-Versuch traf den Server, bevor er lauschte; der zweite Versuch kam nie → Logo ohne Ende (`2c-p4-neu-haengt.png`, über 1 min), bis die App neu nach vorn kommt. Das ist dieselbe Erscheinung wie am 13.11. in 2a (damals ~80 s).
- Die Ursache im Zeitgeber ist aus dem Ablauf und dem React-Native-Quelltext geschlossen, nicht mit einem eigenen Log bewiesen. Nicht behoben (kein Kern-Code beteiligt; betrifft nur den Start per Befehl direkt nach einer Installation). Für Messungen: nach `install -r` **nicht** selbst starten, Android tut es.

## 4f. AniList ändern mit Warteschlange (Phase 2b, Bereich `anilist`)

Der Kern ändert die Listen des Nutzers selbst bei AniList: Eintrag anlegen und bearbeiten (Status, Wertung, Fortschritt, Start- und Enddatum), Fortschritt setzen (Anime und Manga), Zahl der Wiederholungen, Eintrag löschen. Gleicher Bereich wie das Lesen (`anilist`, Standard aus); ist er aus, geht alles wie bisher zum Server.

| Teil | Wo | Was |
|---|---|---|
| Schnittstellen, Warteschlange, Regeln, Wächter | `native/src/core/anilist/changes.ts` | jede Änderung: prüfen → in die Warteschlange → eigener Speicher sofort → senden |
| Senden | `changeAnilist` in `client.ts` | der einzige Weg, auf dem eine Mutation hinausgeht; braucht den Token; gleiches Rate-Limit wie das Lesen |
| Mutationen | `queries.ts` | `SaveMediaListEntry` (nur die mitgeschickten Felder ändern sich), `DeleteMediaListEntry`, `Media.mediaListEntry` (eigener Eintrag eines Titels), `Viewer { id }` |
| Ein Eintrag im Speicher | `putEntry`, `removeEntry`, `storedEntry` in `store.ts` | ändert einen Eintrag an Ort und Stelle, hängt ihn in die Liste seines Status um |
| Tabelle | `anilist_changes` (Schema-Schritt 5) | eine Zeile je Titel: Konto, Titel, Art (`save`/`delete`), Felder, Fortschritt vor der ersten ungesendeten Änderung, Versuche, letzter Fehler |
| Testdaten | `changes.recorded.json` | aus der Aufzeichnung (§6): Anfragen, Antwort, Fehlertexte, Status nach Fortschritt, Ereignisse; Nummern und Zeiten erfunden |

### Schnittstellen im Kern

| Schnittstelle | Was | Aufgezeichnet |
|---|---|---|
| `POST /api/v1/anilist/list-entry` | Eintrag wie im Bearbeiten-Blatt: Status, Wertung (0–100), Fortschritt, beide Daten. Ein Datum, das die Anfrage weglässt, wird gelöscht. Wertung und Fortschritt müssen dabei sein | Antwort `true`; ohne Wertung/Fortschritt 500 mit AniLists Text („The score raw must be an integer.“) |
| `DELETE /api/v1/anilist/list-entry` | Eintrag löschen | `true`; ohne `mediaId`/`type` 500 „missing parameters“; Titel nicht in den Listen 500 „list entry not found“ |
| `POST /api/v1/library/anime-entry/update-progress` | Folge als gesehen markiert: Fortschritt = diese Folge, **auch rückwärts** | `true` |
| `POST /api/v1/manga/update-progress` | dasselbe für Kapitel | `true` |
| `POST /api/v1/library/anime-entry/update-repeat` | Zahl der Wiederholungen | `true`, danach kein Ereignis |

**Status nach einem Fortschritt (aufgezeichnet, 8 Fälle):** letzte Folge (Fortschritt = Gesamtzahl, Gesamtzahl > 0) → `COMPLETED`; Eintrag steht auf `REPEATING` → bleibt `REPEATING`; alles andere (`PLANNING`, `CURRENT`, `COMPLETED`, kein Eintrag) → `CURRENT`. Gesamtzahl 0 (unbekannt) schließt nie ab. Nicht aufgezeichnet und so angenommen: `PAUSED`/`DROPPED` → `CURRENT`; `REPEATING` an der letzten Folge → `COMPLETED`. Die Daten setzt AniList selbst (erster Fortschritt ohne Eintrag: Start heute; Abschluss: Ende heute); der Kern schickt sie dabei nicht mit und sagt sie für die Zeit ohne AniList genauso voraus.

**Fehlertexte:** Der Server reicht AniLists Ablehnung als 500 mit dem rohen Text seiner GraphQL-Bibliothek durch. Der Kern antwortet mit demselben Status und AniLists eigenen Sätzen je Feld (`validation`), ohne die Hülle. Fehlende Wertung/Fortschritt prüft er selbst vorab (gleiche Sätze), damit so eine Änderung nicht erst in der Warteschlange scheitert.

**Nach einer Änderung** (aufgezeichnet): Der Server liest seine Listen neu und schickt allen `refreshed-anilist-anime-collection` bzw. `…-manga-collection` (Inhalt `null`); die Oberfläche liest daraufhin Listen, Bibliothek und Anime-Seite neu (`_listeners/anilist-collection.listeners.ts`). Der Kern tut dasselbe: Nach dem Senden bittet er den Server, falls er läuft, per `POST /api/v1/anilist/collection` seine beiden Sammlungen neu zu lesen (dessen Anime-Seiten und Bibliothek kommen aus seinen eigenen Listen; höchstens 10 s Wartezeit), dann schickt er das Ereignis über den Verteiler (§4b).

**Favoriten:** Die App hat dafür keine Schnittstelle (in `endpoints.ts` und den Hooks kommt kein Favorit vor). Nichts aufgezeichnet, nichts gebaut.

**Korrektur am Lesen (aus der Aufzeichnung):** Das Test-Konto wertet mit 10 Punkten, die Listen des Servers zeigen trotzdem `"score": 80`. Der Kern las die Wertung bisher im Format des Kontos; jetzt fragt er `score(format: POINT_100)`.

### Warteschlange

Jede Änderung nimmt denselben Weg, ob AniList erreichbar ist oder nicht:

1. Anfrage prüfen, Wächter (unten).
2. In `anilist_changes` schreiben (zusammengefasst mit einer wartenden Zeile desselben Titels) und den eigenen Speicher sofort anpassen: Die Listen des Kerns zeigen den neuen Stand.
3. Die Warteschlange senden, in Reihenfolge. Erreichbar: Das passiert in derselben Anfrage; der Speicher übernimmt, was AniList antwortet (Nummer des Eintrags, Daten, `updatedAt`), die Zeile verschwindet.
4. Nicht erreichbar: Die Zeile bleibt, die Antwort ist trotzdem `true`, die App bekommt den Hinweis `info-toast` („…kept on this device and sent later“).

Gesendet wird wieder: **bevor die Listen gelesen werden** (jeder Start liest sie; so überschreibt ein Lesen nie eine ungesendete Änderung), bei der nächsten Änderung, und über einen Zeitgeber (30 s, dann verdoppelt bis 5 min). Was nach einem Lesen noch wartet, wird auf die frisch gelesenen Listen wieder aufgesetzt. Solange eine Änderung eines Anime wartet, trägt die Anime-Seite (`GET /library/anime-entry/{id}`, Antwort des Servers) den Eintrag aus dem Speicher des Kerns als `listData` (Form wie aufgezeichnet); der Server kann die Änderung noch nicht kennen.

### Konflikt-Regeln

| Regel | Begründung |
|---|---|
| **Eine Zeile je Titel.** Eine spätere Änderung desselben Titels geht Feld für Feld in die wartende Zeile, der spätere Wert gewinnt; die Zeile behält ihren Platz | AniList braucht nur den Endstand; drei Folgen hintereinander markiert sind eine Anfrage statt drei (Rate-Limit) |
| **Reihenfolge:** Gesendet wird in der Reihenfolge des Entstehens. Die erste Zeile, für die AniList nicht gefragt werden kann, hält den Lauf an | nichts überholt; ein Ausfall mitten im Lauf lässt keinen halben Stand |
| **Löschen nach Bearbeiten:** Es bleibt nur das Löschen. **Bearbeiten nach Löschen:** Erst wird AniLists Eintrag gelöscht, dann der neue gespeichert | vom alten Eintrag (Wertung, Daten) soll im neuen nichts stehen bleiben |
| **Fortschritt wird nie ungewollt kleiner.** Eine Änderung, die gewartet hat, wird vor dem Senden mit AniLists Eintrag verglichen: Ist AniList weiter als die Änderung **und** steht nicht mehr dort, wo die Änderung begann (auf einem anderen Gerät weitergeschaut), wird der Fortschritt nicht gesendet, ebenso wenig ein Status, der nur aus ihm folgte. Übrige Felder (gewählter Status, Wertung) gehen | die App wusste beim Ändern nichts vom neueren Stand; der höhere ist der echte |
| Eine Änderung, die **sofort** hinausgeht, wird gesendet, wie sie ist, auch rückwärts | so macht es der Server (aufgezeichnet: Eintrag bei 7, Folge 2 markiert → 2); der Nutzer sieht den Stand, den er ändert. Steht AniList noch dort, wo eine wartende Änderung begann, gilt auch später: zurück war gewollt |
| **AniList lehnt ab** (Status 400–499 außer 429): Änderung verwerfen, Eintrag neu von AniList lesen, melden (sofort: Fehler der Anfrage; später: `error-toast`) | AniList nähme sie auch beim nächsten Versuch nicht; die Liste soll nicht dauerhaft etwas zeigen, das es nicht gibt |
| **AniList nicht fragbar** (Netz, Zeitüberschreitung, 5xx, 429): Änderung bleibt, Versuch wird gezählt, später erneut | ein erneutes Senden schadet nicht: gesendet werden Endstände, das Löschen fragt vorher nach dem Eintrag |
| **Eine Änderung gehört dem Konto, mit dem sie gemacht wurde** (Name aus `account`). Ist inzwischen ein anderes angemeldet, wird sie verworfen, nie gesendet | eine Änderung darf nie auf einem fremden Konto landen |

Bewusst später: Ein neuer Eintrag für einen Titel, den die Listen des Kerns noch nie gelesen haben, erscheint ohne AniList noch nicht in den Listen (dem Speicher fehlt der Titel); er wartet und erscheint nach dem Senden. Die Bibliothek der Startseite (`GET /library/collection`, Server) zeigt eine wartende Änderung erst nach dem Senden. Der Abgleich mit MyAnimeList, den der Server beim Fortschritt mitmacht (`malId`), fehlt im Kern.

### Wächter und Test-Konto

Geschrieben wird beim Entwickeln nur auf ein eigenes AniList-Test-Konto (Nummer **(nicht veröffentlicht)**, leer, nur in der scratch-App angemeldet). Das Konto des Nutzers in Test-App und echter App wird nie für Versuche geändert. Zwei Wächter, beide ohne den Namen des Kontos irgendwo festzuhalten:

- **Im Skript** (`record-server.mjs anilist-write`, `anilist-guard`, `anilist-clear`, immer mit `--test-account <Test-Konto>`): Name des angemeldeten Kontos aus dem Status der App, dessen Nummer per öffentlicher Abfrage bei AniList. Jede andere Nummer oder keine Antwort beendet den Lauf vor der ersten Änderung; vor jedem einzelnen Schritt wird der Name erneut verglichen. Nur Port 43213.
- **Im Kern** (`onlyAccount` in der Umgebung): Der Wirt kann das eine Konto nennen, das der Kern ändern darf. Dann fragt der Kern AniList mit seinem eigenen Token nach `Viewer { id }` (einmal je Token, nur im Arbeitsspeicher) und lehnt bei anderer Nummer oder ohne Antwort ab (403), **bevor** etwas in die Warteschlange kommt; auch der spätere Versand prüft. Die scratch-App ändert nichts, bis ihr ein Konto genannt ist (`seanime-scratch://core?write-account=<Test-Konto>`, gespeichert in MMKV `seanime-core-write-account`; `none` nimmt es zurück). Die anderen Varianten ändern das angemeldete Konto, solange ihnen keines genannt ist. Der Wächter des Skripts sieht nur den Token des Servers; dieser hier den des Kerns, der aus dem Umzug (§4c) stammt.

**Ausfall nachstellen** ohne das Netz des Geräts anzufassen: `core?anilist=down` lässt die Anfragen des Kerns an AniList scheitern wie ohne Netz (nur im Arbeitsspeicher, bis `core?anilist=up` oder Neustart der App); `up` liest alles neu, was die Warteschlange sendet.

### Testweg

`src/core/anilist/changes.test.ts` (18 Tests, ohne Netz; AniList ist ein Test-Double, das Einträge hält wie aufgezeichnet): Antworten, Fehlertexte, Status nach Fortschritt und Ereignisse gegen die Aufzeichnung; Warteschlange: ohne AniList speichern und sofort zeigen (Listen und Anime-Seite), Reihenfolge und Anhalten, Zusammenfassen, Fortschritt-Schutz (vier Fälle), Löschen/Bearbeiten in beiden Reihenfolgen, 4xx verwerfen + melden, Netz/500/503/429 behalten, Neustart mit offener Warteschlange, Lesen der Listen bei noch wartender Änderung, fremdes Konto; Wächter; Bereich aus → Server. `askAnilist` sendet weiterhin keine Mutation (`anilist.test.ts`).

### Am Gerät (Pixel Tablet, scratch-App, Nutzer 10, Test-Konto, 13.11.2026 16:56–17:00)

scratch gebaut und per `install -r` aktualisiert. Links: `core?write-account=<Test-Konto>` (Log: „the core may change on AniList: account <Test-Konto> only“), `core?move=again` („account moved 1“, damit hat der Kern Konto und Token des Test-Kontos), `core?area=anilist&on=1`. Vor jedem Tipp, der etwas ändert, der Wächter des Skripts (`anilist-guard`); der Wächter im Kern lief beim ersten Schreiben mit.

| Schritt | Beleg |
|---|---|
| vorher | AniList öffentlich, Test-Konto: keine Einträge |
| Dr. STONE, „+“ (auf die Liste), AniList erreichbar | `POST /api/v1/anilist/list-entry answered by the core, no HTTP (733 ms)`, `changes for AniList: 1 sent, 0 dropped, 0 waiting`; keine Zeile des Servers zu dieser Anfrage; AniList öffentlich 6 s später: 105333 `PLANNING` |
| `core?anilist=down` | `AniList for the core: cut off (test switch)` |
| zweiter Titel (210482), „+“, ohne AniList | `POST /api/v1/anilist/list-entry answered by the core, no HTTP (117 ms)`, `0 sent, 0 dropped, 1 waiting`; AniList öffentlich unverändert (nur 105333); auf der Seite verschwindet das „+“ wie mit AniList |
| `core?anilist=up` | `AniList for the core: reachable`, `1 sent, 0 dropped, 0 waiting`; AniList öffentlich: 105333 und 210482 `PLANNING` |
| aufräumen | `anilist-clear`: 2 gefunden, entfernt, 0 übrig; AniList öffentlich: keine Einträge; Bereich `anilist` aus (`areas answered by the core: none`) |

Belege: `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\2b-geraet-log.txt` (alle `[Core]`-Zeilen des Laufs) und `2b-1…4-*.png`; Build-Log `D:\SNB\build-kern-2b.log`.

**Nicht am Gerät belegt, nur in den Tests:** das Bearbeiten-Blatt (Status, Wertung, Fortschritt, Daten), Fortschritt über eine Folge oder ein Kapitel, Löschen und Wiederholungen aus der App, Manga, der Fortschritt-Schutz, eine Ablehnung durch AniList, der Zeitgeber. Dass AniList ein Datum löscht, wenn es als `{ year: null, month: null, day: null }` kommt, ist aus der öffentlichen Doku angenommen und nicht gegen das echte AniList geprüft (der Server löscht ein weggelassenes Datum, wie er es schickt, ist nicht bekannt).

**Aufgefallen:** Nach einem `core?anilist=…`-Link stand die App nicht mehr auf der Anime-Seite, auf der sie vorher war; vor dem nächsten Tipp also neu hinsehen. Der Wächter für den Faden der Oberfläche meldete in diesem Lauf `first use of the core` 39 ms und zweimal `GET /api/v1/library/anime-entry/{id}` 14–19 ms am Stück (mehr als die erlaubten 8 ms); ob das mit 2b neu ist, wurde nicht untersucht.

### Am Gerät, Phase 2d (Pixel Tablet, scratch-App mit dem 2b-Build, Nutzer 10, Test-Konto, 13.11.2026 17:05–17:12)

Vor jedem ändernden Tipp `anilist-guard` (jedes Mal <Test-Konto>), vor jedem Tipp ein frischer Bildschirmfoto. Links: `core?write-account=<Test-Konto>`, `core?area=anilist&on=1`.

| Schritt | Beleg |
|---|---|
| vorher | AniList öffentlich, Test-Konto: keine Einträge |
| Dr. STONE, „+“ (auf die Liste) | `POST /api/v1/anilist/list-entry answered by the core, no HTTP (405 ms)`, `1 sent, 0 dropped, 0 waiting` |
| Bearbeiten-Blatt: Status „Watching“, Wertung +1, Fortschritt +1, Speichern | `POST /api/v1/anilist/list-entry answered by the core, no HTTP (425 ms)`, `1 sent, 0 dropped, 0 waiting`; AniList öffentlich: 105333 `CURRENT`, Fortschritt 1, Wertung 10 (1 von 10 in der 100er-Skala des Kontos) |
| Bearbeiten-Blatt: Papierkorb, „Confirm“ | `DELETE /api/v1/anilist/list-entry answered by the core, no HTTP (584 ms)`, `1 sent, 0 dropped, 0 waiting`; AniList öffentlich: keine Einträge |
| aufräumen | `anilist-clear`: 0 gefunden, 0 übrig; Bereich `anilist` aus (`areas answered by the core: none`) |

Im ganzen Lauf keine Zeile des Servers zu `list-entry` im Log. Belege: `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\2d\2d-scratch-log.txt` (alle `[Core]`-Zeilen ab 17:05) und `2d-b*.png`.

**Folge als gesehen markieren (Schnittstelle `UpdateAnimeEntryProgress`) ist am Gerät nicht belegt:** Die App bietet „Mark as watched“ nur in der Folgenliste der eigenen Dateien (`episode-section.tsx`, `EpisodeItem`); die scratch-App hat keine Dateien von Dr. STONE und keinen Online-Anbieter, die Liste „not in your library“ hat nur „Episode info“. Der Fortschritt wurde stattdessen über das Bearbeiten-Blatt gesetzt (oben). Für den Beleg bräuchte die scratch-App eine Datei einer Folge im Bibliotheksordner.

**Aufgefallen:** Nach dem Speichern im Blatt zeigte der Kopf der Anime-Seite weiter „0/24 Planning“, das Blatt selbst beim erneuten Öffnen die neuen Werte (Fortschritt 1, Wertung 1). Der Kopf kommt aus `library/anime-entry`; ob der Kern dort nach einer Änderung den eigenen Stand zeigen muss (Test „sofort zeigen … Anime-Seite“ in `changes.test.ts`) oder die Seite nur nicht neu liest, ist nicht untersucht.

**Wächter `first use of the core` (39 ms in 2b, 35,5 ms in 2d am alten Build):** Ursache ist die Messung, nicht der Kern. `prepareCore` wartete auf die schon geöffnete Datenbank ohne `watch.waiting`; das Warten endet dann erst im nächsten Mikro-Schritt, und bis dahin läuft im selben Takt der Rest des Links (`console.log`, `queryClient.invalidateQueries()`, der alle Abfragen neu startet, samt den ersten synchronen Stücken der neuen Anfragen an den Kern). All das zählte der Wächter als „first use of the core“. Behoben in `core-switch.ts` (`openedDatabase = watch.waiting(ownDatabase)`): das Stück endet jetzt, bevor der Link weiterläuft, und die neu gestarteten Anfragen melden sich unter eigenem Namen. Am Gerät mit dem neuen Build noch nicht nachgemessen (der Bereich wird nur in scratch eingeschaltet, scratch hat noch den 2b-Build). Im selben Lauf meldete der Wächter außerdem `GET /api/v1/anilist/media-details/210482` 44,7 ms und `POST /api/v1/anilist/list-entry` 9,3 ms am Stück: das sind echte Stücke des Kerns, offen (§4g).

## 4g. Offen aus Stufe 2

- ✅ **Holen der Sammlung in Stücken – begründet geschlossen (Reste-Lauf 14.11., §4r):** Das Formen läuft seit 2d Eintrag für Eintrag mit Pause; übrig ist nur `JSON.parse` der einen Antwort. Stücke (`chunk`/`perChunk`) kosten je Liste mehrere Anfragen bei 30 je Minute, die Reihenfolge der Listen über Stücke ist ungeprüft, und das Test-Konto ist leer (nicht messbar). Ursprünglich: Die ganze AniList-Sammlung kommt in einer Antwort; bei großen Listen dauert das (2a: bis 0,6 s) und hält den Faden in langen Stücken (`media-details` 44,7 ms, `anime-entry` 14–19 ms). Aufteilen mit `pause` oder in Seiten.
- **Home und Anime-Seite bleiben bis Stufe 5 die letzte Antwort des Servers** (§4e): ohne Server zeigen sie den gespeicherten Stand; der Kopf der Anime-Seite zeigt eine Änderung aus dem Kern erst nach neuem Lesen (oben).
- ✅ **Einstellungen speichern vor dem Server (Reste-Lauf 14.11., §4r):** gespeichert hat der Kern schon immer, die Antwort (Status) fragte aber den Server → Fehler in den ersten ~2 s. Jetzt antwortet ein Speichern ohne Server mit dem Status des Starts (Server-Teil wie zuletzt gemerkt, `serverReady: false`).
- ✅ **Datum löschen – per Test geprüft (Reste-Lauf 14.11., §4r):** der Kern sendet für geleerte Start-/Enddaten `{ year: null, month: null, day: null }` (öffentliche Doku `FuzzyDateInput`) und behält den Eintrag ohne Datum; am Gerät nicht geschrieben. Ursprünglich: dass AniList ein Datum mit `{ year: null, month: null, day: null }` löscht, ist nur aus der Doku angenommen.
- **Favoriten ohne App-Schnittstelle:** die App hat keinen Weg, einen Favoriten zu setzen; der Kern bietet deshalb keinen.
- **Folge als gesehen markieren** am Gerät nicht belegt (nur in den Tests), siehe oben.
- **Wächter `first use of the core`** nach dem Fix am Gerät nachmessen (nächster scratch-Build).

## 4h. Sandkasten für Erweiterungen (Phase 3a, am Gerät belegt)

Eine Erweiterung (Quelle) läuft in einer eigenen QuickJS-Laufzeit mit harten Grenzen. Drinnen gibt es nur die Sprache selbst und eine Tür zum Wirt.

### Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Vertrag | `native/src/core/extensions/sandbox/sandbox.ts` | `openSandbox(engine, { limits, host })` → `load(code)`, `call(pfad, …argumente)`, `close()`. Argumente und Ergebnis sind JSON, ein Promise wird abgewartet. `SandboxEngine` ist der schmale Vertrag darunter: `open(limits, host)` → `run(code, name)` / `close()` |
| Unterbau Tests | `…/sandbox/node-engine.ts` | QuickJS als WebAssembly (`quickjs-emscripten` 0.32.0, MIT, nur Entwickler-Abhängigkeit). Nur unter Node; einzige Datei des Kerns mit dieser Ausnahme (§2 Regel 5) |
| Unterbau Gerät | `…/sandbox/device-engine.ts` | spricht mit dem nativen Modul, das ihm hineingereicht wird (der Kern bindet nichts von außen ein). Verdrahtet in `native/src/api/client/core-sandbox.ts` |
| Modul | `native/modules/core-sandbox/` (geteiltes C++, über Nitro angebunden) | je Sandkasten eine eigene Laufzeit von **quickjs-ng 0.18.0** (MIT, Quelltext im Modul) auf genau einem eigenen Faden. `CoreSandboxFactory.create(…)` → `CoreSandboxBox` mit `run`, `answerHost`, `close`; dazu `nativeHeapBytes`. Alles asynchron, nie im Faden der Oberfläche. Siehe „Das Modul“ |
| Selbsttest | `…/sandbox/selftest.ts` | dieselben Proben gegen jeden Unterbau: unter Node im Test, am Gerät per Link |

**Tür zum Wirt:** Im Sandkasten gibt es `__host(name, payloadJson)` (liefert ein Promise auf JSON-Text) und darauf `host.ask(name, payload)`. Der Wirt bietet benannte Funktionen an (`host: { fetch: …, … }`); was er nicht anbietet, wird abgelehnt und kommt drinnen als Fehler an. Am Gerät geht die Frage über den Rückruf `onHostCall(call, name, payload)`, den der TS-Teil beim Anlegen mitgibt, an die App, die Antwort mit `answerHost(call, ok, value)` zurück. Daraus wird in 3b das `fetch` der Erweiterungen.

**Fehlerarten** (`SandboxError.kind`): `thrown` (Wurf im Code, auch Syntaxfehler), `time` (Zeitlimit), `memory` (Speicherlimit; der Sandkasten wird danach geschlossen), `stack` (Stapel), `closed`. Zeit und „geschlossen“ meldet der Unterbau selbst; Speicher und Stapel werden am Text des QuickJS-Fehlers erkannt (`out of memory`, `stack overflow` bzw. bei quickjs-ng `Maximum call stack size exceeded`), an einer Stelle für beide Unterbauten. Das Modul lehnt mit einem Text ab, der mit `ERR_SANDBOX_TIME: `, `ERR_SANDBOX_CLOSED: ` oder `ERR_SANDBOX: ` beginnt (Nitro reicht nur den Text eines Fehlers durch, keinen Code); `device-engine.ts` liest das wieder aus.

**Aufruf ohne Code-Einschleusung:** `call` nimmt nur einen Namen aus Bezeichnern und Punkten (`provider.search`); die Argumente gehen als JSON-Text hinein und werden drinnen mit `JSON.parse` gelesen.

### Grenzen (unter Node belegt, `sandbox.test.ts`)

Standard wie in Probe 2: 64 MB Speicher, 512 KB Stapel, 60 s je Laden oder Aufruf (Warten auf den Wirt eingeschlossen).

| Probe | Ergebnis unter Node |
|---|---|
| Endlosschleife, Limit 300 ms | nach dem Limit gestoppt (`time`), auch nach einem `await`; Sandkasten läuft weiter |
| Aufruf wartet auf den Wirt, Limit 300 ms | gestoppt (`time`) |
| Speicherbombe, Limit 16 MB | gestoppt (`memory`), Sandkasten danach geschlossen |
| endlose Rekursion | `stack`, Sandkasten läuft weiter |
| Zugriff nach außen | `require`, `process`, `module`, `std`, `os`, `Deno`, `XMLHttpRequest`, `WebSocket`, `fetch`, `setTimeout`, `setInterval`, `console` gibt es nicht; `import()` von `std`, `os`, `fs`, einer Datei wird abgelehnt |
| zwei Sandkästen | ein globaler Wert des einen ist im anderen nicht da |
| Tür | Antworten als JSON, drei Fragen gleichzeitig, Ablehnung kommt drinnen als Fehler an, Abruf über den Wirt |
| 20-mal anlegen, nutzen, schließen | läuft; Speicher wird nur am Gerät gemessen (`nativeHeapBytes`) |

### Vergleich mit Probe 2 (Node, 13.11.2026)

Die Suche „dr. stone“ der beiden eigenen Torrent-Quellen über die neue Schicht (`fetch` und `console` als Vorspann auf `host.ask`, TypeScript einmal nach JavaScript gewandelt, als einmaliger Skript-Lauf, nicht im Repo): **85 Treffer** (0,9 s, 1 Abruf) und **74 Treffer** (0,5 s, 1 Abruf), dieselben Zahlen wie `probe-quickjs.mjs` in derselben Minute und wie der Server in Stufe 0. Verglichen ist die Zahl der Treffer, nicht jeder einzelne.

### Das Modul: geteiltes C++ um quickjs-ng, über Nitro angebunden (Entscheidung 13.11.2026)

**Warum nicht Kotlin:** Das zuerst geschriebene Kotlin-Modul um `quickjs-kt` wurde nie gebaut und ist gelöscht. Befund vor dem ersten Build, an den Dateien von Maven Central und dem Gradle-Zwischenspeicher (`javap`):

| Was | Befund |
|---|---|
| App (Expo SDK 58) | Kotlin-Compiler 2.2.0, `kotlinx-coroutines` 1.10.2 (über `expo-modules-core`) |
| quickjs-kt 1.0.18 (07.11.2026), ebenso 1.0.6–1.0.17 | gebaut mit Kotlin 2.4 (`kotlin-stdlib` 2.4.21 bzw. 2.4.10, Metadaten 2.4.0 in 1.0.18 gemessen; dass Kotlin 2.2 nur bis 2.3 liest, ist die Regel aus der Kotlin-Doku, nicht nachgebaut) und gegen `kotlinx-coroutines` 1.11.0. Der Bytecode von 1.0.18 ruft `Mutex.tryLock$default` / `unlock$default` an der Schnittstelle `Mutex` auf (89 Stellen in `QuickJs.class`); in 1.10.2 liegen sie nur in `Mutex$DefaultImpls` → mit den Coroutinen der App wäre das ein `NoSuchMethodError` |
| quickjs-kt 1.0.5 (09.04.2026) | passt (Kotlin 2.3.20, Coroutinen 1.10.2, alle Bezüge in stdlib 2.2.0 + Coroutinen 1.10.2 vorhanden), hat `memoryLimit` und `maxStackSize`, aber **kein Zeitlimit und keinen Abbruch** (`evaluationTimeoutMillis`, `interruptEvaluation` fehlen): eine Endlosschleife wäre nicht zu stoppen |
| 16-KB-Seiten | `libquickjs.so` für arm64-v8a und armeabi-v7a in 1.0.18 und 1.0.5: alle `PT_LOAD` mit `p_align 0x4000` ✅ (0,93 MB / 0,66 MB je ABI in 1.0.18). Gemessen am AAR, nicht an einer gebauten APK |
| Grenzen in quickjs-kt 1.0.18 | laut Quelltext vorhanden: `memoryLimit`, `maxStackSize`, `evaluationTimeoutMillis`, `interruptEvaluation`; am Gerät noch nicht gemessen |

Statt Kotlin und Coroutinen der ganzen App anzuheben, ist der native Teil jetzt **ein C++-Modul für beide Plattformen**. Das löst den Konflikt (kein Kotlin-Code mehr außer der einen von Nitro erzeugten Lade-Klasse) und derselbe Quelltext baut später für iOS. QuickJS bringt alle Grenzen selbst mit: `JS_SetInterruptHandler` (Zeit), `JS_SetMemoryLimit`, `JS_SetMaxStackSize`.

| Teil | Ort in `native/modules/core-sandbox/` | Inhalt |
|---|---|---|
| QuickJS | `cpp/third_party/quickjs-ng/` | quickjs-ng **v0.18.0** (01.11.2026), unverändert, mit `LICENSE` und `VERSION.txt`. Nur der Kern: `quickjs.c`, `libregexp.c`, `libunicode.c`, `dtoa.c` und ihre Kopfdateien. **Nicht** `quickjs-libc` (kein `std`, kein `os`), keine Werkzeuge, keine Tests |
| Sandkasten | `cpp/SandboxCore.hpp/.cpp` | plattformneutral: nur POSIX-Fäden, C++-Standardbibliothek und QuickJS; weiß nichts von React Native, Android oder iOS |
| Anbindung | `cpp/HybridCoreSandboxFactory.hpp`, `cpp/HybridCoreSandboxBox.hpp` | die beiden Nitro-HybridObjects (C++), dünn: reichen Arbeit an den Faden des Sandkastens und lösen Promises |
| Spezifikation | `src/CoreSandbox.nitro.ts` → `nitrogen/generated/` | TypeScript-Spezifikation; der erzeugte Code ist eingecheckt. Neu erzeugen: im Modul-Ordner `npx nitrogen@0.37.2` (gleiche Version wie `react-native-nitro-modules` der App; **keine** neue Abhängigkeit in `package.json`) |
| Android | `android/CMakeLists.txt`, `android/build.gradle`, `…/cpp-adapter.cpp`, `…/SeanimeCoreSandboxPackage.java` | CMake über das NDK der App; QuickJS als statische Bibliothek in `libSeanimeCoreSandbox.so`; Linker-Schalter `-Wl,-z,max-page-size=16384` |
| iOS | `SeanimeCoreSandbox.podspec`, `nitrogen/generated/ios/` | **für iOS ungebaut**: podspec und erzeugter Code liegen da, kein Build, kein Test |

**Einbindung:** Das Modul ist eine React-Native-Bibliothek im Ordner `modules/` (`package.json` + `react-native.config.js`). Expos Autolinking findet sie dort ohne Eintrag in der `package.json` der App, eingebunden wird sie wie `react-native-mmkv` (geprüft: `npx expo-modules-autolinking react-native-config --platform android` nennt `seanime-core-sandbox` mit `SeanimeCoreSandboxPackage`). Der Weg über Nitro ging beim ersten Build; ein Rückfall auf ein reines C++-TurboModule war nicht nötig.

### Faden-Modell

- **Ein Sandkasten = ein Faden.** `JSRuntime` und `JSContext` werden auf diesem Faden angelegt, benutzt und freigegeben und wechseln ihn nie. Der Faden hat eine Aufgaben-Schlange: ein Lauf nach dem anderen, in der Reihenfolge der Aufrufe.
- Der Faden wird mit `pthread` angelegt, mit einem Stapel von Stapel-Grenze + 512 KB (auf 16 KB gerundet). So gilt die Grenze unabhängig davon, wie groß die Plattform einen Faden von sich aus macht.
- **Faden der Oberfläche:** Jede Methode legt nur eine Aufgabe in die Schlange und kehrt zurück; die Antwort kommt als Promise vom Faden des Sandkastens. `nativeHeapBytes` läuft in Nitros Faden-Vorrat.
- **Zeit:** Jeder Lauf hat eine Frist. Der Interrupt-Handler von QuickJS bricht laufenden Code ab (auch in Schritten nach einem `await`, auch in einem regulären Ausdruck); wartet der Lauf auf den Wirt oder auf nichts, wacht der Faden zur Frist auf und meldet `time`. Ein `catch` im Sandkasten kann den Abbruch nicht halten.
- **Tür:** `__host` legt ein Promise an, merkt sich dessen zwei Funktionen unter einer Nummer und ruft den Rückruf (Nitro bringt ihn in den Faden der App). `answerHost` legt die Antwort in die Schlange; der Faden des Sandkastens löst das Promise.
- **Schließen:** setzt eine Marke, die der Interrupt-Handler liest → laufender Code endet, wartende und laufende Aufrufe enden mit `closed`, dann gibt der Faden Kontext und Laufzeit frei und endet. `close()` löst sich erst danach. Wird ein Sandkasten ohne `close()` fallen gelassen, macht der Destruktor dasselbe, ohne zu warten (der Faden ist abgekoppelt und hält seinen Zustand selbst).
- **Kein Absturz:** C++-Ausnahmen aus Rückrufen werden auf dem Faden abgefangen; QuickJS ist mit `NDEBUG` gebaut, damit ein von abgebrochenem Code hinterlassener Wert beim Freigeben keine `assert` auslöst.

### Grenzen am Gerät (S22, Test-App, 13.11.2026)

Selbsttest per Link `seanime-native://core?sandbox=selftest`, zwei Läufe hintereinander, Log `[CoreSandbox]`: **12 von 12 Proben bestanden**, kein Absturz, App danach normal (Home).

| Probe | Ergebnis am Gerät (Lauf 1 / Lauf 2) |
|---|---|
| Sandkasten anlegen | 5,5 ms / 2,9 ms |
| Endlosschleife, Limit 300 ms | gestoppt nach 301 ms, nach einem `await` nach 300 ms; Sandkasten läuft weiter (Lauf 1) |
| Aufruf wartet auf den Wirt, Limit 300 ms | gestoppt nach 302 ms (Lauf 1) |
| Speicherbombe, Limit 16 MB | gestoppt nach 45 ms (`memory`), Sandkasten danach geschlossen (Lauf 1) |
| endlose Rekursion | `stack`, Sandkasten läuft weiter |
| Zugriff nach außen | nichts da (gleiche Liste wie unter Node), `import()` abgelehnt |
| zwei Sandkästen / Tür | getrennt; Antworten als JSON, drei gleichzeitig, Ablehnung kommt drinnen als Fehler an |
| Abruf über den Wirt (archive.org) | Status 200, 491 Zeichen, 1119 ms / 226 ms |
| 30-mal anlegen, nutzen, schließen | 1,8 ms / 1,4 ms je Sandkasten; Speicher außerhalb von JavaScript danach +106 KB / +124 KB (`mallinfo`, ganzer Prozess) |
| Selbsttest gesamt | 2193 ms / 1262 ms (der Unterschied ist vor allem der Abruf) |
| **8-ms-Wächter** | der Sandkasten hielt den Faden der Oberfläche in 247 Stücken, **längstes 1,5 ms / 0,4 ms, 0 über 8 ms** |
| 2-ms-Zeitgeber der App während des Tests | höchstens 31,0 ms / 30,8 ms zu spät. Das misst den ganzen Faden der App, egal wer ihn hält; die Stücke des Sandkastens (Zeile darüber) erklären es nicht. Woher die 31 ms kommen, ist **nicht untersucht** |

Vor dem Build wurde `SandboxCore` allein geprüft: mit dem NDK als Programm für arm64 übersetzt und in der Shell des S22 gestartet (Wegwerf-Programm, nicht im Repo, vom Gerät wieder gelöscht). Dort zusätzlich belegt: Schließen während einer Endlosschleife und während des Wartens auf den Wirt → beide Aufrufe und ein dahinter wartender enden mit `closed`; fallen lassen ohne `close()` während einer Endlosschleife → kein Absturz; 200 000 verschachtelte Klammern im Quelltext → `stack`; ein regulärer Ausdruck mit explodierender Laufzeit → zur Frist gestoppt; `ArrayBuffer` von 1 GB bei 16 MB Limit → abgelehnt; Anlegen 1,6 ms, 30 Zyklen je 2,4 ms, Speicher danach ±0. In der App selbst (über Nitro) sind Schließen während eines Aufrufs und Fallenlassen **nicht** eigens geprüft: der Selbsttest hat dafür keine Probe.

**APK (Variante test, arm64-v8a + armeabi-v7a):** vorher 109 859 841 Bytes, nachher **110 985 431 Bytes** (+1 125 590 Bytes, +1,07 MB). `libSeanimeCoreSandbox.so`: arm64-v8a 1 343 728 Bytes (in der APK 561 339), armeabi-v7a 950 360 Bytes (510 524). **16-KB-Seiten:** aus der APK gelesen, alle `PT_LOAD` beider ABIs mit `p_align 0x4000` ✅; die `zipalign`-Prüfung des Build-Skripts besteht.

### Bewusst später

- Hilfsfunktionen nach dem Vertrag der Erweiterungen: leichte in 3b (§4i), `LoadDoc` usw. in 3c, alle auf `host.ask`.
- Verwaltung der Erweiterungen und TypeScript → JavaScript am Gerät: 3e. Umleiten echter Schnittstellen: 3f.
- **iOS:** bauen und denselben Selbsttest laufen lassen. Bis dahin ist nur belegt, dass `SandboxCore` nichts Android-Eigenes benutzt (einzige Weiche: `mallinfo` unter Android, `malloc_zone_statistics` unter Apple für `nativeHeapBytes`).
- Probe im Selbsttest für „schließen während eines Aufrufs“ (heute nur außerhalb der App belegt, siehe oben).
- Zeitgeber im Sandkasten (`setTimeout`): gibt es nicht; ein Promise, das von nichts mehr gelöst werden kann, wartet bis zur Frist und endet mit `time` (wie unter Node).
- Module (`import`): kein Lader gesetzt, jeder `import()` wird abgelehnt.
- Mehrere Sandkästen auf einem Faden (Vorrat): nicht gebaut; heute kostet jeder Sandkasten einen Faden für seine Lebenszeit.
- Am Tablet nicht gemessen (nur S22).
- **Cloudflare: in 3d erledigt für die automatische Prüfung, bewusst nicht für die interaktive (§4k).** Das versteckte WebView besteht die automatische Prüfung, `fetch` wiederholt den Abruf mit Cookie und gleichem User-Agent, `noCloudflareBypass` wird beachtet (am S22 mit einer öffentlichen Prüf-Seite belegt). AniStar bekommt vom Netz des Geräts aus keine Prüfung (unter Node am PC weiter 403). Interaktive Prüfungen werden nicht gelöst: eigener Fehler „needs the user“.

### Testweg

`native/src/core/extensions/sandbox/sandbox.test.ts`: Selbsttest gegen den Node-Unterbau (ohne Netz), Fehlerarten, Namen statt Code, Argumente als Daten, Tür, Reihenfolge der Aufrufe; der Geräte-Unterbau gegen ein Modul aus dem Test (Grenzen durchgereicht, Fehler-Codes im Text, Antworten je Sandkasten, keine Antwort nach dem Schließen). Am Gerät: der Selbsttest per Link (oben). Das C++ selbst hat keinen eigenen Test im Repo; es wird durch den Selbsttest am Gerät geprüft.

## 4i. Hilfsfunktionen für Erweiterungen, leicht (Phase 3b)

Eine Erweiterung findet im Sandkasten jetzt die leichten Globalen, die ihr die Typ-Datei `goja_plugin_types/core.d.ts` zusagt. Nur gelesen wurden dort die Teile für Erweiterungen; Plugin-Teile (`$shared`, `$scannerUtils` …) nicht.

### Aufbau

- **Vorspann** (`native/src/core/extensions/helpers/prelude/*.js`): eigener Code nach Typ-Datei und öffentlicher Doku (WHATWG Fetch/URL/HTML, Node-`Buffer`, crypto-js), dazu drei freie Bibliotheken. `native/scripts/bundle-extension-helpers.mjs` (Rolldown) packt alles zu einem Skript und schreibt es als Text nach `helpers/bundle.generated.ts` (≈ 91 KB, verkleinert). Ein Test baut es neu und vergleicht, die Datei im Repo ist also immer die, die Quellen + feste Versionen ergeben.
- **Wirt-Seite** (`helpers/helpers.ts`): `openExtensionSandbox(engine, { fetch, log, preferences, offline, limits })` öffnet einen Sandkasten (§4h), lässt den Vorspann laufen und gibt die Ladezeit mit (`helpersMs`). Durch die Tür gehen nur `fetch` (Netz der App) und `log` (Konsole). Alle anderen Hilfen arbeiten im Sandkasten selbst.
- Der rohe Sandkasten (`openSandbox`) bleibt leer, die Probe „nothing of the outside“ gilt weiter.
- Die Globalen sind fest (nicht überschreibbar, nicht aufzählbar).

| Globale | Wie | Abweichung von der Typ-Datei |
|---|---|---|
| `fetch(url, options)` | Fragt die App (`host.ask("fetch")`), die mit ihrem `fetch` sendet und die Antwort ganz liest. Methode, Kopfzeilen (Objekt, Liste oder Headers-artig), Body: Text, `URLSearchParams` (form-urlencoded), `FormData` (multipart), Bytes (als Base64 durch die Tür), sonst JSON. `redirect` (Standard `follow`), `timeout` in s (Standard 35, dann abgelehntes Promise). Antwort: `status`, `statusText`, `method`, `ok`, `url`, `redirected`, `headers`, `rawHeaders`, `cookies` (aus `Set-Cookie`), `contentType`, `contentLength`, `text()`, `json()`. Nur `http`/`https`. Netzfehler → abgelehntes Promise. | `text()`/`json()` geben den Wert sofort (wie zugesagt), `await` darauf geht auch. `headers`/`rawHeaders` nehmen Namen in jeder Schreibweise und haben zusätzlich `get`/`has`/`forEach`. `noCloudflareBypass` wird ignoriert: es gibt keine Umgehung. Antwort nur als Text (UTF-8). `redirect: "manual"/"error"` hängt am `fetch` der App: Node hält sich daran, das `fetch` von React Native folgt Weiterleitungen immer. |
| `console.log/info/warn/error/debug` | Text ins Log der App (`log`), Objekte als JSON | – (nicht in der Typ-Datei, aber in jeder Erweiterung üblich) |
| `URL`, `URLSearchParams` | `whatwg-url-minimum` 0.2.0 (MIT) | – (nicht in der Typ-Datei) |
| `atob`, `btoa` | eigener Code nach HTML-Standard (forgiving-base64) | Fehler ist ein `Error` mit Namen `InvalidCharacterError`, keine DOMException |
| `Buffer` | `buffer` 6.0.3 (MIT); `equals` nimmt auch `Uint8Array`, wie bei Node | erbt von `Uint8Array` (wie bei Node), nicht von `ArrayBuffer` wie in der Typ-Datei |
| `CryptoJS` | crypto-js 4.2.0 (MIT) mit Hülle: Kodierer `Utf8`, `Base64`, `Hex`, `Latin1`, `Utf16`, `Utf16LE` nehmen/geben `Uint8Array`; `AES.encrypt/decrypt` mit Passphrase (String, OpenSSL-Ableitung, Ergebnis `Salted__…`) oder Schlüssel aus Bytes + `iv`; Ergebnis mit `toString(encoder)` | Zusätzlich `MD5`, `SHA1`, `SHA256`, `SHA512`, `Hmac…`. Schlüssel aus Bytes ohne `iv` wird abgelehnt (die Typ-Datei sagt nichts dazu). Zufall für das Salz aus `Math.random` (kein sicherer Zufall im Sandkasten) |
| `FormData` | eigener Code nach XHR-Standard, nur Text-Felder | nicht in der Typ-Datei; keine Dateien/Blobs |
| `$sleep(ms)` | wartet an Ort und Stelle (die Zeitgrenze des Sandkastens bricht es ab), gibt danach ein erfülltes Promise | wartet aktiv auf dem Faden des Sandkastens (der eigene, nicht der der Oberfläche) |
| `$store` | Map im Sandkasten: `set`, `get` (Kopie), `getUnsafe`, `has`, `getOrSet`, `setIfLessThanLimit`, `unmarshalJSON`, `marshalJSON`, `reset`, `values(Unsafe)`, `getAll(Unsafe)`, `watch` | lebt so lange wie der Sandkasten (die Typ-Datei nennt keine dauerhafte Speicherung); `setIfLessThanLimit` setzt, wenn der Schlüssel schon da ist oder weniger als `max` Schlüssel da sind |
| `$getUserPreference(key)` | liest die vom Wirt übergebenen Werte (`preferences`, Standardwerte schon eingesetzt) | Speichern und Standardwerte aus dem Manifest: 3e |
| `__isOffline__`, `$clone`, `$toString`, `$toBytes` | vom Wirt (`offline`) bzw. eigener Code | `$toString` gibt Bytes als UTF-8 aus, anderes als JSON |

### Messwerte

- Größe des Vorspanns: ≈ 91 KB (Text im App-Bündel).
- Ladezeit des Vorspanns unter Node (QuickJS als WebAssembly): 15–16 ms je Sandkasten, der erste 32 ms.
- Am Gerät (S22, Test-App, 13.11.2026 18:58, Selbsttest per Link, Probe „helpers“): Vorspann 23,9 ms im Mittel, 25,8 ms höchstens (4 Sandkästen), unter dem Ziel von 50 ms; deshalb wird er immer geladen, nicht erst bei Gebrauch. `fetch` über die App mit Kopfzeilen und JSON: 200 in 245 ms. Selbsttest 13 von 13 in 3041 ms; Faden der Oberfläche in 269 Stücken gehalten, längstes 2,1 ms, 0 über 8 ms.
- APK (Test): 110 985 431 → 111 173 679 Bytes (+188 KB).

### Praxis-Probe (Node, echtes Netz, 13.11.2026, nicht im Repo)

`search` „dr. stone“ (Medium Dr. STONE aus der Aufzeichnung) der sechs eigenen Erweiterungen des Besitzers über die neue Schicht; TypeScript-Quellen für die Probe mit `typescript` übersetzt.

| Erweiterung | Treffer | Vergleich |
|---|---|---|
| Torrent: Internet Archive | 85 | Aufzeichnung `SearchTorrent` des Servers: 85, gleiche Namen bis auf einen (Bestand seit der Aufzeichnung geändert), andere Reihenfolge (der Server sortiert) |
| Torrent: DKB | 74 | Aufzeichnung: 74, gleiche Namen, andere Reihenfolge |
| Online-Stream: AniStar | 0 | keine Aufzeichnung; die Seite antwortet diesem Rechner mit Cloudflare-Prüfung (403 „Just a moment…“), auch einem direkten Abruf ohne Sandkasten. Liegt nicht an der Schicht |
| Online-Stream: AniWorld | 1 | keine Aufzeichnung |
| Online-Stream: AnimeToast | 1 | keine Aufzeichnung |
| Online-Stream: hanime (benutzt `ChromeDP` nur für Quellen) | 1 | keine Aufzeichnung; `search` braucht kein `ChromeDP` |

Unter Node meldet quickjs-emscripten beim Schließen eines Sandkastens, in dem noch eine Antwort der App aussteht (eine Erweiterung startet mehrere Abrufe und nimmt nur den ersten), einen Abbruch in `JS_FreeRuntime`; `close` fängt ihn ab, der Speicher des WebAssembly-Moduls ist frei. Am Gerät gibt es das nicht (eigene Laufzeit je Faden).

### Bewusst später

- `LoadDoc`/`Doc`, `$habari`, `$torrentUtils`, `$goFeed`: 3c. `ChromeDP`: 3d. Installieren, Einstellungen speichern, TS → JS: 3e. Echte Schnittstellen: 3f.
- `$await`, `$replace`, `$unmarshalJSON`, `$arrayOf`: setzen Go-Referenzen oder ein synchrones Warten auf ein Promise voraus; im Sandkasten nicht nachbaubar ohne blockierende Tür. Gebaut, wenn eine Erweiterung sie braucht.
- `fetch` mit Bytes als Antwort (`arrayBuffer()`), `TextEncoder`/`TextDecoder`, `setTimeout`: nicht in der Typ-Datei.
- Cloudflare (`noCloudflareBypass`): seit 3d, nur die automatische Prüfung (§4k).

### Testweg

`native/src/core/extensions/helpers/helpers.test.ts` (Node, ohne Netz, `fetch` der App durch eine lokale Test-Antwort): Bündel aktuell; `fetch` (Methode, Kopfzeilen, JSON/Text/`URLSearchParams`/`FormData`/Bytes, Weiterleitung, 404, Netzfehler, Zeitlimit, Zeitgrenze des Sandkastens, nur http/https); `console`; `URL`; `atob`/`btoa` mit den Paaren aus RFC 4648; `Buffer`; `CryptoJS` mit MD5/SHA-1/SHA-256/SHA-512 („abc“), HMAC-SHA-256 (RFC 4231 Fall 2), AES-128 (FIPS-197 C.1) und Passphrase-Rundweg; `$sleep`; `$store`; Einstellungen, `__isOffline__`, `$clone`, `$toString`, `$toBytes`. Der Selbsttest hat die Probe „helpers“ (unter Node in `sandbox.test.ts`, am Gerät per Link).

## 4j. Hilfsfunktionen für Erweiterungen, mittel (Phase 3c)

Eine Erweiterung findet im Sandkasten jetzt auch `LoadDoc`/`Doc`, `$habari`, `$torrentUtils` und `$goFeed`, wie `goja_plugin_types/core.d.ts` sie beschreibt. In den vier Vertrags-Dateien `goja_*_test/*.d.ts` kommen sie nicht vor.

### Aufbau

- **Zwei Skripte statt einem** (`scripts/bundle-extension-helpers.mjs`, beide in `helpers/bundle.generated.ts`, der Test baut neu und vergleicht): `HELPERS_SCRIPT` (≈ 101 KB, immer geladen: die leichten aus §4i plus `$habari` und `$torrentUtils`, beide eigener Code, ≈ 10 KB) und `DOC_HELPERS_SCRIPT` (≈ 95 KB: `LoadDoc`, `Doc`, `$goFeed` mit htmlparser2).
- `openExtensionSandbox` lädt das zweite Skript **nur, wenn der geladene Code `LoadDoc`, `Doc` oder `$goFeed` erwähnt** (`NAMES_OF_DOC_HELPERS`, einmal je Sandkasten, direkt vor diesem Code; `docHelpersMs()` gibt die Ladezeit). Grund: beide zusammen kosten am S22 ≈ 60 ms je Sandkasten, über dem Ziel von ~50 ms; das leichte allein ≈ 33 ms. Wer den Namen zusammensetzt (`globalThis["Load"+"Doc"]`), bekommt nichts.
- Keine neue Wirt-Funktion: alles läuft im Sandkasten.

| Globale | Wie | Abweichung von der Typ-Datei |
|---|---|---|
| `LoadDoc(html)` → `$(selector)`, `new Doc(html)` | htmlparser2 12.0.0 (MIT) liest, css-select 7.0.0 (BSD-2) wählt, domutils 4.0.2 (BSD-2) gibt Text/HTML; Auswahl-Klasse eigener Code (`prelude/doc.js`). Alle Methoden der Typ-Datei: `attr`, `attrs`, `children`, `closest`, `contents`, `contentsFiltered`, `data`, `each`, `end`, `eq` (auch negativ), `filter`/`not`/`is` (Selektor oder Funktion), `find`, `first`, `last`, `has`, `text`, `html`, `length`, `map`, `next(All/Until)`, `prev(All/Until)`, `parent(s/sUntil)`, `siblings` | `…Until(a, b)` mit zwei Argumenten: `a` filtert, `b` ist die Grenze (die Typ-Datei sagt nicht, welches welches ist). `closest()` ohne Selektor gibt die Elemente selbst. `html()` gibt Entitäten so aus, wie sie im Baum stehen (`&amp;` bleibt Text `&`). Doppelte Elemente fallen weg, Reihenfolge wie gefunden (nicht neu nach Dokument sortiert) |
| `$goFeed.parse(text)` | htmlparser2 im XML-Modus, Formung eigener Code (`prelude/feed.js`) nach RSS 2.0, RSS 1.0, RFC 4287 (Atom). Feldnamen wie gofeeds universeller Feed in JSON: `title`, `description`, `link`, `feedLink`, `links`, `updated(Parsed)`, `published(Parsed)`, `author(s)`, `language`, `image`, `copyright`, `generator`, `categories`, `items[]` (mit `content`, `guid`, `enclosures`), `feedType` (`rss`/`atom`), `feedVersion`; fremde Namensräume (z. B. `nyaa:infoHash`) unter `extensions[prefix][name][]` mit `value`/`attrs`/`children` | Die Typ-Datei sagt nur `Record<string, any>`. `*Parsed` ist ISO-Text (kein Datums-Objekt). `dublinCoreExt`/`itunesExt` gibt es nicht, `dc:` und `itunes:` landen in `extensions`. JSON-Feeds nicht. Kein XML → Fehler |
| `$habari.parse(name)` | eigener Deuter (`prelude/habari.js`): Name in Wörter und Klammer-Gruppen zerlegt, Stichwort-Listen (Auflösung, Codec, Ton, Quelle, Untertitel, Sprache …), Folge nach Stärke (SxxExx/1x05/E05/05v2 → „Episode“-Wort → Zahl nach „ - “ → letzte freie Zahl), Gruppe in eckigen Klammern oder „…-GROUP“, Jahr in Klammern, CRC32 | Felder wie `Metadata`; leere fehlen. `formatted_title` ersetzt nur bei Namen ohne Leerzeichen Punkte/Unterstriche. `device_compatibility`, `part_number`, `volume_number`, `other_episode_number`, `episode_number_alt` werden nur einfach erkannt; Bereiche („01-12“) nicht. Siehe Vergleich unten |
| `$torrentUtils.getMagnetLinkFromTorrentData(b64)` | eigener Bencode-Leser (BEP 3), Infohash = SHA-1 (eigener Code nach FIPS 180-4) über die Original-Bytes von `info`; `magnet:?xt=urn:btih:<hex>&dn=<name>&tr=…` (announce + announce-list, ohne Doppelte) | Hex klein geschrieben. Kaputte Daten → Fehler |

### `$habari` gegen die Aufzeichnung

159 Namen aus `TORRENT_SEARCH.SearchTorrent` (Internet Archive + DKB, Feld `torrentMetadata`, nur öffentliche Release-Namen, im Test `helpers/habari-cases.ts`). Gleich je Feld (gezählt, wo das Feld beim Server oder beim Kern vorkommt):

| Feld | gleich | Feld | gleich |
|---|---|---|---|
| title / formatted_title | 149 / 156 | season_number | 77 / 77 |
| episode_number | 111 / 118 | video_resolution | 94 / 94 |
| episode_title | 23 / 28 | video_term | 80 / 80 |
| release_group | 93 / 99 | subtitles | 103 / 104 |
| audio_term, source, year, file_checksum | 5/5, 3/3, 2/2, 1/1 | release_information | 3 / 3 |
| language | 2 / 3 | | |

Abweichungen fast nur bei Namen, die keine Releases sind (Vorträge, Musik auf archive.org) oder bei Eigenheiten des Servers (z. B. „Dr Stone 2“ ohne Folge, „S 1 E 22-24“). Der Test hält die Anteile (`medium-helpers.test.ts`).

### Messwerte (S22, Test-App, 13.11.2026 19:22–19:24, zwei Läufe per Link)

- Selbsttest **14 von 14** in 3028 ms / 1861 ms. Probe „medium helpers“: leichtes Skript 47,2 / 41,1 ms, zweites Skript 16,3 / 19,4 ms (zusammen 63,5 / 60,5 ms); Aufrufe `LoadDoc` 0,7 / 2,8 ms, `$goFeed` 0,6 / 2,6 ms, `$habari` 0,4 / 0,6 ms, `$torrentUtils` 0,4 / 1,2 ms.
- Probe „helpers“ (nur leichtes Skript): **32,0 / 32,6 ms** im Mittel, 35,6 / 34,3 ms höchstens (vorher 23,9 ms; +10 KB `$habari`/`$torrentUtils`).
- **8-ms-Wächter:** 279 Stücke, längstes **7,7 / 7,2 ms**, 0 über 8 ms (3b: 2,1 ms). Das längste Stück entsteht beim Öffnen eines Erweiterungs-Sandkastens: das ≈ 100 KB große Skript wird im Faden der App zu Text zusammengesetzt und über Nitro übergeben. Unter der Grenze, aber knapp: wächst das leichte Skript weiter, muss die Übergabe (z. B. Skript einmal im Modul halten) umgebaut werden.
- Unter Node: alle Proben grün (`sandbox.test.ts`).
- APK (Test): 111 173 679 → **111 301 667 Bytes** (+128 KB).

### Zeitgeber-Befund (Pflicht-Untersuchung)

3b meldete einen 2-ms-Zeitgeber bis 149,4 ms zu spät (3a: 31 ms). Der Selbsttest misst jetzt zuerst **3 s ohne jede Kern-Arbeit** und ordnet jede Verspätung über 8 ms zu: laufende Probe, Anteil der Kern-Stücke in dieser Zeit, Speicherbereinigungen von Hermes (`HermesInternal.getInstrumentedStats`).

| | ohne Kern (3 s) | während des Selbsttests |
|---|---|---|
| Lauf 1 (Link holt die App nach der Installation nach vorn) | **122,9 ms**, 60 Ticks > 8 ms, **0** davon im Kern | 12,0 ms, 8 Ticks, 2 mit Kern-Anteil (9,0 / 7,6 ms) |
| Lauf 2 (App schon vorn) | 25,8 ms, 11 Ticks, 0 im Kern | 11,9 ms, 6 Ticks, 1 mit Kern-Anteil |

**Ursache:** außerhalb des Kerns. Die großen Verspätungen treten auf, bevor der Kern irgendetwas tut, in den ersten Sekunden nach dem Link: die App kommt nach vorn und baut Home auf (Oberfläche), teils mit Speicherbereinigung (im schlimmsten Tick 2 Bereinigungen, 8,8 ms). In 3a/3b lief der Selbsttest sofort nach dem Link und hat diese Zeit mitgemessen. Während der Proben selbst ist der Zeitgeber höchstens 12 ms zu spät; der Kern-Anteil daran ist das längste Stück oben (≤ 7,7 ms). Zeitgeber unter Android laufen außerdem über den Bild-Takt, eine Verspätung von einem Bild (~8–16 ms) ist auch ohne Arbeit normal. Nichts umgebaut.

### Bewusst später

- `ChromeDP` und Cloudflare: 3d, gebaut (§4k). Installieren, Einstellungen speichern, TS → JS: 3e. Echte Schnittstellen: 3f.
- `$goFeed`: JSON Feed, `dublinCoreExt`/`itunesExt`. `$habari`: Folgen-Bereiche, Ergebnisse der Aufzeichnung, die nach Fehlern des Servers aussehen.
- Übergabe des Skripts ohne Zusammensetzen im Faden der App (siehe 8-ms-Wächter).

### Testweg

`native/src/core/extensions/helpers/medium-helpers.test.ts` (Node, ohne Netz): `LoadDoc`/`Doc` mit eigenem HTML (alle Methoden der Typ-Datei, Entitäten, `end`), zweites Skript nur bei Erwähnung; `$goFeed` mit eigenem RSS 2.0 (CDATA, Enclosure, `nyaa:`-Erweiterung) und Atom 1.0, Nicht-Feed abgelehnt; `$torrentUtils` mit im Test erzeugter `.torrent` (Infohash von Node-`crypto` zum Vergleich), kaputte Daten; `$habari` mit vier üblichen Namen und den 159 aufgezeichneten. Selbsttest: Probe „medium helpers“.

## 4k. ChromeDP über ein verstecktes WebView (Phase 3d)

Erweiterungen bekommen `ChromeDP` (ferngesteuerter Browser) und `fetch` einen Weg durch Cloudflares **automatische** Prüfung. Beides trägt ein einziges verstecktes `react-native-webview` (schon in der App, kein neuer nativer Code), gesteuert aus TypeScript. Geschrieben nach `goja_plugin_types/core.d.ts` (`ChromeDP`, `ChromeBrowser`, `FetchOptions.noCloudflareBypass`), der öffentlichen Doku von react-native-webview und Cloudflare; keine Vorlage.

### Aufbau

| Teil | Wo | Was |
|---|---|---|
| Verstecktes WebView | `native/src/lib/hidden-browser/hidden-browser.tsx` (App-Schicht) | `HiddenBrowserHost` hängt einmal in `app/_layout.tsx`, unter allem. Rendert nichts, bis eine Seite verlangt wird; dann ein WebView 360 × 640 unter den Bildschirmen der App, Deckkraft 0, ohne Berührungen, ohne Anteil am Layout. Beim Schließen wird es ausgehängt (Seite samt Inhalt weg). Gibt dem Kern `hiddenBrowser`: Adresse laden, JavaScript ausführen, wegwerfen |
| Frage an die Seite | `lib/hidden-browser/page-script.ts` | Ein WebView gibt für eingeschleustes JavaScript nichts zurück. Das Skript schickt seinen Wert (Promise wird abgewartet) als Nachricht mit Kennung. Erst als Programm (indirektes `eval`, Anweisungen gehen); verbietet die Seite `eval` (CSP), dieselbe Frage noch einmal als Ausdruck |
| Reihe und Schritte | `core/extensions/browser/browser.ts` | Der Kern kennt keine Oberfläche: er bekommt nur `HiddenBrowser` eingereicht. Eine Seite zur Zeit, wer eine will, wartet in der Reihe. Jede Benutzung hat ein Zeitlimit (Vorgabe 30 s, `timeout` der Erweiterung); läuft es ab, wird die Seite weggeworfen und der Nächste bekommt eine neue. Alle Schritte des Vertrags sind hier aus „JavaScript ausführen“ gebaut. Nur `http`/`https` |
| Cloudflare | `core/extensions/browser/cloudflare.ts` | Prüfseite erkennen, Seite öffnen und warten, je Host merken |
| Im Sandkasten | `helpers/prelude/chromedp.js`, `fetch.js` | `ChromeDP` fragt die App (`host.ask("browser")`); `fetch` reicht `noCloudflareBypass` durch |
| Wirt | `helpers/helpers.ts` | `openExtensionSandbox({ browser })`: ohne `browser` (Node, Tests) scheitert `ChromeDP` mit „ChromeDP is not available here“, eine Prüfseite kommt an, wie sie kam. Offene Seiten einer Erweiterung schließen mit ihrem Sandkasten |

Die Seite bekommt nichts von der App: keine Server-Adresse, kein Token, kein Objekt außer der Nachrichten-Brücke. Sie öffnet keine Fenster (`setSupportMultipleWindows={false}`), startet keine andere App (nur `http`, `https`, `about`, `data`, `blob` werden geladen), spielt nichts von selbst ab, hat keinen Dateizugriff. Nachrichten der Seite sind Daten: eine Seite kann die Antwort auf eine Frage fälschen, bekommt dadurch aber nichts, was sie nicht ohnehin über ihren eigenen Inhalt bestimmt.

### Unterstützte Befehle

| Befehl der Typ-Datei | Stand |
|---|---|
| `ChromeDP.newBrowser({ timeout, userAgent })` | ✅ hält die eine Seite bis `close()` oder bis `timeout` Sekunden um sind |
| `ChromeDP.scrape(url, options)`, `ChromeDP.evaluate(url, jsCode, options)` | ✅ je eine eigene Seite; `waitSelector` (wartet auf sichtbar), `waitDuration`, `timeout`, `userAgent` |
| `navigate`, `waitVisible`, `waitReady`, `evaluate`, `innerHTML`, `outerHTML`, `text`, `attribute`, `sleep`, `close` | ✅ Schritte mit Selektor warten auf das Element, längstens bis zum Zeitlimit |
| `click`, `sendKeys` | ✅ mit Abweichung (unten) |
| `ChromeDP.screenshot`, `browser.screenshot`, `browser.fullScreenshot` | ❌ Ein WebView gibt ohne nativen Code kein Bild her. Der Aufruf scheitert mit „not available in this app“ |
| `listenBrowser`, `listenTarget`, `executeCDP` | ❌ Hinter dem WebView steht kein DevTools-Protokoll. Der Aufruf scheitert mit „not available in this app“ |
| Option `headless` | ohne Wirkung: die Seite ist immer unsichtbar |

### Abweichungen von einem echten Chrome

- **`click`** ruft `element.click()`; es gibt keine echten Maus-Ereignisse (`isTrusted` ist falsch, keine Koordinaten).
- **`sendKeys`** hängt den Text an den Wert des Feldes und löst `input` und `change` aus; einzelne Tasten-Ereignisse gibt es nicht.
- **`text`** ist `textContent`.
- **`evaluate`** wartet ein Promise ab. Der Wert muss sich als JSON senden lassen (ein DOM-Knoten nicht → Fehler).
- **`navigate`** ist fertig, wenn die Seite geladen hat, gleich mit welchem HTTP-Status; nicht erreichbar → Fehler. Lädt die Seite danach von selbst neu, scheitert eine gerade gestellte Frage („the page went to another address“).
- **User-Agent:** ohne Angabe der des WebView des Geräts (ein mobiles Chrome). Mit `userAgent` meldet sich die Seite so, bleibt aber dasselbe WebView.
- **Eine Seite für die ganze App:** zwei Erweiterungen zugleich warten aufeinander, längstens bis zum Zeitlimit der ersten.
- **Cookies bleiben** nach dem Schließen im Cookie-Speicher der App (den auch `fetch` der App benutzt); alles andere der Seite ist weg.
- **Downloads:** unterbunden (seit 3f-3, Patch an react-native-webview, nur dieses WebView, §4m 3f-3).

### Cloudflare

Eine Seite hinter Cloudflare kann einen Abruf mit einer Prüfseite beantworten. `fetch` einer Erweiterung erkennt sie (Status 403/503 und Kopfzeile `cf-mitigated: challenge`, oder `server: cloudflare` mit Titel „Just a moment…“ bzw. `_cf_chl_opt` im Text) und tut dann, was ein Browser ohne Zutun tut:

1. Die versteckte Seite öffnet dieselbe Adresse (mit dem User-Agent, den die Erweiterung nennt, sonst dem des WebView) und wartet, längstens 30 s. Sie fragt alle 0,5 s nur, ob noch die Prüfseite da ist. **Nichts wird geklickt, getippt oder gelöst.**
2. Geht die Prüfung von selbst durch, setzt Cloudflare sein Cookie. WebView und Netz der App teilen einen Cookie-Speicher (`sharedCookiesEnabled`; unter Android ist es ohnehin derselbe), das Cookie geht also nie durch den Kern, und der Speicher lässt es auch ablaufen.
3. `fetch` sendet den Abruf **einmal** noch einmal, mit demselben User-Agent (das Cookie gilt nur mit ihm). Der Kern merkt sich je Host diesen User-Agent; spätere Abrufe an den Host tragen ihn sofort, ohne Seite. Antwortet die Seite später wieder mit der Prüfung (Cookie abgelaufen), beginnt es von vorn.
4. Antwortet die Seite trotz bestandener Prüfung wieder mit der Prüfseite, bekommt die Erweiterung diese Antwort (403); das Gemerkte wird verworfen. Kein zweiter Versuch.

`noCloudflareBypass: true` schaltet das für einen Abruf ab. Mehrere Abrufe, die zugleich auf die Prüfung eines Hosts treffen, teilen sich eine Seite.

**Feste Grenze: interaktive Prüfungen.** Verlangt die Prüfung einen Menschen (Kästchen, Rätsel; Art `interactive`) oder geht sie in 30 s nicht von selbst durch, scheitert `fetch` mit einem eigenen Fehler: `error.name === "CloudflareCheckError"`, `error.needsUser === true`, Meldung „fetch: Cloudflare's check needs the user: …“. Es gibt kein Klicken, keine Tricks, keine Dienste zum Lösen, und das bleibt so. Was die App dem Nutzer dann zeigt (z. B. die Seite sichtbar öffnen, damit er selbst bestätigt), gehört zu 3f.

### Messwerte (S22, Test-App, 13.11.2026 19:49–20:04)

| Was | Wert |
|---|---|
| Selbsttest per Link `core?sandbox=selftest` | 15 von 15 in 3772 ms |
| Probe „ChromeDP“ (IANA-Seite „Example Domains“: laden, `waitVisible`, `text`, `evaluate` mit Promise, `click`, `attribute`, `sendKeys`, `innerHTML`, `outerHTML`, Screenshot abgelehnt, `close`) | 1085 ms, davon Seite geladen und sichtbar 736 ms (erstes WebView nach App-Start; ein zweiter Lauf 389 ms) |
| Faden der Oberfläche im Selbsttest | 346 Stücke, längstes 7,1 ms, 0 über 8 ms |
| Zeitgeber der App (2 ms) im Selbsttest | höchstens 172,5 ms verspätet, beim Anlegen des ersten WebView (Kern in der Zeit 1,4 ms); im Leerlauf davor 187,5 ms. Das Anlegen eines WebView ist Arbeit der App außerhalb des Kerns und kostet einmal je Seite etwa 0,1–0,2 s |
| Cloudflare, öffentliche Prüf-Seite mit automatischer Prüfung (Art `managed`), Praxis-Lauf | mit `noCloudflareBypass`: 403 „Just a moment…“ in 226 ms, keine Seite. Ohne: Prüfung in der versteckten Seite **von selbst bestanden** nach 5686 ms, zweiter Abruf 200 mit der echten Seite (zusammen 6301 ms). Nächster Abruf an den Host: 200 in 192 ms ohne Seite. Im zweiten Lauf (Cookie noch im Speicher) 1220 ms |
| Praxis: eigene Erweiterung mit `ChromeDP` (Online-Stream, `findEpisodeServer`: `newBrowser` mit eigenem User-Agent, `navigate`, Schleife aus `sleep` und `evaluate`, `close`) | Quelle gefunden (Typ m3u8) in 1263 ms (ein zweiter Lauf 1193 ms); davor Katalog mit 4,3 MB geladen und zerlegt in 2160 ms (1586 Reihen) |
| Praxis: eigene Erweiterung AniStar, `search` „dr. stone“ | 2 Treffer in 434 ms. **Keine Prüfung** vom Netz des Geräts aus (der PC bekommt für dieselbe Seite weiter 403 mit Prüfung, Art `managed`); der Cloudflare-Weg ist deshalb mit der Prüf-Seite oben belegt, nicht mit AniStar |
| Faden der Oberfläche im Praxis-Lauf | 66 Stücke, **eines über 8 ms: 95,2 ms** (Lauf davor 57,5 ms), sonst höchstens 5,4 ms. Ursache: die Antwort mit 4,3 MB geht als ein JSON-Text durch die Tür (`JSON.stringify` im Faden der App). Offen für 3f |
| Speicher | Der Katalog mit 4,3 MB sprengt die 64 MB aus Probe 2 („out of memory“ nach 963 ms). Der Praxis-Lauf gibt dem Sandkasten deshalb 256 MB; die Vorgabe für echte Erweiterungen ist in 3f zu entscheiden |
| App sichtbar | unverändert: Bildschirmfotos vor dem Einbau, während des Praxis-Laufs und danach sind Byte für Byte gleich (`belege/3d-0-vorher.png`, `3d-2-waehrend-seite-offen.png`, `3d-3-nach-praxis.png`). Berührungen wurden dabei nicht geprüft (kein Tipp am Gerät); das WebView liegt unter den Bildschirmen der App und nimmt keine an |
| APK (Test) | 111 301 667 → 111 349 879 Bytes (+48 212) |

Im ersten Build schlug die Probe „ChromeDP“ fehl: sie erwartete auf `example.com` eine Überschrift, die diese Seite nicht mehr hat. Die Probe liest seitdem nur den Titel der Seite und bringt mit, was sie klickt und beschreibt.

Interaktive Prüfung: am Gerät ist keine begegnet. Der Fehlerweg ist in den Logik-Tests belegt (Art `interactive` und Zeitablauf), nicht am Gerät.

Das Lesen der Praxis-Dateien aus dem Ordner der App auf dem gemeinsamen Speicher geht mit `expo-file-system` ohne Berechtigung; der per adb angelegte Ordner brauchte `chmod 777`.

### iOS

Derselbe TypeScript-Code; `react-native-webview` läuft dort auf WKWebView, `sharedCookiesEnabled` teilt dessen Cookies mit dem Netz der App. Ungebaut und ungetestet.

### Bewusst später

- Fehler „needs the user“: seit 3f-3 ein Satz über den Fehler-Weg der Online-Stream-Seite (§4m 3f-3); die Seite sichtbar öffnen, damit der Nutzer selbst bestätigt, ist nicht gebaut. Eine Seite für die ganze App fest verdrahten, sobald echte Schnittstellen den Sandkasten benutzen (3f). Heute bauen nur Selbsttest und Praxis-Lauf die Reihe auf.
- Screenshots (bräuchten nativen Code), DevTools-Protokoll: nicht geplant.

### Testweg

`native/src/core/extensions/browser/browser.test.ts` (Node, ohne Netz, mit einer Prüf-Seite statt eines Browsers): Schritte des Vertrags, nur `http`/`https`, Reihe (einer zur Zeit, in Reihenfolge), Zeitlimit (Seite weg, Nächster dran), Erkennen der Prüfseite, automatische Prüfung → zweiter Abruf mit dem User-Agent der Seite und Merken je Host, User-Agent der Erweiterung, gemeinsame Seite bei gleichzeitigen Abrufen, `noCloudflareBypass`, interaktive Prüfung und Zeitablauf → `CloudflareCheckError` ohne einen Klick, höchstens ein Versuch, kein Browser → Prüfseite unverändert; `ChromeDP` im Sandkasten (Schritte, Ein-Aufruf-Formen, nicht Machbares sagt es, offene Seite schließt mit dem Sandkasten, unter Node „not available here“). `native/src/lib/hidden-browser/page-script.test.ts`: Wert, Anweisungen, Promise, Fehler, `eval` verboten → Ausdruck. Am Gerät: Probe „ChromeDP“ im Selbsttest (`core?sandbox=selftest`) und Praxis-Lauf `core?sandbox=practice` (nur Test- und scratch-App): lädt jede `.js`-Datei aus `Android/data/<Paket>/files/core-practice/` in einen eigenen Sandkasten und ruft deren `practice()`; die Dateien kommen nur für den Test per adb aufs Gerät und werden danach gelöscht, kein Erweiterungs-Code ist Teil der App.

## 4l. Erweiterungs-Verwaltung (Phase 3e)

Phase 3e-1 (13.11.2026): Der Bereich `extensions` verwaltet die installierten Erweiterungen ohne Server, hinter dem Schalter (Standard aus). Code: `native/src/core/extensions/manage/` (`installed.ts` Ordner lesen, `loader.ts` Sandkästen, `manage.ts` Antworten, `install.ts` Installieren/Aktualisieren/Deinstallieren), Geräte-Seite `native/src/api/client/core-extensions.ts`.

### Schnittstellen

**Im Kern (12, Bereich `extensions`, neben dem Manifest-Lesen aus Stufe 0):** `GetAllExtensions` (`POST /api/v1/extensions/all`, mit `withUpdates`), `ListExtensionData`, `ListAnimeTorrentProviderExtensions`, `ListMangaProviderExtensions`, `ListOnlinestreamProviderExtensions`, `ListCustomSourceExtensions`, `GetExtensionPayload`, `GetExtensionUserConfig`, `SaveExtensionUserConfig`, `GetMarketplaceExtensions`, `GetExtensionUpdateData`, `ReloadExternalExtension`. Antworten in Form und Feldern wie die Aufzeichnungen (`manage.recorded.json`: nur die Form, ohne Werte).

**Beim Server geblieben:**

| Schnittstelle | Grund |
|---|---|
| `GetPluginSettings`, `SetPluginSettingsPinnedTrays`, `GrantPluginPermissions`, `ListAnimeEntryEpisodeTabExtensions` | Plugins (Stufe 7c). Die Episoden-Tabs liefert nur ein Plugin (Aufzeichnung: `null`) |
| `ListDevelopmentModeExtensions`, `RunExtensionPlaygroundCode` | Entwickler-Modus und Playground, nicht im Kern |

**Abweichungen:** `unsafeExtensions` ist immer `{}` (aufgezeichnet `{}`; „unsicher“ betrifft Plugins). `ListCustomSourceExtensions` lässt eine eigene Quelle weg, solange der Server ihr keine Nummer gegeben hat (Tabelle `custom_source_identifiers` der Server-DB, nur gelesen): die Nummer vergibt der Server, der Kern rät keine. `GetExtensionUpdateData` gibt das Ergebnis der letzten Update-Prüfung *des Kerns* (vor der ersten `null`). Pfade in `invalidExtensions` sind relativ zum Datenordner (`extensions/<datei>`). Eine Erweiterung, deren Code nicht lädt, steht bis „Neu laden“ in `invalidExtensions` mit `invalid_payload`; erfahren wird das beim Laden für die Arten-Listen, nicht bei `GetAllExtensions` (das lädt keinen Code). Die eingebaute Quelle `local-manga` (Teil des Servers) wird wie aufgezeichnet gelistet, ihre Arbeit bleibt beim Server.

### Datenort

Die installierten Erweiterungen sind der vorhandene Ordner des Servers im Dateien-Ordner der App: `files/extensions/<id>.json` (Manifest mit Code in `payload`, wie ein Server-Install schreibt; am PC-Server gleiches Format geprüft). Der Kern liest ihn bei jeder Anfrage; geschrieben wird nur von `install.ts` im gleichen Format, damit der Server bei Schalter aus alles unverändert findet. Ausgeschaltete Erweiterungen: `files/cache/extension-settings.cache` (`disabledExtensionIds`), nur gelesen. Ort und Lesart wie `core/move/` (App reicht die Dateien herein, der Kern kennt kein Dateisystem).

### Nutzer-Einstellungen: Umzug

Beim ersten Bedarf je Erweiterung liest der Kern `files/cache/ext_user_config_<id>.cache` (`{ "<id>": { value: { version, values } } }`) einmal lesend und legt das Ergebnis in `core.db`, Tabelle `extension_user_configs` (neuer `SCHEMA_STEP` 6, `origin` „server“, auch wenn der Server nichts hatte). Speichern schreibt nur dort (`origin` „core“) und öffnet den Sandkasten der Erweiterung neu. Der Server-Bestand wird nie verändert. Folge bis 3f: Was der Kern speichert, sieht der Server nicht; Suchen/Streams laufen noch über den Server mit dessen Einstellungen.

### Laden, Lebenszyklus, Speichergrenze

- Ein Sandkasten je Erweiterung, geöffnet bei Bedarf (`getSettings()` für die Arten-Listen), geschlossen nach **120 s** ohne Nutzung, bei anderen Einstellungen oder neuem Code neu geöffnet. Lief ein Aufruf in eine Grenze (Zeit, Speicher) oder brach die Maschine, wird der Sandkasten geschlossen; der nächste Aufruf öffnet einen neuen. Ein Fehler, den der Code selbst wirft, lässt ihn offen.
- **Speichergrenze 256 MB** je Sandkasten (Vorgabe `DEFAULT_EXTENSION_MEMORY_MB`), als Einstellung in `core.db` (`extension_sandbox_settings`: `memory_mb` 16–2048, `idle_seconds` 5–3600). Begründung: 64 MB reichten in 3d für eine hanime-Katalog-Antwort von 4,3 MB nicht (Text, geparste Form und Kopien der Erweiterung gleichzeitig); 256 MB geben das Vierfache Spielraum. Die Grenze ist eine Obergrenze, QuickJS belegt nur, was es braucht, und ruhende Sandkästen werden geschlossen.
- Laden: leichter Vorspann (gemerkt, siehe unten) → bei TypeScript der Wandler (ebenfalls gemerkt) → `(0, eval)(__seanimeTranspile(code) + "new Provider()")` → Wandler wieder entfernt. Der Anbieter liegt als `__extension` im Sandkasten; Aufrufe `__extension.<methode>`.
- Installieren lädt den Code vorher in einem Probe-Sandkasten; Code, der nicht lädt, und Plugins werden nicht installiert.

### TypeScript → JavaScript

`sucrase` 3.35.0 (MIT; gebündelt mit `ts-interface-checker` 0.1.13, Apache-2.0, und `lines-and-columns` 1.2.4, MIT; Lizenzen in `licenses/`), nur die Umwandlung „typescript“ ohne Herabstufen neuer Syntax. `native/scripts/bundle-transpiler.mjs` packt sie wie den Vorspann zu einem Skript (`manage/transpiler.generated.ts`, ≈ 198 KB); ein Test baut es neu und vergleicht. Es läuft nur im Sandkasten der Erweiterung, nie im Faden der Oberfläche, und wird wie der Vorspann im Modul gemerkt. Neue Abhängigkeit (dev, fest): `sucrase` 3.35.0.

### Vorspann-Cache

Bisher wurde das ≈ 100 KB große Vorspann-Skript für jeden Sandkasten im Faden der App zusammengesetzt und über Nitro gereicht (längstes Kern-Stück 7,7 ms in 3c). Neu: `CoreSandboxFactory.keepScript(key, code)` gibt es einmal je App-Lauf an das C++-Modul (`KeptScripts`, geteilt von allen Sandkästen); `CoreSandboxBox.runKept(key, after, name)` reicht nur noch den Schlüssel und den kurzen Aufruf-Teil, das Zusammensetzen passiert in C++. Vertrag: `SandboxEngine.keep` / `EngineBox.runKept` / `Sandbox.loadKept` (`sandbox.ts`); der Node-Unterbau macht es gleich (`node-engine.ts`), ein Unterbau ohne `keep` bekommt das ganze Skript wie bisher. Gemerkt werden „helpers“, „doc-helpers“ und „transpiler“.

**Messung am S22** (Test-App, Nutzer 0, Selbsttest per Link, 13.11.2026): vorher (Build ohne Cache, 20:34) 15 von 15, längstes Kern-Stück **7,8 ms**, Vorspann 27,8 ms im Mittel. Ein erster Cache-Build ließ das längste Stück bei 7,8 ms: das einmalige Übergeben des ganzen Skripts kostete selbst so viel. Deshalb wird jetzt in Teilen zu 24 KB übergeben (`KEEP_PART`, `device-engine.ts`; nie zwischen zwei Hälften eines Zeichens). Nachher (20:47): 15 von 15 in 3214 ms, 355 Stücke, **längstes 4,7 ms**, 0 über 8 ms; längster einzelner Aufruf ins Modul im Faden der App: `keepScript` 0,49 ms, `run` 0,24 ms, `runKept` 0,12 ms; Anlegen mit Vorspann 28,0 ms im Mittel, 32,3 ms höchstens (läuft im Sandkasten-Faden).

### Testweg

`native/src/core/extensions/manage/manage.test.ts` (Node, ohne Netz): Wandler-Bündel aktuell; vier eigene Beispiel-Erweiterungen nach den Vertrags-`.d.ts` (Online-Stream und Manga in TypeScript, Torrent in JavaScript, eigene Quelle in TypeScript mit Generics/Enum) laden und aufrufen, kein Wandler-Rest im Sandkasten; Leerlauf schließt, Speichergrenze schließt und öffnet neu; jede übernommene Schnittstelle gegen die Form der Aufzeichnung (fehlende oder zusätzliche Felder, Art jedes Werts); Umzug der Nutzer-Einstellungen (einmal, danach nur `core.db`); `requiresConfig`; Marktplatz (Vorgabe-Adresse, eigene Adresse, nur http/https); Update-Prüfung; Plugins/Entwickler-Modus/Playground/Install bleiben beim Server; Installieren/Aktualisieren/Deinstallieren auf einem Test-Ordner (Format, Probe-Laden, kaputter Code, Plugin abgelehnt, eingebaute nicht löschbar). `sandbox.test.ts`: gemerktes Skript geht einmal über die Grenze, danach nur der Schlüssel; Node-Unterbau gleich.

### Praxis (Node, echtes Netz, 13.11.2026, nicht im Repo)

Die sechs eigenen Erweiterungen des Besitzers über `readInstalled` + `ExtensionLoader` (TS→JS im Sandkasten), je `search` „dr. stone“: animetoast (JS) 1 Treffer, AniStar (TS) 0 (Cloudflare am PC, erlaubt), AniWorld (JS) 1, Internet Archive (TS) 85, DKB (TS) 74, hanime (TS) 1. Laden je 19–81 ms, alle sechs ohne Fehler.

### Am Gerät (S22, Test-App, Nutzer 0, 13.11.2026 20:47–20:52)

Selbsttest siehe oben. Bereich `extensions` per Link an, Seite „Extensions“ neu geöffnet: App-Log `POST /api/v1/extensions/all` (495 ms), `GET …/list` (245 ms), `…/list/anime-torrent-provider` (615 ms), `…/list/manga-provider` (567 ms), `…/list/onlinestream-provider` (701 ms) „answered by the core, no HTTP“; Liste gleich wie bei Schalter aus (6 installiert, gleiche Gruppen und Einträge). Erweiterungs-Blatt Anikoto angesehen, nichts gespeichert/installiert/gelöscht. Danach Schalter aus („areas answered by the core: none“). Belege `belege/3e1-*.png`. APK 111 349 879 → 111 820 295 Bytes.

### Phase 3e-2: schreibende Schnittstellen (13.11.2026)

**Neu im Kern (5):** `InstallExternalExtension` (auch das „Update“ der Oberfläche), `InstallExternalExtensionRepository` (Vorschau `install: false` und Installieren; Repository-Datei `{ name, urls }`), `UninstallExternalExtension`, `UpdateExtensionCode` (gleiche Datei, nur `payload` neu; ohne Probe-Laden, Code, der nicht lädt, steht danach unter „invalid“), `SetExternalExtensionDisabled`. Antwort-Form wie die Aufzeichnungen (`manage.recorded.json`, Formen ergänzt). Abweichung: Beim Repository fehlen Manifeste, die nicht abrufbar sind oder nicht laden, in der Antwort; die übrigen werden installiert (der Server-Fall ist nicht aufgezeichnet).

**Aus/Ein:** Der Kern schreibt `files/cache/extension-settings.cache` im Format des Servers (`{"1":{"value":{"disabledExtensionIds":{"<id>":true}},"updated_at":…}}`, Ein = Kennung entfernt, andere Einträge bleiben). Am Tablet gelesen per `run-as` (vorher `{}`), Schreiben ist die einzige Ausnahme vom „nur lesend“ für den Datei-Cache (`writeServerCache`, nur dieser Eimer).

**Server mitziehen:** Nach jeder Änderung sendet der Kern das Ereignis `extensions-reloaded` (die Listen laden neu, wie nach dem Ereignis des Servers) und sagt es dem laufenden Server: `POST …/external/reload {id}` nach Installieren/Aktualisieren/Bearbeiten/Deinstallieren, `POST …/external/disabled {id, disabled}` nach Aus/Ein (höchstens 5 s, Fehler ändern nichts im Kern; App-Log `told the server: …`). Am Tablet belegt: `reload` mit einer neuen Kennung lädt die Datei auch beim Server (Log `Loaded external extension id=archive-org`). Der erste Build fragte vorher `serverListening()` – das war in der scratch-App nie wahr, der Server bekam nichts; jetzt ohne diese Abfrage.

**Listen ohne Sandkasten:** Was `getSettings()` lieferte, steht in `core.db` (Schema-Schritt 7, `extension_settings`, Schlüssel aus Länge + FNV-1a von Code und Einstellungen). Installieren fragt es schon im Probe-Sandkasten ab. Ursache der 495–701 ms am S22 (3e-1): je Erweiterung ein neuer Sandkasten mit Vorspann und TS-Wandler beim ersten Öffnen nach App-Start; zusätzlich las jede der fünf gleichzeitigen Listen den Ordner selbst, Datei für Datei, und `GetAllExtensions` fragte die Nutzer-Einstellungen nacheinander. Jetzt: ein gemeinsamer Lesevorgang, Dateien zugleich gelesen, Einstellungen zugleich.

**Listen-Zeit am Tablet (scratch, App-Log, 13.11.2026 21:07–21:19):**

| | Server | Kern |
|---|---|---|
| `POST /extensions/all`, 0 externe Erweiterungen, 1./2. Aufruf | 32 / 28 ms | – |
| `/all` + 3 Listen gleichzeitig, 1 Erweiterung (nach Umschalten) | 72–86 ms | 8–20 ms |
| `/all` direkt nach App-Neustart, 1 Erweiterung (aus `core.db`, kein Sandkasten) | – | 12 ms |
| `/all` per Node über `adb forward`, 1./2. Aufruf | 109 / 15 ms | – |

Vorher (3e-1, S22, 6 Erweiterungen) 495–701 ms je Liste. Der Kern ist am Tablet nicht langsamer als der Server; ein Vergleich mit 6 Erweiterungen am S22 steht aus.

**Am Gerät (Pixel Tablet, scratch-App, Nutzer 10; Belege `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\3e2-*.png`):**

1. Bereich an, Internet Archive über den Kern installiert (411 ms, Datei `files/extensions/archive-org.json` 26 670 Bytes), Liste zeigt sie sofort (`3e2-03`). Rückweg mit Build 1: Server zeigte sie **nicht** (`3e2-04`, Ursache oben); `reload` per Hand → Server zeigt sie. Mit Build 2 nicht wiederholt.
2. Nach App-Neustart (Build 2) Kern-Liste mit Internet Archive, 12 ms (`3e2-05`). Einstellungen: die Erweiterung hat keine (`userConfig` fehlt), das Blatt bietet keine an (`3e2-06`).
3. Update prüfen: „This extension is up to date“ (`3e2-07`).
4. Ausschalten über den Kern (277 ms, `told the server: POST …/disabled`), Datei-Cache danach `{"archive-org":true}` (`3e2-08`). Rückweg: Server-`/all` zeigt archive-org unter `disabledExtensions` – gleicher Stand.
5. Einschalten, Code-Ansicht, Deinstallieren, wieder Installieren und Bereich aus: im Abschluss unten (Builds 3 und 4).

**Faden-Wächter (Build 2):** mehrere Stücke über 8 ms in den Listen (8–21 ms) und beim Ausschalten 54,7 ms am Stück.

### 3e-2, Abschluss: Ursache der Stücke über 8 ms

Kein Rechen-Stück des Kerns war so lang; der Wächter hat zu viel gezählt, an zwei Stellen:

1. **Datei-Zugriffe nicht als Warten gesehen.** `files/extensions/*.json` und der Datei-Cache werden über `expo-file-system` gelesen (`file.text()`, eigener Faden). Diese Aufrufe waren nicht mit `watch.waiting` umhüllt; das Stück des Kerns blieb über das ganze Lesen offen, und was die Oberfläche in der Zeit lief (Neu-Zeichnen nach dem Tipp, die anderen Listen), zählte als Kern. Fix: `placeWithWaits` (`manage/installed.ts`) umhüllt alle Datei- und DB-Zugriffe des Ortes; was davor im Faden läuft (`exists`, das Schreiben selbst), zählt weiter.
2. **Mehrere Wartende zugleich.** Bei `Promise.all` (Dateien zugleich lesen, Einstellungen zugleich) öffnete schon das erste beendete Warten wieder ein Stück, das offen blieb, bis das letzte fertig war – auch hier lief in der Zeit nur die Oberfläche. Fix im Wächter (`blocking.ts`): Ein beendetes Warten merkt sich nur den Zeitpunkt; das Stück beginnt erst, wenn Kern-Code den Wächter wieder erreicht, ab dem Ende des letzten Wartens (und nie vor dem Ende eines anderen Stücks, das dazwischen lief). Gilt für alle Bereiche.
3. **Mitlesen.** Fragen mehrere Listen zugleich, teilen sie einen Lesevorgang (`readInstalled`), ebenso einen Sandkasten, der gerade geöffnet wird. Wer sich anhängt, wartete ungesehen; sein Stück blieb offen, bis der andere fertig war (am Gerät nach Build 3: Code-Ansicht `GET /extensions/payload` 27,0 ms, die Liste nach App-Start 13,5 ms). Fix: `ExtensionPlace.join`, von `placeWithWaits` gesetzt, in `readInstalled` und `ExtensionLoader.use`.

Nachgestellt unter Node (`manage.test.ts`, „counts the screens' work during a file read as theirs“): Lesen 20 ms auf anderem Faden, Oberfläche 15 ms dazwischen → ohne Fix längstes Stück > 15 ms (mit Fix 1 allein 30,4 ms, wegen Punkt 2), mit allen Fixes < 8 ms; ebenso beim Mitlesen. Rechenzeit des Kerns selbst (Node): `JSON.parse` des 26-KB-Manifests 0,04 ms, `manifestFromText` 0,05 ms.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build 4 = Code von `a2f0786`, 13.11.2026 21:45–21:49; Rückweg jeweils per Node über `adb forward` an `POST /api/v1/extensions/all` des Servers):**

| Schritt | Kern-Log | 8 ms | Rückweg (Server) |
|---|---|---|---|
| Liste öffnen (`/all`) | 14–15 ms | kein Stück > 8 ms (vorher 8–21 ms) | – |
| a) Einschalten (Build 3) | `told the server: POST …/disabled`, 392 ms | kein Stück > 8 ms (Ausschalten vorher 54,7 ms) | `archive-org` unter `extensions`, `disabled` leer (`3e2-10-eingeschaltet.png`) |
| b) Code-Ansicht | `GET /extensions/payload` 45 ms | **31,4 ms** (Build 3: 27,0 ms) | – |
| c) Deinstallieren | `told the server: POST …/reload`, 349 ms; Server-Log `Extension removed id=archive-org` | kein Stück > 8 ms | nur `local-manga` |
| d) Installieren | `told the server: POST …/reload`, 711 ms | **8,4 / 22,3 ms** | `archive-org` unter `extensions` (`3e2-11-wieder-installiert.png`) |
| e) Liste nach dem Installieren | `/all` 6 ms, Listen 8–50 ms gesamt | kein Stück > 8 ms | – |
| f) Bereich aus (`on=0`) | `areas answered by the core: none`, Listen wieder vom Server | – | `archive-org` installiert und eingeschaltet (`3e2-12-bereich-aus.png`) |

Erste Liste nach App-Start (Kaltstart): 13,5 ms (Build 3) / 15,1 ms (Build 4), danach nicht mehr.

**Offen (8 ms):** Code-Ansicht 31 ms, Installieren 22 ms, erste Liste nach Kaltstart 15 ms. Nicht belegt, ob Kern oder Oberfläche: Die Rechenzeit des Kerns auf diesen Wegen ist unter Node < 0,1 ms (Hermes ohne JIT eher das Zehnfache), ein ungesehenes Warten ist im Code nicht mehr zu finden. Vermutung: Arbeit der Oberfläche in Microtasks (React plant Updates der Sync-Lane als Microtask; die Code-Ansicht zeichnet 26 KB Text), die zwischen den `await`-Schritten des Kerns laufen, solange dessen Stück offen ist; beim Installieren zusätzlich `JSON.stringify` des Manifests und das Übergeben des Skripts an den Sandkasten; beim Kaltstart das erste Laden der Module. Nächster Schritt: Messpunkte je Abschnitt im Wächter (Teil-Namen über `pause`), ein Build (Budget dieses Laufs erschöpft).

### Schlüssel der gemerkten `getSettings()`-Antworten

Vorher: Länge + FNV-1a des Codes und der Werte; im Speicher nur der Code-Vergleich. Was der Server ändert, während der Bereich aus ist (Datei neu geschrieben, Nutzer-Einstellungen `ext_user_config_<id>` gespeichert), blieb so unbemerkt, solange der Code-Text gleich war. Jetzt: `<Größe>.<Änderungszeit>` der Datei `extensions/<datei>` und der Datei `cache/ext_user_config_<id>.cache` (`ExtensionFolder.stamp`, `ExtensionPlace.serverCacheStamp`) + FNV-1a der Werte, im Speicher wie in `core.db` (`extension_settings.code_key`, kein neuer Schema-Schritt). Der Code muss dafür nicht mehr gehasht werden. Welche Nutzer-Einstellungen gelten, bleibt die Umzugs-Regel oben (einmal übernommen); eine Änderung beim Server führt nur dazu, dass `getSettings()` neu gefragt wird. Test: „asks getSettings() again when the server changed the files while the area was off“.

### Offen für 3e-2 / 3f

- Stücke über 8 ms: Code-Ansicht, Installieren, erste Liste nach Kaltstart (oben). Listen-Zeit mit 6 Erweiterungen am S22.
- 3f: Suchen und Streams über die Kern-Sandkästen (Online-Stream-Schnittstellen umleiten); dann wirken auch die im Kern gespeicherten Nutzer-Einstellungen.
- Nummern für neue eigene Quellen vergibt weiter der Server.

## 4m. Online-Stream im Kern (Phase 3f)

Phase 3f-1 (13.11.2026): Die Online-Stream-Schnittstellen laufen im Kern, hinter dem Bereich `streams` (Standard aus). Die Arbeit macht die Erweiterung in ihrem eigenen Sandkasten (3a–3e, gleicher `ExtensionLoader` wie die Verwaltung). Code: `native/src/core/streams/` (`onlinestream.ts` Antworten, Ablauf, Cache; `choose.ts` Auswahl; `mappings.ts` Zuordnungen), Prüf-Link am Gerät `native/src/api/client/core-streams-check.ts`. Abspielen ohne Server folgt in 3f-2.

### Schnittstellen (Bereich `streams`)

| Schnittstelle | Adresse | Antwort |
|---|---|---|
| `GetOnlineStreamEpisodeList` | `POST /api/v1/onlinestream/episode-list` | `{ episodes, media }` |
| `GetOnlineStreamEpisodeSource` | `POST /api/v1/onlinestream/episode-source` | `{ number, videoSources, servers }` |
| `GetOnlinestreamMapping` | `POST /api/v1/onlinestream/get-mapping` | `{ animeId }` (`null` ohne Zuordnung) |
| `OnlinestreamManualSearch` | `POST /api/v1/onlinestream/search` | Treffer `{ id, title, url, subOrDub }` |
| `OnlinestreamManualMapping` | `POST /api/v1/onlinestream/manual-mapping` | `true` |
| `RemoveOnlinestreamMapping` | `POST /api/v1/onlinestream/remove-mapping` | `true` |
| `OnlineStreamEmptyCache` | `DELETE /api/v1/onlinestream/cache` | `true` |

Form und Felder wie die Aufzeichnungen (`onlinestream.recorded.json`: nur die Form, keine Werte). Bereich `streams` statt eines neuen: so war er in §3 angelegt, und er ist unabhängig von `extensions` schaltbar (die Verwaltung kann beim Server bleiben, während der Kern streamt).

**Ablauf:** `search` → Auswahl (oder Zuordnung) → `findEpisodes` → `findEpisodeServer`. Die Quelle fragt die Server der Erweiterung in der Reihenfolge von `getSettings().episodeServers`, bis einer Video-Quellen hat (aufgezeichnet: ein Server, der erste, auch bei `kaa` mit zwei). Zeitlimit und Fehlerarten wie 3a: jeder Aufruf hat die Zeitgrenze des Sandkastens (60 s); `time`, `memory`, `stack`, `closed` und der eigene Fehler der Erweiterung werden zu einem `CoreError` mit eigenem Text (`<id>: findEpisodes failed: …`, `… took too long`). Zwischen den Schritten gibt der Kern den Faden frei (`pause`).

**Metadaten der Folgen:** Titel, Bild und Beschreibung je Folge (`metadata` = die Folge der Anime-Seite) gehören nicht der Erweiterung, sondern den Metadaten des Servers (Stufe 5). Der Kern nimmt sie aus der Server-Antwort der Anime-Seite (`/library/anime-entry/{id}`, frisch oder die zuletzt gemerkte aus §4e), Zuordnung über `progressNumber` der Hauptfolgen. Ohne beides: Titel der Erweiterung bzw. „Episode N“, `media` von AniList (eigene Abfrage `ANIME_BASE` mit den Feldern der Listen). Das ist die bewusste Abweichung bis Stufe 5.

**Weitere Abweichungen:** Fehlertexte sind eigene (der Server-Wortlaut ist nicht aufgezeichnet). Untertitel ohne `id` (wie aufgezeichnet). Die manuelle Suche gibt der Erweiterung nur die Wörter (`media.id` 0), die Anfrage nennt keinen Anime.

### Auswahl des Anbieter-Eintrags (`choose.ts`, eigene Regeln)

1. Falsche Sprachart fällt weg (Dub gewünscht: „sub“; Sub gewünscht: „dub“), außer es bleibt nichts.
2. Ähnlichkeit des Treffer-Titels zu Romaji, Englisch und Synonymen (Synonyme × 0,95): gleich nach dem Säubern (Groß/klein, Akzente, Satzzeichen, „Season 2“ = „2nd Season“ = „2“) = 1, sonst Anteil gemeinsamer Buchstabenpaare (Dice).
3. Eine Zahl im Treffer, die kein Titel des Anime hat (Fortsetzung, fremdes Jahr): −0,4; das Jahr des Anime: +0,05.
4. Bester Treffer ab 0,6 gewinnt; Gleichstand: der frühere. Gesucht wird mit dem Romaji-Titel, ohne Treffer noch mit dem englischen; `year`, `episodeCount`, `format` usw. gehen als `Media` an die Erweiterung.

Ohne passenden Treffer: Fehler „no matching entry found, choose one by hand“. Eine gefundene Wahl wird nicht als Zuordnung gespeichert (aufgezeichnet: nach dem Laden der Folgen-Liste bleibt `animeId` `null`). Belegt: gleiche Wahl wie in den Aufzeichnungen (beide Trefferlisten für Dr. STONE) und am Gerät gleiche Folgen-Listen für zwei Anime und beide Erweiterungen.

### Zuordnungen und Umzug

Eigene Tabelle `onlinestream_mappings` in `core.db` (Schema-Schritt 8: `provider`, `media_id`, `anime_id`, `origin`, `changed_at`, eindeutig je Anbieter + Anime) und `onlinestream_mapping_move` (eine Zeile = Umzug gelaufen). Beim ersten Bedarf liest der Kern einmal die Tabelle `onlinestream_mappings` der Server-DB (Kopie im Speicher wie `core/move/`, Weg `ExtensionPlace.serverMappings`), übernimmt gültige Zeilen mit `origin` „server“ und fragt danach nie wieder. Manuelle Zuordnung schreibt `origin` „core“, Entfernen löscht im Kern; der Server-Bestand bleibt unverändert (am Gerät: beide Anime beim Server ohne Zuordnung, nichts geändert). Folge: Was der Kern zuordnet, sieht der Server nicht.

### Cache

Im Speicher des App-Laufs: Folgen-Liste der Erweiterung je Anbieter + Anime + Sub/Dub **60 min** (neue Folgen erscheinen spätestens dann), Quellen je Folge **10 min** (Adressen der Anbieter verfallen). `refresh: true` fragt die Quelle neu. Gleichzeitige gleiche Anfragen teilen einen Lauf (Warten über `place.join`, für den Wächter ein Warten). Ein Fehler wird nicht gemerkt. „Cache leeren“ (`mediaId`) vergisst alles dieses Anime; manuelle Zuordnung und Entfernen ebenso.

### Größe der Antworten

Die Erweiterung gibt kleine Listen zurück; durch den Faden der Oberfläche geht nur das JSON-Ergebnis eines Aufrufs. Messung (Node, `onlinestream.test.ts`): eine Folgen-Liste mit 2000 Folgen hat 148 680 Bytes, `JSON.parse` 0,26 ms. Ein Zusammenstreichen schon im Sandkasten lohnt sich bei dieser Größe nicht, anders als beim hanime-Katalog in 3d (4,3 MB).

### Vergleich Kern gegen Server (S22, Test-App, Nutzer 0, Build von `f4887c2`, 13.11.2026 22:12–22:18, nur lesend)

Weg: Link `seanime-native://core?streams=check&media=105333,154587&query=dr.%20stone` (nur Test-/scratch-App) liest über dieselbe Tür wie die Hooks (`buildSeaQuery`), je installierter Online-Stream-Erweiterung: Folgen-Liste, Quelle Folge 1, manuelle Suche; danach zweimal `/extensions/all`. Einmal mit allen Bereichen aus (Server), einmal mit `streams` + `extensions` an (Kern). Dazu lesend per Node über `adb forward` an Port 43212 (Server). Keine Zuordnung, kein Entfernen, kein Cache-Leeren, keine Wiedergabe. Zweiter Anime: Sousou no Frieren (154587).

| Erweiterung | Anime | Folgen Server / Kern | Quelle Folge 1 Server / Kern | Zeit Liste S / K | Zeit Quelle S / K |
|---|---|---|---|---|---|
| `aq-anikoto` | Dr. STONE | 24 (1..24) / 24 (1..24) | 1 m3u8, Kopfzeilen ja, 9 Untertitel, 1 Server / gleich | 18 ms¹ / 205 ms | 838 / 1295 ms |
| `aq-anikoto` | Frieren | 28 (1..28) / 28 (1..28) | 1 m3u8, Kopfzeilen ja, 9 Untertitel, 1 Server / gleich | 122 / 95 ms | 750 / 964 ms |
| `kaa` | Dr. STONE | 24 (1..24) / 24 (1..24) | 1 m3u8, Kopfzeilen ja, 8 Untertitel, 1 Server / gleich | 1757 / 1220 ms | 1185 / 1088 ms |
| `kaa` | Frieren | 28 (1..28) / 28 (1..28) | 1 m3u8, Kopfzeilen ja, 9 Untertitel, 1 Server / gleich | 1964 / 1316 ms | 1318 / 881 ms |

¹ beim Server schon im Cache. Per Node direkt danach (Server-Cache warm): Listen 20–22 ms, Quellen 11–16 ms.

| Manuelle Suche „dr. stone“ | Server | Kern |
|---|---|---|
| `aq-anikoto` | 49 Treffer (668 ms) | **30** Treffer (582 ms) |
| `kaa` | 9 Treffer (398 ms) | 9 Treffer (412 ms) |

**Abweichung `aq-anikoto`-Suche:** Die Erweiterung baut ihre Suchwörter mit `$scannerUtils.buildSmartSearchTitles` (öffentlich in `core.d.ts`, bis zu drei Varianten). Diese Hilfsfunktion gibt es im Kern-Sandkasten noch nicht; die Erweiterung fängt den Fehler ab und sucht nur mit den rohen Wörtern, daher weniger Treffer. Folgen-Listen und Quellen sind nicht betroffen (gleiche Wahl).

**Faden der Oberfläche (Wächter, Kern-Lauf):** Stücke über 8 ms: „extension sandbox“ 66,1 ms und 33,7 ms (erstes Öffnen der Sandkästen nach App-Start, `aq-anikoto` 57 KB TypeScript), `episode-list` 23,8 / 14,8 / 9,5 ms (zweimal im Schritt `kaa search`), `episode-source` 9,1 / 8,2 ms, `extensions/all` 10,2 ms (erster Aufruf). Der Server-Lauf hat keine Kern-Stücke. Ursache noch nicht untersucht.

**Listen-Zeit `/extensions/all` mit 6 installierten Erweiterungen (aus 3e offen):** Server 16 / 16 ms (App), 15 / 16 ms (Node); Kern 47 / 14 ms (1. / 2. Aufruf).

Am Ende alle Bereiche aus (Log „areas answered by the core: none“). Beleg: `belege/3f1-01-anime-seite-bereich-an.png` (Anime-Seite Dr. STONE, Bereich an). Die Screenshots der Folgen-Liste an/aus fehlen: der Tipp auf den Reiter „Online streaming“ wurde von der Freigabe-Prüfung dieser Sitzung abgelehnt; die Zahlen oben stammen aus dem Log. APK 111 820 295 → 111 900 419 Bytes.

### Testweg

`native/src/core/streams/onlinestream.test.ts` (Node, ohne Netz, 17 Tests): eigene Beispiel-Erweiterung nach `onlinestream-provider.d.ts` im echten Sandkasten (TypeScript); jede der sieben Routen gegen die Form der Aufzeichnung; Folgen-Liste mit Metadaten der Anime-Seite und ohne Server (AniList-Weg, Form von `media`); Quelle mit Ausweich-Server; Fehlerfälle; Umzug der Server-Zuordnungen an einer Test-DB (einmal, ungültige Zeilen weg, Server-Liste unverändert, keine DB); Cache (Lebensdauer, `refresh`, Leeren, geteilter Lauf, Fehler nicht gemerkt); Auswahl mit eigenen Fällen (beide aufgezeichneten Trefferlisten, Fortsetzungen, Sub/Dub, Jahr, Gleichstand, nur Synonym); Größen-Messung. `database.test.ts`: Schritt 8. `app-links.test.ts`: Prüf-Link nur in Test-/scratch-App.

### Phase 3f-2: Abspielen ohne Server, `$scannerUtils`, Stücke über 8 ms (13.11.2026)

**Abspielen ohne Server (S22, Test-App, Nutzer 0, Build von `001aa0c`, 22:52–22:53, Bereiche `extensions` + `streams` an):** Dr. STONE, Reiter „Online streaming“, Anbieter `kaa` (war gespeichert; die Wahl des Besitzers wurde nicht umgestellt), Folge 1 im Kasten abgespielt, nach ≈ 10 s pausiert (Medientaste), Seite zu, Bereiche aus. Quelle aus dem Kern (`episode-source` vom Kern beantwortet), App-Log: `playing directly, no proxy: m3u8, header fields Origin/Referer/User-Agent, subtitles 8`; mpv spielt mit Untertitel (`belege/3f2-01-wiedergabe-direkt.png`, pausiert `belege/3f2-02-pausiert.png`). logcat im Abspiel-Fenster (Tipp bis Pause): **0** Zeilen `/api/v1/proxy` oder `proxy >`, **0** Online-Stream-Anfragen beim Server (`SeanimeBackend`); die ersten Server-Anfragen `onlinestream/*` kommen erst nach `area=streams&on=0` (Neuladen vom Server, wie gewollt). Weg wie Probe 1 (§7): `buildOnlineStream(…, direct)` → `mpvHeaderOptions` → `http-header-fields`. AniList unberührt (Folge schon gesehen, Wiedergabe weit vor jeder Meldung).

**HLS-Schlüssel:** Der Prüf-Link liest jetzt für die erste m3u8-Quelle Liste → erste Variante mit den Kopfzeilen der Quelle und zählt `#EXT-X-KEY` (RFC 8216); bei einem Schlüssel fragt er dessen Adresse einmal mit, einmal ohne Kopfzeilen. Ergebnis für beide Anbieter und beide Anime: **keine `#EXT-X-KEY`-Zeile** (anikoto 1 Variante, kaa 3 Varianten). Der Schlüssel-Weg von mpv bleibt deshalb unbelegt (kein verschlüsselter Test-Stream verfügbar); der Prüf-Link zeigt ihn, sobald eine Quelle verschlüsselt ist.

**`$scannerUtils`** (`helpers/prelude/scanner.js`, eigene Regeln nach den Beschreibungen in `core.d.ts`): alle 13 Funktionen (`normalizeTitle`, `extractSeasonNumber`, `extractPartNumber`, `extractYear`, `compareTitles`, `findBestMatch`, `getSignificantTokens`, `buildSearchQuery`, `buildAdvancedQuery`, `sanitizeQuery`, `buildSeasonQuery`, `buildPartQuery`, `buildSmartSearchTitles`). Im leichten Vorspann (+ ≈ 5 KB, `bundle.generated.ts` 203 → 208 KB), kein Nachladen nötig. Tests `scanner.test.ts` (6, im echten Sandkasten, mit den Beispielen aus `core.d.ts`). Praxis (PC, Node, Suchseite der Erweiterung, nicht im Repo): Suchwort „dr. stone“ 30 Treffer, „dr stone“ 30, zusammen **49**; `buildSmartSearchTitles(["dr. stone"])` gibt `["dr stone"]`, die Erweiterung sucht damit und mit den rohen Wörtern. **Am S22: `aq-anikoto`-Suche 49 Treffer (Kern) = 49 (Server)**, in drei Läufen; `kaa` weiter 9 = 9.

**Wächter mit Messpunkten:** `waiting(fn, name)` gibt jedem Warten einen Namen (Netz, Datei, SQL, Sandkasten-Aufrufe, Server …), `mark(name)` schneidet ein Stück in Abschnitte; jedes Stück meldet `from` (nach welchem Warten), `until` (bis zu welchem) und seine Abschnitte. Eine Warnung im Log nennt das (`… (after network read, until sandbox answer)`); der Prüf-Link gibt am Ende das längste Stück je Anfrage aus. Die Sandkasten-Fragen heißen jetzt `extension sandbox: <Host-Funktion>`. Tests `blocking.test.ts` (+3).

**Stücke über 8 ms, vorher/nachher (S22, Test-App):** vorher = 3f-1 (oben) bzw. 3e (§4l); nachher = Build `001aa0c`, Lauf A „kalt“ 8 s nach dem Neustart durch `install -r`, Lauf B „warm“ direkt danach (nach dem Selbsttest). Werte = längstes Stück der Anfrage.

| Stück | vorher | nachher A (kalt, 8 s nach Start) | nachher B (warm) | Ursache (Messpunkt) |
|---|---|---|---|---|
| Sandkasten, erstes Öffnen | 66,1 / 33,7 ms | `extension sandbox: fetch` 69,6 ms (after network read, until sandbox answer) | längstes `fetch`-Stück 0,7 ms | Arbeit der App beim Start (1) |
| `episode-list` | 23,8 / 14,8 / 9,5 ms | 16,2 ms (`kaa search`, after sql, until pause), sonst ≤ 4,2 ms | ≤ 2,7 ms | wie (1) |
| `episode-source` | 9,1 / 8,2 ms | 5,3 ms | 3,6 ms | – |
| `/extensions/all` | 10,2 ms | 2,8 ms | 2,7 ms | (2) |
| Code-Ansicht (`/extensions/payload`) | 31,4 ms (3e) | 3,8 / 3,0 ms | 1,3 / 3,2 ms | (2) |
| erste Liste nach Kaltstart | 15,1 ms (3e) | 4,0 ms | 2,7 ms | (2) |
| Installieren | 22,3 ms (3e) | nicht gemessen | nicht gemessen | schreibend, am S22 bewusst nicht (3f-3) |
| `episode-source` beim Abspielen | – | 1150,4 ms (after sandbox close, until sandbox close) | – | **Kern-Fehler, behoben** (3) |

**Ursachen:**

1. **Zwischen „network read“ und „sandbox answer“** läuft im Kern nur: Antwort-Objekt bauen, Cloudflare-Prüfung (nur bei 403/503), `JSON.stringify` der Seite (≈ 117 KB) und Übergabe an `answerHost` – derselbe Weg dauert warm höchstens 0,7 ms über alle Abrufe des Laufs. 69,6 ms gibt es nur in den Sekunden nach dem App-Start: Zwischen den `await`-Schritten dieses Abschnitts (schon erfüllte Versprechen, kein echtes Warten) laufen die eingereihten Microtasks der App (Start der Oberfläche, Listen), und das offene Stück zählt sie mit. Belegt durch den Abschnitt (kein Warten dazwischen, das sich umhüllen ließe) und den warmen Lauf. Gleiches für `kaa search` 16,2 ms (warm ≤ 1,3 ms). **Nicht Kern**, kein Fix im Kern; ein Wächter, der fremde Microtasks abzieht, ist in JavaScript nicht machbar.
2. **Code-Ansicht, erste Liste, `/extensions/all`:** am S22 jetzt 1,3–4,0 ms ohne neue Änderung auf diesem Weg (die Fixes `placeWithWaits`/`join` aus 3e-2 wirken); die alten Werte stammen aus Läufen direkt nach dem Start bzw. ohne Messpunkte – wie (1).
3. **1150 ms beim Abspielen (echter Fehler im Kern):** `ExtensionLoader.close` wartete auf einen Sandkasten, der gerade geöffnet wurde (`await entry.sandbox`), ohne dass der Wächter es sah; das Stück blieb über das ganze Öffnen offen. Fix: Warten über `place.join` (`loader.ts`). Nachgestellt in `manage.test.ts` („sees closing a sandbox that is still being opened as a wait“): ohne `join` > 15 ms (Oberfläche 15 ms dazwischen), mit < 8 ms. Am Gerät noch nicht nachgemessen (Build-Budget erschöpft).
4. Erstes Laden des nativen Moduls `modules/core-sandbox`: der Selbsttest lädt es als Erstes, sein längstes Stück 5,8 ms (Build 1) – nicht die Ursache der 66 ms. Selbsttest warm einmal 11,9 ms (2 von 355 Stücken, Build 2), sonst ≤ 5,8 ms.

### Offen für 3f-3

- Deutsche Erweiterungen in scratch vergleichen, Zuordnung am Gerät schreiben, Downloads aus dem versteckten WebView, „needs the user“-Meldung in der Oberfläche.
- Wiedergabe mit `aq-anikoto` am Gerät (gespeicherter Anbieter war `kaa`), verschlüsselter Stream (`#EXT-X-KEY`), Fix (3) am Gerät nachmessen, Installieren messen (Tablet/scratch), Selbsttest-Stück 11,9 ms.
- Metadaten der Folgen ohne Server (Stufe 5).

### Phase 3f-3: Downloads, „needs the user“, Installieren am Tablet (13.11.2026)

**Downloads aus der versteckten Seite:** react-native-webview hat unter Android keinen Schalter dafür (der `DownloadListener` wird immer gesetzt und reicht jeden Download an den DownloadManager). Kleiner Patch `native/patches/react-native-webview+14.0.1.patch` (über `patch-package`): neue Eigenschaft `downloadsDisabled` (Spec für Codegen, View-Config, beide View-Manager, Feld am `RNCWebView`); ist sie gesetzt, kehrt der Listener als Erstes zurück (Log `Download blocked: downloads are off for this WebView`) – keine Anfrage, keine Berechtigungsfrage, kein Toast. Nur das versteckte WebView (`hidden-browser.tsx`) setzt sie; andere WebViews der App bleiben wie sie waren. Test `lib/hidden-browser/downloads.test.ts` (Node, ohne WebView): Wächter steht vor allem anderen im Listener, Eigenschaft erreicht die native Seite, nur der versteckte Browser setzt sie. Am Gerät nicht ausgelöst (keine Seite mit Download zur Hand).

**Interaktive Cloudflare-Prüfung in der App:** `failureOf` (`streams/onlinestream.ts`) erkennt `CloudflareCheckError`/„Cloudflare's check needs the user“ auch eingepackt in den Fehler der Erweiterung und macht daraus einen Satz: `<Anbieter>: the site asks for a human check (Cloudflare) that the app cannot pass by itself. Try again later or choose another provider.` (Status 503, ohne Adresse). Er geht den vorhandenen Weg: Fehler-Hinweis der Quelle bzw. „Anbieter-Fehler“ auf der Online-Stream-Seite. Kein neuer Bildschirm, kein neues Aussehen; die App löst nichts. Tests in `onlinestream.test.ts` (+2).

**Neue Prüf-Links (nur Test-/scratch-App):** `core?extensions=install&url=<Manifest>` (Installieren über dieselbe Tür wie die Oberfläche, Log: Zeit, Antwort, längstes Stück); `core?streams=mapping&media=<id>&provider=<id>&query=<Wörter>&entry=<Wörter>` (Zuordnung lesen → Folgen-Liste → Suche → Zuordnung setzen → lesen → Liste → entfernen → lesen → Cache leeren → Liste); `core?streams=check&…&searchonly=<ids>` (diese Anbieter nur Suche, keine Folge, keine Quelle – für hanime). Tests in `app-links.test.ts`.

**Installieren am Tablet (scratch, Nutzer 10, Build von `f41fbec`, 13.11.2026 23:14, Bereich `extensions` an, über den Prüf-Link; AniWorld, AnimeToast, hanime ohne eigene Adresse → Manifest mit Code vom PC über `adb reverse`):**

| Erweiterung | Zeit | längstes Stück (Abschnitt) |
|---|---|---|
| AniStar | 6581 ms (erste nach Start) | 120,9 ms (after start, until network) |
| AniWorld | 640 ms | 20,7 ms (after file read, until file write) |
| AnimeToast | 703 ms | 33,4 ms (after sandbox close, until file names) |
| hanime | 1146 ms | 43,3 ms (after sandbox close, until file names) |
| `aq-anikoto` | 3735 ms | 34,2 ms (after sandbox close, until file names) |

Alle fünf „Successfully installed“. **Vorbehalt:** Das Tablet war gesperrt (Nutzer 10 mit Sperre, `isDeviceLocked(10): true`, Anzeige „Dozing“); die App lief im Hintergrund, der Server war nicht gestartet (`could not tell the server … Network Error`). Die Werte sind deshalb nicht mit 3e-2 (22,3 ms, App im Vordergrund) vergleichbar; die Stücke liegen zwischen Datei-/SQL-/Sandkasten-Warten, wo im Kern keine Rechenarbeit dieser Länge steht – vermutlich gedrosselte CPU im Hintergrund. Nachmessen mit entsperrtem Tablet offen.

**Abgebrochen (Tablet gesperrt):** Der Vergleich Kern/Server, die Wiedergabe mit `aq-anikoto` und die Zuordnung am Gerät liefen nicht durch: Server-Lauf `extensions/all: Network Error` (Server nicht gestartet); Kern-Lauf blieb nach `get-mapping: none (79 ms)` und der Anbieter-Liste (364 ms) stehen, `ConnectivityService` meldet für die App abwechselnd „BLOCKED“ (Hintergrund-Netz bei gesperrtem Gerät). Ein Wischen nach oben zeigte die Eingabe der Sperre (Bildschirmfoto schwarz); ein Entsperren mit Zugangsdaten ist dem Agenten nicht erlaubt. Danach alle Bereiche aus (`areas answered by the core: none`), die fünf Erweiterungen bleiben installiert.

### Phase 3f-3, Gerätearbeit nachgeholt (Pixel Tablet, scratch, Nutzer 10, Build von `5ec105c`, 13.11.2026 23:40–23:49, Tablet entsperrt, App im Vordergrund)

**Vergleich Kern/Server** (Link `core?streams=check&media=105333&query=dr.%20stone&searchonly=hanime-online-streaming`, einmal alle Bereiche aus = Server, einmal `extensions` + `streams` an = Kern; Kern-Lauf: **0** Online-Stream-Anfragen beim Server):

| Erweiterung | Suche „dr. stone“ S / K | Folgen Dr. STONE S / K | Quelle Folge 1 Server | Quelle Folge 1 Kern |
|---|---|---|---|---|
| AniStar | 2 / 2 | 24 (1..24) / 24 (1..24) | 4 Quellen m3u8/mp4, Kopfzeilen ja, 0 Untertitel, 2 Server | **2 Quellen m3u8**, Kopfzeilen ja, 0 Untertitel, **1 Server** |
| AniWorld | Fehler / Fehler (gleich: `cannot read property 'format' of undefined` in der Erweiterung) | 24 / 24 | 2 Quellen m3u8/mp4, Kopfzeilen nein, 0 Untertitel, 1 Server | 2 Quellen m3u8/mp4, Kopfzeilen nein, 0 Untertitel, 2 Server gefragt (1. ohne Quellen) |
| AnimeToast | 1 / 1 | 24 / 24 | Fehler „no source found for episode“ (500) | Fehler „Mp4Upload has no link for episode 1“ (gleiches Ergebnis: keine Quelle) |
| `aq-anikoto` | 49 / 49 | 24 / 24 | 1 Quelle m3u8, Kopfzeilen ja, 9 Untertitel, 1 Server | gleich |
| hanime (nur Suche) | 1 / 1 | – | – | – |

HLS: keine `#EXT-X-KEY`-Zeile (AniStar 0, AniWorld 3, anikoto 1 Variante, beide Seiten). `/extensions/all` 7 / 7 Erweiterungen. Der Server antwortete aus seinem Cache (37–55 ms je Quelle).

**Abweichung AniStar Folge 1:** Der Kern fragt die Server der Erweiterung nur bis zum ersten mit Quellen (`onlinestream.ts`, Schleife über `episodeServers`) und nennt in `servers` die gefragten; der Server gibt bei AniStar die Quellen **beider** Server (4) zurück. Im Kern fehlt damit die Wahl des zweiten Servers (mp4). Bei AniWorld nennt der Kern zusätzlich den ersten, leeren Server. Abspielen ist nicht betroffen (die erste Quelle genügt); als Code-Fehler gemeldet, nicht geändert.

**Wiedergabe mit `aq-anikoto` ohne Server** (Bereiche `extensions` + `streams` an, Dr. STONE, Reiter „Online streaming“, Anbieter von AnimeToast auf Anikoto umgestellt, Folge 1 im Kasten, nach ≈ 10 s pausiert per Medientaste, danach Seite und Mini-Player geschlossen): `episode-list` und `episode-source` vom Kern beantwortet; App-Log `playing directly, no proxy: m3u8, header fields Referer/Origin, subtitles 9`; mpv spielt mit Untertitel (`belege/3f3-01-wiedergabe-anikoto.png`). logcat ab dem Tipp bis nach dem Schließen: **0** Zeilen `/api/v1/proxy` bzw. `proxy >`, **0** Online-Stream-Anfragen beim Server. Fortschritt bleibt 0/24, AniList unberührt.

**Zuordnung am Gerät** (Link `core?streams=mapping&media=105333&provider=aq-anikoto&query=dr.%20stone&entry=ryuusui`, Bereiche an): vorher keine Zuordnung (94 ms) → Liste 24 Folgen → Suche 49 Treffer → Zuordnung auf „Dr. Stone: Ryuusui“ gesetzt `true` → lesen: Eintrag gesetzt → Liste **1** Folge (die des Specials) → entfernen `true` → lesen: keine → Cache leeren `true` → Liste wieder 24 Folgen. Alle Antworten vom Kern, keine Anfrage beim Server. Längstes Stück 36,1 ms (`episode-list`, after start, until file names).

**Installieren im Vordergrund** (Link `core?extensions=install`, `aq-anikoto` neu installiert, Bereich `extensions` an): „Successfully installed“ nach **1602 ms** (gesperrt: 3735 ms). Stücke über 8 ms je Abschnitt: 31,6 ms (after sandbox close, until file names), 15,0 ms (after start, until network), 14,1 ms (after file read, until file write), 9,4 ms (after sql, until file stamp). Server danach mitgezogen (`extensions/external/reload` 200). Gegenüber 3e-2 (22,3 ms) also nicht besser; das Stück „after sandbox close, until file names“ tritt bei Installieren, Listen und Code-Ansicht auf (13–38 ms im Vergleichslauf) und ist noch nicht untersucht.

**Auffällig:** Direkt nach dem Vergleichslauf meldete der Wächter ein Stück von **2351 ms** bei `POST /api/v1/extensions/all` (after sandbox close, until join). Ob das echte Arbeit im Faden oder ein Mess-Artefakt (offenes Stück über eine Pause) ist, ist offen.

**Endstand:** alle Bereiche aus (`areas answered by the core: none`), scratch bleibt installiert, alle Erweiterungen bleiben, kein `adb forward`/`reverse` am Tablet.

### Phase 3f-4 (14.11.2026): Quellen aller Server, Wächter-Stücke, S22 nachgemessen

**Quellen aller Server** (`onlinestream.ts`, `episodeSource`): Alle Server der Erweiterung werden gleichzeitig gefragt; die Quellen jedes Servers mit Quellen kommen in der Reihenfolge der Einstellungen zurück, `servers` nennt nur diese (Status `available`). Server ohne Quellen oder mit Fehler fehlen wie beim Server; hat keiner Quellen, kommt der erste Fehler zurück, sonst 404. Tests (`onlinestream.test.ts`): Form der Aufzeichnung (kaa und `aq-anikoto`), 2 Server mit Quellen, 1 leerer, 1 Fehler, alle mit Fehler.

Tablet (scratch, Nutzer 10, Build vom Stand `5a76a6e`, Link `core?streams=check&media=105333&…`, Bereiche aus = Server, `extensions` + `streams` an = Kern):

| Erweiterung | Quelle Folge 1 Server | Kern vorher (3f-3) | Kern nachher |
|---|---|---|---|
| AniStar | 4 Quellen m3u8/mp4, 2 Server | 2 m3u8, 1 Server | **4 m3u8/mp4, 2 Server** |
| AniWorld | 2 Quellen m3u8/mp4, 1 Server | 2, 2 Server (1. leer) | **2 m3u8/mp4, 1 Server** |
| `aq-anikoto` | 1 m3u8, 9 Untertitel, 1 Server | gleich | gleich |

**Wächter-Stücke, Ursachen:**

1. **2351 ms „after sandbox close, until join“ (Mess-Fehler, behoben):** Schließt der Leerlauf-Zeitgeber einen Sandkasten, läuft nach dem Ende von `sandbox close` kein Kern-Code weiter; das gemerkte Ende (`resumed` in `blocking.ts`) blieb liegen. Der nächste Kern-Code, der ohne offenes Stück an den Wächter kam (Zeitgeber eines zweiten Sandkastens → `join`), öffnete sein Stück an diesem alten Zeitpunkt; die freie Zeit dazwischen zählte als Kern. Fix: Das Ende eines Wartens gilt nur bis zur nächsten Runde des Fadens (`free()`), denn Code, der danach weiterläuft, tut das in derselben Runde. Tests „forgets a wait nobody went on after“ (ohne Fix 2351 ms, mit Fix nur das echte Stück) und „still opens the piece … in the same turn“.
2. **„after …, until file names / file write / file stamp“ (echte Arbeit im Faden der Oberfläche, behoben):** Die neueren `File`/`Directory` von expo-file-system prüfen `exists`, listen den Ordner (`list()`), lesen Größe und Zeit und schreiben im aufrufenden Faden; nur `text()`/`write()` sind asynchron (und `write()` wurde nicht abgewartet). Diese Arbeit lag vor dem Warten und zählte richtig ins Stück. Fix: `core-extensions.ts` nutzt `expo-file-system/legacy` (`getInfoAsync`, `readDirectoryAsync`, `readAsStringAsync`, `writeAsStringAsync`, `makeDirectoryAsync`, `deleteAsync`), alles auf dem Faden des Moduls; Stempel in gleicher Form (`<Bytes>.<ms>`). Prüfung in `blocking.test.ts` (kein `new File(`, `list()`, `…Sync(`).
3. **Prüfen der Manifeste nach dem Lesen (12–33 ms, verkleinert):** `readFolder` prüfte alle Manifeste (je mit ganzem Code) in einem Stück. Fix: `place.pause("manifests")` vor jedem Manifest (`installed.ts`), Test „lets the thread go between the manifests“. Ein einzelnes großes Manifest bleibt ein Schritt (bis 18,0 ms).

| Abschnitt (Tablet) | vorher | nachher |
|---|---|---|
| `extensions/all` after sandbox close, until join | 2351 ms | nicht mehr aufgetreten (2 Läufe, Antwort 34/35 ms) |
| Installieren `aq-anikoto`: after sandbox close, until file names | 31,6 ms | weg |
| Installieren: after file read, until file write | 14,1 ms | weg (längstes Manifest-Stück 5,5 ms) |
| Installieren: after sql, until file stamp | 9,4 ms | weg |
| Installieren: after start, until network | 15,0 ms | 15,6 ms (offen) |
| Installieren gesamt | 1602 ms | 1311 ms |
| Listen/Suche: after file read, until sql | 12–33 ms | 12,7–18,0 ms (ein Manifest am Stück) |

**Offen (Kern, nicht behoben):** `extension sandbox: fetch` „after network read, until sandbox answer“ 8,6–99,8 ms – die Antwort der Seite wird als JSON an das native Modul gegeben (`answerHost`), bei großen Seiten im Faden der Oberfläche; braucht eine Übergabe ohne den JSON-Umweg. „after network, until network read“ 9,5–16 ms und „after start, until network“ 15,6 ms liegen im `fetch` von React Native vor bzw. nach dem Warten (nicht Kern-Code, aber in seinem Stück). Suche „after sql, until pause“ 9,8–23,7 ms (Auswahl der Treffer in einem Schritt).

**S22 nachgemessen** (Test-App, Nutzer 0, Build vom Stand `5a76a6e`, APK 111 946 111 Bytes): Selbsttest **15 von 15** in 3706 ms, 355 Stücke, längstes **5,4 ms**, 0 über 8 ms (vorher einmal 11,9 ms). Bereiche `extensions` + `streams` an, Dr. STONE → Online streaming (gespeicherter Anbieter `kaa`), Folge 1 ≈ 12 s abgespielt (setzte am gespeicherten Punkt fort), Medientaste Pause, Seite geschlossen: `episode-list` 1357 ms und `episode-source` 1418 ms vom Kern, `playing directly, no proxy: m3u8`, 0 Online-Stream-/Proxy-Anfragen beim Server. Längstes Stück von `episode-source` **54,2 ms** (after start, until file names) statt **1150,4 ms** (after sandbox close, until sandbox close): Fix `ExtensionLoader.close` am Gerät belegt; die 54 ms vor dem ersten Datei-Zugriff sind offen. Beleg `belege/3f4-01-wiedergabe-s22.png`. AniList unberührt (Folge war schon gesehen, nichts markiert).

**Endstand:** Tablet und S22 alle Bereiche aus (`areas answered by the core: none`), keine eigenen `adb forward`/`reverse`.

### Phase 3g (14.11.2026): Kern-Stücke über 8 ms aus 3f-4

Je Stück zuerst unter Node nachgestellt (Test ohne Fix rot), dann gebaut; ein Test-Build vom Stand `3aba7cb`, S22 (Test-App, Nutzer 0, APK 111 949 611 Bytes), am Gerät nur Links.

| Stück | vorher (3f-4) | Node ohne → mit Fix | S22 nachher kalt (≈ 40 s nach Start) | S22 nachher warm | Stand |
|---|---|---|---|---|---|
| A `extension sandbox: fetch` after network read, until sandbox answer | 8,6–99,8 ms | 15,5 ms → < 8 ms (Seite 6 MB) | 29,5 ms | 0,8 ms (längstes `fetch`-Stück) | JSON-Umweg weg; kalter Rest offen (→ §4r „8-ms-Sammellauf (14.11.)“) |
| B großes Manifest, after file read, until sql | 12,7–18,0 ms | 2. Lesen 14,7 ms → < 8 ms (Manifest ≈ 13 MB) | Listen/Suche ≤ 6,6 ms | ≤ 2,9 ms | behoben für jedes weitere Lesen |
| C Suche after sql, until pause | 9,8–23,7 ms | – (kein Kern-Code nachstellbar, s. u.) | 22,7 ms (`episode-list`, kaa search) | weg (≤ 0,9 ms) | offen, nur kalt (→ §4r „8-ms-Sammellauf (14.11.)“) |
| D `episode-source` after start, until file names | 54,2 ms (Wiedergabe) | 51 → 1 ms (Aufrufer 50 ms nach dem Aufruf) | ≤ 2,1 ms | 0,2 ms | behoben (Wiedergabe nicht erneut gemessen) |
| E RN-`fetch` after network, until network read / after start, until network | 9,5–16 / 15,6 ms | – | nicht unter den längsten | 0,8 ms (davon `network` 0,6) | nicht Kern, s. u. |

Selbsttest: **15 von 15** in 3155 ms, 355 Stücke, längstes **2,5 ms** (vorher 5,4 ms), 0 über 8 ms; `fetch through the app` läuft über die neue Übergabe. `streams=check` Dr. STONE: `aq-anikoto` 49 Treffer, kaa 9; `episode-list`/`episode-source` vom Kern (kalt 379–1479 ms, warm 8–16 ms). Endstand: alle Bereiche aus (`areas answered by the core: none`).

**Ursachen und Fixes:**

- **A:** Die Seite ging als Teil von `JSON.stringify(answer)` über `answerHost`; das Verpacken wächst mit der Seite (Escapes für jedes Anführungszeichen und jede Zeile). Jetzt geht der Body als eigener Parameter: Nitro-Spec `answerHost(call, ok, value, body)` (`modules/core-sandbox/src/CoreSandbox.nitro.ts`, nitrogen neu erzeugt), `SandboxCore.cpp` gibt bei Body `[value, body]` in den Sandkasten, der Vorspann (`sandbox.ts`, `host.ask`) setzt ihn als `body` ein; `AnswerWithBody` in `helpers.ts` für `fetch`, `node-engine.ts` gleich. Leere Seite kommt ohne Body (`fetch.js`: `answer.body ?? ""`). Test `helpers/fetch-answer.test.ts`. Kalt bleiben am S22 29,5 ms im selben Abschnitt, warm 0,8 ms: im Abschnitt läuft jetzt nur noch das Umkopieren des Body durch Nitro; ob die kalten 29,5 ms fremde Arbeit sind (wie 3f-2 (1)) oder das erste Umkopieren einer großen Seite, trennt erst ein Messpunkt vor `answerHost` (offen).
- **B:** Jede Liste und Suche liest den Ordner neu und parst jedes Manifest mit ganzem Code (`JSON.parse`, nicht teilbar). Jetzt merkt `installed.ts` (`manifestOf`) das geprüfte Manifest je Ordner und Datei mit dem Text; gleicher Text = kein neues Parsen, weg gefallene Dateien werden vergessen. Test „checks a large manifest once while its file stays the same“ (`manage.test.ts`). Das erste Lesen nach dem App-Start bleibt ein Schritt.
- **C:** Zwischen dem `sql` (Zuordnung bzw. Einstellungen der Erweiterung) und der Pause vor `search` läuft im Kern nur Mikrosekunden-Code (Suchwörter, Optionen); die Auswahl der Treffer (`choose.ts`) liegt erst nach dem Suchen. Neuer Messpunkt `provider config` (`onlinestream.ts`, nach den Einstellungen). Nur kalt (22,7 ms), warm ≤ 0,9 ms: dasselbe Muster wie 3f-2 (1). Nicht behoben; offen, bis ein Messpunkt die Zeit einem Stück Kern-Code zuordnet.
- **D (Kern, behoben):** Ein Hook fragt aus der Arbeit der Oberfläche heraus (Seite des Players baut sich auf). `coreRequestFor` öffnete das Stück sofort; nach dem ersten `await` lief die Arbeit des Aufrufers im selben Durchgang weiter und zählte bis zum ersten Warten (`file names`) als Kern. Fix: `afterCallersTurn()` (`blocking.ts`) vor `watch.enter` in `core-switch.ts`: der Kern beginnt in einem Promise-Job nach dem Durchgang des Aufrufers. Test „starts a request after its caller's turn“ (`blocking.test.ts`: ohne 51 ms, mit 1 ms). Betrifft jedes „after start“-Stück einer Anfrage (auch E „after start, until network“ beim Installieren).
- **E (nicht Kern):** Im Abschnitt „after network, until network read“ läuft vom Kern nur das Kopieren der Kopfzeilen; der Rest ist `fetch`/`Response.text()` von React Native vor dem Warten. Neue Messpunkte `react native fetch()` und `react native text()` (`core-sandbox.ts`). Am S22 warm 0,8 ms, kalt nicht unter den längsten Stücken; „after start, until network“ (Installieren) ist der Fall D. Installieren am S22 bewusst nicht gemessen (schreibend).

**Offen** (→ §4r „8-ms-Sammellauf (14.11.)“)**:** A kalt 29,5 ms und C kalt 22,7 ms (Messpunkt vor `answerHost` bzw. nach `mappingOf`, nächster Build), erstes Lesen eines großen Manifests, Wiedergabe-Start am S22 mit D nachmessen, Installieren (Tablet/scratch).

## 4n. Manga im Kern (Phase 4a)

Phase 4a-1 (14.11.2026): Die lesenden Manga-Schnittstellen laufen im Kern, hinter dem neuen Bereich `manga` (Standard aus, Link `core?area=manga&on=1`). Die Arbeit macht die Manga-Erweiterung in ihrem eigenen Sandkasten (3a–3e, gleicher `ExtensionLoader` wie Verwaltung und Online-Stream). Code: `native/src/core/manga/` (`manga.ts` Antworten, Ablauf, Cache; `mappings.ts` Zuordnungen), Prüf-Link `native/src/api/client/core-manga-check.ts`. Vertrag: `manga-provider.d.ts` (`search`, `findChapters`, `findChapterPages`, `getSettings`).

### Schnittstellen im Kern (Bereich `manga`)

| Schnittstelle | Adresse | Antwort |
|---|---|---|
| `GetMangaEntry` | `GET /api/v1/manga/entry/{id}` | `{ mediaId, media, listData? }` |
| `GetMangaEntryDetails` | `GET /api/v1/manga/entry/{id}/details` | `{ characters, genres, id, recommendations, relations, siteUrl }` |
| `GetMangaEntryChapters` | `POST /api/v1/manga/chapters` | `{ mediaId, provider, chapters }` |
| `GetMangaEntryPages` | `POST /api/v1/manga/pages` | `{ mediaId, provider, chapterId, pages, pageDimensions: null, isDownloaded: false }` |
| `GetMangaMapping` | `POST /api/v1/manga/get-mapping` | `{ mangaId }` (`null` ohne Zuordnung) |
| `MangaManualSearch` | `POST /api/v1/manga/search` | Treffer `{ provider, id, title, synonyms?, year?, image?, imageHeaders?, searchRating }` |

Form und Felder wie die Aufzeichnungen (`manga.recorded.json`: nur die Form, keine Werte). `AnilistListManga` und die Raw-Sammlungen sind schon im Bereich `anilist` (§4d), nicht gedoppelt.

**Bewusst beim Server (4a-1):**

| Schnittstelle / Fall | Grund |
|---|---|
| `GetMangaCollection` | eigene Gliederung des Servers; die Reihenfolge der Einträge in einer Liste weicht von AniList ab und ist aus der Aufzeichnung (3 Einträge) nicht sicher abzulesen |
| `GetMangaLatestChapterNumbersMap` | stammt aus den Kapitel-Listen, die der Server über Neustarts gespeichert hat (auch Titel, die nicht mehr in der Liste sind); der Kern merkt Kapitel nur im Speicher |
| `GetMangaPreferences` | gehört mit `PatchMangaPreference`/`ImportMangaPreferences` zusammen (Datei-Cache `manga-preferences` des Servers) → 4a-2 |
| `GetMangaSourceRefresh` | Zustand eines Laufs des Servers (Quellen-Auffrischen) → 4a-2 |
| `GetMangaEntryDownloadedChapters`, `MANGA_DOWNLOAD` | Downloads → 4b/4c |
| Quelle `local-manga` | eingebaute Quelle des Servers (Ordner auf dem Gerät): `chapters`, `pages`, `search` mit `provider: "local-manga"` reicht der Kern unverändert an den Server weiter, auch dessen Fehler („no results found for this media“) |
| Seiten eines heruntergeladenen Kapitels | der Kern fragt den Server nach `downloaded-chapters/{id}`; steht das Kapitel dort, beantwortet der Server die Seiten (Dateien liegen bei ihm). Server nicht da: gilt als nicht heruntergeladen |
| Seiten mit `doublePage: true` | `pageDimensions` braucht die Größe jedes Bildes, also jedes Bild einmal laden; bleibt beim Server |

### Ablauf und Abweichungen

`search` → Auswahl (oder Zuordnung) → `findChapters` → `findChapterPages`. Die Auswahl ist die der Online-Streams (`streams/choose.ts`, §4m: Titel-Ähnlichkeit zu Romaji/Englisch/Synonymen, Zahlen-Abzug, Jahr), gesucht mit dem Romaji-Titel und dem Jahr (`QueryOptions.year`), ohne Treffer mit dem englischen. Fehlerarten wie §4m (`failureOf`: Zeit, Speicher, Cloudflare, eigener Fehler der Erweiterung).

- **Kapitel:** `provider` vorn, dann die Vertrags-Felder, leere fallen weg (aufgezeichnet: `provider, id, url, title, chapter, index, updatedAt`); sortiert nach `index`, bei Gleichstand Reihenfolge der Erweiterung.
- **Seiten:** `headers` immer ein Objekt (ohne Kopfzeilen `{}`), sortiert nach `index`; keine Seite = Fehler.
- **`searchRating`:** eigene Regel, Anteil gemeinsamer Buchstabenpaare (klein geschrieben, mit Leerzeichen) zwischen den Suchwörtern und dem Titel oder einem Synonym, der beste. Für die aufgezeichnete Suche ergibt das genau den aufgezeichneten Wert; die Regel des Servers ist sonst nicht bekannt.
- **Manga-Seite (`GetMangaEntry`):** `media` mit den Feldern der Listen (`mangaFields`, gleich wie in der Raw-Sammlung aufgezeichnet), `listData` aus dem Eintrag des Nutzers: Null-Werte und leere Daten fallen weg, Daten als `JJJJ-MM-TTT00:00:00Z` (aufgezeichnete Form), fehlender Monat/Tag als 01. Ohne Eintrag kein `listData` (nicht aufgezeichnet, angenommen). Quelle: Bereich `anilist` an → die Listen des Kerns zuerst (mit seinen noch wartenden Änderungen, §4f); sonst eine kleine AniList-Abfrage `Media + mediaListEntry` mit dem Token; AniList nicht erreichbar → die gemerkten Listen.
- **Details:** eigene AniList-Abfrage `MANGA_DETAILS` mit den aufgezeichneten Feldern, gemerkt in `anilist_media.details` (`kind` MANGA) für den Ausfall. `relations` aufgezeichnet als `{}`: leere Kanten fallen wie überall weg.
- **Fehlertexte** sind eigene (der Wortlaut des Servers ist nur für `local-manga` aufgezeichnet, und der kommt vom Server).

### Seitenbilder

Die Oberfläche lädt die Bilder selbst (`main/manga/_lib/handle-manga-utils.ts`, `getChapterPageUrl`): Hat eine Seite Kopfzeilen (aufgezeichnet: `Referer` bei jeder Seite), wird die Adresse `…/api/v1/image-proxy?url=…&headers=…` **des Servers**; ohne Kopfzeilen lädt das Bild direkt von der Quelle; heruntergeladene Seiten kommen von `…/manga-downloads/…`, lokale von `…/api/v1/manga/local-page/…` (beides Server). Der Kern liefert nur die Liste mit Adressen und Kopfzeilen. **Ohne Server gehen Seiten mit Kopfzeilen heute also nicht.** Der Weg ohne Proxy wäre, die Kopfzeilen dem Bild direkt mitzugeben (wie mpv beim Online-Stream, §7); das ist Arbeit an der Oberfläche und bleibt offen (später, mit dem Leser in Stufe 4). Nichts davon ist vorgetäuscht: mit Bereich `manga` an laufen die Bilder weiter über den Proxy des Servers.

### Zuordnungen und Umzug

Eigene Tabelle `manga_mappings` in `core.db` (Schema-Schritt 9: `provider`, `media_id`, `manga_id`, `origin`, `changed_at`, eindeutig je Anbieter + Manga) und `manga_mapping_move` (eine Zeile = Umzug gelaufen). Beim ersten Bedarf liest der Kern einmal die Tabelle `manga_mappings` der Server-DB (Kopie im Speicher, Weg `ExtensionPlace.serverMangaMappings`, nur lesend), übernimmt gültige Zeilen mit `origin` „server“ und fragt danach nie wieder; gleiche Regeln wie §4m. Setzen/Entfernen (`MangaManualMapping`, `RemoveMangaMapping`) sind als Funktionen da und getestet, aber noch nicht registriert (4a-2).

### Cache

Im Speicher des App-Laufs: Kapitel-Liste je Anbieter + Manga **60 min**, Seiten je Kapitel **10 min**; gleiche gleichzeitige Anfragen teilen einen Lauf; Fehler werden nicht gemerkt. „Cache leeren“ (`EmptyMangaEntryCache`) ist noch beim Server und leert den Kern-Cache nicht (4a-2); bis dahin erscheinen neue Kapitel mit Bereich `manga` an spätestens nach 60 min oder nach einem Neustart der App.

### Testweg

`native/src/core/manga/manga.test.ts` (Node, ohne Netz, 12 Tests): eigene Beispiel-Erweiterung nach `manga-provider.d.ts` im echten Sandkasten (TypeScript); jede der sechs Routen gegen die Form der Aufzeichnung; Grenze zum Server (nicht registrierte Schnittstellen, `local-manga`, heruntergeladenes Kapitel, Doppelseite, Server nicht da); Kapitel-Reihenfolge, Suche mit Romaji + Jahr, Cache und Fehler; Zuordnung mit Umzug (einmal, ungültige Zeilen weg), Setzen/Entfernen; `searchRating`; Manga-Seite mit/ohne Eintrag, `listData` gegen die Form aus Seite und Sammlung, Bereich `anilist` an, AniList weg; Details mit Ausfall. `database.test.ts`: Schritt 9. `app-links.test.ts`: Prüf-Link nur in Test-/scratch-App.

Prüf-Link (nur Test-/scratch-App): `seanime-native://core?manga=check&media=<AniList-Nummer>&provider=<id>[&query=<Wörter>]` liest über dieselbe Tür wie die Hooks Manga-Seite, Details, Zuordnung, Kapitel-Liste, Seiten des ersten Kapitels und optional die Suche; App-Log `[CoreManga]` nur Zahlen (keine Titel, keine Adressen), am Ende die längsten Stücke. Einmal mit `manga` aus (Server), einmal an (Kern). Nichts wird geändert: keine Zuordnung, kein Cache-Leeren, kein Fortschritt, kein Leser.

### Vergleich Kern gegen Server (S22, Test-App, Nutzer 0, Build von `672f7a1`, 14.11.2026 01:33–01:37, nur lesend)

Ein Manga aus der Liste (Status „geplant“), Erweiterung `mangadex`, Suchwort aus drei Buchstaben. Erst `manga` aus, dann `area=manga&on=1`, Prüf-Link, danach `on=0` (Log „areas answered by the core: none“). Kein Leser geöffnet, nichts markiert.

| | Server | Kern |
|---|---|---|
| Manga-Seite | `media` ja, `listData` createdAt/status/updatedAt (6 ms) | gleich (224 ms, AniList-Abfrage) |
| Details | 1 Figur, 4 Empfehlungen (241 ms) | gleich (188 ms) |
| Zuordnung | keine (4 ms) | keine (12 ms, Umzug der Server-Zuordnungen) |
| Kapitel | 81, `index` 0..80 (5 ms, Cache des Servers) | **81, 0..80** (1697 ms, erster Sandkasten + Suche + `findChapters`) |
| Seiten Kapitel 1 | 69, `index` 0..68, Kopfzeile `Referer` bei allen 69 → alle über den Bild-Proxy (8 ms, Cache des Servers) | **Fehler** „mangadex: findChapterPages failed: SyntaxError: unexpected token: '<'“ (119 ms) |
| Suche | 25 Treffer (528 ms) | 25 Treffer (122 ms) |

**Seiten bei `mangadex` (offen):** Die Erweiterung fragt `…/at-home/server/<Kapitel>` mit einem festen alten Chrome-User-Agent. Am Gerät bekommt der `fetch` des Kerns darauf eine Antwort mit Erfolgs-Status, aber HTML statt JSON (keine Cloudflare-Kopfzeilen, §4k greift nicht). Gegenprobe (PC, Node, nicht im Repo): mit diesem User-Agent 403 „Bot challenge not passed“, ohne User-Agent 200 JSON; der Server (eigener HTTP-Client) bekommt frisch 200 JSON (Kapitel 2 und 3: 65 / 70 Seiten, 454 / 370 ms, per `adb forward`, nur gelesen). Die Bot-Abwehr der Quelle unterscheidet also die Clients, nicht der Kern die Antwort. Kapitel-Liste und Suche derselben Quelle sind gleich. Offen für 4a-2: herausfinden, woran die Abwehr den App-`fetch` erkennt (Kopfzeilen von OkHttp, TLS), ohne die Erweiterung zu ändern.

**Faden der Oberfläche:** längste Kern-Stücke 4,9 ms (`chapters`, Sandkasten-Skript merken), 4,3 ms (`search`), 2,2 ms (Manga-Seite); kein Stück über 8 ms.

Tablet (scratch, Reader-Test) in 4a-1 nicht gemacht (kein eigener scratch-Build). APK 111 949 611 → 111 990 631 Bytes.

### Phase 4a-2 (14.11.2026): Manga ohne Downloads

Neu im Bereich `manga` (Form gegen die Aufzeichnungen, `manga.test.ts`):

| Schnittstelle | Adresse | Antwort / Regel |
|---|---|---|
| `MangaManualMapping` | `POST /api/v1/manga/manual-mapping` | `true`; schreibt `manga_mappings` (`origin` „core“), vergisst Kapitel/Seiten des Manga |
| `RemoveMangaMapping` | `POST /api/v1/manga/remove-mapping` | `true`; ebenso |
| `EmptyMangaEntryCache` | `DELETE /api/v1/manga/entry/cache` | `true`; leert den Kern-Cache des Manga und sagt es dem Server (höchstens 5 s, Fehler egal: `local-manga`/Downloads liegen dort) |
| `GetMangaPreferences` | `GET /api/v1/manga/preferences` | `{ entries: { <id>: { provider, filters } } }`, nach Nummer sortiert |
| `PatchMangaPreference` | `PATCH /api/v1/manga/preferences/{mediaId}` | gegebene Felder über die gemerkten, Antwort `{ provider, filters }`; ohne Quelle Fehler 400 |
| `ImportMangaPreferences` | `POST /api/v1/manga/preferences/import` | nimmt nur Manga, für die der Kern noch nichts hat (die gemerkte Wahl gewinnt), Antwort alle |
| `GetMangaCollection` | `GET /api/v1/manga/collection` | eigene Regel, unten |
| `GetMangaLatestChapterNumbersMap` | `GET /api/v1/manga/latest-chapter-numbers` | eigener Speicher, unten |

**Speicher (Schema-Schritt 10):** `manga_preferences` (eine Zeile je Manga), `manga_chapter_numbers` (höchste Kapitelnummer je Manga + Quelle), `manga_moves` (was einmal vom Server genommen wurde: `preferences`, `chapter-numbers`, `refresh:<Auftrag>`). Umzug wie §4m, nur lesend, aber über die Lese-Antwort des Servers (`GET /manga/preferences`, `GET /manga/latest-chapter-numbers`), weil die Vorlieben im Datei-Cache des Servers liegen; ist der Server nicht da, fragt der Kern beim nächsten Mal wieder, eine schon gesetzte Wahl des Kerns gewinnt.

**Sammlung (eigene Regel):** die AniList-Listen des Kerns (`rawCollection` MANGA, wie §4d, mit wartenden Änderungen §4f), je Status eine Liste (`type` = `status`), eigene Listen fallen weg, leere Listen auch; Listen und Einträge in AniList-Reihenfolge; Eintrag `{ media, mediaId, listData }` mit `listData` wie die Manga-Seite. Die Reihenfolge des Servers in einer Liste weicht in der Aufzeichnung ab (3 Einträge) und ist nicht ablesbar; die Oberfläche sortiert jede Liste selbst (`handle-manga-collection.ts`, Standard nach Titel) und ordnet die Listen selbst (CURRENT, PAUSED, PLANNING), darum sieht sie gleich aus.

**Neueste Kapitelnummern:** jede frische Kapitel-Liste einer Quelle schreibt die höchste Nummer (erste Zahl in `chapter`, ohne Nachkommastellen, wie `getChapterNumberFromChapter` der Oberfläche; keine = 0). Antwort je Manga ein Eintrag je Quelle, `scanlator`/`language` leer (aufgezeichnet: leer, teils doppelt; der Kern doppelt nicht).

**Quellen-Auffrischen bleibt beim Server:** Der Auftrag fragt jede Quelle für die ganze Sammlung (bewusst nicht aufgezeichnet), läuft Minuten und meldet sich über WebSocket-Ereignisse des Servers. Er arbeitet auf den Vorlieben und Zuordnungen des Servers. Damit das Ergebnis nicht verloren geht: Liest der Kern die Vorlieben und der Server meldet einen beendeten Auftrag mit `changes`, übernimmt der Kern für genau diese Manga die Wahl des Servers (einmal je Auftrag, `origin` „server“). Abweichung: Wahlen, die nur der Kern kennt, sieht der Auftrag nicht.

**mangadex-Seiten (offen, Befund):** Node am PC mit genau gesetzten Kopfzeilen (`node:https`, nicht im Repo), Anfrage `at-home/server/<Kapitel>`:

| Kopfzeilen | Antwort |
|---|---|
| keine | 400 „You must set an appropriate User-Agent header“ |
| User-Agent der Erweiterung (alter Desktop-Chrome) | 302 auf eine Seite `/edge/challenge` eines anderen Hosts („Redirecting to bot challenge page“) |
| derselbe + OkHttp-Kopfzeilen (`Accept-Encoding: gzip`, `Connection: Keep-Alive`) / + `Accept: application/json` / + Browser-Kopfzeilen | 302 Bot-Prüfung |
| aktueller Android-Chrome-User-Agent | 302 Bot-Prüfung |
| `okhttp/4.12.0` oder ein eigener App-Name | 200 JSON |

Der Unterschied ist allein der Browser-User-Agent, den die Erweiterung setzt: Wer sich als Browser ausgibt, muss die Browser-Prüfung bestehen. Der `fetch` der App folgt der Weiterleitung und liest die HTML-Seite (daher „unexpected token '<'“). OkHttp-Kopfzeilen und TLS spielen keine Rolle. Das ist eine echte Bot-Prüfung; der Kern löst sie nicht und tauscht den User-Agent der Erweiterung nicht aus. Ehrlicher Weg (nicht im Kern): die Erweiterung schickt einen eigenen Client-Namen statt eines Browsers. Bleibt offen.

**Bilder ohne Proxy:** Ist der Bereich `manga` an, gibt `useMangaReaderUtils` für Seiten mit Kopfzeilen die Adresse der Quelle zurück und `getChapterPageHeaders` die Kopfzeilen; `ChapterPage` gibt sie expo-image als `source: { uri, headers }`, Vorladen im Blätter-Leser mit `Image.prefetch(url, { headers })`. Bereich aus, heruntergeladene und lokale Seiten: wie vorher (Proxy/Server). Aussehen unverändert. Die Bilder in der manuellen Suche (`imageHeaders`) laufen weiter über den Proxy. Am Gerät nicht belegt: die einzige Manga-Quelle der scratch-App ist `mangadex`, deren Seiten im Kern an der Bot-Prüfung scheitern (oben); einen Reader mit Kern-Seiten gab es daher nicht.

**Prüf-Link schreibend** (nur Test-/scratch-App): `core?manga=write&media=<id>&provider=<id>`: Zuordnung setzen → lesen → löschen → lesen (eine frühere wird wieder gesetzt), Cache leeren, Filter ändern → lesen → zurück → lesen, dann Sammlung und Kapitelnummern; nur Zahlen im Log `[CoreManga]`. Einen Eintrag ganz entfernen kann keine Schnittstelle: hatte der Manga keine Vorliebe, bleibt eine mit der angegebenen Quelle.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Test-Konto, Build von `ca231cf`, 14.11.2026 01:59–02:01):** `mangadex` per Link installiert, Bereich `manga` an. Schreib-Link zweimal: Zuordnung gesetzt `true` (31 ms) → gelesen → gelöscht `true` (20/23 ms) → keine; Cache leeren `true` (36/37 ms); Vorlieben 2 bzw. 3 Einträge, Filter geändert und zurück, beides gelesen (33–79 ms); Sammlung leer (Test-Konto ohne Manga, 310/393 ms); Kapitelnummern 1 Manga. Lese-Link: Kapitel-Liste der gewählten Quelle 0 Kapitel (2272 ms, kalt). Danach `on=0`, Log „areas answered by the core: none“.

**Faden der Oberfläche:** neue Stücke höchstens 8,5 ms (`GET preferences`, „after server, until sql“: nach der Server-Antwort, enthält vermutlich deren Lesen), 8,3 ms (`PATCH`), sonst ≤ 7,6 ms. Über 8 ms nur alte 4a-1-Stücke beim ersten Aufruf nach der Installation: Suche im Sandkasten 82,6 ms („mangadex search“, kalt), Details 30,7 ms und 16,2 ms Manga-Seite (kalt, vor dem ersten Lauf), Kapitel 14,5 ms (Sandkasten anlegen). Nicht nachgestellt (Budget), offen für 4a-3 (→ §4r „8-ms-Sammellauf (14.11.)“).

APK scratch 125 262 150 Bytes.

### Gerätetest MangaFire (14.11.)

Pixel Tablet, scratch, Nutzer 10, Test-Konto (Wächter `anilist-guard` ok, am Ende `anilist-clear`: 0 Einträge), vorhandener Build (installiert 14.11. 09:59), kein Code geändert. Erweiterung `dipland-mangafire` 1.1.1 (TypeScript, mehrsprachig) per `core?extensions=install` installiert: „Successfully installed MangaFire“ (1240 ms, vom Kern). Manga Dr. STONE (AniList 98416), Bereiche `extensions` + `manga`.

| Prüf-Link `core?manga=check` | Kern | Server |
|---|---|---|
| Manga-Seite | ja, ohne `listData` (343 ms) | ja (219 ms) |
| Details | 25 Figuren, 8 Empfehlungen | gleich |
| Kapitel | **1202** (3,3 s) | **1202** (2,4 s) |
| Seiten des ersten Kapitels | **53**, Kopfzeilen `Referer`/`User-Agent` (548 ms) | **53**, gleiche Kopfzeilen |

Abweichung Reihenfolge: MangaFire zählt `index` je Sprache neu ab 0 (16 Sprachen hintereinander). Der Kern sortiert alle nach `index` (§4n „Kapitel“) und mischt so die Sprachen (letzter `index` 718), der Server behält die Reihenfolge der Erweiterung (letzter `index` 233). Erstes Kapitel bei beiden gleich. Die Oberfläche sortiert die Kapitel selbst nach Nummer und zeigt Sprache/Übersetzer, Liste am Gerät richtig („Chapters 1202“, Kapitel 0 Englisch zuerst) → kein Fix, Regel „nach `index`“ gibt nur bei Quellen mit einer Sprache dieselbe Reihenfolge wie der Server. ✅ **Erledigt im Reste-Lauf (14.11., §4r):** der Kern behält die Reihenfolge der Erweiterung; Prüf-Link am Tablet Kern und Server je 1202 Kapitel, `index 0..233`.

Am Gerät: Quelle in der Oberfläche auf MangaFire, Kapitel 0 (Englisch) im Leser: **Seite 1/53 sichtbar** (Screenshot angesehen), `POST /api/v1/manga/pages answered by the core`, **0 Zeilen `image-proxy`** im Server-Log (`SeanimeBackend`) → Bilder direkt mit Kopfzeilen von der Quelle; kein ChromeDP/Cloudflare nötig. Download `core?manga=download&count=1`: Lader `done` 48 960 211 Bytes in 15,9 s, 53 Seiten `file://`, `isDownloaded true`; Reiter „Downloaded · 1“, Kapitel aus Datei gelesen (1/53 sichtbar, 0 Zeilen `manga-downloads`/`image-proxy`); `core?manga=remove`: 1 Kapitel gelöscht, 0 Ordner übrig. Faden: längste Stücke 57,8 ms (`findChapters`) und 56,3 ms (`search`) im Sandkasten, 19,8 ms beim Installieren → über 8 ms, offen wie 4a-3.

## 4o. Download-Dienst (Phase 4b)

Heute lädt der Server Offline-Folgen (MP4 mit Range, HLS mit AES-128) und Manga-Kapitel, am Leben gehalten vom Dauer-Dienst `specialUse` des Server-Moduls. Der eigene Download-Dienst teilt die Arbeit: **Die Logik** (Warteschlange, HLS auswerten, Teile zusammenfügen, Wiederholen) kommt in den TypeScript-Kern (Phase 4b-B/C). **Nativ** bleibt nur, was Android und iOS grundverschieden lösen: eine einzelne Datei laden, während die App nicht vorn ist (Plan §19: Kotlin bzw. Swift nur als dünne Schicht). Das Server-Modul und sein Dienst bleiben bis Stufe 8 unverändert.

### Phase 4b-A: nativer Lader

Stand: Modul, Vertrag, Hülle und Prüf-Link gebaut; nichts in der App benutzt den Lader außer dem Prüf-Link. Der Server lädt weiter wie bisher.

#### Aufbau

| Teil | Ort | Inhalt |
|---|---|---|
| Modul | `native/modules/core-download/` | lokales Expo-Modul nur für Android (`expo-module.config.json`, Kotlin), eingebunden wie `modules/seanime-server`: Expos Autolinking findet es im Ordner `modules/` (geprüft: `npx expo-modules-autolinking resolve --platform android` nennt `core-download` mit `CoreDownloadModule`) |
| Regeln | `android/…/LoaderRules.kt` | Antwort der Quelle → Plan (anhängen, neu schreiben, schon fertig, noch einmal ohne Range, abgelehnt) und die Marke für `If-Range`; ohne Android-Klassen |
| Übertragung | `android/…/Loader.kt` | eine Datei auf dem aufrufenden Faden über `HttpURLConnection`: Kopfzeilen, Range, Schreiben, Fortschritt, eigene Wiederholungen, Fehlerklasse; höchstens 3 Übertragungen zugleich |
| Stand | `android/…/LoaderStore.kt` | ein Eintrag je Download-ID in den privaten `SharedPreferences` `core_download` (Auftrag und Stand); überlebt das Ende der App |
| Wege | `android/…/LoaderWays.kt` | `enqueue` / `cancel` / `status` / `forget`, der Job-Dienst `LoaderJobService`, der Worker `LoaderWorker`, die Benachrichtigung |
| JS-Anbindung | `android/…/CoreDownloadModule.kt`, `index.ts` | Expo-Modul `SeanimeCoreDownload`: fünf Funktionen, drei Ereignisse |
| Vertrag | `native/src/core/download/loader.ts` | Typen (`LoaderRequest`, `LoaderEvent`, `LoaderStatus`, `NativeLoader`), Lesen dessen, was das Modul schickt, und zwei Regeln für den Kern: `continuedRequest` (ab wo weiter) und `worthAnotherTry` (lohnt ein neuer Versuch) |
| Hülle | `native/src/api/client/core-download.ts` | `deviceLoader()` bindet das Modul an den Vertrag (lädt es erst beim ersten Aufruf); der Selbsttest |

Einzige neue Gradle-Abhängigkeit: `androidx.work:work-runtime:2.12.0`, nur im Modul. Das ist die Version, die der Build der App ohnehin auflöst (`expo-background-task` verlangt 2.10.5, in der gebauten APK steht `META-INF/androidx.work_work-runtime.version` = 2.12.0). HTTP läuft über `HttpURLConnection` der Plattform, der Hash über `MessageDigest`, der Stand über `org.json`: keine weitere Bibliothek.

#### Android-Wege

| Android | Weg | Einzelheiten |
|---|---|---|
| 14 und neuer (API 34+) | **vom Nutzer gestartete Datenübertragung** (UIDT): ein Job je Download, `JobInfo.Builder.setUserInitiated(true)` | Berechtigung `RUN_USER_INITIATED_JOBS`; Netz-Anforderung `NETWORK_TYPE_ANY` (dafür `ACCESS_NETWORK_STATE`); geschätzte Größe aus `expectedBytes`, sonst unbekannt; `setNotification` sofort in `onStartJob` und bei jedem Fortschritt, dazu `updateTransferredNetworkBytes`; Jobs im eigenen Namensraum `core-download` (`JobScheduler.forNamespace`), damit ihre Nummern nicht mit denen von WorkManager zusammenstoßen. Nimmt das System den Job nicht an (es nimmt ihn nur, solange die App sichtbar ist), lädt der Worker |
| 7 bis 13 (API 24–33) | **WorkManager** mit `setForeground`: `CoroutineWorker`, getragen von WorkManagers `SystemForegroundService` mit Typ `dataSync` | Berechtigungen `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC`, der Dienst-Typ im Manifest des Moduls (`tools:node="merge"`); Netz-Bedingung `CONNECTED`; eindeutige Arbeit je ID. Verweigert Android 12+ den Vordergrund-Dienst (App nicht vorn), läuft die Arbeit ohne ihn weiter |

Beide Wege rufen dieselbe Übertragung (`Loader.work`). **Stoppt das System** einen Lauf (Netz weg, eigene Grenzen), bekommt es ihn zurück (`onStopJob` → `true`, Worker → `retry`) und startet ihn später neu; der Lauf macht dann von selbst bei den Bytes auf der Platte weiter. **Stoppt der Nutzer** ihn in der Aufgaben-Liste des Systems, endet er mit dem Ereignis `failed` / `CANCELLED`.

**Benachrichtigung:** eigener leiser Kanal `core-downloads` („Downloads“, englisch wie die App), Titel aus `title`, Balken und Prozent, kleines Symbol der App; verschwindet mit dem Ende des Laufs. Am Aussehen der App ändert sich nichts.

#### Schnittstelle (JS/TS)

`deviceLoader()` gibt den `NativeLoader` des Vertrags:

| Aufruf | Bedeutung |
|---|---|
| `enqueue({ id, url, headers?, path, resumeFrom?, ifRange?, expectedBytes?, title })` | `path`: Pfad oder `file://`-Adresse **im Speicher der App** (Daten-Ordner, eigene Ordner auf dem gemeinsamen Speicher), sonst Ablehnung; nur `http`/`https`. Ein laufender Download derselben ID endet vorher. `resumeFrom` > 0: die Datei wird auf diese Länge gekürzt und der Rest verlangt; ist sie kürzer oder fehlt sie: von vorn |
| `cancel(id)` | bricht ab und kehrt zurück, wenn der Lauf die Datei losgelassen hat; **die Teil-Datei bleibt liegen**; kein Ereignis |
| `status(id)` | `{ id, state, bytes, total, validator, failure }` oder `null`. `state`: `queued`, `running`, `done`, `failed`, `cancelled`, `interrupted`. `bytes` ist, was auf der Platte liegt |
| `forget(id)` | bricht nötigenfalls ab und löscht den Eintrag des Laders; die Datei bleibt |
| `listen(fn)` | Ereignisse `progress { id, bytes, total }` (höchstens alle 0,5 s; `total` `null`, wenn die Quelle keine Länge nennt), `done { id, bytes, resumedFrom }`, `failed { id, kind, httpStatus, message }` |

Dazu am Gerät `sha256(path)` (Hash einer Datei im App-Speicher, im Kotlin-Teil gerechnet) für die Prüfung fertiger Dateien.

**Nach einem Ende der App:** Der Eintrag bleibt. `status(id)` meldet für einen Download, der unterwegs war und den weder dieser Prozess noch das System mehr hält, `interrupted` mit den Bytes auf der Platte und der Marke der Quelle; der Kern (4b-B) baut daraus mit `continuedRequest` den Auftrag zum Fortsetzen. Hält das System den Job noch, heißt der Stand `queued`.

**Gleichzeitig:** höchstens 3 Übertragungen, der Rest wartet im Lader (Stand `queued`, Benachrichtigung ohne Prozent).

#### Fehlerklassen

| `kind` | Wann | Neuer Versuch (`worthAnotherTry`) |
|---|---|---|
| `CONNECTION` | keine Antwort, Verbindung bricht, Quelle endet vor dem Ende der Datei, und die eigenen Wiederholungen des Laders halfen nicht | ja |
| `STORAGE_FULL` | freier Platz kleiner als der Rest der Datei (vor dem Schreiben geprüft) oder Schreibfehler `ENOSPC` | nein |
| `SOURCE_REFUSED` | die Quelle antwortet mit einem Status, der nicht die Datei ist; `httpStatus` nennt ihn | nur 408, 425, 429 und 5xx |
| `CANCELLED` | der Nutzer hat den Download außerhalb der App gestoppt (Aufgaben-Liste des Systems). `cancel()` der App schickt kein Ereignis | nein |
| `UNKNOWN` | alles andere (z. B. Schreibfehler ohne vollen Speicher) | nein |

**Eigene Wiederholungen des Laders:** Bricht die Verbindung, versucht er es bis zu dreimal hintereinander ohne Fortschritt erneut (Pause 2, 4, 6 s), jeweils ab den Bytes auf der Platte; ein Versuch, der Bytes brachte, zählt nicht. Erst danach `CONNECTION`.

#### Fortsetzen

Der Lader verlangt den Rest immer ab der Länge der Datei auf der Platte (`Range: bytes=<Länge>-`) und schickt die Marke der Quelle als `If-Range` mit (starkes `ETag`, sonst `Last-Modified`; RFC 9110 §13.1.5), damit eine inzwischen geänderte Datei nicht an den alten Teil geklebt wird. `Accept-Encoding: identity` ist fest gesetzt: sonst verlangt die Plattform gzip und packt aus, Byte-Zahlen und Range passten nicht mehr zur Datei.

| Antwort der Quelle | Lader |
|---|---|
| 206 mit `Content-Range` ab der verlangten Stelle | hängt an; `resumedFrom` im Ereignis `done` nennt die behaltenen Bytes |
| 200 (keine Range-Unterstützung, oder Datei geändert) | **von vorn**: Datei neu geschrieben, `resumedFrom` 0 |
| 206 ab einer anderen Stelle | Teil verwerfen, noch einmal ohne Range (höchstens zweimal, dann `SOURCE_REFUSED`) |
| 416 mit `Content-Range: bytes */<Länge>` gleich der Datei auf der Platte | schon vollständig: `done` |
| 416 sonst | Teil verwerfen, noch einmal ohne Range |
| anderer Status | `SOURCE_REFUSED` |

#### Prüf-Link

Nur Test-/scratch-App: `core?download=selftest&url=<Adresse>[&referer=<Adresse>][&sha256=<hex>][&size=<Bytes>][&stop=<Prozent>][&way=work]`. Lädt eine Datei in den Cache-Ordner der App, bricht einmal ab (Vorgabe nach 25 %, `stop=0`: nie), liest den Stand, setzt mit dem Auftrag aus `continuedRequest` fort, vergleicht Größe und SHA-256 mit den Angaben des Links und löscht Datei und Eintrag. `way=work` erzwingt den WorkManager-Weg auch auf Android 14+. Nur Zahlen im Log `[CoreDownload]`, keine Adresse.

**Prüfquelle** (nicht im Repo): ein kleines Node-Skript am PC, per `adb reverse` am Gerät erreichbar: 41 943 040 Bytes Zufallsdaten, nur mit einem bestimmten `Referer` (sonst 403), mit Range, `ETag` und `If-Range`, absichtlich gedrosselt (Rate über die Adresse wählbar), auf Wunsch ohne Range (`norange=1`); es schreibt je Anfrage Range, Status und gesendete Bytes mit. Keine fremde Seite.

#### Messwerte (S22, Android 16 / API 36, Test-App, Build von `29095b4`, 14.11.2026 02:29–02:34)

Fünf Läufe per Prüf-Link gegen die Prüfquelle, Datei 41 943 040 Bytes. Zeit = Start des Selbsttests bis zum Ergebnis im Log.

| Lauf | Weg | Ergebnis |
|---|---|---|
| 1: Abbruch bei 25 %, fortsetzen (2 000 KB/s) | UIDT-Job | abgebrochen nach 11 272 192 Bytes (letztes Ereignis), auf der Platte 11 313 152, Stand `cancelled`, Marke der Quelle vorhanden. Fortgesetzt mit `Range: bytes=11313152-` und passendem `If-Range`: Quelle 206, 30 629 888 Bytes gesendet. `done` 41 943 040 Bytes, davon 11 313 152 behalten („continued“), **Größe gleich, SHA-256 gleich**, 22 984 ms, Datei danach gelöscht |
| 2: ohne Abbruch, App im Hintergrund (500 KB/s) | UIDT-Job | Start 02:30:47, Home-Taste 02:30:50, danach der Launcher vorn (02:31:02 und 02:31:53 geprüft). Benachrichtigung im Kanal `core-downloads`, Titel „Download self test“, 17 % → 73 %, vom System als `USER_INITIATED_JOB` gekennzeichnet. `done` 02:32:16,9 = **86 s nach der Home-Taste**, 41 943 040 Bytes, **Größe gleich, SHA-256 gleich**, 90 125 ms |
| 3: wie Lauf 1, `way=work` | WorkManager (erzwungen) | `SystemForegroundService` mit `isForeground=true`, Typ `0x1` (`dataSync`), Benachrichtigung des Laders. Abbruch bei 11 436 032 Bytes auf der Platte, Quelle 206 ab dort, `done` mit 11 436 032 behaltenen Bytes, **Größe gleich, SHA-256 gleich**, 22 702 ms. WorkManager meldet die erste Arbeit als abgebrochen, die zweite als `SUCCESS` |
| 4: Quelle ohne Range (4 000 KB/s) | UIDT-Job | Abbruch bei 12 345 344 Bytes auf der Platte; die Quelle beantwortet `Range` mit 200 → **von vorn**: `done` 41 943 040 Bytes, behalten 0 („started-over“), Größe gleich, SHA-256 gleich, 14 855 ms |
| 5: falscher `Referer` | UIDT-Job | Quelle 403 → `failed` mit `SOURCE_REFUSED` und `httpStatus` 403 nach 168 ms, keine Datei |

Bei jeder Anfrage des Laders kam `Accept-Encoding: identity` an (Mitschrift der Prüfquelle). Nach den Läufen keine Benachrichtigung des Laders mehr, die App wieder vorn. In der installierten App gewährt: `RUN_USER_INITIATED_JOBS`, `FOREGROUND_SERVICE_DATA_SYNC`. Die App lief dabei mit dem Server wie bisher; an AniList wurde nichts geändert.

**APK (Test-App):** 112 053 531 Bytes, vorher 111 990 631 (+62 900). Ein Build, erster Versuch.

**Am Gerät unbelegt** (nur Durchsicht des Kotlin-Codes):

- **WorkManager-Weg auf Android 7–13 (API 24–33):** kein solches Gerät. Derselbe Code lief am S22 (API 36) über `way=work`; das belegt Worker, Vordergrund-Dienst mit Typ und Fortsetzen, **nicht** das Verhalten älterer Android-Versionen (API 24/25 ohne Kanal, API < 29 ohne Dienst-Typ, Regeln für Vordergrund-Dienste vor Android 12).
- Stand `interrupted` nach einem Ende der App (ein erzwungenes Beenden war in diesem Lauf nicht erlaubt), Neustart eines Laufs durch das System (Netz weg), Stopp durch den Nutzer in der Aufgaben-Liste (`CANCELLED`).
- `STORAGE_FULL`, `CONNECTION` samt den eigenen Wiederholungen, die Antwort 416, mehr als 3 Downloads zugleich (der Prüf-Link lädt eine Datei).
- Rückfall auf den Worker, wenn das System den Job nicht annimmt (App nicht sichtbar).

#### iOS

Nicht gebaut. In Stufe 9 übernimmt eine dünne Swift-Schicht denselben Vertrag mit einer `URLSession` im Hintergrund (`URLSessionConfiguration.background`, Download-Aufgaben, Fortsetzen über die Fortsetzungs-Daten des Systems); `LoaderRules.kt` ist klein genug, um dort neu geschrieben zu werden. Der Vertrag (`core/download/loader.ts`) kennt nichts von Android.

#### Offen für 4b-B

- Der Lader nimmt einen UIDT-Job nur an, solange die App sichtbar ist. Eine Warteschlange, die im Hintergrund den nächsten Download nachschiebt, fiele auf den Worker zurück. 4b-B gibt deshalb alle Dateien einer Folge beim Start zusammen ab (der Lader lässt 3 zugleich laufen) oder nimmt den Rückfall hin; für HLS mit vielen kleinen Teilen ist ein Job je Teil-Datei zu prüfen (Benachrichtigung je Job), gegebenenfalls ein Sammel-Auftrag im Lader.
- Warteschlange, Wiederholen nach `worthAnotherTry`, Fortsetzen nach `interrupted` beim Start der App, WLAN-Regel („nur im WLAN“ → Netz-Anforderung des Jobs), HLS/AES-128, Zusammenfügen, Manga-Kapitel: alles im Kern.
- Die bisherige Benachrichtigung der App für Folgen-Downloads (`episode-downloads`) und die des Laders müssen dann zu einer werden.

#### Testweg

`npx vitest run src/core/download src/lib/app-links.test.ts` (Ereignis-Form, Stand, Fortsetzen, Fehler-Einordnung, Link). Die Kotlin-Regeln (`LoaderRules.kt`) haben keinen Gradle-Test (JUnit wäre eine weitere Abhängigkeit); sie sind am Gerät über den Prüf-Link belegt, soweit oben genannt.

### Phase 4b-B: Offline-Folgen im Kern (Bereich `offline`)

Stand: Der neue Bereich `offline` beantwortet die Offline-Schnittstellen für Anime-Folgen selbst, in der Form des Servers (Snapshot, Item, Ereignis `mobile-offline-updated` mit dem ganzen Snapshot). Schalter wie alle Bereiche, Standard aus; ist er aus, lädt der Server wie bisher. Manga-Kapitel (4b-C) und die Übernahme der alten Server-Downloads (4c) gehören nicht dazu: Mit Bereich an zeigt die App nur die Folgen des Kerns, die des Servers bleiben unberührt liegen.

#### Aufbau

| Teil | Ort | Inhalt |
|---|---|---|
| Warteschlange und Antworten | `native/src/core/offline/offline.ts` | Zustände, Reihenfolge, Wiederholen, WLAN-Regel, Neustart, die sieben Antworten, das Ereignis |
| HLS lesen | `native/src/core/offline/hls.ts` | Master- und Medien-Listen nach RFC 8216, Wahl von Variante und Tonspur, Teile-Liste; ohne Netz und ohne Dateien |
| Vertrag des Laders | `native/src/core/download/loader.ts` | neu: `LoaderPart`, `LoaderRequest.parts` / `continueParts`, `LoaderProgress.fraction` |
| Tabellen | `core.db`, Schema-Schritt 11 | `offline_items` (eine Zeile je Folge: `item` wie die Oberfläche es bekommt, `source`, `tries`, `retry_at`), `offline_settings` (`wifi_only`) |
| Geräte-Seite | `native/src/api/client/core-offline.ts` | Lader des Moduls, Ordner, Netz-Zustand direkt aus NetInfo (`fetch` + `addEventListener`), Prüf-Link |
| Lader: Sammel-Auftrag | `native/modules/core-download/…/LoaderParts.kt` | mehrere Teile in einem Lauf: laden, AES-128 lösen, an die Datei hängen |

#### Schnittstellen

| Im Kern (Bereich `offline`) | Inhalt |
|---|---|
| `GET /api/v1/mobile-offline/snapshot` | `{ items, wifiOnly, network: { known, connected, metered }, waiting: "" \| "wifi" \| "internet" }`; der erste Aufruf nach dem App-Start startet den Dienst (siehe Neustart) |
| `POST …/batch` | reiht die gewählten Folgen ein, gibt die Zahl der neuen zurück. Die Quelle wird erst gefragt, wenn die Folge an der Reihe ist: über die Erweiterung wie in §4m (`episodeSource`), Quelle des gewünschten Servers (fehlt er: alle), in der genannten Qualität, sonst „auto“, sonst die erste |
| `POST …/download` | die Folge, die der Player offen hat, von dessen Adresse (Kopfzeilen und Untertitel aus der Anfrage); Antwort: das Item |
| `POST …/action` | `pause` (Lader bricht ab, Teil bleibt), `resume`, `retry` (nur `failed`; Zähler von vorn), `remove` (Lader vergisst, Ordner weg, Zeile weg). Unbekannte `id`: 500 `invalid id` |
| `POST …/settings` | `wifiOnly`, in `core.db` |
| `POST …/position` | Stand in Millisekunden, nur in `core.db`, nie an AniList |
| `POST …/network` | die Meldung der Oberfläche wird genommen wie die eigene Messung; nötig ist sie nicht mehr, der Kern hört NetInfo selbst |

Beim Server bleiben: `POST …/mobile-offline/manga` (kein Aufrufer), `GET …/file/{id}/{name}` und `…/artwork/{name}` (nur noch für die Folgen des Servers bei Bereich aus) und alle Manga-Download-Schnittstellen.

**Item:** `id` = `<mediaId>-<Folge>-<sub|dub>` (zugleich der Ordner-Name): eine Folge in einer Tonfassung ist ein Download, gleich wer sie eingereiht hat. Schon vorhandene werden nicht doppelt eingereiht, fehlgeschlagene dürfen neu. `audioLanguage` bleibt leer (die Oberfläche vergleicht dann nach `dubbed`), `metadataSaved` ist `false`: Der Kern speichert noch keine Bilder und keine Beschreibungen des Anime, die Oberfläche nimmt die Online-Adressen (`coverUrl`, `episodeImageUrl`).

#### Warteschlange

- Zustände `queued` → `resolving` (Quelle finden, Listen lesen) → `downloading` → `ready`, daneben `paused` und `failed`. Reihenfolge nach `order`, höchstens **2 Folgen zugleich** (`AT_ONCE`).
- **Fehlerklassen:** Lader `CONNECTION` / `STORAGE_FULL` / `SOURCE_REFUSED` / `UNKNOWN` gleichnamig; `CANCELLED` (Nutzer stoppt in der Aufgaben-Liste des Systems) → `paused`. Beim Finden der Quelle: geschützter oder laufender Stream, keine Quelle, Fehler der Erweiterung → `SOURCE_UNAVAILABLE`; Liste mit Status ≥ 300 → `SOURCE_REFUSED`; keine Antwort → `CONNECTION`.
- **Wiederholen:** was ein späterer Versuch heilen kann (`worthAnotherTry`), wartet 15 s, 60 s, 5 min und fällt danach mit seiner Klasse aus. Eine Ablehnung (401/403/404 …) einer Adresse, die der Anbieter gab, bekommt genau einen neuen Versuch mit frisch gefragter Quelle (`refresh`), weil solche Adressen ablaufen; die Adresse des Players nicht.
- **WLAN-Regel:** ohne Verbindung `waiting: "internet"`, mit „Nur WLAN“ im Mobilnetz oder solange das Netz noch unbekannt ist `waiting: "wifi"`. Was dann lädt, wird abgebrochen (Teil bleibt) und wartet als `queued`; mit passendem Netz geht es von selbst weiter. `waiting` ist nur gesetzt, wenn etwas warten muss.
- **Neustart:** Beim ersten Aufruf nach dem App-Start fragt der Kern den Lader nach jeder Folge, die unterwegs war: `done` → `ready`; vom System noch gehalten (`running`/`queued`) → bleibt `downloading`, die Ereignisse laufen weiter; sonst (`interrupted`, kein Eintrag) → `queued`, Quelle neu, der Auftrag mit `continueParts` setzt hinter dem letzten ganzen Teil fort.

#### Ablage und Wiedergabe

`<App-Daten>/files/core-offline/episodes/<id>/`: `video.ts` (HLS) bzw. `video.mp4` (HLS mit `EXT-X-MAP`, Direkt-Datei nach ihrer Endung auch `mkv`/`webm`), eigene Tonspur `audio.<m4a|aac|mp3|ts>`, Untertitel `subtitle-<n>.<vtt|srt|ass|ssa>`. Die Namen stehen in `files` des Items.

Wiedergabe: `offlineFileUrl` (`mobile_offline.helpers.ts`) gibt bei Bereich an die `file://`-Adresse der Datei, also auch für Tonspur und Untertitel (`offline-playback.ts`, `player-screen.tsx`); mpv liest sie ohne den Server. Die Bildschirme sind unverändert.

#### HLS

- Master-Liste: beste Variante bis zur gewählten Höhe (höchste, die nicht höher ist; bei gleicher Höhe die mit mehr Daten; „Auto“ = 1080; sind alle höher, die niedrigste). Eigene Tonspur der Audio-Gruppe der Variante: Sprache nach `dubbed` (`de…` bzw. `ja…`), sonst die Vorgabe, sonst die erste; ohne Adresse steckt der Ton in der Variante.
- Medien-Liste: `EXT-X-MAP` zuerst, dann jedes Segment in der Reihenfolge der Liste; `EXT-X-BYTERANGE` (auch ohne Anfang: hinter dem letzten Bereich derselben Adresse). Ein Segment zählt nach seinem Platz in der Liste, nie nach der Endung seiner Adresse (getarnte `.jpg`).
- AES-128: Schlüssel-Adresse und IV je Teil; IV aus dem Tag, sonst die Sequenznummer als 128-Bit-Zahl (`EXT-X-MEDIA-SEQUENCE` + Platz). `METHOD` außer `NONE`/`AES-128`, ein `KEYFORMAT` außer `identity`, ein `EXT-X-SESSION-KEY` dieser Art, eine Liste ohne `EXT-X-ENDLIST` oder ohne Segmente → `SOURCE_UNAVAILABLE`.
- Adressen der Listen löst der Kern selbst auf (RFC 3986 §5.2), weil `URL` unter Hermes nicht verlässlich ist.

#### Lader-Entscheidung: Sammel-Auftrag

Android nimmt einen UIDT-Job nur an, solange die App sichtbar ist; ein Job je Segment scheidet aus. Deshalb gibt der Kern **eine Folge als einen Auftrag** ab: `parts` nennt alle Teile aller Dateien der Folge in der Reihenfolge des Zusammenfügens (Untertitel zuerst mit Gewicht 0, dann Bild, dann Ton). Ein Job, eine Benachrichtigung je Folge.

- **Kern (TypeScript):** welche Teile, Reihenfolge, Schlüssel-Adresse, IV, Byte-Bereich, Ziel-Datei, Gewicht.
- **Lader (Kotlin, `LoaderParts.kt`):** lädt jeden Teil, holt den Schlüssel (einmal je Adresse und Lauf, mit den Kopfzeilen der Quelle), löst AES-128 beim Lesen (`javax.crypto`, `AES/CBC/PKCS5Padding`) und hängt an die Ziel-Datei an. Entschlüsseln und Zusammenfügen laufen damit auf dem Faden des Jobs, nie auf dem Faden der Oberfläche.
- **Fortsetzen je Teil:** nach jedem ganzen Teil schreibt der Lader `partsDone`, die Länge der Ziel-Datei und die Summe der Bytes in seinen Eintrag. Ein neu gestarteter Lauf schneidet einen halben Teil ab und macht hinter dem letzten ganzen weiter. Eine ganze Datei (Teil ohne Schlüssel und ohne Bereich, z. B. MP4) setzt innerhalb des Teils per `Range` + `If-Range` fort wie in 4b-A. `continueParts` behält den Stand eines früheren Auftrags derselben ID nur, wenn die Zahl der Teile gleich ist und die Datei die Bytes noch hat; sonst von vorn.
- Die Teile-Liste liegt in einer eigenen Datei (`files/core-download/<Nummer>.parts`, einige hundert Einträge) statt im Eintrag der `SharedPreferences` und wird gelöscht, sobald der Download endet (wie Adresse und Kopfzeilen).
- **Fortschritt:** Ereignis `progress` mit `fraction` (Anteil der Teile nach Gewicht, im laufenden Teil nach Bytes) und den geschriebenen Bytes; `done.bytes` und `status().bytes` sind die Summe über alle Dateien.
- Dazu im Modul `removeFolder(path)` (nur im App-Speicher): Das Löschen einer Folge läuft auf dem Faden des Moduls (Befund unten).

**Benachrichtigung:** Den Fortschritt zeigt die Benachrichtigung des Laders (Kanal `core-downloads`, Titel „<Anime> · Episode <n>“, das System verlangt sie für den Job). „Download fertig“, „Download fehlgeschlagen“ und „Wartet auf WLAN“ kommen unverändert aus `download-notifications.ts`, das den Snapshots folgt, jetzt denen des Kerns. Einen eigenen Fortschritts-Hinweis hatte die App nicht, es gibt also nichts doppelt.

#### Prüf-Link

Nur Test-/scratch-App, Ergebnis im Log `[CoreOffline]` (Zahlen und Dateinamen, keine Adresse):

- `core?offline=check&url=<Adresse>[&type=mp4][&referer=<Adresse>][&subtitle=<Adresse>][&sha256=<hex>][&size=<Bytes>][&keep=1]`: stellt „Nur WLAN“ aus, speichert die Adresse wie der Player (`…/download`), folgt dem Snapshot bis `ready` oder `failed`, vergleicht Größe und SHA-256 der Bild-Datei, nennt Tonspur und Untertitel, entfernt die Folge (`remove`) und prüft, dass der Ordner weg ist.
- `core?offline=check&media=<id>&provider=<id>&episode=<n>[&title=…][&keep=1]`: dasselbe über `…/batch` mit der Quelle der Erweiterung.
- `core?offline=remove&id=<id>` und `core?offline=list`.

**Prüfquelle** (nicht im Repo): ein Node-Skript am PC über `adb reverse`: erzeugte HLS-Folge (Master mit zwei Varianten und Audio-Gruppe; 24 Bild-Segmente `.jpg`, zwei AES-128-Schlüssel, die ersten zwölf mit IV aus der Sequenznummer ab 5, die zweiten zwölf mit IV aus dem Tag; 6 Ton-Segmente; eine Untertitel-Datei) und eine MP4 von 12 000 000 Bytes mit Range; alles nur mit einem bestimmten `Referer` (sonst 403).

#### Messwerte (S22, Android 16, Test-App, Bereiche `offline`, `extensions`, `streams` an, 14.11.2026 03:07–03:14, Build von `8fd9b3a`)

| Lauf | Ergebnis |
|---|---|
| (a) Test-HLS mit AES vom PC | `ready` nach 1 043 ms. `video.ts` 9 385 644 Bytes, **Größe gleich, SHA-256 gleich** der Quelle (Klartext-Segmente aneinander); `audio.aac` 361 515 Bytes (= Quelle), `subtitle-0.vtt` 52; Item 9 747 211 Bytes. 36 Anfragen an die Prüfquelle, alle 200 (Referer überall angekommen): 3 Listen aus dem Kern, 33 vom Lader mit `Accept-Encoding: identity`, jeder Schlüssel einmal. Längstes Stück 1,9 ms. Entfernt, Ordner weg |
| MP4 vom PC | `ready` nach 1 060 ms, `video.mp4` 12 000 000 Bytes, Größe und SHA-256 gleich, Untertitel 52 Bytes; längstes Stück 2,2 ms; entfernt |
| (b) Dr. STONE Folge 1 über `kaa` (`…/batch`) | Quelle gefunden nach 4,1 s, `downloading` 03:08:06. **Home-Taste 03:08:14**, Launcher vorn; Benachrichtigung des Laders mit `USER_INITIATED_JOB`, Job `LoaderJobService` beim System. Lader fertig **03:08:51** (37 s nach der Home-Taste, 45 s gesamt): 702 453 449 Bytes = `video.ts` 663 710 500 + `audio.ts` 38 537 932 + 8 Untertitel. Der Kern nahm `done` im Hintergrund an (`ready` in `core.db`) |
| (c) Abspielen aus der App | Downloads → Dr. STONE → „Watch episode 1“: Bild und englischer Untertitel (Screenshot angesehen), mpv `PLAYING`. Log: 10 Adressen `file:///…/files/core-offline/episodes/105333-1-sub/…` (Bild, Ton, 8 Untertitel), **0 Zeilen mit `/mobile-offline/file`**; `…/position` vom Kern beantwortet. Keine Anfrage an AniList (kein `update-progress`, kein `list-entry`) |

Befunde aus diesen Läufen:

- **Löschen hielt den Faden der Oberfläche 50,6 ms** (`remove` der 702-MB-Folge: `Directory.delete()` von expo-file-system läuft auf dem aufrufenden Faden). Behoben: `removeFolder` im Modul, Nachmessung unten.
- **Ein Stück von 14,8 ms** beim Ereignis `done`, während die App im Hintergrund war (Launcher vorn); dasselbe Stück vorn 1,2–1,3 ms.
- **JS-Zeitgeber laufen im Hintergrund nicht:** Die Abfrage-Schleife des Prüf-Links (`setTimeout`) stand von der Home-Taste bis zur Rückkehr der App (03:12:17) und meldete erst dann `ready`. Ereignisse des Laders kommen dagegen an. Folgen stehen unter „Offen“.
- **Wiedergabe lief 43 s statt höchstens 15 s:** Die Zurück-Taste nach 10 s schloss den Player nicht, sondern verkleinerte ihn zum Mini-Player; geschlossen 03:13:50. An AniList ging nichts.

#### Nachmessung (zweiter Build von `bb5efc9`, S22, 14.11.2026 03:22–03:24, App vorn)

Dr. STONE Folge 1 über `kaa` per Prüf-Link ohne `keep` (laden, prüfen, entfernen):

- Fortschritt im Snapshot in Schritten sichtbar: 10 % nach 13 s, 80 % nach 35 s.
- **Abbruch durch die Quelle und Fortsetzen je Segment:** Bei 80 % beantwortete die Quelle ein Segment mit 429. Lader `SOURCE_REFUSED 429` → Kern `queued`, 15 s Pause, Quelle neu gefragt, Auftrag mit `continueParts` → der Lader behielt **694 794 517 von 702 453 449 Bytes** und lud den Rest; `ready` nach 54,5 s. `video.ts` wieder 663 710 500 Bytes, und der Anfang des SHA-256 ist derselbe wie im ersten Lauf (`773d0d1822357b99`): Die zusammengefügte Datei ist nach Abbruch und Fortsetzen dieselbe wie ohne.
- **Entfernen ohne Warnung des Wächters** (vorher 50,6 ms): Ordner weg, Folge nicht mehr im Snapshot.
- Längstes Stück **14,7 ms**: vom Lesen der Listen bis zur Abgabe des Auftrags an den Lader (`offline: parts`), beim ersten Download nach dem App-Start; im ersten Build war dasselbe Stück 5,5 ms. Nicht behoben (siehe Offen).
- Danach: der Ergebnis-Hinweis der App (`episode-download-105333-1-sub`, aus `download-notifications.ts`, also aus dem Snapshot des Kerns) steht in der Liste des Systems; keine Benachrichtigung des Laders und kein Job des Laders mehr beim System; alle Bereiche aus (`areas answered by the core: none`), Port-Weiterleitung entfernt.

**APK (Test-App):** 112 110 019 Bytes, vorher 112 053 531 (+56 488). Zwei Builds: der erste lief ohne Fehler durch (112 109 575 Bytes), der zweite wegen des Befunds von 50,6 ms.

**Am Gerät unbelegt** (nur unter Node, `offline.test.ts` / `hls.test.ts`):

- Stand `interrupted` nach einem Ende der App (ein erzwungenes Beenden war nicht erlaubt). Das Fortsetzen selbst ist durch den 429-Lauf belegt, der Weg dorthin über `status()` nicht.
- WLAN-Regel (`waiting`, Abbrechen im Mobilnetz), `pause` / `resume` / `retry`, `STORAGE_FULL`, mehr als eine Folge in der Warteschlange, eine zweite Folge, die im Hintergrund startet (Rückfall des Laders auf den Worker).
- HLS mit `EXT-X-MAP`, `EXT-X-BYTERANGE` und SAMPLE-AES; Tonspur-Wahl nach Sprache.
- Die Hinweise „Download fehlgeschlagen“ und „Wartet auf WLAN“; „Download fertig“ kam an, wann genau (vorn oder im Hintergrund) ist nicht gemessen.
- Android 7–13 (wie in 4b-A).
- `LoaderParts.kt` hat keinen eigenen Test. Die Node-Tests führen die Teile-Liste des Kerns mit einem kleinen Zusammenfüger aus (`joinParts` in `hls.test.ts`: Bereich, AES-128, Anhängen), der dasselbe tut wie der Kotlin-Teil; dessen Gleichheit ist am Gerät über Lauf (a) belegt.

**Offen für 4b-C und 4c:**

- **Zeitgeber im Hintergrund.** React Native hält `setTimeout` an, solange die App nicht vorn ist. Daran hängen: die Ereignisse des Kerns (`emitCoreEvent`), also auch der Hinweis „Download fertig“, die Pausen vor einem neuen Versuch und `pause()` des Wächters. Ein laufender Download ist nicht betroffen (er läuft im Job, sein `done` kommt an und steht in `core.db`); die nächste Folge der Warteschlange und ein neuer Versuch können im Hintergrund aber bis zum Öffnen der App warten. Lösung in 4b-C: ein Weg ohne Zeitgeber oder der Hinweis aus dem Lader.
- Das Stück von 14,7 ms (Listen lesen bis Lader-Auftrag) teilen; das Stück von 14,8 ms im Hintergrund beobachten.
- Bilder und Beschreibungen des Anime speichern (`coverAsset`, `bannerAsset`, `episodeImageAsset`, `metadataSaved`), `audioLanguage` füllen.
- Die Quelle des Laufs begrenzt Anfragen (429 nach rund 80 % der Segmente ohne Pause dazwischen): gegebenenfalls zwischen den Teilen bremsen.
- Manga-Kapitel (4b-C); Übernahme von `queue.json` und den Dateien des Servers, gesperrter Bildschirm (4c).
- Für Geräte-Läufe: Die Zurück-Taste verkleinert den Player zum Mini-Player, die Wiedergabe endet erst mit dessen Schließen.

#### Testweg

`npx vitest run src/core/offline src/core/download src/lib/app-links.test.ts` (Warteschlange, Zustände, Fehlerklassen, WLAN-Regel, Neustart, Form von Snapshot, Item und Ereignis gegen die App-Typen, HLS-Auswertung, AES-128 und Zusammenfügen mit erzeugten Daten, Link).

### Phase 4b-C1: Warteschlange im Hintergrund, Bremse, Bilder und Angaben

Stand: Eine Warteschlange von drei Folgen läuft am S22 ganz durch, während die App nicht vorn ist, samt Wartezeit nach einem Fehler und Bremse bei 429. **Nicht erreicht:** Die Zeitgeber von React Native laufen im Hintergrund trotz des neuen Wegs nur rund 5 s weiter; die Hinweise „Download fertig“ erscheinen deshalb weiter erst beim Öffnen der App, und das gespeicherte Cover war auf der Downloads-Seite nicht zu sehen (beides unter „Befunde“ und „Offen“). Manga-Kapitel sind 4b-C2.

#### Was die Kette trägt

| Stück | Weg | Ort |
|---|---|---|
| Nächste Folge | Das Ereignis `done` des Laders weckt den JS-Faden (kein Zeitgeber): `finish` → `pump` → Quelle finden → Auftrag an den Lader. Schon in 4b-B so gebaut, jetzt am Gerät belegt | `offline.ts` |
| Wartezeit vor einem neuen Versuch | zusätzlich zum JS-Zeitgeber **nativ**: `wakeIn(ms)` plant eine verzögerte Arbeit (WorkManager, `setInitialDelay`, eindeutig `core-download:wake`); ihr Lauf schickt das Ereignis `wake`, der Kern ruft `pump`. Die Arbeit bleibt 30 s stehen, damit der Prozess wach ist, bis die Quelle gefunden und der Auftrag abgegeben ist. Kein Versuch offen: `wakeIn(-1)` nimmt sie zurück | `WakeWorker` in `LoaderWays.kt`, `OfflineDevice.wakeIn` / `onWake` |
| Bremse (429, 408, 425, 5xx) | **im Lauf des Laders**, auf dessen Faden (`Thread.sleep` in Schritten, kein Zeitgeber der App): siehe „Bremse“ | `LoaderRules.kt`, `Loader.kt`, `LoaderParts.kt` |
| Zeitgeber der App | Headless-JS-Aufgabe `SeanimeCoreQueue` (React-Native-Doku „Headless JS“: solange eine Aufgabe läuft, hält `JavaTimerManager` die Zeitgeber nicht an). Der Kern verlangt sie, solange Folgen unterwegs sind (`keepAwake(true)`), und gibt sie 5 s nach der letzten wieder frei. Das Modul startet sie ohne eigenen Dienst (`HeadlessJsTaskContext.startTask`). **Am S22 reicht das nicht** (Befund) | `CoreDownloadModule.holdTimers`, `core-offline.ts`, `offline.ts` (`keepAwake`) |

Grenze des nativen Weckens: Hat das System den Prozess inzwischen beendet, gibt es kein JavaScript, dem die Arbeit etwas sagen könnte; die Warteschlange geht dann beim Öffnen der App weiter (Neustart-Regel aus 4b-B).

**Gradle:** Das Modul bekam `compileOnly 'com.facebook.react:react-android'`, damit sein Kotlin die Klassen von React Native sieht (`HeadlessJsTaskContext`, `HeadlessJsTaskConfig`, `UiThreadUtil`, `Arguments`). Das ist React Native selbst, auf dem die App gebaut ist; in die APK kommt dadurch nichts Neues, die Version setzt das Gradle-Plugin von React Native. Keine neue Bibliothek, keine neue npm-Abhängigkeit.

#### Bremse

Zwei Regeln, in TypeScript mit Tests (`retryAfterMs`, `sourcePause` in `core/download/loader.ts`) und gleich in Kotlin (`LoaderRules.kt`):

- `Retry-After` (RFC 9110 §10.2.3) als Sekunden oder HTTP-Datum; unlesbar zählt als nicht genannt.
- Nach einer Ablehnung des Augenblicks (408, 425, 429, 5xx) wartet der Lader `max(Retry-After, eigene Pause)`; eigene Pausen 5 s, 15 s, 45 s, je Ablehnung in Folge die nächste. Ein fertiger Teil (oder Bytes einer ganzen Datei) setzt die Zählung zurück. Danach fragt er **dieselben Bytes** noch einmal: eine ganze Datei per `Range` ab der Länge auf der Platte, ein Segment von vorn; nichts beginnt von vorn.
- Der Lader gibt auf (`SOURCE_REFUSED` mit `retryAfterMs` im Ereignis), wenn drei Ablehnungen in Folge nichts brachten oder die Quelle mehr als 2 min verlangt. Die Warteschlange wartet dann `max(15 s / 60 s / 5 min, Retry-After)`, höchstens 30 min, und setzt mit `continueParts` hinter dem letzten ganzen Teil fort. Dasselbe gilt für eine abgelehnte HLS-Liste, die der Kern selbst liest.
- 401/403/404/410 werden nie abgewartet (Adresse oder Kopfzeilen falsch).

#### Bilder und Angaben

- **Angaben:** Beim Einstellen liest der Kern, was die gemerkten Listen über den Anime wissen (`anilist_media.content`): `description`, `genres`, `year`, `format`, `totalEpisodes`, `duration`, `score`. Ein Anime, den die Listen nicht führen, bringt nichts davon mit; `airDate` bleibt leer.
- **Bilder:** Cover, Banner und Folgenbild hängen als Neben-Teile am Auftrag der Folge (`LoaderPart.extra`, Gewicht 0, zuletzt): ohne die Kopfzeilen der Quelle geladen, nie abgewartet, bei jedem Fehler übergangen; die Folge wird auch ohne sie fertig. Ablage `core-offline/artwork/<id>-cover|banner|episode.<Endung>`, je Folge eigene Dateien (zwei Folgen desselben Anime laden zugleich, und Entfernen nimmt nur die eigenen mit). Bei `ready` fragt der Kern das Gerät, welche Dateien da sind (`OfflineDevice.has`), und setzt `coverAsset`, `bannerAsset`, `episodeImageAsset`; `metadataSaved` ist `true`, wenn jedes genannte Bild gespeichert ist.
- **Adresse:** `offlineArtworkUrl` gibt bei Bereich an die `file://`-Adresse (`offlineArtworkAddress`), sonst wie bisher die des Servers.
- **`audioLanguage`:** `ja` bzw. `de`, wenn die eigene Tonspur des Streams die gewünschte Sprache nennt; sonst leer (die Oberfläche vergleicht dann wie bisher nach `dubbed`).

#### Prüf-Link und Prüfquelle

`core?offline=check…` nimmt zusätzlich `cover`, `banner`, `image` (Adressen), `etitle`, `text`; mehrere Links nacheinander ergeben eine Warteschlange; jede Zustands-Zeile nennt, ob die App vorn war (`app active` / `app background`). Prüfquelle (nicht im Repo, PC über `adb reverse`): Folge 1 eine Datei von 24 000 000 Bytes; Folge 2 ebenso, die Verbindung bricht bei der Hälfte, die nächste Anfrage bekommt einmal 429 mit `Retry-After: 6`; Folge 3 HLS (40 Segmente, eigene Tonspur `ja` mit 6), die Master-Liste antwortet einmal 503 mit `Retry-After: 30`, Segment 21 einmal 429 mit `Retry-After: 4`; drei erzeugte PNG-Bilder ohne Referer-Zwang.

#### Messwerte (S22, Android 16, Test-App, nur Bereich `offline` an, Build von `ca56b0b`, 14.11.2026 04:01–04:11, Uhr des Geräts)

| Zeit | Ereignis |
|---|---|
| 04:02:02–04:02:05 | drei Folgen eingestellt, App vorn: 1 und 2 `downloading`, 3 `queued` |
| 04:02:09 | Home-Taste. Die oberste Activity lag danach in allen 61 Abfragen von 04:02:14 bis 04:07:57 in einer anderen Task als die Test-App; die App wurde bis 04:09:02 nicht geöffnet. Die Zustands-Zeilen 04:02:10–04:02:14 sagen `app background` |
| 04:02:17 | Folge 2: nach dem Abbruch bei 12 000 000 Bytes fragt der Lader `Range: bytes=12000000-`, Quelle 429 → Lader „asking again in 6000 ms“ |
| 04:02:25,0 | Folge 1 fertig (Lader). Im selben Augenblick fragt der Kern die Liste der Folge 3 (Quelle: 503, `Retry-After: 30`): **die nächste Folge beginnt im Hintergrund**, 16 s nach der Home-Taste |
| 04:02:34,8 | Folge 2 fertig: Quelle 206 ab Byte 12 000 000, nichts doppelt geladen |
| 04:02:55,2 | `wake` der verzögerten Arbeit, 30 s nach der Ablehnung; Liste der Folge 3 jetzt 200, Auftrag an den Lader. Keine Zeile „refused the job“: Das System nahm den Job der Folge 3 an, obwohl die App seit 46 s nicht vorn war |
| 04:03:01,8 | Folge 3: Segment 21 von 49 Teilen 429 → „asking again in 5000 ms“ (eigene Pause länger als die verlangten 4 s), dann 200. Segmente 1, 20 und 40 je genau einmal angefragt |
| 04:03:13,4 | Folge 3 fertig, **64 s nach der Home-Taste** |
| 04:09:02 | App per Link geöffnet (Prüfung): alle drei `ready`; Bild-Dateien 24 000 000, 24 000 000 und 12 088 140 Bytes, **Größe gleich, SHA-256 gleich**; `audio.aac` 240 255; je Folge drei Bilder (8 628, 5 285, 2 058 Bytes), `metadataSaved true`. Die neun Bild-Anfragen kamen ohne Referer an, alle Datei-Anfragen mit `Accept-Encoding: identity` |

Befunde:

- **Zeitgeber:** Die Abfrage-Schleifen des Prüf-Links (`setTimeout`, 1 s) liefen nach der Home-Taste bis 04:02:14,2 weiter und standen dann bis 04:09:02. Die Headless-Aufgabe hält die Zeitgeber am S22 also höchstens rund 5 s. Folgen: Die Ereignisse des Kerns (`emitCoreEvent`) und damit **die Hinweise „Download fertig“ kamen erst beim Öffnen** (um 04:07:57 stand keiner in der Liste des Systems, nach 04:09:02 alle drei, `episode-download-999001-…`). Die Kette selbst war nicht betroffen (Ereignisse des Moduls und die verzögerte Arbeit brauchen keinen Zeitgeber).
- **Stück beim `done` im Hintergrund:** 15,6 ms (04:02:25) und 33,4 ms (04:02:34), jeweils „after start, until sql“; in 4b-B 14,8 ms. Nachgestellt, **nicht behoben**: In diesem Stück liegen jetzt zusätzlich drei synchrone Abfragen `File.exists` (`has`), und der JS-Faden wird im Hintergrund gebremst. Die neue Pause `offline: next` trennt nur den Start der nächsten Folge ab.
- **Stück „Listen lesen bis Lader-Auftrag“** (4b-B: 14,7 ms): geteilt durch die Pausen `offline: sound parts`, `offline: request`, `offline: loader`. Längstes Stück eines Download-Starts in diesem Lauf 6,4 ms (nach `loader enqueue`), aber nur mit 49 Teilen; mit einigen hundert Segmenten am Gerät nicht gemessen (unter Node prüft ein Test die Pausen mit 1 800 Teilen).
- **Downloads-Seite:** Screenshot ohne Port-Weiterleitung (Online-Adressen unerreichbar): „1 Anime · 3 episodes · 58 MB“, Titel richtig, **an der Stelle des Covers der Platzhalter**. `expo-image` meldete nur den Fehlversuch der Online-Adresse, keinen zur Datei-Adresse. Ursache offen (alter Snapshot ohne `coverAsset` in der Seite, oder die Anzeige der `file://`-Adresse).
- **Builds:** drei Anläufe. 1: Absturz des Bundlers (`:app:createBundleReleaseJsAndAssets`, 0xC0000005) ohne Meldung zum Code; 2: Kotlin fand die Klassen von React Native nicht → `compileOnly` (oben); 3: durch in 4 min 40 s.

**APK (Test-App):** 112 125 643 Bytes, vorher 112 110 019 (+15 624).

Danach: alle drei Test-Folgen entfernt (Ordner weg, 0 Bilder übrig), `areas answered by the core: none`, keine Port-Weiterleitung, Prüfquelle beendet. Auf dem Gerät stehen noch die drei Hinweise „Download finished“ der Test-Folgen (Hinweise wurden nicht angetippt). An AniList ging nichts, es wurde nichts abgespielt.

**Am Gerät unbelegt** (nur unter Node, `background.test.ts`):

- Rückfall auf den Worker, wenn das System den Job im Hintergrund nicht annimmt (hier nahm es ihn an); Wecken nach mehr als 30 s Ruhe des Prozesses; ein inzwischen beendeter Prozess.
- Aufgeben des Laders nach drei Ablehnungen und die Wartezeit der Warteschlange mit `retryAfterMs`; `Retry-After` als Datum; ein Bild, das nicht kommt (übergangen).
- Angaben aus den gemerkten Listen (die Test-Folgen gehören zu keinem Anime der Listen); `audioLanguage` (die Log-Zeile war abgeschnitten).

**Offen für 4b-C2:**

- **Zeitgeber im Hintergrund** bleiben das Hauptproblem: ein nativer Takt (Ereignisse des Moduls statt `setTimeout`) oder der Hinweis „Download fertig“ direkt aus dem Lader. Dazu gehört `pause()` des Wächters: Sie wartet auf einen Zeitgeber, sobald ein Stück 4 ms gelaufen ist; im Hintergrund kann das Finden einer Quelle mit langen Listen daran hängen bleiben, bis die App geöffnet wird (in diesem Lauf nicht eingetreten). Ob die Headless-Aufgabe bleibt, ist dann zu entscheiden.
- Cover aus der Datei auf der Downloads-Seite klären; `has` vom Faden der Oberfläche nehmen (Modul-Funktion); das Stück beim `done`.
- Manga-Kapitel; Übernahme der alten Server-Downloads und gesperrter Bildschirm (4c).

#### Testweg

`npx vitest run src/core/offline src/core/download src/lib/app-links.test.ts` – neu `background.test.ts`: drei Folgen nur über Ereignisse des Laders, Wachhalten und Freigeben, Wecken nach einer Wartezeit (auch zu früh), `Retry-After` und Pausen-Regel, Wartezeit der Warteschlange, Bilder als Neben-Teile, Angaben, `metadataSaved`, Tonspur-Sprache, Pausen zwischen den Stücken.

### Korrektur 4b-C1K: Hinweise vom Gerät, Wächter im Hintergrund, Cover, Datei-Abfragen

Stand: Die End-Hinweise erscheinen am S22, während die App im Hintergrund ist; das gespeicherte Cover ist auf der Downloads-Seite zu sehen. **Nicht erreicht:** Das Stück beim `done` liegt im Hintergrund weiter über 8 ms (unten).

| Aufgabe | Ursache | Änderung |
|---|---|---|
| Hinweise im Hintergrund | Die Hinweise kamen aus JS (`useDownloadNotifications`: Ereignis des Kerns → Abfrage → Effekt), und alles davon läuft über Zeitgeber, die ~5 s nach der Home-Taste stehen | Der Kern ruft bei `ready` und bei `failed` ohne weiteren Versuch `OfflineDevice.notify`; das Gerät zeigt den Hinweis per Modul-Funktion `notice` (Kotlin, `LoaderNotice.end`): Kanal `episode-downloads` (wird angelegt, falls er fehlt, leise), Tag `episode-download-<id>` mit Nummer 0 wie bei expo-notifications, eigenes kleines Symbol, Titel/Text wie bisher (Texte in der App-Sprache aus `core-offline.ts`, `endNoticeOf`), Antippen öffnet `…://open?path=/android-downloads`. Das `done`-Ereignis erreicht JS ohne Zeitgeber (4b-C1 belegt). `download-notifications.ts` zeigt mit Bereich `offline` an nur noch „Wartet auf WLAN“ |
| Headless-Aufgabe | brachte am S22 nichts (Zeitgeber standen wie ohne sie nach ~5 s) | **entfernt**: `holdTimers`, `keepAwake`, `AWAKE_AFTER_MS` und die Gradle-Zeile `compileOnly 'com.facebook.react:react-android'` |
| `pause()` des Wächters | Ab 4 ms wartete `pause()` auf einen Zeitgeber; stehen die Zeitgeber, hängt die Arbeit bis zum Öffnen | `BlockingWatchParts.inFront` (`blocking.ts`): Ist die App nicht vorn, wartet `pause()` nicht, das Stück läuft weiter und wird als eines gemessen. Die App setzt es in `client-providers.tsx` über `connectAppFront(() => AppState.currentState === "active")` (`core-switch.ts`). Vorn unverändert |
| Cover aus `file://` | Die Seite zeigte zuerst die Online-Adresse (Folge noch nicht fertig), dann die Datei-Adresse. Der Fehlversuch der Online-Adresse kam erst danach an, und `onError` schrieb ihn der **gerade gezeigten** Adresse zu – also der Datei: Platzhalter. Passt zum Befund (nur ein Fehler, der zur Online-Adresse). Die Adresse selbst stimmte; expo-image lädt `file://` über Glide | `Artwork` (`downloads-parts.tsx`): `key={source}`, ein Bild je Adresse, ein später Fehler trifft nur seine eigene. Ein Fehler zu einer `file:`-Adresse wird geloggt (`saved picture not shown`). Aussehen gleich |
| 8 ms beim `done` | drei synchrone `File.exists` (`has`) im Stück | `has` als Modul-Funktion (`has`, Kotlin, Faden des Moduls), in `core-offline.ts` mit `watch.waiting(…, "file check")` |

**Tests (vitest):** `blocking.test.ts` „never waits for a timer while the app is not in front …“ (Zeitgeber, die nie feuern; vorher hing `pause()` dort). `background.test.ts`: drei Folgen mit je einem Hinweis vom Gerät; Hinweis „finished“ bei stehenden Zeitgebern, „failed“ erst ohne weiteren Versuch; Stück beim Ende einer Folge mit drei Datei-Abfragen à 4 ms: vorher ein Stück > 8 ms, jetzt ≤ 4 ms und dreimal bis „file check“ geteilt.

#### Messwerte (S22, Test-App, nur Bereich `offline`, Build von `e841ff1`, 14.11.2026, Uhr des Geräts)

| Zeit | Ereignis |
|---|---|
| 04:36:48–04:36:51 | zwei Folgen (MP4, Folge 2 mit Abbruch und 429) per Prüf-Link eingestellt, App vorn |
| 04:36:52 | Home-Taste; App danach bis 04:37:59 nicht geöffnet. Vorn laut `topResumedActivity` in allen Abfragen 04:36:57–04:37:53 `com.sec.android.app.launcher/.activities.LauncherActivity` |
| 04:37:10,832 / 04:37:10,898 | Folge 1 fertig (Lader) / „end notice shown“ |
| 04:37:20,533 / 04:37:20,623 | Folge 2 fertig / „end notice shown“ |
| 04:37:53 | `dumpsys notification`: `tag=episode-download-999001-1-sub` (erstellt 04:37:10,896) und `…-2-sub` (04:37:20,621), Kanal `episode-downloads`, Wichtigkeit 2, Titel „Download finished“, Text „Sample Show · Episode 1/2“, `AUTO_CANCEL`, Symbol der App – **im Hintergrund** |
| 04:37:59 | App per `am start -n` zurück: beide `ready`, Größe und SHA-256 gleich, je drei Bilder, `metadataSaved true` |
| 04:38:16 | Downloads-Seite ohne Port-Weiterleitung: **Cover sichtbar** (das gespeicherte Bild) |

- **Stück beim `done` (im Hintergrund):** 13,2 ms und 26,1 ms, beide „after file check, until sql“ (4b-C1: 15,6 / 33,4 ms „after start, until sql“). Die Datei-Abfragen sind aus dem Stück heraus; der Rest – Zustand ändern, Zeile bauen (`change`/`store`, Drizzle bis zur ersten Anweisung) – braucht auf dem gebremsten Faden im Hintergrund allein mehr als 8 ms. **Offen** (→ §4r „8-ms-Sammellauf (14.11.)“). Eine Pause hilft dort nicht (sie wartet im Hintergrund jetzt bewusst nicht); nötig wäre ein kleineres Stück oder ein echtes Warten ohne Zeitgeber.
- **APK:** 112 125 375 Bytes, vorher 112 125 643 (−268).
- Danach: beide Test-Folgen entfernt (Ordner weg, 0 Bilder übrig), `areas answered by the core: none`, keine Port-Weiterleitung, Prüfquelle beendet. Die zwei neuen Hinweise und der alte von 4b-C1 (`…-3-sub`) stehen noch auf dem Gerät (nicht angetippt). Nichts an AniList, nichts abgespielt.

**Am Gerät unbelegt:** Hinweis „Download failed“ (nur unter Node), Antippen des Hinweises, ein `pause()` im Hintergrund mit langen Listen (Weg nur unter Node).

### Phase 4b-C2: Manga-Kapitel herunterladen (Bereich `manga`)

Stand (14.11.2026): Mit Bereich `manga` an beantwortet der Kern die Manga-Downloads selbst. **Bereich:** `manga`, kein eigener: Seiten-Antwort (`isDownloaded`), Kapitel-Liste und Downloads müssen dieselbe Quelle haben, sonst zeigte der Leser ein Kapitel als heruntergeladen, dessen Dateien beim anderen liegen. Code: `native/src/core/manga/downloads.ts`, Tests `downloads.test.ts`.

| Schnittstelle | Adresse | Antwort / Regel |
|---|---|---|
| `DownloadMangaChapters` | `POST /api/v1/manga/download-chapters` | `true`; Kapitel aus der Kapitel-Liste der Quelle (Cache 60 min), schon vorhandene übersprungen, unbekannte Nummer = Fehler 404; `startNow` startet die Warteschlange |
| `GetMangaDownloadData` | `POST /api/v1/manga/download-data` | `{ downloaded, queued }` je Anbieter `[{ chapterId, chapterNumber }]`; `downloaded` nur fertige |
| `GetMangaDownloadQueue` | `GET /api/v1/manga/download-queue` | nicht fertige Kapitel in Reihenfolge, `{ provider, mediaId, chapterId, chapterNumber, status, id, createdAt, updatedAt }`, `status` `not_started` / `downloading` / `errored` (ohne `pageData`) |
| `GetMangaDownloadsList` | `GET /api/v1/manga/downloads` | je Manga mit fertigen Kapiteln `{ mediaId, media?, downloadData }`; `media` aus `anilist_media`, sonst nimmt die Seite ihre eigene |
| Start / Stopp / Fehler zurücksetzen | `POST …/download-queue/start`, `/stop`, `/reset-errored` | `true`; Stopp vergisst den laufenden Auftrag des Laders, das Kapitel wartet wieder |
| `ClearAllChapterDownloadQueue` | `DELETE /api/v1/manga/download-queue` | `true`; alle nicht fertigen samt Ordner |
| `DeleteMangaDownloadedChapters` | `DELETE /api/v1/manga/download-chapter` | `true`; Kapitel samt Ordner (`removeFolder` des Moduls) |
| `GetMangaEntryDownloadedChapters` | `GET /api/v1/manga/downloaded-chapters/{id}` | je Anbieter ein Behälter `{ mediaId, provider, chapters }` (`Manga_ChapterContainer`), Kapitel wie die Quelle sie listete |
| `GetMangaEntryPages` | `POST /api/v1/manga/pages` | vom Kern geladenes Kapitel: Seiten als `file://`, `headers: {}`, `isDownloaded: true`; sonst wie 4a (Server-Downloads bleiben beim Server) |

Ereignisse über den Kern-Verteiler: `chapter-download-queue-updated` bei jeder Änderung der Warteschlange, `refreshed-manga-download-data` bei fertig/gelöscht. Hinweise: keine neuen (die alte App zeigte für Manga keine); die Benachrichtigung des Laders (Kanal `core-downloads`, Titel = Kapitel-Titel) verlangt das System für den Job.

**Ablage:** Tabelle `manga_downloads` (Schema-Schritt 12: Kapitel wie gelistet, Zustand, Ordner, Seitenliste `[{ index, file }]`, Fehlertext; eindeutig je Anbieter + Manga + Kapitel). Dateien unter `<App-Speicher>/core-manga/<Anbieter>/<mediaId>/<Kapitel>/000.png …` (Namen außerhalb `[A-Za-z0-9._-]` ersetzt, dann mit Prüfsumme; Endung aus der Adresse, sonst `jpg`).

**Lader:** ein Kapitel = ein Sammel-Auftrag (`parts`, jeder Teil eine eigene Datei `path`), ID `manga-<n>`, ein Kapitel zugleich. Kopfzeilen: die der ersten Seite für den Auftrag; weicht eine Seite ab, bekommt ihr Teil eigene `headers` (neu im Vertrag `LoaderPart.headers`, in `LoaderParts.kt` eine Zeile). Eine Seite, die nicht kommt, lässt das Kapitel scheitern (`errored` mit Fehlerklasse und Status), die Warteschlange geht weiter. `done` des Laders startet das nächste Kapitel (kein Zeitgeber). Nach einem Neustart: vom Lader fertig → fertig, noch gehalten → läuft weiter, sonst neu.

**Leser:** `getChapterPageUrl` gibt eine `file://`-Adresse unverändert zurück (statt `<Server>/manga-downloads/…`); Aussehen unverändert. Nebenbei: der Kern las die Server-Antwort `downloaded-chapters` bisher als flache Kapitel-Liste, sie besteht aber aus Behältern je Anbieter; jetzt beides gelesen.

**Prüf-Link** (nur Test-/scratch-App): `core?manga=download&media=<id>&provider=<id>[&count=<n>]` (erste n Kapitel über dieselbe Tür, folgt der Warteschlange, Ereignisse des Laders mit `app active/background`, dann Seiten: Anzahl, `isDownloaded`, Schema, Dateien) und `core?manga=remove&media=<id>&provider=<id>` (löscht die Kapitel, prüft die Ordner). Nur Zahlen im Log `[CoreManga]`.

**Tests (vitest, `downloads.test.ts`, 6):** Form jeder Antwort gegen die App-Typen, ein Auftrag je Kapitel mit Seiten-Pfaden und eigenen Kopfzeilen einer abweichenden Seite, Kette über `done`, Fehler der Quelle und Fehler einer Seite (`errored`, nächstes Kapitel läuft), Zurücksetzen, Stopp, Leeren, Löschen mit Ordnern, Neustart, unbekanntes Kapitel, Ereignisse. `manga.test.ts`: Download-Adressen sind jetzt Kern. `database.test.ts`: Schritt 12. `app-links.test.ts`: neue Links.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Test-Konto, 14.11.2026 04:58–05:12):** Prüfquelle am PC (eigene Test-Erweiterung nach `manga-provider.d.ts`, Suche/Kapitel/Seiten als JSON, Seiten = erzeugte PNG nur mit bestimmtem `Referer`, sonst 403; nicht im Repo, `adb reverse`), per `core?extensions=install` installiert (597 ms), Bereiche `extensions` + `manga` an.
- Lauf 1 (Bilder sofort): 2 Kapitel à 4 Seiten in 1,8 s fertig (18 599 / 18 307 Bytes), vorn.
- Löschen per Link: „2 chapters deleted, folders left 0“, Liste 0 Manga.
- Lauf 2 (jedes Bild 2 s verzögert): Link 05:00:16, **Home-Taste 05:00:18**, Launcher vorn. „loader done manga-3 … app background“ nach 8,8 s, **„manga-4 … app background“ nach 17,5 s**: das zweite Kapitel startete im Hintergrund über `done`. Nach Rückkehr: Warteschlange leer, Liste 1 Manga / 2 Kapitel, je Kapitel „4 pages, isDownloaded true, scheme file://, 4 files“.
- Downloads-Seite (Manga): „2 chapters ready“, „Available offline“. Im ersten Build war „Read“ gesperrt (`downloaded-chapters` flach statt Behälter) → behoben, **zweiter Build**. Danach Leser geöffnet: Kapitel 1, Seite 1/4 sichtbar (erzeugtes Bild), Log `downloaded-chapters` und `pages` vom Kern; keine Zeile `manga-downloads` in logcat, an die Prüfquelle beim Lesen 0 Anfragen.
- Danach: Kapitel per Link gelöscht, `areas answered by the core: none`, Port-Weiterleitung entfernt, Prüfquelle beendet. **Offen:** die Test-Erweiterung ist noch installiert (kein Prüf-Link zum Entfernen, Aufruf-Budget aufgebraucht) → in der Oberfläche entfernen.

**Faden der Oberfläche:** über 8 ms: 22,9 ms „event of the loader“ (im Hintergrund, wie 4b-C1K bekannt), 12,1 ms Auftrag bauen (vorn), 12,0 ms `download-data` (erster Aufruf, Tabelle laden), 10,6 ms `downloads` (erster Aufruf), 22,3 / 17,3 ms Sandkasten (Manifeste/Suche, alte 4a-Stücke). Nicht behoben, offen (→ §4r „8-ms-Sammellauf (14.11.)“).

APK scratch 125 262 150 → 125 448 462 Bytes.

**Offen für 4c:** Übernahme der Manga-Downloads des Servers (bis dahin liest der Leser sie weiter beim Server, sie fehlen aber in Liste/Warteschlange des Kerns, solange `manga` an ist); Stücke über 8 ms; Fortschritt je Kapitel (die Oberfläche zeigt keinen).

### Phase 4c: alte Downloads des Servers im Kern (14.11.2026)

Stand: Folgen, die der Server fertig geladen hat, zeigt der Kern mit Bereich `offline` an weiter in der Downloads-Seite und spielt sie **aus den alten Dateien**: nichts kopiert, verschoben oder gelöscht. Manga-Kapitel des Servers: **offen** (Form am Gerät nicht erzeugbar, siehe unten). Code: `native/src/core/offline/legacy.ts` (Liste lesen), `offline.ts` (Übernahme, Adressen, Löschen), Geräte-Seite `core-offline.ts` (`oldRoot`, `oldQueue`), Wiederholen in `core-switch.ts` (`repeatCoreMove`). Tests `legacy.test.ts` (8).

**Alte Ablage (am Gerät beobachtet, scratch, nur Form):** `files/mobile-offline/queue.json` = `{ version, wifiOnly, items: { <id>: Item }, manga: {} }`. `<id>` ist eine 32-stellige Hex-Zeichenfolge und zugleich der Ordner `files/mobile-offline/episodes/<id>/` (HLS: `video.ts`, Untertitel `sub-<n>.vtt`). Bilder in `files/mobile-offline/artwork/<sha256>.jpg`. Ein Item trägt die Felder des App-Typs `MobileOffline_Item` (`id`, `key` = `<mediaId>:<Folge>:<Anbieter>:<dub>:<Qualität>`, `status`, `ready`, `mediaId`, `provider`, `episode` als Text, `dubbed`, `quality`, `server`, `audioLanguage`, `progress` **0–100**, `bytes`, `position`, `files { video, audio?, subtitles[{ file, language, label, default, mime }] }`, `order`, Angaben des Anime, `coverAsset`/`bannerAsset`/`episodeImageAsset`, `metadataSaved`) und dazu eigene Felder des Servers: `source { url, type, headers, subtitles }`, `videoTotal`, `video { segments, bytes }`, `audioState { segments, bytes }`. Daneben `mobile-offline/legacy-import.json` (`{ version, done, items, at }`, Übernahme der alten App durch den Server; nicht gelesen). Der Server schreibt `queue.json` bei seinem Start neu (gleicher Inhalt, nur die Zeit ändert sich).

**Umzug:** beim ersten Start des Download-Dienstes im Kern, einmal je `core.db` (Vermerk in der neuen Tabelle `offline_moves`, Schema-Schritt 13, Zeile `episodes`). Übernommen werden nur Items mit `status` `ready`; Unfertiges bleibt beim Server (der Kern müsste es in seinem eigenen Ordner neu beginnen). Felder wie `MobileOffline_Item`, `progress` → 1 (Kern zählt 0–1), `source`, `videoTotal`, `video`, `audioState` bleiben zurück (Adressen der Quelle). Datei- und Ordnernamen nur `[A-Za-z0-9._-]`, sonst bleibt das Item beim Server. Schon vorhanden (gleiche ID oder gleiche Folge in gleicher Tonfassung) → nicht doppelt. Die Zeile in `offline_items` trägt `source: { old: true }`; für solche IDs und ihre Bilder zeigen `offlineFileAddress`/`offlineArtworkAddress` auf `files/mobile-offline/…` statt `files/core-offline/…`. Nicht lesbare Liste → kein Vermerk, nächster Start versucht es neu (Fehlertext ohne Werte). Wiederholen: Link `core?move=again` holt nur Neues nach (läuft der Dienst noch nicht, beim nächsten Start). Die Dateien des Servers werden nur gelesen.

**Löschen eines übernommenen Eintrags im Kern** (Stand bis 4.3.0; seit 4.3.1 löscht „Vom Gerät löschen“ auch den Ordner eines übernommenen Kapitels bzw. einer Folge, Bilder, die eine andere alte Folge noch nutzt, bleiben, siehe `core/manga/downloads.ts` und `core/offline/offline.ts`): nur der Eintrag des Kerns geht, die Dateien bleiben (Ordner und `queue.json` gehören dem Server). Begründung: Der Umzug ist nur lesend, und der Rückweg muss halten – Schalter aus, der Server zeigt seine Folge mit Dateien unverändert. Würde der Kern die Dateien löschen, zeigte der Server danach eine Folge ohne Dateien. Der Eintrag kommt nicht von selbst zurück (Vermerk), nur über `core?move=again`. Platz frei machen: Schalter aus und über den Server löschen (bis Stufe 8, die die Ablage des Servers aufräumt).

**Manga (offen):** Mit `mangadex` gab der Server am Tablet für die probierten Titel keine Seiten (Dr. STONE Kapitel 1: Fehler 500 „No pages found“; One-Punch Man: „no chapters“), die Ordner `files/manga/` und `files/manga-local/` blieben leer. Ohne beobachtete Form keine Übernahme (keine Vermutung über Tabelle `chapter_download_queue_items` und Ordner). Bis dahin liest der Leser alte Kapitel weiter beim Server (§4o 4b-C2).

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, 14.11.2026 05:13–05:35; Build von `be9f869`):**
1. Test-Erweiterung „C2 Test Manga“ aus 4b-C2 über die Oberfläche deinstalliert (Bereich `extensions` an, „uninstall answered by the core“, Datei weg), danach `areas answered by the core: none`.
2. Mit dem Server (alle Bereiche aus): Dr. STONE Folge 1 über `aq-anikoto` geladen (ein Eintrag `ready`, 310 MB, neun Untertitel, drei Bilder). Manga: siehe oben, nicht möglich.
3. Neue APK, Bereiche `extensions`, `streams`, `offline`, `manga` an: Downloads-Seite „1 Anime · 1 episode · 310 MB“ mit Cover aus `mobile-offline/artwork` (`snapshot answered by the core`). Folge abgespielt (12 s, Bild und Untertitel sichtbar): logcat `file://…/files/mobile-offline/episodes/<id>/video.ts` und `sub-0…8.vtt`, **0 Anfragen `/mobile-offline/file`**; Player und Mini-Player geschlossen. `files/core-offline/episodes/` leer: nichts kopiert.
4. Bereiche aus → `none`, Downloads-Seite vom Server „1 Anime · 1 episode · 310 MB“; `video.ts` unverändert (Größe, Zeit 05:16), Items in `queue.json` feldgleich mit der Kopie vor dem Umzug.

Offen: Löschen der Server-Folge über die Oberfläche am Ende (Aufruf-Budget), Manga-Übernahme, „Download bei gesperrtem Bildschirm“ (am Gerät nicht prüfbar ohne Nicks Entsperren).

APK scratch 125 448 462 → 125 457 814 Bytes.

### Phase 4c-2: alte Manga-Kapitel (14.11.2026)

Stand: Kapitel, die der Server fertig geladen hat, zeigt der Kern mit Bereich `manga` an in Downloads-Seite und Kapitel-Liste als heruntergeladen und liest sie im Leser **aus den alten Dateien** (`file://`); nichts kopiert, verschoben oder gelöscht. Code: `native/src/core/manga/legacy.ts` (Ordner lesen), `downloads.ts` (Übernahme, Seiten-Adressen, Löschen), Geräte-Seite `core-offline.ts` (`oldMangaRoot`, `oldManga`), Wiederholen in `core-switch.ts` (`repeatOldChapters`). Tests in `downloads.test.ts` (4 neu).

**Alte Ablage (am Gerät beobachtet, scratch, ein Titel mit hochgeladenen Kapiteln über `mangadex`, nur Form):** Ordner `files/manga/<Anbieter>_<mediaId>_<Kapitel-ID>_<Kapitel-Nummer>/` (Einstellung `manga.downloaddir` = `$SEANIME_DATA_DIR/manga`), darin die Seiten `01.jpeg`, `02.jpeg` … und `registry.json` = `{ "<index>": { index, filename, original_url, size, width, height } }`. Die Tabelle `chapter_download_queue_items` (`provider`, `media_id`, `chapter_id`, `chapter_number`, `page_data`, `status`) hält nur die Warteschlange: nach dem Laden war sie leer. Ein Titel des Kapitels steht nirgends.

**Umzug:** beim ersten Start der Manga-Downloads im Kern, einmal je `core.db` (Zeile `manga` in `offline_moves`). Übernommen wird ein Ordner nur mit lesbarer `registry.json`, deren Dateien alle da sind und nur `[A-Za-z0-9._-]` tragen (Ordnername ebenso); sonst bleibt er beim Server (ohne `registry.json` = noch unterwegs). Name zerlegt: Anbieter bis zum ersten `_<Ziffern>_`, Nummer nach dem letzten `_`, dazwischen die Kapitel-ID. Kapitel-Angaben: `{ provider, id, url: "", title: "Chapter <n>", chapter, index: <n> }`. Neue Spalte `old` in `manga_downloads` (**Schema-Schritt 14**): Ordner liegt unter dem Server-Ordner. `core?move=again` holt Neues nach. Der automatische erste Umzug schreibt jetzt eine Log-Zeile (Folgen und Manga): `move from the server: saved episodes|manga chapters taken n, left with the server m`.

**Löschen eines übernommenen Kapitels im Kern:** nur der Eintrag, Ordner bleibt (gleiche Regel wie Folgen, §4o 4c).

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, 14.11.2026 05:36–06:00):**
1. Aufräumen aus 4c: Server-Folge über die Downloads-Seite gelöscht (alle Bereiche aus), `mobile-offline/episodes/` leer, `queue.json` ohne Items.
2. Mit dem Server: Kapitel (22 Seiten) über `mangadex` geladen (Warteschlange musste auf der Downloads-Seite mit „Start / resume“ gestartet werden), Form oben.
3. Neue APK, Bereiche `extensions` + `manga` an: Log `move from the server: saved manga chapters taken 1, left with the server 0`; Downloads-Seite (Manga) „1 Manga · 1 chapter offline“, Seite des Manga „Available offline“; Leser: Seite 1/22 sichtbar (850 × 850 wie in `registry.json`), `downloaded-chapters` und `pages` vom Kern, **0 Zeilen `manga-downloads`** in logcat. Die Seiten-Adresse selbst schreibt die App nicht ins Log (kein `file://` in logcat); die Form `file://…/files/manga/<Ordner>/<Datei>` belegt der Test.
4. Bereiche aus → `none`, Downloads-Seite vom Server weiter „1 Manga · 1 chapter offline“.

Offen: Löschen des Server-Kapitels über die Oberfläche am Ende (Aufruf-Budget; Ordner `files/manga/…` liegt noch), Kapitel-Titel der Quelle (nur „Chapter n“), „Download bei gesperrtem Bildschirm“.

APK scratch 125 457 814 → 125 465 910 Bytes.

### Gerätetest gesperrter Bildschirm (14.11.)

Pixel Tablet, scratch, Nutzer 10, vorhandener Build (installiert 14.11. 09:59, kein Code geändert). Bereiche `extensions`, `streams`, `offline` an; Online-Stream-Erweiterung `kaa` per Prüf-Link installiert (fehlte in scratch: erster Versuch `SOURCE_UNAVAILABLE online stream provider not found: kaa`); eine alte Folge 1 aus einem früheren Lauf vorher mit `core?offline=remove` entfernt. Download über `core?offline=check&media=105333&provider=kaa&episode=1&keep=1` (`…/batch`, derselbe Weg wie die Downloads der App).

| Zeit | Was |
|---|---|
| 15:00:10 | Link, `resolving`; 15:00:17 `downloading 0 %` (Lader-Job `LoaderJobService` läuft) |
| 15:00:37 | Power-Taste per adb: `Going to sleep due to power_button`, „locking without delay“, `screen_toggled 0`; Beleg `mWakefulness=Dozing`, `mScreenLocked=true` |
| 15:03:27 | **Tablet von Hand aufgeweckt** (`WAKE_REASON_POWER_BUTTON`, nicht durch den Lauf) und entsperrt; 15:03:34 erste Zeile der App: `downloading 40 %` |
| 15:04:24 | Lader `done: 702453449 bytes, 0 of them kept from an earlier run`; 15:04:25 `ready`, Größen wie in §4o (b): `video.ts` 663 710 500, `audio.ts` 38 537 932, 8 Untertitel |

Ergebnis: **Der Download lief bei gesperrtem Bildschirm weiter** (rund 170 s gesperrt, danach 40 % erreicht, kein Abbruch, kein neuer Anlauf: „0 kept from an earlier run“). **Fertig wurde er nicht im gesperrten Zustand**, weil das Tablet nach 170 s entsperrt wurde; das Ende kam 57 s danach. Auffällig: gesperrt rund 280 MB in 170 s (etwa 1,6 MB/s), danach rund 420 MB in 50 s (etwa 8 MB/s; am 14.11. vorn/Home ganz in 45 s). Ob das System den Job bei aus­geschaltetem Bildschirm drosselt (Doze, Netz) oder die Quelle schwankte, ist aus dem Log nicht zu trennen → offen, mit einem Lauf ohne Eingriff wiederholen.

Hinweise: Für scratch sind Benachrichtigungen vom Nutzer gesperrt (`importance=NONE userSet=true`), daher weder die Lader-Benachrichtigung noch der Ergebnis-Hinweis in `dumpsys notification`; der nutzergestartete Job lief trotzdem. Keine Zeile „failed“, kein Absturz. Folge 1 bleibt gespeichert (`105333-1-sub`). Endstand: alle Bereiche aus (`none`), Port-Weiterleitung entfernt.

## 4p. Wiedergabe-Rest (Stufe 5)

Befund vor Beginn: 117 Schnittstellen und mehrere direkte Server-Adressen gehen mit allen Bereichen an noch zum Server. Schnitt: 5a-1 Status + Anime-Seite + Folgen-Sammlung, 5a-2 Fortschritt/Verlauf, 5a-3 Home/Entdecken-Rest + Anmeldung, 5a-4 Playlists, 5b lokale Ordner, 5c Tag ohne Server.

### Phase 5a-1 (14.11.2026): Status, Anime-Seite und Folgen ohne Server

**Neuer Bereich `library`** (`native/src/core/library/`, Standard aus). Grund: Die Anime-Seite mischt AniList, die Listen, die Folgen-Metadaten eines fremden Dienstes und die Downloads (`offline`); ein eigener Schalter lässt genau diesen Teil einzeln zurück auf den Server, ohne AniList-Lesen und -Ändern (Bereich `anilist`) mitzunehmen. Ist `library` aus, bleibt alles wie in §4e (letzte Antwort des Servers).

| Schnittstelle | Bereich | Code | Antwort |
|---|---|---|---|
| `GET /api/v1/status` | `settings` (+ `anilist`) | `start/start.ts` `startStatus` | ganz vom Kern, keine Anfrage an den Server (Regel unten) |
| `PATCH /api/v1/torrentstream/settings`, `PATCH /api/v1/debrid/settings` | `settings` | `start/start.ts` `serverSettingsSaved` | speichert weiter der Server (Stufe 6); seine Antwort ersetzt den Teil im aufgehobenen Status |
| `GET /api/v1/library/anime-entry/{id}` | `anilist`, mit `library` an vom Kern gebaut | `library/library.ts` `libraryEntry` | `Anime_Entry` wie aufgezeichnet |
| `GET /api/v1/anime/episode-collection/{id}` | `library` | `library/library.ts` `episodeCollection` | `Anime_EpisodeCollection` wie aufgezeichnet |

**Metadaten-Quelle: ani.zip** (`https://api.ani.zip/mappings?anilist_id=…`, `library/metadata.ts`). Die Aufzeichnung zeigt Folgen-Bilder von `artworks.thetvdb.com`, je Folge `tvdbId`, `anidbEid` und die Zuordnungen (AniDB, TheTVDB, MAL, Kitsu, …) – genau die Felder, die der öffentliche Dienst ani.zip je AniList-Nummer frei und ohne Schlüssel liefert (Stichprobe Dr. STONE: `tvdbId`, `anidbEid`, Bild, Ausstrahlung, englischer Titel, Länge = Laufzeit gleich der Aufzeichnung). Cache in `core.db`, Schema-Schritt 15, Tabelle `episode_metadata` (`anilist_id`, `content`, `fetched_at`): jünger als ein Tag → ohne Netz; älter → neu gefragt (10 s Zeitlimit); Ausfall → letzter Stand jeden Alters; nie gefragt und Ausfall → keine Metadaten (`hasMappingError: true`, Folgen nur „Episode n“).

**Eigene Regeln**

- *Status:* `settings`, `themeSettings`, `user` wie §4e vom Kern. Was nur das Server-Programm weiß (Version, Datenordner, Client-Kennung, Feature-Flags, `isOffline`, Einstellungen für Torrent, Debrid und Umwandlung) ist sein Teil, **wie er ihn zuletzt gab, für diesen Build der App** (`server_answers`, dazu `…/status#app-build` = Version+Build der App). Ein neuer Build bringt ein neues Server-Programm: Der Kern fragt dessen Teil dann einmal auf dem alten Weg. Gespeicherte Torrent-/Debrid-Einstellungen kommen über die Antwort des Servers hinein (Schlüssel des Bezahldienstes geleert). `updating: false`. `serverReady` = der Server-Prozess lauscht; bis dahin werden Anfragen an den Server zurückgehalten (§4e), danach gehen sie raus – auf „Daten geladen“ des Servers wird nicht mehr gewartet, weil die ersten Bildschirme ihre Daten vom Kern haben.
- *Folgen:* Hauptfolgen 1 … n; n = alle bei abgeschlossenem Anime, bei laufendem die vor der nächsten Ausstrahlung (`nextAiringEpisode`), ohne diese die schon ausgestrahlten laut Metadaten, sonst die Zahl von AniList, sonst die des Dienstes; „noch nicht erschienen“ → keine. Titel/Bild/Ausstrahlung je Nummer aus den Metadaten, `absoluteEpisodeNumber` = Nummer + Versatz der ersten Folge. `isDownloaded`: Folge im Bereich `offline` fertig (`offline_items`, Status `ready`).
- *Anime-Eintrag:* `media` = Titel aus den Listen (`anilist_media`); nicht in den Listen → AniList (`EntryMedia`, mit Ausfall-Speicher). `listData` aus dem eigenen Listen-Eintrag (mit wartenden Änderungen, §4f; gleiche Form wie `entryWithWaitingChange`). `downloadInfo.episodesToDownload` = alle Folgen nach dem Fortschritt, alle bei „abgeschlossen“/„wiederholen“ (`rewatch`); `canBatch` bei abgeschlossenem Anime, `batchAll` zusätzlich ohne Fortschritt; `hasInaccurateSchedule` bei laufendem Anime ohne nächste Ausstrahlung. `anidbId` aus den Zuordnungen, `currentEpisodeCount` = n.
- *Behoben aus Stufe 2 (§4g):* Der Kopf der Anime-Seite zeigt eine Änderung aus dem Kern sofort – das Ereignis `refreshed-anilist-anime-collection` lässt die Seite neu lesen, und die Antwort kommt jetzt aus den eigenen Listen statt vom Server.
- *Online-Stream:* `streams/onlinestream.ts` nimmt Titel und Folgen-Metadaten mit `library` an vom Kern; sonst fragt es den Server nur noch, wenn er lauscht. Der Neuladen-Hinweis nach einer Änderung (`anilist/changes.ts`) geht wie bisher nur, wenn der Server lauscht.

**Abweichungen vom Server:** Der Kern kennt noch keine eigenen Ordner mit Dateien des Nutzers (5b): kein `libraryData`, keine `episodes`/`localFiles` der Bibliothek; die Seite zeigt den Anime wie jeden ohne Dateien („nicht in deiner Bibliothek“ + Folgen zum Schauen + Downloads auf dem Gerät). Specials/OP/ED/Trailer stehen nur in `metadata.episodes`, soweit der Dienst sie kennt (der Server hatte mehr Schlüssel, z. B. `T1…`); Titel-Sprachen sind die des Dienstes (`x-jat` heißt `main`). `GET /api/v1/library/collection` (Home) bleibt die letzte Antwort des Servers (offen, 5a-3).

**Am Gerät (S22, Test-App, Nutzer 0, Build von `a7b6b2c`, 14.11.2026 06:30–06:33, nur lesend, alle Bereiche an, danach alle aus):** Prüf-Link Dr. STONE (105333): Status Kern 21 Felder = Server 21 Felder, alle Server-Felder gleich (Version, Datenordner, Client-Kennung, Flags, Torrent-/Umwandlungs-Einstellungen, Nutzer), abweichend nur `settings`/`themeSettings` (gehören seit 1b dem Kern). Eintrag: `listData`, `anidbId`, `currentEpisodeCount` 24 und alle `downloadInfo`-Schalter gleich; Kern ohne `libraryData` (Server: 4 eigene Dateien, darum zum Schauen Kern 24 / Server 20; Metadaten der 20 gemeinsamen Folgen gleich). Folgen-Sammlung: 24 Folgen, 24 mit Titel, 24 mit Bild auf beiden Seiten, Titel 24/24 und Bilder 24/24 gleich, Zuordnungen und `episodeCount` gleich; Metadaten-Schlüssel Kern 26 / Server 63, Titel-Sprachen 16 / 8. Anime-Seite geöffnet: Kopf (Fortschritt, Status) und Folgenliste mit Titeln und Bildern; im Server-Log ab dem Öffnen **0** Anfragen für Status, Eintrag, Folgen-Sammlung und Online-Stream (nur `continuity/history`, `metadata/parent`, zwei Erweiterungs-Listen, offen für 5a-2/5a-3). Eintrag vom Kern 12 ms.

| Längstes Stück (warm, Vordergrund) | vorher | nachher |
|---|---|---|
| `media-details` | 44,7 ms (Stufe 2) | 2,1 ms (Pausen nach Lesen und Kürzen) |
| `anime-entry` | 14–19 ms (Stufe 2) | 3,9 ms |
| `episode-collection` | (Server) | 1,3 ms |
| `status` | – | 2,0 ms |

APK Test-App 112 125 375 → 112 220 915 Bytes.

**Testweg:** `library/library.test.ts` (Form jeder Antwort gegen `library.recorded.json`, nur Arten aus der Aufzeichnung; kein Listeneintrag, Ausfall des Dienstes mit/ohne Stand, Offline-Folge, laufender Anime, 1100 Folgen mit Pausen, Bereich aus), `start/start.test.ts` (Status ohne Server, neuer Build, gespeicherte Debrid-Einstellungen). Prüf-Link (Test-/scratch-App): `seanime-native://core?library=check&media=105333` – Status, Eintrag, Folgen-Sammlung einmal über die Tür der Hooks und einmal direkt vom Server, nur Zahlen und Feldnamen (`[CoreLibrary]`).

### Phase 5a-2 (14.11.2026): Schau-Verlauf und Fortschritt ohne Server

Neuer Bereich **`playback`** (Standard aus). Eigener Bereich statt `library`/`anilist`: Er nimmt dem Server einen ganzen Kanal ab (die `videocore`-Nachrichten des Players), nicht nur Schnittstellen, und muss sich einzeln zurückschalten lassen, ohne Listen oder Anime-Seite mitzunehmen.

| Teil | Wo | Was |
|---|---|---|
| Haken | `use-player-server.ts` `send` → `tellPlayer` (`core/playback/playback.ts`) | jede Player-Nachricht geht an genau eine Seite: Bereich an → `coreHearPlayer` (`api/client/core-switch.ts`, nach dem Zug des Aufrufers, gemessen wie eine Anfrage, Fehler nur ins Log), sonst wie bisher per WebSocket an den Server. Kein Doppel-Melden |
| Verlauf | `playback.ts`, Tabelle `watch_positions` (gibt es seit 1d, Umzug aus `watch_history.cache`) | eine Zeile je Anime; `GET /continuity/history`, `GET /continuity/item/{id}` (nicht da: `{ item: null, found: false }`), `PATCH /continuity/item` → `true`; Form wie aufgezeichnet, Zeiten auf Millisekunden; abgelaufene Zeilen aus dem Umzug fallen weg |
| Hören | `hearPlayer` | `video-loaded`: Anime, Folge (`progressNumber`), Art (`onlinestream`, sonst `mediastream`), Einstellungen einmal lesen. `video-status`: nur Arbeitsspeicher, Schreiben höchstens alle 5 s. Pause, Sprung, 80 %, Schließen schreiben sofort |
| Fortschritt | `watched` | bei `video-completed` (der Player schickt es einmal bei 80 % gespielt, `player-logic.ts`) und „Fortschritt automatisch speichern“ (`library.autoUpdateProgress`) an: AniList-Fortschritt = diese Folge, **nie kleiner**. Bereich `anilist` an → `updateProgressOf` (Warteschlange, Ereignisse `refreshed-anilist-*`, §4f); aus → Server `update-progress` nach Blick auf `listData.progress` |

Einstellungen: `library.enableWatchContinuity` aus → kein Verlauf. Gelesen aus dem Kern (Bereich `settings` an) oder dem Status des Servers. Offline-Folgen schicken nichts (`enabled` im Haken); ihre Position bleibt beim Bereich `offline` (`mobile-offline/position`), wie vorher.

Nicht übernommen (der Server hört nichts mehr davon, solange der Bereich an ist): was er sonst noch aus `videocore` macht (Discord, Playlisten, Befehle an den Player). Die Startseite zeigt die Fortsetzen-Zeile aus `GET /library/collection`; das Test-Konto hat dort nach dem Lauf keinen Eintrag (Grenze aus §4f), darum ist der Beleg der Position das Log und die Anime-Seite.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build von `7963d8e`, 14.11.2026 06:51–06:56, Bereiche `settings`, `anilist`, `library`, `extensions`, `streams`, `playback` an, Test-Konto, Wächter vorher „GUARD ok“, Dr. STONE ohne Eintrag):** Folge 1 online gespielt, nahe ans Ende gesprungen (20:35 / 24:06), kurz weiter, Mini-Player geschlossen. App-Log: `video-loaded … playing 105333 episode 1`, `video-completed … progress 1 by the core` (`changes for AniList: 1 sent`), `video-terminated … closed 105333 episode 1 at 1236 s`; Anime-Seite danach 1/24 „Watching“; AniList öffentlich `CURRENT`, Fortschritt 1 (vorher kein Eintrag). Server: Verlauf leer (`continuity/history` des Servers: 0 Einträge), im Server-Log keine `videocore`-/Fortschritts-Zeile; die zwei `continuity/history`-Anfragen um 06:53:10 waren beim Start vor dem Einschalten von `playback` gestellt und hingen in der 60-s-Startschranke. Zurückgesetzt über die App (Eintrag löschen, vom Kern), danach `anilist-clear`: 0 Einträge; alle Bereiche aus (`areas answered by the core: none`). Wiedergabe gesamt gut 25 s (über dem Plan von 15 s, die Bedienleiste kam erst nach dem zweiten Versuch).

**Faden der Oberfläche:** Die Wächter-Meldungen während des Abspielens: `video-status` 8,8–24,6 ms, `video-seeked` 28,8 / 31,2 ms, `video-terminated` 44,1 ms (alle „after start, until sql“ bzw. „until end“); im selben Zeitraum `GET /status` 8–75 ms. Der Haken selbst ist ohne Datenbank nur eine Map-Änderung; die Zeit „after start“ fällt auch beim ersten Sprung ganz ohne SQL an (28,8 ms) – der Player-Faden belastet die Messung. **Offen:** über 8 ms, nicht abgenommen; nächster Schritt: Messung mit ruhendem Player und Schreiben des Verlaufs außerhalb des Faden-Stücks.

APK scratch 125 465 910 → 125 512 742 Bytes.

**Testweg:** `core/playback/playback.test.ts` (10 Tests): Form gegen `playback.recorded.json` (Aufzeichnung CONTINUITY.*, Werte erfunden), eine Zeile je Anime, abgelaufene Zeile, Bereich aus → Server; Haken an/aus (genau eine Seite); 5-s-Schreiben, Sprung und Schließen sofort, nach dem Schließen nichts mehr; Verlauf aus; Fortschritt einmal über den Server, Einstellung aus, nie kleiner, kein Fortschritt aus einem Status allein; ohne Netz: Warteschlange des Kerns hält die Änderung (`info-toast`), Verlauf trotzdem gespeichert.

### Phase 5a-3 (14.11.2026): Home, Entdecken, Zeitplan, Einträge-Kleinkram und Anmelden ohne Server

| Schnittstelle | Bereich | Code | Antwort |
|---|---|---|---|
| `GET /api/v1/library/collection` | `anilist`, mit `library` an vom Kern gebaut | `library/home.ts` `ownLibraryCollection` | `Anime_LibraryCollection` wie aufgezeichnet |
| `POST /api/v1/anilist/collection` („Refresh AniList“) | `anilist` | `library/home.ts` `refreshAnimeCollection` | Listen neu von AniList; mit `library` aus liest auch der Server seine Listen neu (sein Home braucht sie) |
| `GET /api/v1/anilist/list-missed-sequels` | `anilist` | `anilist/sequels.ts` | Liste von Titeln wie aufgezeichnet |
| `GET /api/v1/library/upcoming-episodes` | `library` | `library/home.ts` `upcomingEpisodes` | `{ episodes }` wie aufgezeichnet |
| `GET /api/v1/library/schedule` | `library` | `library/home.ts` `animeSchedule` | `Anime_ScheduleItem[]` wie aufgezeichnet |
| `GET /api/v1/library/anime-entry/silence/{id}`, `POST …/silence` | `library` | `library/marks.ts` | still: `{ id, createdAt, updatedAt }`, sonst `false`; Umschalten → `true` |
| `GET /api/v1/metadata/parent/{id}`, `POST`/`DELETE /api/v1/metadata/parent` | `library` | `library/marks.ts` | Eintrag; ohne: alles 0, Zeiten `0001-01-01T00:00:00Z`; Löschen → `true` |
| `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` | `anilist` | `anilist/auth.ts` | der Status (`start/start.ts`) |

Zuordnung: Was nur AniList fragt (Fortsetzungen, Anmelden, Neuladen), gehört zu `anilist`; was Listen mit Folgen-Metadaten, Verlauf oder Downloads mischt oder eigene Marken einer Anime-Seite hält, zu `library` (wie 5a-1). `core.db` Schema-Schritt 16: `silenced_anime`, `metadata_parents`.

**Eigene Regeln**

- *Home (`library/collection`):* aus den gespeicherten Listen (nie gelesen → einmal AniList), dem Verlauf (`watch_positions`) und den Geräte-Downloads. Ohne eigene Ordner (5b) sind die Listen leer, Zähler 0. `stream.anime` = Einträge `CURRENT`/`REPEATING`, zuletzt geschaut zuerst, dann zuletzt geändert; `stream.continueWatchingList` = je Anime die Folge nach dem Fortschritt, wenn sie schon draußen ist (`episodesOut`, 5a-1), Metadaten von ani.zip; `stream.listData` je Anime (`progress`, `score`, `status`, `startedAt`, `completedAt`).
- *Kommende Folgen:* alle Listen-Anime außer „abgebrochen“ mit einer noch nicht gelaufenen nächsten Folge, früheste zuerst; Bild der Folge aus den Metadaten, sonst Banner, sonst Cover (so antwortete der Server am S22).
- *Zeitplan:* Listen-Anime außer „abgebrochen“, die laufen, noch kommen oder zur vorigen, laufenden oder nächsten Saison gehören (AniList: Winter = Dezember–Februar); alle Folgen, für die AniList eine Zeit hat (höchstens 50 je Anime), nach Zeit sortiert; Titel `userPreferred`, Bild `extraLarge`, `isMovie` = `MOVIE`, `isSeasonFinale` = letzte Folge. Regel aus der Aufzeichnung abgeleitet (11 Anime, 136 Folgen; Zeitfenster passte nicht, Saisons passten genau).
- *Verpasste Fortsetzungen:* Beziehung `SEQUEL` der abgeschlossenen Anime, in keiner Liste, „läuft“ oder „fertig“, je einmal, neueste (Startdatum) zuerst, höchstens 10 (Server am S22: 10, nach Start absteigend). AniList je 25 Anime (eine Seite mit 50 hielt den Faden 12,4 ms).
- *Marken:* still/Eltern-Eintrag in `core.db`. Vorhandene Marken des Servers werden **nicht** übernommen (Umzug offen, mit dem Rest der Server-Datenbank in Stufe 6). Der Kern nutzt den Eltern-Eintrag noch nicht für die Folgen-Metadaten (5a-1 nimmt immer ani.zip des Anime selbst).
- *Anmelden/Abmelden:* Token in `expo-secure-store` (`seanime-core.account-token`, wie §4c), Name + Viewer (ohne Nummer) in `account`; neues Konto → gespeicherte Listen vergessen; der Server wird mitgeteilt, solange er lauscht (er arbeitet noch für Bereiche, die aus sind). Mit `onlyAccount` (scratch) nur das Test-Konto, sonst Fehler ohne etwas zu speichern. Neu in `CoreEnvironment`: `keepSecret` (null = löschen).

**Beim Server bleiben:** `POST`/`DELETE /api/v1/metadata-provider/filler`. Die Füller-Listen kommen beim Server von einer fremden Webseite (Aufzeichnung: „fetches filler lists from an outside site“); dafür gibt es keine saubere, frei nutzbare Quelle mit Schnittstelle oder Lizenz – nur Auslesen einer Webseite. Offen aus der Aufgabe: `/manga/source-refresh`, `manga/manual-mapping/preview`, `custom-source/provider/list/*` (5a-4) und die 8-ms-Stücke aus 5a-2 (Budget).

**Am Gerät (S22, Test-App, Nutzer 0, Build von `1d8e112`, 14.11.2026 07:18–07:21, nur lesend, alle Bereiche an, danach alle aus):** Prüf-Link `seanime-native://core?library=home`: Home-Sammlung Kern 8 Felder = Server 8 Felder; `stream`: Anime 6/6 gleiche Menge, nächste Folgen 5/5 gleiche Anime+Folge, 5/5 mit Bild, `listData` 6/6 gleich; Listen-Einträge Kern 0 / Server 1 (eigene Dateien, 5b). Kommende Folgen 8/8, gleiche Folgen und Reihenfolge, Bild Kern 1 / Server 7 (→ Bild-Regel oben nachgezogen). Zeitplan 136/136, alle 136 ganz gleich, 11/11 Anime, 1 Film, 5 Finale. Verpasste Fortsetzungen Kern 23 / Server 10, alle 10 des Servers beim Kern (→ neueste 10, nachgezogen, nicht neu gemessen). Home (`belege/5a3-01-home.png`, Fortsetzen-Zeile + „Currently watching“), Entdecken (`5a3-02-discover.png`), Zeitplan (`5a3-03-schedule.png`) geöffnet. App-Log: die Schnittstellen „answered by the core, no HTTP“; Server-Log nach dem Einschalten nur die Direkt-Fragen des Prüf-Links (07:19:02–07:19:10) und um 07:20:01 je eine Zeile `upcoming-episodes` und `list-missed-sequels` (4 ms bzw. 2 ms), zu der es im App-Log keinen Weg zum Server gibt (alle Antworten „by the core“) – Herkunft offen. Längste Stücke: `list-missed-sequels` 9,4 / 9,2 / 12,4 ms (offen, Seitengröße danach halbiert (→ §4r „8-ms-Sammellauf (14.11.)“)), `schedule` 8,4 ms, `upcoming-episodes` 6,1 ms, `library/collection` 5,9 ms. Kern: Home 67 ms, kommende 126 ms, Zeitplan 252 ms, Fortsetzungen 3379 ms (AniList). APK Test-App 112 220 915 → 112 272 987 Bytes.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build von `1156c0b`, 14.11.2026 ~07:30, nur lesend):** Wächter `record-server.mjs anilist-guard` verlangt `--test-account`, die Nummer lag diesem Lauf nicht vor → **nichts geschrieben**: Stilllegen, Eltern-Eintrag sowie Ab-/Anmelden nur per Tests belegt (Anmelden bräuchte ohnehin Zugangsdaten). Prüf-Link mit `settings`, `anilist`, `library` an: Test-Konto ohne laufende Einträge, alle Zähler Kern 0 = Server 0; längstes Stück `library/collection` 11,4 ms („after start, until sql“, erster Aufruf nach dem Einschalten, offen (→ §4r „8-ms-Sammellauf (14.11.)“)), sonst ≤ 6,7 ms; danach Bereiche aus. APK scratch 125 512 742 → 125 552 842 Bytes.

**Testweg:** `library/home.test.ts` (11 Tests, Form gegen `home.recorded.json`, Schlüssel nach AniList-Nummer als `{mediaId}`; Reihenfolge nach Verlauf, Bereich aus, kommende ohne abgebrochene/gelaufene, Saisons, AniList aus → Stand, Fortsetzungen in Listen/noch nicht erschienen, Marken an/aus/ersetzen/Fehler, Neuladen mit `library` an/aus), `anilist/auth.test.ts` (5 Tests: Anmelden, Konto-Wechsel vergisst Listen, Test-Konto-Wächter, fehlendes Token, Abmelden). Prüf-Link: `core?library=home` (`[CoreLibrary]`, nur Zahlen).

### Phase 5a-4 (14.11.2026): Playlists ohne Server

**Bereich `playback`** (kein eigener). Grund: Eine laufende Playlist geht nur weiter, wenn ihr Besitzer den Player hört (`video-loaded`, `video-completed`) – das tut seit 5a-2 genau der Bereich `playback` (`tellPlayer`). Ein eigener Schalter erlaubte „Playlists beim Kern, Player beim Server“: Der Server sähe die Playlists des Kerns nie, der Kern den Player nie. Speichern und Abspielen gehören darum zusammen in den Bereich, der den Player hört.

| Teil | Wo | Was |
|---|---|---|
| `GET /api/v1/playlists` | `playback/playlists.ts` `allPlaylists` | `Anime_Playlist[]` (`{ dbId, name, episodes }`), älteste zuerst, wie aufgezeichnet |
| `POST /api/v1/playlist` | `createPlaylist` | `{ name, episodes }` → die neue Playlist. Abweichung: Der Server antwortete `dbId: 0` (vor dem Speichern, die Liste danach zeigte 1), der Kern gibt die gespeicherte Nummer; die App liest die Antwort nicht (sie lädt die Liste neu) |
| `PATCH /api/v1/playlist` | `updatePlaylist` | `{ dbId, name, episodes }` → die Playlist; unbekannt → 404 |
| `DELETE /api/v1/playlist` | `deletePlaylist` | `{ dbId }` → `true` |
| `GET /api/v1/playlist/episodes/{id}` | `playlistEpisodes` | nicht aufgezeichnet (keine Playlist in der Test-App, §6). Abgeleitet aus `mobile-playlists.tsx` (`EpisodeSelection`: filtert `episode`, sortiert nach `progressNumber`, setzt `watchType \|\| defaultWatchType`, wählt nach `aniDBEpisode`) und dem Typ `Anime_PlaylistEpisode`: je Folge der Folgen-Sammlung (5a-1) `{ episode, isCompleted, watchType: "", isNakama: false }`; `isCompleted` = Folge ≤ Fortschritt (Abfrage `progress`, sonst eigener Listen-Eintrag); leere Art → die App setzt ihre Standard-Art ein; Nakama kennt der Kern nicht |
| Kanal `playlist` | `global-playlist-manager.tsx` `usePlaylistSender` → `tellPlaylist`; `api/client/core-switch.ts` `coreHearPlaylist` → `hearPlaylist` | jede Nachricht an genau eine Seite (Bereich an → Kern, sonst WebSocket), wie 5a-2 |
| Player → Playlist | `coreHearPlayer` → nach `hearPlayer` noch `playlistHearsPlayer` | Folge der Playlist geladen → `playing-episode`; gilt als gesehen (80 %) → in der Playlist abgehakt |

`core.db` Schema-Schritt 17: `playlists` (`db_id`, `name`, `episodes` als JSON in der Reihenfolge der App, Zeiten), `playlist_move` (eine Zeile: Ergebnis des Umzugs).

**Ablauf `playlist` im Kern** (Nachrichten wie heute zwischen App und Server, `global-playlist-manager.tsx`):

- `current-playlist` (Frage beim Start) → Antwort `current-playlist` `{ playlist, playlistEpisode }` (keine: beide `null`).
- `start-playlist` `{ dbId, … }` → ab der ersten noch nicht gesehenen Folge (alle gesehen: ab der ersten); Antwort `current-playlist` + `play-episode` `{ playlistEpisode }`. Die App startet die Folge wie bisher nach ihrer Art (online: Anime-Seite, Reiter Online-Stream).
- `play-episode` `{ which, isCurrentCompleted }` → mit `isCurrentCompleted` (in der App: „Fortschritt zählt“) AniList-Fortschritt = diese Folge, nie kleiner (`progressTo`, derselbe Weg wie 5a-2: Bereich `anilist` an → Warteschlange, sonst Server), Folge abgehakt; dann die nächste/vorige: `current-playlist` + `play-episode`. Über das Ende hinaus → Playlist beendet (`current-playlist` leer).
- `reopen-episode` → `play-episode` derselben Folge; `stop-playlist` → `current-playlist` leer.
- **Nächste Folge nach `video-completed`:** Der Kern hakt die Folge bei 80 % ab (Speicher und `core.db`, `current-playlist` mit `isCompleted: true`); den Fortschritt setzt dort 5a-2. Weiter geht es, wenn der Player es verlangt – am Ende der Folge oder über seine Taste „Nächste“ (`player-screen.tsx`: mit laufender Playlist fragt er `playlistNavigation` → `play-episode next`). Ein eigenes Weiterspringen bei 80 % hätte die letzten 20 % (Abspann) abgeschnitten und doppelt mit dem Player gesprungen.
- Ändern einer laufenden Playlist: dieselbe Folge spielt weiter, wenn sie noch drin ist, sonst Stopp; Löschen → Stopp. Der Zustand der laufenden Playlist lebt nur im Arbeitsspeicher (wie beim Server ein Neustart).

**Umzug** (einmal je `core.db`, nur lesend): Tabelle `playlists` der Server-Datenbank (`id`, `name`, `value`), gelesen wie §4c/§4m als Kopie im Speicher (`CoreEnvironment.serverPlaylists`, `openOldData`), **keine Anfrage an den Server**. `value` = die Folgen als JSON (Liste oder Objekt mit `episodes`); das Format ist aus dem Typ abgeleitet, die DB-Kopien (§6) hatten 0 Zeilen. Eine nicht lesbare Playlist kommt ohne Folgen mit (`reason`). Ergebnis in `playlist_move`: `moved`/`empty`/`missing`/`failed`; danach nie wieder. Die alte Tabelle `playlist_entries` (gleiche Spalten, 0 Zeilen in allen Kopien) wird nicht gelesen.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build von `55faca7`, 14.11.2026 07:43–07:46, Test-Konto, Wächter vorher „GUARD ok“):** installiert, Bereiche `settings`, `anilist`, `library`, `extensions`, `streams`, `playback` an (`areas answered by the core: …, playback`). Dr. STONE per Link geöffnet, Eintrag über die App auf „Watching“ gesetzt (vom Kern, `belege`-Bilder im Arbeitsordner), weil der Playlist-Editor nur Anime aus „Currently watching“ anbietet. **Playlist am Gerät nicht angelegt/abgespielt:** Der Einstieg zu den Playlists liegt nicht im Menü des Tablets, der Lauf hatte sein Aufruf-Budget erreicht – offen für den nächsten Lauf, ebenso Stilllegen/Eltern-Eintrag aus 5a-3. Wiedergabe 0 s. Server-Log: 6 Zeilen `GET /api/v1/playlists`, davon 3 um 07:44:55 mit `playback` an. Geklärt im zweiten Lauf (unten): Im Kern-Log steht um 07:44:55.493 „the server was not ready after 60 s, held requests go to it now“ – es sind Anfragen, die die Startschranke vor dem Einschalten von `playback` angehalten hatte, keine neuen. Danach `anilist-clear` (Eintrag entfernt, 0 übrig), alle Bereiche aus (`areas answered by the core: none`). APK scratch 125 552 842 → 125 574 542 Bytes.

**Am Gerät, zweiter Lauf (Pixel Tablet, scratch, Nutzer 10, derselbe Build, 14.11.2026 07:50–07:54 Ortszeit, Test-Konto, Wächter vorher „GUARD ok“, Konto leer):** Bereiche einzeln per Link an (07:50:12–07:50:22), `areas answered by the core: …, playback` um 07:50:21.9. Jeder Schaltvorgang lädt die Playlists neu: 07:50:13 und 07:50:15 (`playback` noch aus) vom Server, 07:50:22 „answered by the core, no HTTP“.
- **Startschranke belegt, nicht nur vermutet:** Mit `anilist` an hält der Kern Server-Anfragen an, solange er den Server nicht hört (`serverListening` blieb falsch, obwohl der Server antwortete). Um 07:51:15.470 „the server was not ready after 60 s, held requests go to it now“, direkt danach 3× `GET /api/v1/playlists` beim Server (07:51:15.52–.57) – dasselbe Muster wie 07:44:55. Es sind Anfragen von vor 07:50:21.9 (`playback` noch aus). **Zeitfenster sauber ab 07:51:16 bis zum Ausschalten 07:54:12: 0 Playlist-Anfragen beim Server.** Die zwei Zeilen danach (07:54:20/22) kamen nach dem Ausschalten von `playback`, wie erwartet.
- **Playlist nicht angelegt, Wiedergabe 0 s.** Grund: Dr. STONE ließ sich am Tablet nicht auf die Liste setzen. Auf der Anime-Seite fehlt der Knopf „Zur Liste hinzufügen“ (`AnilistMediaEntryButton` zeigt nichts ohne `useCurrentUser()`), auch nach `anilist` aus; der Server selbst meldet den Nutzer (`/status`: `user` da, nicht simuliert). Im Menü steht kein Konto. Ohne Listen-Eintrag gibt es weder den Karten-Eintrag „Zur Playlist hinzufügen“ (`usePlaylistMenuItem`: `onList`) noch eine Auswahl im Editor („Currently watching“). Der Home-Knopf „Playlists“ erscheint nur mit lokaler Bibliothek (`library.hasEntries`), die scratch-App hat keine. Ursache des fehlenden Nutzers nicht geklärt (Status-Atom, `startStatus`/`ownUser` ohne Token in `expo-secure-store`?) – offen, vor dem nächsten Geräte-Lauf am Code prüfen.
- **Stilllegen / Eltern-Eintrag (aus 5a-3) über die Oberfläche nicht erreichbar:** Die Glocke (`SilenceToggle`) steht nur im Reiter „Lokale Bibliothek“ mit lokalen Dateien (`entry.libraryData`); die Felder für die Hauptserie nur ohne AniDB-Nummer (`!entry.anidbId`). Dr. STONE ohne Dateien erfüllt das nicht. Beleg dafür braucht einen Anime mit lokalen Dateien bzw. ohne AniDB-Eintrag oder den Prüf-Link.
- Danach alle Bereiche aus (07:54:22 `areas answered by the core: none`), `anilist-clear` „found 0, … left … 0“.

**Am Gerät, dritter Lauf (Pixel Tablet, scratch, Nutzer 10, Build von `2130e16` mit den Korrekturen 5a-K, 14.11.2026 08:14–08:23, Test-Konto, Wächter vorher „GUARD ok“):** Bereiche `settings`, `anilist`, `library`, `extensions`, `streams`, `playback` per Link an (08:14:06–08:14:18, `… playback` um 08:14:17.9), aus um 08:23:08–08:23:21 (`areas answered by the core: none`).
- Dr. STONE über die Anime-Seite: Knopf „+“ → „Planning“, „Edit“ → „Watching“ (vom Kern, `changes for AniList: 1 sent`). Einstieg Playlists: „Meine Listen“ → Karte lange drücken → „Add to playlist“ → „Add to new playlist“ → Folgen 1 und 2 → Name → speichern: `POST /api/v1/playlist answered by the core` (64 ms).
- **Erster Start spielte nichts:** Der Kern startete die Playlist (`start-playlist … started playlist 1 at 1 of 2`), die App öffnete aber keine Folge. Ursache: Die Folgen hatten keine Quelle (`watchType` leer), weil die App keine Standard-Art hatte (`defaultWatchType` leer, Auswahl zeigte „Choose source“, obwohl „Online streaming“ die einzige Wahl war); `global-playlist-manager.tsx` kennt für eine leere Art keinen Weg. Gleiches Verhalten wie mit dem Server (die Oberfläche speichert, was der Editor hält). Nach Wahl „Online streaming“ für beide Folgen (`PATCH … answered by the core`, 45 ms) startete die Playlist richtig. **Offen (Oberfläche):** mit nur einer möglichen Quelle diese vorwählen oder ohne Quelle nicht speichern lassen.
- Kern-Log, Ablauf: `start-playlist` → `video-loaded … playlist episode 1 plays` → `video-completed … progress 1 by the core` + `playlist episode 1 watched` (die Folge sprang auf die im Verlauf aus 5a-2 gemerkte Stelle 20:35, also gleich über 80 %) → Taste „Nächste“ im Player: `play-episode … playing 2 of 2` → `video-loaded … playlist episode 2 plays` (Toast „Playing episode 2 of Dr. STONE“) → `stop-playlist … stopped the playlist` → `video-terminated … closed 105333 episode 2 at 20 s`. Anime-Seite danach 1/24 „Watching“, im Playlist-Blatt Folge 1 abgehakt.
- Umbenennen („Probe“ → „ProbeNeu“, `PATCH`, 38 ms) und Löschen (`DELETE`, 68 ms) vom Kern, Liste danach leer.
- **Server-Log:** von 08:14:18 bis 08:23:08 0 Anfragen an `/playlists`/`/playlist*`, 0 `videocore`-Zeilen, 0 × „not ready after 60 s“. Die 6 `GET /api/v1/playlists` ab 08:23:10 kamen nach dem Ausschalten von `playback` (Neuladen je Schaltvorgang, wie im zweiten Lauf).
- **Mini-Player:** Solange eine Playlist läuft, deckt ihr runder Knopf unten rechts das × des Mini-Players ab; schließen ging erst nach „Playlist stoppen“. **Offen (Oberfläche).**
- **Wiedergabe gut 95 s statt höchstens 15 s** (08:19:30–08:20:40 Folge 1, 08:21:03–08:21:28 Folge 2): die erste Taste „Nächste“ traf die Bedienleiste nicht, der Player lief beim Suchen weiter. Regelverstoß dieses Laufs.
- Stücke über 8 ms beim Abspielen (alter Stand, „after start, until sql“): `video-status` 8,1–30,6 ms, genau im 5-s-Takt des Schreibens (auch bei Pause im Mini-Player), `video-seeked` 15,5 / 18,0 / 43,7 ms, `video-completed` 101,0 ms, `video-loaded` 9,1 ms („after sql, until sql“), `start-playlist` 8,3 ms. Befund für 5a-2b: Die langen Stücke fallen auf die Nachrichten, die schreiben, nicht auf jede Sekunde.
- Danach `anilist-clear` (1 Eintrag gefunden und entfernt, 0 übrig), alle Bereiche aus, `adb forward` entfernt. Bilder `a01`–`a41` im Arbeitsordner (nicht im Repo).

**Testweg:** `playback/playlists.test.ts` (9 Tests): Form gegen `playlists.recorded.json` (Liste/Anlegen/Ändern/Löschen samt Zustand danach, Namen erfunden), Reihenfolge von Playlists und Folgen, Fehler 400/404, Folgen zum Auswählen (gesehen bis Fortschritt, Abfrage zählt vor), Umzug (Reihenfolge nach Server-`id`, Text und Bytes, kaputter Wert, nur einmal, `missing`, `failed`), Kanal an/aus (genau eine Seite), Ablauf Start → geladen → 80 % → Weiter mit Fortschritt → Zurück → Wieder öffnen → Ende, Stopp, Ändern und Löschen der laufenden. `database.test.ts`: neue Tabellen.

### Korrektur 5a-K (14.11.2026): Knopf „Zur Liste hinzufügen“ und Startschranke

**Fehler 1, kein Knopf „Zur Liste hinzufügen“ – Ursache war nicht der Nutzer.** Der Verdacht aus 5a-4 (Status ohne `user`) stimmte nicht: Mit allen Bereichen aus fehlte der Knopf am Tablet ebenso, die App zeigte Home statt „Willkommen“ (`server-data-wrapper.tsx` zeigt ohne `user` die Anmeldung), und der Server-Status hatte `user` (Feldnamen per Node über `adb forward` gelesen, nicht simuliert). Ursache: `AnilistMediaEntryButton` (`anilist-media-entry-sheet.tsx`) blendete den Knopf nach einem erfolgreichen Hinzufügen aus, bis der Eintrag kommt (`isSuccess` der Änderung) – und vergaß diesen Erfolg nie. Im ersten Lauf von 5a-4 war Dr. STONE auf derselben, noch offenen Seite hinzugefügt worden; `anilist-clear` entfernte den Eintrag danach von außen, und dieselbe Seite (der Link öffnet die schon offene Seite wieder) zählte weiter den alten Erfolg. **Fix:** `entryButton`/`addingDone` (`main/_features/media/_lib/list-entry-form.ts`): Ist der hinzugefügte Eintrag da, wird die Änderung zurückgesetzt (`reset()`), danach zeigt die Seite ohne Eintrag wieder den Knopf. Die Status-Regel (Nutzer vom Kern nur mit Token im gesicherten Speicher, sonst der Stand des Servers) bleibt, wie sie war.

**Fehler 2, Startschranke hielt 60 s.** Ursache: Der native Zustand des Server-Prozesses wird erst `ready`, wenn er die Zeile „Seanime started at“ ausgibt und vorher keine Zeile „address already in use“ kam (`modules/seanime-server`, Schutz gegen den Server eines anderen Profils auf demselben Port). Am Tablet läuft der Server der Test-App mit; der eingebaute Torrent-Client des scratch-Servers findet seinen Port belegt und weicht aus („failed to start client on port …, retrying with random port“, enthält „address already in use“). Der Prozess lauscht danach normal, der Zustand bleibt aber `starting` – `serverListening` blieb falsch, jede Anfrage an den Server wartete die 60 s ab. **Fix ohne Änderung am Modul:** `serverListens` (`lib/server/start-gate.ts`): lauscht = Zustand `ready` **oder** Zustand `starting` und die Ereignis-Verbindung (`/events`) zum Server steht (`websocketConnectedAtom`). In jedem anderen Zustand (`idle`, `retrying`, `error`, `stopped`) zählt die Verbindung nicht – dann kann der Port einem anderen Profil gehören. `client-providers.tsx` gibt das an `connectServerState`; die Status-Abfrage alle 2 s lässt die Anfragen danach durch.

**Testweg:** `list-entry-form.test.ts` (4 neue Tests: kein Nutzer/hinzufügen/bearbeiten, nach dem Hinzufügen versteckt bis der Eintrag kommt, Eintrag von außen entfernt → Knopf wieder da, misslungenes Hinzufügen), `start-gate.test.ts` (4 neue Tests: `ready`, `starting` mit/ohne Verbindung, fremde Zustände). Vor dem Fix rot (8 Fehlschläge), danach grün.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build von `2130e16`, 14.11.2026 08:09–08:11, Test-Konto, Wächter vorher „GUARD ok“):** Server-Log nach der Installation: eine Zeile „address already in use“ (Torrent-Port), danach „Seanime started at http://127.0.0.1:43213“ – Ursache von Fehler 2 belegt. Vor dem Fix (alter Build, alle Bereiche aus) fehlte der Knopf auf Dr. STONE; nach dem Fix alle sechs Bereiche an (`settings`, `anilist`, `library`, `extensions`, `streams`, `playback`), Dr. STONE: Knopf „+“ sichtbar, Antippen → „Planning“ und Knopf „Bearbeiten“ (vom Kern, `changes for AniList: 1 sent`). Kein „not ready after 60 s“ ab dem Start (0 Zeilen), 0 Playlist-Anfragen beim Server. Danach `anilist-clear` (1 Eintrag entfernt, 0 übrig), alle Bereiche aus (`areas answered by the core: none`), kein `adb forward`. Wiedergabe 0 s. **Offen:** der Playlist-Ablauf aus 5a-4 am Gerät (Anlegen, Abspielen, Umbenennen, Löschen) – Aufruf-Budget dieses Laufs reichte nur für die beiden Fehler; ebenso die 8-ms-Stücke von `playback` (Aufgabe 3). APK scratch 125 574 542 → 125 574 922 Bytes.

### Phase 5b-1 (14.11.2026): eigene Videodateien (lokale Ordner) ohne Server

Bereich **`library`** (wie 5a-1). Neue Dateien `library/local-files.ts` (Tabelle, Formen, Änderungen, Zuordnung), `library/scan.ts` (Scan, Zusammenfassungen, unbekannte Anime, Abspielen), App-Seite `api/client/core-local-files.ts` (Ordner lesen mit expo-file-system, nur lesend). `core.db` Schema-Schritt 18: `local_files` (eine Zeile je Datei, Schlüssel = Pfad), `scan_summaries` (höchstens 10). Neu in `CoreEnvironment`: `localFolders` (`list(pfad)` → Name, Ordner ja/nein, Größe).

| Schnittstelle | Code | Antwort |
|---|---|---|
| `POST /api/v1/library/scan` | `scan.ts` `scanLocalFiles` | alle Dateien (`Anime_LocalFile[]`); Ereignisse `scan-progress` 0/20/30/70/100, `scan-status` Text |
| `GET /api/v1/library/scan-summaries` | `scanSummaryList` | `[{ createdAt, scanSummary: { id, groups, unmatchedFiles } }]`, neueste zuerst |
| `PATCH /api/v1/library/local-files` | `local-files.ts` `updateLocalFiles` | `lock`/`unlock`/`ignore`/`unignore`/`unmatch` → `true` |
| `PATCH /api/v1/library/local-file` | `updateLocalFileData` | Folge/Art/Anime/Marken einer Datei → alle Dateien |
| `DELETE /api/v1/library/local-files` | `deleteLocalFiles` | Dateien vom Gerät, dann ihre Einträge (seit 4.3.1) → übrige Dateien |
| `POST /api/v1/library/local-files` | `bulkLocalFiles` | alle zugeordneten sperren/entsperren → alle Dateien |
| `PATCH /api/v1/library/anime-entry/bulk-action` | `entryBulkAction` | `toggle-lock`/`unmatch` für einen Anime → alle Dateien |
| `POST /api/v1/library/anime-entry/manual-match` | `manualMatch` | Dateien → Anime, Folge neu aus dem Namen, gesperrt → alle Dateien |
| `POST /api/v1/library/unknown-media` | `addUnknownMedia` | je Anime „Geplant“ über die Warteschlange (§4f) → Anime-Listen |
| `POST /api/v1/directstream/play/localfile`, `POST /api/v1/playback-manager/play` | `playLocalFile` | `null`; Ereignis `native-player` „watch“ mit `streamUrl` `file://…` |
| `GET /api/v1/library/anime-entry/{id}`, `GET /api/v1/library/collection` | `library.ts`, `home.ts` | jetzt mit `libraryData`, `localFiles`, eigenen Folgen, Listen, Zählern |

**Ablauf des Scans:** Ordner = `library.libraryPath` + `library.libraryPaths` (Einstellungen des Kerns mit `settings` an, sonst Status des Servers). Breitensuche über die Ordner, ein Ordner je Stück (`pause`), höchstens 12 Ebenen und 20 000 Dateien, Namen mit Punkt vorn übersprungen, Endungen mkv/mp4/avi/webm/m4v/mov/wmv/flv/ts/m2ts/mpg/mpeg/ogm/rmvb/3gp. Ein Wurzelordner, der sich nicht lesen lässt, bricht ab (Fehler mit Pfad), die Tabelle bleibt dann wie sie war. Name gedeutet mit dem eigenen `$habari` (§4j, `prelude/habari.js` direkt eingebunden); Titel aus der Datei, sonst aus dem nächsten Ordner. Mit „erweitert“ (`enhanced`, in der App „nur meine Listen“ aus) wird ein in den Listen unbekannter Titel einmal bei AniList gesucht (`Page.media`, `SEARCH_MATCH`, höchstens 30 Suchen je Scan); eine so zugeordnete Datei gehört zu einem Anime außerhalb der Listen (`unknownGroups`). Gesperrte/ignorierte Dateien behalten mit `skipLockedFiles`/`skipIgnoredFiles` ihre Zeile; ohne diese werden sie neu gedeutet und verlieren die Marke. Verschwundene Dateien fallen aus der Tabelle. Je 20 Dateien und je 50 geschriebene Zeilen eine Pause.

**Zuordnungs-Regel (eigen):** Titel werden schlicht gemacht (Akzente weg, klein, „&“ → „and“, alles außer Buchstaben/Ziffern → Leerzeichen) und ein Staffel-Zeichen herausgenommen („season 2“, „2nd season“, „s2“, eine letzte einzelne Ziffer 2–9). Der Titel der Datei wird gegen jeden Titel jedes Kandidaten gehalten (romaji, englisch, nativ, bevorzugt, Synonyme): gleich = 1, sonst Dice-Koeffizient der Buchstabenpaare. Staffel > 1: +0,2 für einen Kandidaten mit derselben Staffel, −0,2 für alle anderen; ohne Staffel −0,2 für Kandidaten mit Staffel ≥ 2. Zugeordnet ab 0,8; bei Gleichstand gewinnt der erste (die Listen stehen vorn). *Folge:* Nummer aus dem Namen = Hauptfolge; `OP`/`NCOP` → `nc` `OPn`, `ED`/`NCED` → `nc` `EDn`; `SP`/`OVA`/`OAD` bei einer Serie → `special` `Sn`; ohne Nummer: Film oder Einzelfolge → Folge 1, sonst `special` `S1`.

**Abgeleitete Formen (nicht aufgezeichnet, aus Typen und App-Code):** `Anime_LocalFile` (`parsedInfo` = Felder von `Anime_LocalFileParsedData`, Bereiche nur bei mehr als einem Wert); `libraryData` = `allFilesLocked` (alle gesperrt), `sharedPath` (gemeinsamer Ordner), `unwatchedCount` (Hauptfolgen nach dem Fortschritt), `mainFileCount`; Anime-Seite: `episodes` = je Datei eine Folge (Hauptfolge mit den Metadaten ihrer Nummer, sonst eigene Zeile), `nextEpisode` = erste Hauptfolge mit Datei nach dem Fortschritt (beim Wiederholen die erste), Folgen mit eigener Datei nicht mehr in `episodesToDownload`. Home: Listen nur mit Anime, die Dateien haben (`REPEATING` unter `CURRENT`), `unmatchedGroups` je Ordner (`suggestions` leer), `stats` aus den Dateien, `continueWatchingList` = nächste Hauptfolge auf dem Gerät der laufenden Anime. Formen von Eintrag und Home gegen `library.recorded.json`/`home.recorded.json` geprüft (alle Felder des Kerns aufgezeichnet, gleiche Arten).

**Abweichungen vom Server:** `DELETE /library/local-files` entfernte bis 4.3.0 nur die Einträge, nie die Dateien. Die Dialoge sagten aber „wird von diesem Gerät gelöscht“, und der nächste Scan brachte die Dateien zurück. **Seit 4.3.1 (Nicks Entscheidung, 21.11.2026)** löscht der Kern die Datei wirklich, so wie der Dialog es sagt: nur eine Datei, die in `local_files` steht und in einem Bibliotheksordner liegt, nie einen Ordner, keinen Pfad mit `..`. Was nicht gelöscht werden kann, behält seinen Eintrag, und die Antwort ist ein Fehler. Manuelle Zuordnung sperrt die Dateien (ein neuer Scan überschreibt sie dann nicht). Keine AniDB-/Offline-Datenbank (`enhanceWithOfflineDatabase` wird nicht gelesen), keine Vorschläge für unzugeordnete Ordner, kein Ordner-Wächter (`library-watcher-*`, `auto-scan-*`), kein `DELETE /library/empty-directories`, kein `explorer/file-tree`, kein `suggestions` (offen, 5b-2). Ein `GET /library/local-files` gibt es in der App nicht. Abspielen: nur über den eingebauten Player (Weg `directstream/play/localfile`); externe Player-Links und Umwandlung (`mediastream`) bleiben beim Server.

**Testweg:** `library/scan.test.ts` (14 Tests): Namen deuten, Punktwerte und Staffel, Folgen-Arten; Scan mit Unterordner, Nicht-Video, versteckter Datei, Ereignisse (0 → 100, aufsteigend), Pausen; erweitert mit AniList-Suche → unbekannter Anime; unlesbarer Ordner lässt die Tabelle stehen; gesperrt behalten/neu deuten, verschwundene Datei weg; Zusammenfassungen; Eintrag und Home in der aufgezeichneten Form; Sperren/Ignorieren/Lösen/alle/je Anime; manuelle Zuordnung; Löschen lässt die Datei; Abspielen → `native-player` „watch“ mit `file://` (Leerzeichen escaped), Fehler für unzugeordnete und unbekannte Pfade.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build vom WIP-Stand 5b-1, 14.11.2026 08:59–09:05, Test-Konto, Wächter vorher „GUARD ok“, Bereiche `settings`, `anilist`, `library`, `playback` an):** `adb push` nach `/storage/emulated/10/…` verweigert (Shell darf den Speicher von Nutzer 10 nicht), darum drei selbst erzeugte 10-s-Testvideos (`Dr. STONE - 01.mp4`, `Dr. STONE - 02.mp4`, `Urlaub am See 2025 - 03.mp4`) per `run-as` in den App-Speicher der scratch-App, Bibliotheks-Ordner über Einstellungen → Lokale Bibliothek gesetzt (`PATCH /settings/path` vom Kern). Scan über Home → „Scan your anime library“ (nur Listen aus = erweitert): `POST /library/scan` vom Kern, 715 ms, keine HTTP-Anfrage an den Server; Home danach „1 file has no anime yet“ + „1 anime is hidden“ → Dr. STONE (TV, 2019, 24 Folgen) mit **2 Dateien** (01, 02), die dritte Datei unzugeordnet. Stücke über 8 ms: `library scan folders` 9,5 ms („after sql, until sql“), Lesen der AniList-Antwort der Suche 36,0 ms (bestehender Lese-Weg von AniList, offen). **Nicht am Gerät:** Abspielen einer lokalen Folge (Werkzeug-Budget; Weg `directstream/play/localfile` → `native-player` „watch“ mit `file://` nur per Test belegt), „Add to AniList“ nicht gedrückt (nichts geschrieben). Aufgeräumt: Pfad zurück auf „Not set“, Testordner gelöscht, alle Bereiche aus (`areas answered by the core: none`), `anilist-clear`: 0 Einträge, Port-Weiterleitung entfernt.

APK scratch 125 575 866 → 125 639 722 Bytes.

### Phase 5b-2 (14.11.2026): lokale Ordner fertig, lokale Folge am Gerät gespielt

Bereich **`library`**. Neue Datei `library/folders.ts`; `api/client/core-local-files.ts` neu auf die Funktionen aus `expo-file-system/legacy` (`readDirectoryAsync`, `getInfoAsync`, `deleteAsync`), beide Geräte-Aufrufe als Warten der Wache (`localFoldersFor(watch)`). `LocalFolders` hat neu `removeEmptyFolder(pfad)` (löscht nur, wenn der Ordner beim erneuten Lesen gar nichts enthält).

| Schnittstelle | Code | Antwort |
|---|---|---|
| `GET /api/v1/library/explorer/file-tree` | `folders.ts` `fileTree` | `{ root, localFiles }`: Bibliotheks-Ordner, wie er jetzt auf dem Gerät ist (ein Ordner = Wurzel, mehrere = Wurzel „Library“ ohne Pfad), nur Ordner und Videodateien; Zähler (`localFileCount`, `matchedLocalFileCount`, `mediaIds`) zählen gescannte Dateien; `localFiles` nach Pfad. Kein Ordner gesetzt: ohne `root` |
| `POST /api/v1/library/explorer/file-tree/refresh` | `refreshFileTree` | `true` (der Baum wird bei jeder Anfrage neu gelesen, nichts gemerkt) |
| `DELETE /api/v1/library/empty-directories` | `removeEmptyDirectories` | `true`; entfernt unterhalb der Bibliotheks-Ordner jeden Ordner ohne jeden Inhalt (auch ohne versteckte Datei), tiefste zuerst; nie einen Bibliotheks-Ordner selbst, nie eine Datei; versteckte Ordner werden nicht betreten |
| `POST /api/v1/library/anime-entry/suggestions` | `folderSuggestions` | AniList-Treffer für den Titel des Ordnernamens (sonst der ersten Datei darin); ohne Titel `[]` |
| Scan beim Start | `scanAtStart` | einmal je App-Lauf nach dem ersten `GET /library/collection`, nur mit `library` an, `library.refreshLibraryOnStart` an („Refresh the library when the app starts“) und gesetztem Ordner; Ereignisse `auto-scan-started`/`-completed` (auch nach Fehler, damit die Anzeige endet) |

**Bewusst nicht:** kein Ordner-Wächter (`library.autoScan`, „Refresh the library automatically“, bleibt ohne Wirkung; ein Dauer-Wächter wäre Dauerlast). Formen ohne Aufzeichnung (nur `explorer/file-tree` ist aufgezeichnet, die Wurzel dort ist ein Platzhalter „.“ mit leerem Kind): aus den App-Typen und `library-explorer-phone.tsx`/`library-explorer-tree.ts`.

**8 ms:** (1) `library scan folders` 9,5 ms (5b-1) war `Directory.list()` und `File.size` des neueren expo-file-system: beide laufen im Faden der Oberfläche. Jetzt nur noch die asynchronen Funktionen, die Wache sieht sie als Warten; `blocking.test.ts` prüft die Datei (wie 3f-4 bei den Erweiterungen). Am Gerät danach keine Meldung „library scan folders“. (2) Die AniList-Suche des Scans nutzt die eigene kleine Abfrage `SEARCH_FILE_MATCH` (ohne Beschreibung, Genres, Trailer, Banner, `pageInfo`) statt `LIST_ANIME`, mit Pause nach der Antwort; `scan.test.ts` prüft die Abfrage. **Am Gerät aber weiter 42,2 ms** („POST /library/scan (library scan match) … after network read, until sql“): Da die Pause nach dem Lesen nicht griff, liegt das Stück nach ihr – Zuordnen der restlichen Dateien, `scan-progress`/`scan-status` (70) an die Oberfläche bis zum Löschen der Tabelle. Die 36,0 ms aus 5b-1 waren also nicht (nur) das Lesen der Antwort. ~~Offen: Messpunkte setzen und nachmessen.~~ ✅ Reste-Lauf (14.11., §4r): bis zu 20 Dateien je Stück gegen alle Anime der Listen abgeglichen → jetzt Pause vor jeder Datei (die Pause wartet nur, wenn das Stück lang genug lief); am Gerät nicht nachgemessen (keine Bibliotheksordner auf dem Tablet). Weitere Meldungen im Lauf: `GET /library/anime-entry/{id}` 8,9 ms, `POST /directstream/play/localfile` 9,7 ms, `videocore video-seeked` 25,2 ms (offen).

**Testweg:** `scan.test.ts` +6 Tests: Abfrage der Suche; Dateibaum (Zähler, ungescannte Datei, `localFiles`); mehrere Ordner + unlesbarer Ordner; leere Ordner (leer, verschachtelt leer, nur versteckte Datei bleibt, Ordner mit Video bleibt, Bibliotheks-Ordner bleibt, unlesbar = Fehler); Vorschläge (Ordnername, erste Datei, ohne Titel); Scan beim Start (nur mit Einstellung, einmal). `blocking.test.ts`: Geräte-Seite der Ordner nur asynchron und gewartet.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build `327f346`, 14.11.2026 09:18–09:24, Test-Konto, Wächter vorher „GUARD ok“, Bereiche `settings`, `anilist`, `library`, `playback` an):** Testordner `kern5b` per `run-as` im App-Speicher (Unterordner `Dr. STONE` mit 2 Testvideos, eine Datei in der Wurzel, leerer Ordner `Leer/Innen`), Pfad über Einstellungen → Local library gesetzt (`PATCH /settings/path` vom Kern). Scan (erweitert, Liste des Test-Kontos leer): `POST /library/scan` vom Kern 823 ms, danach `file-tree/refresh` vom Kern; Dr. STONE mit 2 Dateien als „hidden“. **„Add to AniList“** gedrückt: `POST /library/unknown-media` vom Kern (1314 ms), Dr. STONE „Planning“ im Test-Konto. **Abspielen:** Folge 2 aus der Anime-Seite: `POST /directstream/play/localfile` vom Kern, `[NATIVE PLAYER] Watch local file` mit `file:///data/user/10/…/Dr.%20STONE%20-%2002.mp4`, `videocore video-loaded heard by the core: playing 105333 episode 2`, Schau-Verlauf `continuity/*` vom Kern; im Log keine Anfrage an `/playback-manager/play` oder `/directstream` beim Server. **Panne:** Das Zeichen oben links im Vollbild ist „vorige Folge“, nicht „Schließen“ – der Tipp startete Folge 1 (lief bis zum Ende, Fortschritt 1 über `playback`), danach startete die App selbst Folge 2 (Fortschritt 2, `video-completed … progress 2 by the core`), bevor „Cancel“ griff. **Wiedergabe gesamt gut 24 s statt höchstens 10 s** (Folge 2 ca. 5 s, Folge 1 ca. 10 s, Folge 2 ca. 9 s; Testvideos von 10 s), danach Pause, Mini-Player mit × geschlossen. `POST /library/anime-entry/suggestions` beim Öffnen der unzugeordneten Datei vom Kern (266 ms). **Nicht am Gerät:** Dateibaum-Seite und „Leere Ordner entfernen“ (nur Tests). Aufgeräumt: Pfad leer übernommen (`PATCH /settings/path` vom Kern), Testordner gelöscht, alle Bereiche aus (`areas answered by the core: none`), `anilist-clear`: 1 Eintrag entfernt, 0 übrig, Port-Weiterleitung entfernt.

APK scratch 125 639 722 → 125 653 914 Bytes.

### Phase 5c-1 (14.11.2026): ohne Server – ein normaler Tag, der Dienst startet nicht

**Schalter** (nur Test- und scratch-App, Link wie die anderen): `core?server=off` / `core?server=on`, gespeichert in MMKV unter `seanime-core-server-off`. Die Release-Variante liest weder Link noch Wert (`serverOffAllowed` in `core-switch.ts`). An heißt:

- `client-providers.tsx`: Der Server-Dienst wird beim Start **nicht** gestartet (Log `The app runs without its server, the server is not started`), auch nicht beim Zurückkommen in den Vordergrund. Der Link schaltet sofort für Anfragen um; der Dienst fehlt ab dem nächsten Start. `server=on` startet den Dienst sofort wieder (er wird beim Ausschalten nicht beendet).
- `core/switches.ts`: `connectServerOff`/`isServerOff`; **alle Bereiche gelten als an**, die gespeicherte Liste bleibt unverändert und gilt wieder nach `server=on` (Log `without the server: no, areas answered by the core: …`).
- Startschranke: nichts wird zurückgehalten, `serverReady: true` → kein „L o a d i n g“, kein 2-s-Nachfragen, kein Neuladen nach `server-ready`, kein 60-s-Warten.
- WebSocket `/events` wird nicht verbunden (`websocket-provider.tsx`); Ereignisse des Kerns kommen weiter über seinen Verteiler (`server-events.ts`).

**Status ohne Server** (`core/start/without-server.ts`): Einstellungen, Aussehen, Nutzer vom Kern; Server-Teil = letzter aufgehobener Stand, sonst feste Werte eines nie eingerichteten Servers (Felder nach der Aufzeichnung `SETTINGS.GettingStarted`: nichts eingeschaltet, kein Torrent-Client, kein Bezahldienst, leerer Schlüssel). Ohne Konto mit Token: nachgestellter Nutzer `{ viewer: { name: "Guest" }, isSimulated: true }` (eigener Text). `startStatus`, `firstStart` und jedes Speichern der Einstellungen (`statusWithOwnSettings`) antworten so, ohne den Server zu fragen.

**Erststart** (leerer `core.db`): Status ohne Einstellungen → `MobileGettingStarted` → `POST /api/v1/start` (Kern) → Status mit Einstellungen und Gast → AniList-Anmeldung über den Kern (5a-3). Nicht mehr „L o a d i n g“. Am Gerät nicht durchgespielt (scratch hat Stand), nur in Tests.

**Sauber scheitern:** `askServer` (`requests.ts`) wirft ohne Server sofort denselben axios-Fehler wie der Server, Status 503, Text `<METHODE> <adresse> needs the server, the app runs without it` (`serverOffError`). Das gilt auch für Rückfragen des Kerns (`environment.server`). Die Hooks zeigen ihren vorhandenen Fehlerweg (Toast, „could not be loaded / Try again“). Betrifft u. a. Torrent/Debrid (Stufe 6), Nakama, Cast, Plugins, Discord (Stufe 7), filler, `manga/source-refresh`, custom-source, `anilist/cache-layer/status`, `extensions/list/development`.

**Direkte Server-Adressen** (`lib/server/without-server.ts`: `serverAddress`, `streamFileAddress`, `withoutServerError`):

| Stelle | ohne Server |
|---|---|
| `ws://…/events` | nicht verbunden |
| `lib/airing/anilist-public.ts` `fetch /api/v1/status` | Nutzer aus dem Status des Kerns (`buildSeaQuery`) |
| `lib/server/assets.ts` `/assets/` | leer (kein Bild); ganze Adressen bleiben |
| `mobile_offline.helpers.ts` alte Offline-Datei/-Bild | nur eigene `file://`-Dateien; Bild fällt auf die Online-Adresse zurück |
| `handle-manga-utils.ts` `manga/local-page`, `/manga-downloads/`, `image-proxy` | leer bzw. Bild direkt von der Quelle (Kopfzeilen über `getChapterPageHeaders`) |
| `player-screen.tsx` Untertitel-Pfade des Servers, Cast-Basis | ausgelassen; Cast ohne Basis (`castableStreamUrl` → null) |
| `episode-section.tsx` Stream-Adresse kopieren, `external-player-link.ts` | Toast mit „needs the server“ |
| `medialinks-phone.tsx` lokale Untertitel | keine |
| `use-save-server-file.ts` (Logs) | sofortiger Fehler, Aufrufer zeigt ihn |

Nicht angefasst: `onlinestream-page.tsx` (Basis nur für nicht-direkte Streams; mit `streams` an direkt), `native-player.tsx` (Ereignis kommt nur vom Server).

**Tests:** `core/start/without-server.test.ts` (alle Bereiche an, Erststart, erster Start speichert, Konto + aufgehobener Teil, Konto ohne Token), `lib/server/without-server.test.ts` (Link nur Test/scratch, sofortiges 503 ohne HTTP für Torrent/Debrid/Nakama/filler/custom-source, Adressen).

**Am Gerät** (Tablet, scratch, Build `e215a29`, 14.11. 09:40–09:44): `core?server=off`, Neustart per `install -r`. Danach kein `libseanime.so` als Kind von scratch, Port 43213 nicht offen. „Running main“ 09:40:57.66 → Status vom Kern 09:40:58.04 (212 ms) → Home-Sammlung 58.46 (316 ms); Home sichtbar ohne Hänger. Ablauf: Home ✓, Meine Listen ✓ (Test-Konto leer), Dr. STONE per Link mit Folgen und Bildern ✓, Online-Stream Folge 1 (Autoplay nächste Folge aus) ~5 s, dann `KEYCODE_MEDIA_PAUSE` (Player 0:05), Mini-Player über × geschlossen ✓, Manga-Seite ✓, Downloads ✓, Einstellungen „Hide spoilers“ an und zurück (`PATCH /api/v1/theme` vom Kern, 65/17 ms) ✓, Torrents → nach ≤2 s „The torrent list could not be loaded“ + Toast `GET /api/v1/torrent-client/list needs the server…` ✓. `core?server=on` → `areas answered by the core: none`, Server-Prozess wieder da, Port 43213 lauscht; AniList-Wächter vorher ok, `anilist-clear` danach: 0 Einträge.

**Offen:** Hintergrund-Abfragen ohne eigenen Bildschirm (`extensions/plugin-settings` auf der Anime-Seite, `manga/source-refresh`, `anilist/cache-layer/status` in den Einstellungen) zeigen ihren Fehler als Toast – sauber, aber laut. Erststart nur in Tests, nicht am Gerät.

### Phase 5c-2 (14.11.2026): Hintergrund-Abfragen still, Messung ohne gegen mit Server

**Still ohne Server** (`lib/server/without-server.ts` `onlyWithServer(enabled)`): Abfragen ohne eigenen Bildschirm werden ohne Server gar nicht gestellt (kein 503, kein Toast); mit Server unverändert. Sichtbare Seiten behalten ihren Fehlerweg (Torrent-Liste usw.), Knöpfe (z. B. Cache-only umschalten, Quellen-Auffrischen starten) zeigen beim Tippen weiter „needs the server“.

| Abfrage | wo | gefunden |
|---|---|---|
| `extensions/plugin-settings`, `extensions/list/development` | Plugin-Knopf (Anime-Seite, jede obere Leiste) | 5c-1 |
| `manga/source-refresh` | Home, Manga-Liste, Kapitel-Liste, Sync | 5c-1 |
| `anilist/cache-layer/status` | Einstellungen, alle 10 s | 5c-1 |
| `nakama/room/available` | Nakama-Verwalter, bei jedem Start | 5c-2, Tablet + S22 |
| `extensions/list/anime-entry-episode-tabs` | Einstellungen (Plugin-Tabs als Folgen-Quelle) | 5c-2, Tablet |

Die letzten zwei kamen erst beim Messen ans Licht, nach beiden Builds: im Code und Test, **am Gerät nicht belegt**. Im Lauf zeigten Home, Black Clover und Einstellungen am Tablet ohne Server sonst keine „Server error“-Zeile.

**Nutzer „Guest“:** bleibt. Die App zeigt den Namen eines nachgestellten Nutzers nirgends (alle Stellen prüfen `isSimulated`), einen eigenen Text für „nicht angemeldet“ als Namen gibt es nicht.

**Tests:** `lib/server/without-server.test.ts` („background queries without a screen of their own“): `onlyWithServer` mit/ohne Server, und je Abfrage, dass ihr Hook `enabled: onlyWithServer(…)` trägt.

**Messung:** §5 „Nach Stufe 5“. Am Ende beide Geräte `server=on`, `areas answered by the core: none`, Server-Prozess läuft (Tablet 10:04, S22 10:15).

### Phase 5c-3 (14.11.2026): Arbeitsspeicher am S22

**Prüf-Link** `core?memory=report` (nur Test/scratch, Commit `93dfa1f`): eine Log-Zeile `[Core] info memory: …` mit Hermes-Heap, gemerkten Antworten (Anzahl, Größe als JSON, größte Schlüssel), offenen Sandkästen und ob das Torrent-Modul geladen ist.

**Nachmessung** (§5 „Nach Stufe 5“, 3 Läufe je Seite, gleiche Methode): ohne Server App 288,4 ± 3,1 MB; mit Server App 271,1 ± 1,0 + Server 84,4 ± 5,9 = 355,5 ± 5,4 MB → **ohne Server −67 MB**. Die App allein braucht ohne Server +17 MB (Code/`.apk mmap` +8,4 = mehr vom JS-Bündel, Java Heap +7,4, Native Heap +4,7); `.so mmap` gleich, Torrent-Modul nicht geladen, keine Sandkästen offen → kein Modul, das sich später laden ließe. **Kein Code geändert.** Befund 5c-2 (+35 MB) richtiggestellt.

**Endstand S22:** `server=on`, Log `areas answered by the core: none`, `libseanime.so … --port 43212` läuft (14:35).

## 4q. Torrent (Stufe 6)

Ziel von Stufe 6: Torrent-Stream mit Springen ohne Server. Wie der Sandkasten (§4h „Das Modul …“) wird das ein **geteiltes C++-Modul hinter Nitro**, damit iOS später denselben Code nutzt.

### Phase 6a: Vorprüfung (14.11.2026, nur prüfen und messen)

Kein App-Code, kein App-Build, keine neue Abhängigkeit im Repo. Quellen und Bau lagen außerhalb des Repos.

**Kandidaten** (Stand 14.11.2026, Versionen und Daten aus den offiziellen GitHub-Repos):

| | libtorrent (arvidn), C++ | frostwire-jlibtorrent (Java/SWIG) | libtorrent4j (Java/SWIG) |
|---|---|---|---|
| Lizenz | BSD-3-Clause; in `LICENSE` außerdem Boost-Lizenz, zlib-artige und gemeinfreie Teile sowie **eine APSL-2.0-Datei** (`aux_/route.h`, wird nur für iOS eingebunden, siehe Fallen) | MIT (Hülle) + libtorrent + OpenSSL | MIT laut README (GitHub: „Other“) + libtorrent + OpenSSL |
| Version, Pflege | **2.1.2** und 2.0.15, beide 25.09.2026; Repo aktiv (Push 13.11.2026) | 2.1.2.1 (13.11.2026, libtorrent 2.1.2.0), sehr aktiv | 2.1.0-39 (07.02.2026, libtorrent-master-Stand), seitdem nichts |
| Abhängigkeiten | Boost **nur Kopfdateien** (Asio, System header-only ab 1.69); OpenSSL/GnuTLS **optional** (nur HTTPS-Tracker/-Webseeds und SSL-Torrents). Protokoll-Verschlüsselung (RC4) und SHA-1/SHA-256 eingebaut. 2.1: WebTorrent (libdatachannel) abschaltbar | alles eingebaut (OpenSSL, Boost, libc++ statisch); Java-API über SWIG | wie jlibtorrent |
| Größe arm64-v8a | **gemessen**: 2,68 MB gestrippt, ~1,06 MB gepackt (siehe Bautest) | **gemessen**: `libjlibtorrent.so` 17,4 MB (gestrippt 17,36 MB), Jar 6,2 MB | nicht gemessen (gleiche Bauart wie jlibtorrent, ähnliche Größe zu erwarten) |
| 16-KB-Seiten | ✅ gemessen (alle `LOAD` 0x4000, NDK 27 mit `-Wl,-z,max-page-size=16384`) | ✅ gemessen (alle `LOAD` 0x4000); Build prüft das laut README selbst | laut Release-Notes NDK r29 (Standard 16 KB), nicht gemessen |
| minSdk | frei wählbar, gebaut für **API 24** | ❌ `.so` für **API 26** gebaut (`NT_ANDROID_TYPE_IDENT` = 26, NDK r28c), App hat 24 | ❌ **API 28** ab 2.1.0-39 |
| iOS | ✅ C++/CMake, gleicher Quelltext | ❌ nur JVM (macOS-Jars sind Desktop-Java) | ❌ |
| Streaming | `sequential_download`, `set_piece_deadline` (+ `alert_when_available`), `file_priority`, `piece_priority`, `read_piece`, Resume-Daten | gleiche libtorrent-Funktionen über Java | dito |

**Bautest** (Windows, NDK 27.1.12297006 = NDK der App laut React Native, CMake 3.31.6 + Ninja aus dem Android-SDK, clang 18.0.2, Boost 1.92.0 nur Kopfdateien, `ANDROID_PLATFORM=android-24`, `ANDROID_STL=c++_shared`, `MinSizeRel`, `-ffunction-sections -fdata-sections`, `--gc-sections`):

| Variante | Ergebnis | `.so` gestrippt | gzip -9 | `LOAD`-Ausrichtung | NEEDED |
|---|---|---|---|---|---|
| libtorrent 2.0.15 als eigene `libtorrent-rasterbar.so` (alle Symbole sichtbar, ohne Verschlüsselung) | ✅ 167 Schritte in 24 s | 3,66 MB | 1,38 MB | 3 × 0x4000 | libc, libm, libdl, libc++_shared |
| 2.0.15 **statisch** in eine Probe-`.so` gelinkt, Sichtbarkeit `hidden`, `--exclude-libs,ALL`, Verschlüsselung an, Logging an | ✅ | **2,68 MB** | 1,06 MB | 3 × 0x4000 | dito |
| dito, Logging aus | ✅ | 2,55 MB | 1,00 MB | 3 × 0x4000 | dito |
| **2.1.2** statisch wie oben, Verschlüsselung an, Logging an, `webtorrent=OFF` | ✅ (nach Anpassung der Probe: `torrent_info::files()` gibt es in 2.1 nicht mehr) | **2,78 MB** | 1,10 MB | 3 × 0x4000 | dito |

Die Probe (`lt_probe`) ruft genau die Schnittstellen auf, die 6b braucht (Sitzung, Magnet lesen, Hinzufügen, `sequential_download`, `file_priority`, `set_piece_deadline`, `read_piece`, Status, Resume-Daten schreiben), damit der Linker sie behält. Alle Varianten **ohne OpenSSL**: `deprecated-functions=OFF`, `i2p=OFF`. Nur gebaut, nicht am Gerät geladen oder gelaufen.

**Nicht gemessen:** TLS. Ohne OpenSSL gehen HTTPS-Tracker, HTTPS-Webseeds und SSL-Torrents nicht; UDP-/HTTP-Tracker, DHT und Magnet-Links schon. Statisches OpenSSL bzw. BoringSSL (libcrypto + libssl) dazu geschätzt **+1–2 MB** gestrippt je ABI.

**Fallen (gefunden oder bekannt):**
- **minSdk**: beide Java-Hüllen verlangen mehr als API 24 (jlibtorrent 26, libtorrent4j 28) → Rückfall nur mit angehobenem minSdk.
- **Plattenzugriff**: 2.0 nutzt standardmäßig `mmap` (auf Android hohe RSS-Anzeige durch eingeblendete Dateien, Probleme bei fremden Speicherorten). 2.1 hat `pread_disk_io_constructor` und `posix_disk_io_constructor` → für das Handy `pread`. Speicherort muss ein echter Pfad sein (App-Ordner), kein SAF-`content://`.
- **libc++**: expo-mpv ersetzt beim Packen `libc++_shared.so` durch seine neuere Fassung. Ein gegen NDK 27 gebautes libtorrent läuft mit einer neueren libc++ (abwärtskompatibel), muss aber am Gerät belegt werden.
- **2.1 und WebTorrent**: Standard an, zieht libdatachannel + OpenSSL; das rekursive Klonen scheiterte unter Windows im Untermodul `deps/libdatachannel/deps/json`. Mit `-Dwebtorrent=OFF` unnötig.
- **Lizenz für iOS**: `aux_/route.h` (APSL 2.0) wird nur für iOS eingebunden (`TARGET_OS_IPHONE`, in `enum_net.cpp`); die App steht unter GPL-3.0, APSL 2.0 gilt laut FSF als GPL-unverträglich → vor dem iOS-Bau ersetzen (eigene Kopfdatei mit den wenigen Routing-Konstanten) oder klären. Android betrifft das nicht.
- **iOS allgemein**: Apple lässt BitTorrent-Clients im App Store in der Regel nicht zu; für Familien-Geräte (Plan §19) ohne Store kein Hindernis.
- **Boost-Größe**: Kopfdateien 187 MB entpackt → nicht ins Repo, sondern wie expo-mpv beim Bau holen (Release-Archiv mit festem SHA-256) oder mit `bcp` auf die nötigen Teile kürzen. Entscheidung in 6b.

**Empfehlung für 6b:** **libtorrent 2.1.2** (C++) als statische Bibliothek in einem eigenen Nitro-Modul `native/modules/core-torrent/` nach dem Muster von `core-sandbox`. Gründe: gleicher Quelltext für iOS, minSdk 24 bleibt, kleinste Größe (gemessen 2,78 MB statt 17,4 MB der Java-Hülle), `pread`-Plattenzugriff, alle Streaming-Funktionen direkt. **APK-Zuwachs** (die App packt `.so` gepackt, `useLegacyPackaging`): etwa **+1,1 MB je ABI** ohne TLS, mit TLS geschätzt **+1,5–2 MB**; installiert ~2,8 MB bzw. ~4–5 MB je ABI. Rückfall jlibtorrent nur, wenn der C++-Weg scheitert (dann minSdk 26, ~+6 MB APK, kein iOS). **Risiken:** TLS-Bau (OpenSSL für Android/iOS), Boost im Bau holen, libc++-Tausch durch expo-mpv, Hintergrund (Doze, langer Download braucht den Vordergrund-Dienst aus 4b), Speicher am S22.

**Schnittstelle (Skizze, Nitro-HybridObject, C++):**

| Gruppe | Funktionen |
|---|---|
| Sitzung | `start(settings)` (Speicher-Ordner, Ports, Limits, Plattenzugriff `pread`), `stop()`, Resume-Daten speichern und beim Start laden |
| Hinzufügen | `addMagnet(uri, savePath) → infoHash`, `addTorrentFile(bytes, savePath) → infoHash`, `remove(infoHash, deleteFiles)`; Metadaten-Ereignis, sobald ein Magnet seine Dateiliste hat |
| Dateien | `files(infoHash) → [{index, path, size, pieceStart, pieceEnd}]`, `setFilePriority(infoHash, index, 0..7)` (alle anderen auf 0 für Streaming) |
| Streaming | `setSequential(infoHash, on)`, `setPieceDeadlines(infoHash, firstPiece, count, msBase)`, `clearDeadlines(infoHash)`; der Ausgang setzt die Fristen selbst beim Springen |
| Fortschritt | `status(infoHash) → {state, progress, downRate, upRate, peers, seeds, piecesHave}` und gebündelte Ereignisse (1×/s) über den Ereignis-Verteiler |
| Ausgang | `serve(infoHash, fileIndex) → "http://127.0.0.1:PORT/t/<hash>/<index>"`: kleiner HTTP-Server auf Boost.Asio (schon in libtorrent, keine weitere Abhängigkeit), nur Loopback, zufälliger Token im Pfad; `GET`/`HEAD` mit `Range` → `206`, `Content-Length`, `Accept-Ranges: bytes`; liest Stücke per `read_piece` bzw. aus der Datei, wartet blockierend mit Zeitgrenze auf fehlende Stücke und setzt für den angefragten Bereich die Fristen (nächste ~5–10 Stücke eng). mpv spielt diese Adresse |

Kotlin/Swift bleiben dünn (nur die von Nitro erzeugte Lade-Klasse); der Faden des Moduls ist der Alert-Faden von libtorrent plus ein Asio-Faden für den Ausgang.

### Phase 6b-1: natives Torrent-Modul (14.11.2026)

Das Modul aus der Empfehlung von 6a steht, baut im normalen App-Build und ist am S22 gelaufen. **Noch nicht drin:** der lokale HTTP-Ausgang für mpv und die Anbindung an die Torrent-Stream-Schnittstellen der App (6b-2), Suche und Debrid (6c). Nichts in der App benutzt das Modul außer dem Prüf-Link; am Aussehen ändert sich nichts.

**Aufbau** (`native/modules/core-torrent/`, Muster `core-sandbox`):

| Teil | Ort | Inhalt |
|---|---|---|
| Sitzung | `cpp/TorrentCore.hpp/.cpp` | plattformneutral: nur C++-Standardbibliothek und libtorrent; weiß nichts von React Native, Android oder iOS |
| Anbindung | `cpp/HybridCoreTorrent.hpp` | das Nitro-HybridObject `CoreTorrent` (C++), dünn: prüft Zahlen, reicht Arbeit an den Faden der Sitzung, löst Promises |
| Spezifikation | `src/CoreTorrent.nitro.ts` → `nitrogen/generated/` | TypeScript-Spezifikation mit drei Datensätzen (Einstellungen, Datei, Status); erzeugter Code eingecheckt, neu erzeugen im Modul-Ordner mit `npx nitrogen@0.37.2` |
| Bau | `android/CMakeLists.txt`, `cmake/fetch-deps.cmake`, `android/build.gradle` | libtorrent als statische Bibliothek in `libSeanimeCoreTorrent.so`; `-Os`, `--gc-sections`, `--exclude-libs,ALL`, `-Wl,-z,max-page-size=16384` |
| Laden | `android/src/main/…/SeanimeCoreTorrentPackage.java`, `cpp-adapter.cpp` | einziger Java-Code: die Lade-Klasse; kein eigenes Kotlin |
| Hülle | `native/src/api/client/core-torrent.ts` | Typen und dünne Hülle (`createTorrentClient`, `deviceTorrent`): Ordner als reiner Pfad, Info-Hash und Zahlen geprüft, Status gelesen, `ERR_TORRENT: …` → `TorrentError`; das Modul wird erst beim ersten Gebrauch geladen |
| Prüfung | `native/src/api/client/core-torrent-selftest.ts`, Link in `lib/app-links.ts` | Prüf-Link, nur Test- und scratch-App |

Lizenztexte: `licenses/libtorrent-LICENSE.txt`, `licenses/boost-LICENSE.txt`.

**Bauweg und Cache.** libtorrent und Boost liegen **nicht** im Repo. `cmake/fetch-deps.cmake` läuft im Konfigurations-Schritt von CMake (also im normalen `build-android.ps1`, je ABI) und holt zwei offizielle Release-Archive mit fester Version und SHA-256:

| Was | Quelle | SHA-256 |
|---|---|---|
| libtorrent 2.1.2 | `github.com/arvidn/libtorrent/releases/download/v2.1.2/libtorrent-rasterbar-2.1.2.tar.gz` (6,7 MB) | `3362546d…0334dbc` (gleich dem `digest` der Release-Seite) |
| Boost 1.92.0, davon nur `boost/` und die Lizenz | `archives.boost.io/release/1.92.0/source/boost_1_92_0.tar.gz` (235 MB) | `c4a3b310…fd296ce` (gleich der `.json` neben dem Archiv) |

Ziel ist `<GRADLE_USER_HOME oder ~/.gradle>/caches/seanime-core-torrent/` – außerhalb des Repos, neben dem übrigen Gradle-Cache. Je Archiv: laden (`file(DOWNLOAD … EXPECTED_HASH)`), entpacken, Marke `<Ordner>.sha256` schreiben, Archiv löschen. Steht die Marke mit der erwarteten Prüfsumme und der entpackte Baum ist da, kehrt das Skript zurück, **bevor** es das Netz anfasst: ein Bau mit gefülltem Cache braucht kein Netz. Ohne Netz und ohne Cache nennt die Fehlermeldung den Ort, an den das Archiv gelegt werden kann (die Prüfsumme wird trotzdem geprüft). Eine Sperre (`file(LOCK)`) hält zwei Konfigurations-Schritte auseinander. Gefüllt ist der Cache 214 MB groß; das Füllen dauerte 8 s. Warum so und nicht mit `bcp` gekürzt: ein Skript, keine weitere Abhängigkeit, keine selbst gepflegte Liste von Boost-Teilen; der Preis sind 214 MB Platte auf der Bau-Maschine.

Gemessen bzw. nicht gemessen: Das Laden über das Skript ist für libtorrent gelaufen. Das Boost-Archiv lag aus 6a schon auf der Platte und wurde in den Cache gelegt; das Skript hat nur seine Prüfsumme geprüft und entpackt – der 235-MB-Download selbst lief also nicht über das Skript. Der zweite App-Build lief mit gefülltem Cache; mit getrenntem Netz ist er nicht geprüft.

Falle: `file(LOCK … GUARD FILE)` lässt CMake 3.31.6 im Skript-Modus (`cmake -P`) abstürzen; die Sperre wird deshalb am Ende ausdrücklich gelöst.

Schalter von libtorrent: statisch, `webtorrent=OFF`, `deprecated-functions=OFF`, `i2p=OFF`, Protokoll-Verschlüsselung an, Logging an, Sichtbarkeit `hidden` nur für libtorrent (der eigene Code behält die Sichtbarkeit, die Nitros Typen brauchen). **TLS: bewusst noch ohne** (kein OpenSSL gefunden, keins gebaut): HTTPS-Tracker, HTTPS-Webseeds und SSL-Torrents gehen nicht; UDP-/HTTP-Tracker, DHT, Magnet-Links und Peers gehen. Plattenzugriff `pread_disk_io_constructor`.

**Schnittstelle** (alle Aufrufe antworten als Promise vom Faden der Sitzung; Fehler `ERR_TORRENT: <Text>`):

| Gruppe | Funktionen |
|---|---|
| Sitzung | `start(settings, onStatus)`: eigener Ordner im App-Speicher (`<Dokumente>/core-torrent/`: `session.state`, `resume/<hash>.resume`), Port, Verbindungs-Grenze; bringt die Torrents der letzten Sitzung aus ihren Resume-Daten zurück. `stop()`: Resume-Daten und Zustand sichern (wartet höchstens 5 s), Sitzung beenden |
| Einstellungen für Tests | `dht`, `lsd`, `trackers`, `pex`, `portMapping` (UPnP/NAT-PMP), `utp` einzeln abschaltbar. `trackers` aus: die Tracker eines Torrents werden beim Hinzufügen verworfen |
| Hinzufügen | `addMagnet(uri, savePath) → infoHash`, `addTorrentFile(bytes, savePath) → infoHash` (ein schon vorhandener Torrent antwortet mit seinem Hash), `remove(infoHash, deleteFiles)` – mit Dateien kommt die Antwort erst, wenn sie gelöscht sind |
| Dateien | `files(infoHash) → [{index, path, size, offset, pieceStart, pieceEnd}]` (ohne Füll-Dateien), `setFilePriority(infoHash, index, 0..7)` |
| Streaming | `setSequential(infoHash, on)`, `setPieceDeadlines(infoHash, firstPiece, count, firstMs, stepMs)` (Stück `first + n` innerhalb `firstMs + n·stepMs`), `clearDeadlines(infoHash)` |
| Fortschritt | `status(infoHash)` und einmal pro Sekunde `onStatus([…])` mit jedem Torrent: `{infoHash, name, state, error, hasMetadata, progress, downRate, upRate, peers, seeds, piecesHave, pieces, bytesDone, bytesWanted}`; `state` ist `checking`, `metadata`, `downloading`, `finished`, `seeding` oder `paused` |
| Peer direkt | `connectPeer(infoHash, host, port)`: IP-Adresse, an jeder Peer-Suche vorbei |

Abweichung von der Skizze aus 6a: `setPieceDeadlines` hat einen Schritt (`stepMs`) dazu; das Status-Ereignis kommt als Rückruf von `start`, noch nicht über den Ereignis-Verteiler des Kerns (kommt mit dem Bereich in 6b-2).

**Faden-Modell.** Das Modul hat **einen eigenen Faden** (`TorrentCore::loop`), angelegt mit dem HybridObject. Er arbeitet die Aufrufe der Reihe nach ab, liest die Alerts von libtorrent (libtorrents Faden weckt ihn nur) und schickt jede Sekunde den Status. Dahinter laufen libtorrents eigene Fäden (Netz, Platte). Jede Methode legt auf dem Faden der App nur eine Aufgabe in die Schlange und kehrt zurück; die Bytes einer `.torrent`-Datei werden dabei einmal kopiert (wenige KB). Auch die Aufrufe von libtorrent, die auf dessen Netz-Faden warten (`add_torrent`, `status`, `torrent_file`), laufen so nie im Faden der App. Ohne Sitzung schläft der Faden. Verschwindet das HybridObject (Neuladen des JavaScript), beendet der Faden die Sitzung selbst; niemand wartet darauf.

Resume-Daten werden geschrieben, wenn die Metadaten eines Magnets da sind, wenn ein Torrent fertig ist, alle 30 s für geänderte Torrents und beim Stoppen; jeweils neben die Datei und dann darübergeschoben. Ein entfernter Torrent bekommt keine mehr.

**Prüfquelle** (eigene Daten, kein öffentlicher Torrent, kein öffentlicher Schwarm; alles außerhalb des Repos): 50 MB Zufallsdaten, dazu eine selbst gebaute `.torrent`-Datei (bencode, 200 Stücke zu 256 KB, SHA-1 je Stück, kein Tracker) und ein eigener Seeder als Node-Skript (BEP 3: Handshake, bitfield, interested → unchoke, request → piece; nur TCP, nur `127.0.0.1`), ans Gerät per `adb reverse`. Der Seeder ist vorab von einem zweiten Skript wie von einem Peer abgefragt worden (erstes und letztes Stück gegen die SHA-1 der `.torrent`-Datei).

**Prüf-Link** (nur Test- und scratch-App): `core?torrent=selftest&file=<.torrent als base64url>&peer=<IP>:<Port>&sha256=<hex>[&size=<Bytes>]`. Ablauf: Sitzung mit DHT, LSD, Trackern, PEX, Port-Freigabe und uTP **aus** starten → `.torrent` hinzufügen → Dateien lesen, Priorität 7, sequenziell, Fristen für die ersten 4 Stücke → den einen Peer verbinden → auf `finished`/`seeding` warten → Größe und SHA-256 der Datei prüfen (SHA-256 rechnet das Modul `core-download`) → Sitzung stoppen und neu starten (der Torrent muss vollständig aus den Resume-Daten zurückkommen) → mit Dateien entfernen (Datei muss weg sein) → den Magnet-Link desselben Torrents hinzufügen (Hash gleich, Zustand `metadata`) und entfernen → Sitzung stoppen. Ergebnis im App-Log (`[CoreTorrent]`), nur Zahlen. Der Magnet-Weg ist damit nur bis „hinzugefügt, wartet auf Metadaten“ belegt; Metadaten von Peers holen (BEP 9) kann der Test-Seeder nicht.

**Messwerte (S22, Android 16, Test-App, Nutzer 0, 14.11.2026, Uhr des Geräts):**

| | Build 1 (`6493a53`), uTP an, 10:56–10:58, 2 Läufe | Build 2 (`233ee18`), uTP im Test aus, 11:06–11:08, 5 Läufe |
|---|---|---|
| Ergebnis | 2 × ok | 5 × ok |
| Größe, SHA-256 | 52 428 800 Bytes, gleich | 52 428 800 Bytes, gleich |
| Vom Hinzufügen bis zur TCP-Verbindung (Log des Seeders) | ~4,4 s | 0,4–0,5 s |
| „geladen“ in der App (ab `connectPeer` bis zum Status `finished`; der Status kommt nur 1×/s) | 5,8 s / 6,0 s | 2,8 / 2,0 / 2,0 / 2,0 / 2,0 s |
| Übertragung selbst (Seeder: erste Anfrage bis Ende) | 1,4 s ≈ 37 MB/s | 1,4–1,5 s ≈ 35–37 MB/s |
| Höchste `downRate` im Status (libtorrent glättet über Sekunden) | 7,5–7,6 MB/s | 6,7–9,1 MB/s |
| Reihenfolge (Seeder: Anfragen für dasselbe oder ein späteres Stück als die vorige) | 3100–3105 von 3200 | 3094–3101 von 3200 |
| Status-Ereignisse | 6 je Lauf, 999–1001 ms auseinander | 2–3 je Lauf, 999–1003 ms |
| Neustart: zurück aus Resume-Daten | `seeding`, 200/200 nach 920–936 ms | `seeding`, 200/200 nach 858–927 ms |
| Entfernen mit Dateien / Magnet | Datei weg / Hash gleich, `metadata` | Datei weg / Hash gleich, `metadata` |
| Wächter: längstes Stück des Tests im Faden der App (je 20 Stücke, Grenze 8 ms) | 4,8 ms / 4,8 ms, 0 darüber | 12,2 / 15,5 / 16,3 / 3,4 / 4,7 ms; darüber 2 / 1 / 1 / 0 / 0 |
| 2-ms-Zeitgeber der App höchstens verspätet (in Klammern: 2 s Leerlauf davor) | 91,9 (111,7) / 14,9 (27,2) ms | 84,4 (131,2) / 17,2 (33,6) / 17,2 (28,0) / 10,1 (29,8) / 15,6 (29,8) ms |
| Abstürze (`logcat` nach `FATAL`/`tombstone` gefiltert), Lade-Fehler (`UnsatisfiedLinkError`, `dlopen failed`) | 0 / 0, gleicher Prozess über beide Läufe | 0 / 0, gleicher Prozess über alle fünf Läufe |

Befunde:
- **uTP zuerst.** Mit uTP an vergingen ~4,4 s, bis die TCP-Verbindung zum Seeder stand; mit `utp: false` 0,4–0,5 s. libtorrent versucht einen direkt genannten Peer also zuerst über uTP und fällt erst nach dessen Zeitgrenze auf TCP zurück; der Test-Seeder spricht nur TCP. Der Schalter `utp` ist deshalb dazugekommen und im Prüf-Link aus. Für echte Schwärme (die meisten Peers sprechen uTP) bleibt uTP an; ob das beim Start eines Streams stört, zeigt 6b-2.
- **8-ms-Wächter: nicht durchgehend gehalten.** In 4 von 7 Läufen blieb jedes Stück unter 8 ms, in 3 Läufen von Build 2 lagen ein bis zwei Stücke bei 12–16 ms. Gemessen wird das eigene JavaScript des Tests zwischen zwei Wartestellen; **welches** Stück es war, schreibt der Test nicht ins Log. Nicht belegt, nur Vermutung: die synchronen Datei-Abfragen von `expo-file-system` im Test (`exists`, `size`, Ordner löschen), während die Platte noch 50 MB wegschreibt, oder das erste Laden der Bibliothek. Die Aufrufe des Moduls selbst kehren sofort zurück (Aufgabe in die Schlange). Offen für 6b-2: Ort der Stücke über 8 ms ins Log (`from → until` des Wächters) und beheben.
- **`libc++_shared.so`.** Die APK enthält die von expo-mpv eingesetzte Fassung (arm64 1 374 336 Bytes; die des NDK 27.1 hätte 1 794 776). Das gegen NDK 27.1 gebaute Modul lädt und läuft damit: 7 Läufe, kein Lade-Fehler, kein Absturz. Der Player-Bildschirm wurde nicht geöffnet und nichts abgespielt (Auftrag: nur App-Start und Prüf-Link); dass mpv neben dem Modul spielt, belegt erst 6b-2.

**Größe und 16-KB-Seiten** (APK von Build 2, `llvm-readelf -l` an den Dateien aus der APK):

| | arm64-v8a | armeabi-v7a |
|---|---|---|
| `libSeanimeCoreTorrent.so` in der APK | 3 777 960 Bytes, gepackt 1 314 698 | 2 499 740 Bytes, gepackt 1 172 597 |
| `LOAD`-Ausrichtung | 3 × 0x4000 | 3 × 0x4000 |
| NEEDED | libfbjni, libjsi, libNitroModules, libreactnative, libdl, libm, libc++_shared, libc | dito |

APK der Test-App: vorher 112 381 459 Bytes, nachher **114 907 537 Bytes** (+2 526 078 Bytes, +2,41 MiB für beide ABIs). Die Probe aus 6a hatte 2,78 MB für arm64; das Modul ist mit 3,78 MB größer, weil es mehr von libtorrent benutzt (Sitzungs-Zustand, Resume-Daten lesen, `.torrent` laden) und die Nitro-Anbindung enthält. Bauzeit des ganzen App-Builds 5 min 52 s (erster Bau von libtorrent für beide ABIs inbegriffen) und 5 min 49 s; libtorrent plus Modul allein für arm64 26 s.

**iOS:** ungebaut, und anders als beim Sandkasten gibt es **noch kein podspec** (`react-native.config.js` nennt nur Android, damit ein iOS-Build das Modul nicht halb einbindet). `cpp/` und `cmake/fetch-deps.cmake` sind plattformneutral; der von Nitrogen erzeugte iOS-Code liegt da. Vor dem iOS-Bau zu klären: `aux_/route.h` von libtorrent steht unter **APSL 2.0** und wird nur für iOS eingebunden (`enum_net.cpp`, `TARGET_OS_IPHONE`); die App steht unter GPL-3.0 → Datei durch eine eigene Kopfdatei mit den wenigen Routing-Konstanten ersetzen oder die Verträglichkeit klären (§4q „Fallen“). Android betrifft das nicht.

**Offen für 6b-2:** lokaler HTTP-Ausgang mit Range für mpv (eigener Asio-Faden, Fristen beim Springen), Bereich `torrent` im Kern mit Schalter und Ereignis-Verteiler, Anbindung an die Torrent-Stream-Schnittstellen der App; Ort und Behebung der Stücke über 8 ms; echte Magnet-Links (Metadaten von Peers), DHT und Tracker am Gerät; TLS (HTTPS-Tracker); langer Download im Hintergrund (Doze, Vordergrund-Dienst aus 4b); Speicher am S22; Start-Verzögerung durch uTP-zuerst bei TCP-Peers; mpv neben dem Modul.

**Testweg:** `core-torrent.test.ts` (Hülle mit einem eingesetzten Modul: Vorgaben, Pfade, Info-Hash, Bytes, Fehler; Form und Verteilung der Status-Ereignisse; Prüf-Link nur in Test- und scratch-App). Am Gerät: Prüf-Link wie oben.

### Phase 6b-2: Torrent-Stream im Kern (14.11.2026)

Drei Teile: der lokale HTTP-Ausgang im Modul, der Bereich `torrent` im Kern (Schalter, Standard aus) und die Stücke über 8 ms aus 6b-1. **Nicht drin:** Torrent-Suche über Erweiterungen, Magnet beim Anbieter erfragen, Debrid (6c). Am Aussehen der App ändert sich nichts. Am Gerät wurde **nichts abgespielt**: der Ausgang ist über den Prüf-Link aus der App heraus abgefragt worden, die Übergabe an den Player (`watch`) ist nur unter vitest belegt.

**Ausgang** (`native/modules/core-torrent/cpp/StreamServer.hpp/.cpp`, Sitzungs-Seite `cpp/TorrentServe.cpp`; Boost.Asio aus den schon vorhandenen Boost-Kopfdateien, keine neue Abhängigkeit):

| | |
|---|---|
| Adresse | `serve(infoHash, fileIndex)` → `http://127.0.0.1:<Port>/<Token>/<Info-Hash>/<Datei-Index>/<Dateiname>`. Nur `127.0.0.1`, Port vom System gewählt, Token aus 32 Hex-Zeichen (`std::random_device`), neu mit jeder Sitzung. Falscher Token oder unbekannte Datei: 404 |
| Anfragen | `GET` und `HEAD` (sonst 405), HTTP/1.1, eine Anfrage je Verbindung (`Connection: close`). `Range` nach RFC 7233: `a-b`, `a-`, `-n` → 206 mit `Content-Range` und `Content-Length`; Bereich hinter dem Dateiende → 416 mit `Content-Range: bytes */<Größe>`; mehrere Bereiche, fremde Einheit oder Unlesbares → die Kopfzeile wird übergangen (200, ganze Datei). Immer `Accept-Ranges: bytes`, `Content-Type` nach der Endung |
| Bytes | Stück für Stück über libtorrent (`read_piece` → `read_piece_alert`), nie direkt aus der Datei: so stimmt auch, was libtorrent noch nicht auf die Platte geschrieben hat. Ein Stück liegt dabei ganz im Speicher (je Leser eines) |
| Warten | Ein Stück, das noch fehlt, bekommt die Frist „jetzt“ mit Übergabe bei Ankunft (`set_piece_deadline(…, alert_when_available)`); die Antwort-Kopfzeilen gehen sofort raus, der Körper wartet. Nach 90 s ohne das Stück wird der Leser getrennt |
| Sprung | Hinter dem gelesenen Stück bekommen die nächsten 8 MiB (4–32 Stücke) gestaffelte Fristen (250 ms je Stück). Ein Leser, der mitten in der Datei beginnt, zieht den Download also dorthin. Geht ein Leser, werden seine Fristen zurückgenommen (`reset_piece_deadline`), außer ein anderer Leser will dieselben Stücke |
| Abbruch | Schließt der Leser seine Seite, endet die Verbindung sofort, auch während sie auf ein Stück wartet. Beim Schreiben gibt es keine Zeitgrenze (ein Player mit vollem Puffer liest minutenlang nichts) |
| Mehrere Leser | bis 32 gleichzeitig; wartet mehr als einer auf dasselbe Stück, wird es einmal gelesen und an alle gegeben |
| Ende | Mit `remove` werden die Leser des Torrents getrennt, mit `stop` der Ausgang beendet |

Faden-Modell: Der Ausgang hat **einen eigenen Faden** (Asio), der alle Verbindungen trägt und nie wartet. Was er von der Sitzung braucht (Stück gewünscht, Leser weg), legt er in die Schlange des Sitzungs-Fadens; die Antwort kommt als Aufgabe zurück. Der Faden der App ist an keiner Anfrage beteiligt; `serve` ist ein Aufruf wie die anderen (Promise vom Sitzungs-Faden). Falle in libtorrent: Wird die Frist eines Stücks neu gesetzt, ersetzt das auch den Wunsch nach Übergabe; `setPieceDeadlines` lässt deshalb Stücke aus, auf die ein Leser wartet, und nach `clearDeadlines` werden sie neu angemeldet.

**Bereich `torrent`** (`native/src/core/torrent/torrent.ts`, Geräte-Seite `torrentDeviceFor` in `native/src/api/client/core-torrent.ts`, Tabelle `torrent_kept`, Schema-Schritt 19):

| Schnittstelle | Im Kern |
|---|---|
| `POST /api/v1/torrentstream/start` | Magnet aus `torrent.magnetLink`, sonst aus `torrent.infoHash` gebaut → hinzufügen → auf die Dateiliste warten (höchstens 60 s) → Datei wählen → alle anderen Dateien Priorität 0, die gewählte 7, sequenziell, Fristen für die ersten 6 und die letzten 2 Stücke (Index einer MP4, Cues einer MKV) → `serve` → Adresse an den Player der App als `native-player` „watch“ (`streamType: "torrent"`, `streamUrl` = Ausgang, wie eine lokale Datei in 5b-1). Währenddessen `open-and-await` mit eigenen Worten, bei Fehler `abort-open`. `playbackType` `none`/`noneAndAwait` und `preload` bereiten nur vor. Ein Stream zur Zeit: ein neuer entfernt den alten samt Dateien |
| Datei-Wahl | `fileIndex` der App; sonst die einzige Videodatei; sonst die Videodatei, deren Name die Folge nennt (eigener Parser `$habari` über `readName`), Folge vor Extra, größere Datei vor kleinerer; passt keine: 404 |
| `POST …/torrentstream/stop` | Torrent samt Geladenem entfernen, Sitzung beenden → `true` |
| `POST …/torrentstream/torrent-file-previews` | Torrent nur für seine Dateiliste hinzufügen (alle Dateien Priorität 0, nichts wird geladen) → Videodateien in der Form `Torrentstream_FilePreview` |
| `POST …/torrentstream/batch-history`, `…/batch-history/delete` | je Anime der Batch, aus dem zuletzt gestreamt wurde (gemerkt, wenn der Torrent mehr als eine Videodatei hat); ohne Eintrag die aufgezeichnete Form mit drei `null` |
| `PATCH …/torrentstream/settings` | bleibt im Bereich `settings` eingetragen: mit `torrent` an speichert der Kern (aufgezeichnete Form, `id` 1), sonst wie bisher der Server. `GET /status` trägt die eigenen Einstellungen ein, sobald welche gespeichert sind |
| Ereignis `torrentstream-state` | 1×/s, solange ein Stream läuft: `{ state, status }` mit den Feldern von `Torrentstream_TorrentStatus`. **Eigene Form:** die App hat dafür keinen Hörer, eine Nachricht dieser Art ist nicht aufgezeichnet |

Abweichungen und Grenzen: `autoSelect` ohne Torrent und Torrents ohne Magnet und Info-Hash antworten mit einem Fehler, der 6c nennt; `externalPlayerLink` wird abgelehnt (der Ausgang ist nur am Gerät erreichbar). `StartStream` und `StopStream` waren nur als Form aufgezeichnet, nicht als Antwort. Die Stream-Dateien liegen im Cache der App (`core-torrent-streams`), der Sitzungs-Zustand unter den Dokumenten. Die Einstellungen des Servers (`downloadDir`, Ports, `slowSeeding`, …) werden gespeichert, wirken im Kern aber noch nicht.

**Prüf-Link** (nur Test- und scratch-App): `core?torrent=stream-check&file=<.torrent als base64url>&peer=<IP>:<Port>&size=<Bytes>&parts=<erstes>-<letztes>.<SHA-256>,…` (vier Teile: Anfang, Sprung, Ende, ein weiterer) `[&media=<AniList-ID>]`. Ablauf, alles aus der App selbst über `expo/fetch`, jede Peer-Suche aus: `.torrent` hinzufügen, Datei freigeben → `HEAD`, falscher Token → Peer verbinden → Anfang → Sprung → zwei Leser gleichzeitig (Ende als „die letzten n Bytes“ und ein weiterer Teil) → ein Leser, der nach den ersten Bytes abbricht → danach noch einmal der Anfang → Bereich hinter dem Dateiende. Jeder Teil wird per SHA-256 (`expo-crypto`) mit dem Wert aus dem Link verglichen. Mit dem Bereich `torrent` an danach: `start` mit `playbackType: "none"` für denselben Torrent, die Adresse einmal abfragen, `batch-history`, `stop`.

**Prüfquelle:** eigene MP4 mit Testbild (ffmpeg `testsrc2` mit Rauschen, 120 s, 45 093 472 Bytes, 173 Stücke zu 256 KB), eigene `.torrent`-Datei ohne Tracker, eigener Node-Seeder (BEP 3, nur `127.0.0.1`, über `adb reverse`), auf 12 MB/s gebremst, damit der Sprung vor dem Ende des Downloads liegt. Alles außerhalb des Repos; kein öffentlicher Torrent, kein Schwarm.

**Messwerte (S22, Android 16, Test-App, Nutzer 0, 14.11.2026, Uhr des Geräts):**

| | Build 1 (`1f6b7b2`), 11:44–11:45 | Build 2 (`be19d5a`), 11:55–11:56 |
|---|---|---|
| Selbsttest aus 6b-1, 3 Läufe | geladen 173/173, dann am Datei-Vergleich gescheitert (Dateiname mit eckigen Klammern, vom `File`-Objekt abgelehnt) | 3 × ok: 45 093 472 Bytes, SHA-256 gleich, Neustart aus Resume-Daten nach 912–943 ms |
| Wächter im Selbsttest (Grenze 8 ms) | 10,0 / 4,3 / 11,4 ms; die zwei Stücke darüber beide `download → end` | 3,3 / 3,8 / 4,1 ms von je 23 Stücken, **0 darüber** |
| `stream-check` | gescheitert: das Modul gab einen Token mit 64 statt 32 Hex-Zeichen, die Hülle lehnte die Adresse ab | **ok** |
| `HEAD` / falscher Token | – | 200, Länge gleich der Dateigröße / 404 |
| Anfang (1 MiB ab 0) | – | 206, `Content-Range` richtig, SHA-256 gleich; erstes Byte nach 1007 ms (davon die Verbindung zum Peer), alles nach 3243 ms; Stücke davor 0/173 |
| Sprung (1 MiB ab 70 %) | – | 206, `Content-Range` richtig, SHA-256 gleich; **erstes Byte nach 538 ms**, alles nach 876 ms; Stücke davor 126/173 |
| 2 Leser gleichzeitig | – | Ende (als `bytes=-1048576`): 206, gleich, erstes Byte 14 ms; Teil ab 40 %: 206, gleich, erstes Byte 7 ms |
| Abbruch | – | 206, 7994 Bytes gelesen, dann getrennt; danach derselbe Anfang wieder 206 und gleich (15 ms) |
| Hinter dem Dateiende | – | 416, `Content-Range: bytes */45093472` |
| Bereich `torrent` | – | `start`, `batch-history`, `stop` vom Kern beantwortet („answered by the core, no HTTP“, 7 / 5 / 21 ms); Stream der Datei 0 vorbereitet, Adresse antwortet 206; danach läuft keiner |
| Anfragen an den Server für Torrent-Stream | – | **0** (im Log des Servers nur „Module is disabled“ beim Start) |
| Wächter im `stream-check` | – | 1 von 694 Stücken über 8 ms: 9,7 ms `body → body`, also beim Lesen der Antwort-Körper im JavaScript des Tests |
| Abstürze (`FATAL`, `tombstone`), Lade-Fehler der App | 0 / 0 | 0 / 0 (eine `dlopen failed`-Zeile im Zeitraum gehört zu einer fremden App) |

Was die Zahlen nicht sagen: Mit einem einzigen, gebremsten Peer hängt die Zeit bis zum ersten Byte an dessen Warteschlange (er antwortet in der Reihenfolge der Anfragen); der Anfang brauchte so 3,2 s für 1 MiB. Ein echter Schwarm ist nicht gemessen, ebenso wenig große Stücke (4–16 MB), mehrere Dateien am Gerät, Speicher, IPv6. Beim Sprung waren schon 126 von 173 Stücken da; das angefragte fehlte noch (538 ms Wartezeit).

**8 ms aus 6b-1: Ort und Behebung.** Der Selbsttest schreibt jetzt zu jedem Stück über der Grenze, nach welcher Wartestelle es begann und an welcher es endete. Build 1: beide Stücke über 8 ms (10,0 und 11,4 ms) lagen in `download → end`, dem Abschnitt direkt nach dem Download, in dem der Test die geladene Datei über das `File`-Objekt von `expo-file-system` ansprach (`new File`, `exists`, `size`) – Aufrufe, die im Faden der App laufen (gleicher Befund wie in 5b-1 bei `Directory.list()`). In Build 1 endete dieser Abschnitt mit dem Fehler am Dateinamen, der Vergleich mit 6b-1 ist also nicht ganz derselbe Ablauf. Behebung: der Test fragt Datei und Ordner über die asynchronen Funktionen von `expo-file-system/legacy` (`getInfoAsync`, `deleteAsync`), die für den Wächter Wartestellen sind, und kodiert den Pfad. Build 2: 0 Stücke über 8 ms in 3 Läufen. Hülle und Status-Ereignisse des Moduls waren nicht die Ursache; die App selbst benutzt das `File`-Objekt in diesem Weg nicht.

**Größe:** APK der Test-App vorher 114 907 537 Bytes, nachher **115 125 609 Bytes** (+218 072 Bytes für beide ABIs; Build 1: 115 121 389).

**Offen für 6c und danach:** Torrent-Suche über Erweiterungen und `autoSelect`, Magnet beim Anbieter erfragen, Debrid; Wiedergabe in mpv über den Ausgang am Gerät (hier bewusst nicht gespielt) samt Stoppen des Streams beim Schließen des Players; echte Magnet-Links (Metadaten von Peers), DHT, Tracker, TLS; die gespeicherten Einstellungen im Kern wirksam machen; nächste Folge vorladen; langer Download im Hintergrund; Speicher bei großen Stücken; der Schalter `torrent` ist in keiner Oberfläche.

**Testweg:** `core/torrent/torrent.test.ts` (Schalter, Einstellungen und Batch-Verlauf gegen die Form der Aufzeichnung, Datei-Wahl, Ablauf eines Streams mit einem eingesetzten Gerät, Ereignisse, Fehler, Datei-Vorschau), `core-torrent.test.ts` (`serve` in der Hülle, Form der Ausgangs-Adresse, Prüf-Link `stream-check`). Der C++-Teil hat keine eigenen Tests; er ist außerhalb von Gradle gegen das NDK übersetzt und am Gerät über den Prüf-Link belegt.

### Phase 6c-1: Torrent-Suche und Auto-Auswahl (14.11.2026)

Drei Teile, alle im Bereich `torrent` (Schalter, Standard aus): die Torrent-Suche über die installierten Torrent-Anbieter-Erweiterungen im Sandkasten, `autoSelect` mit eigener Regel samt Auto-Select-Profil in `core.db`, und die gespeicherten Torrent-Stream-Einstellungen, soweit das Modul ein Gegenstück hat. **Nicht drin:** Debrid (6c-2). Am Aussehen der App ändert sich nichts; keine neue Abhängigkeit, kein neuer Schema-Schritt (Profil in `torrent_kept`, Schlüssel `autoselect-profile`).

**Schnittstellen** (`native/src/core/torrent/search.ts`, `autoselect.ts`, Form-Aufzeichnung ohne Werte `search.recorded.json`):

| Schnittstelle | Im Kern |
|---|---|
| `POST /api/v1/torrent/search`, `type: "smart"` | `smartSearch` des Anbieters mit Anime (Vertrags-`Media`, `absoluteSeasonOffset` aus `absoluteOffset`), Folge, Batch, Auflösung, beste Releases und den AniDB-Nummern aus den Folgen-Metadaten (`mappings.anidbId`, `episodes[n].anidbEid`); ein Anbieter ohne `canSmartSearch` bekommt `search` mit den Worten, sonst dem Titel. Je Torrent eine Vorschau `{ episode?, torrent }` (die Folge aus der eigenen Folgenliste, wenn der Torrent eine nennt oder die gesuchte Folge ist) |
| `…/torrent/search`, `type: "simple"` | `search` mit den Worten; ohne Worte `getLatest` (die App schickt das nicht, der Vertrag hat es). Keine Vorschauen |
| Antwort | aufgezeichnete Form: `torrents` (je Torrent `provider` und die Felder des Vertrags; fehlender Magnet/Info-Hash `""`, fehlende Folge `-1`, `resolution`/`isBatch`/`releaseGroup` nur wenn gegeben; meiste Seeder zuerst), `torrentMetadata` je Info-Hash `{ distance, metadata }` (eigener `$habari`; `distance` = wenigste Buchstaben-Änderungen zwischen dem Titel im Namen und einem Titel des Animes, eigenes Maß), `animeMetadata` (ani.zip, §4p), `debridInstantAvailability: null`, `includedSpecialProviders: []` |
| `GET/POST/DELETE /api/v1/auto-select/profile` | ein Profil; ohne gespeichertes die aufgezeichnete leere Form (`dbId` 0, Listen `null`, Vorlieben `""`); Speichern → `dbId` 1, leere Listen werden `null`, fremde Felder fallen weg; Löschen → `true` |
| `POST …/torrentstream/start` mit `autoSelect` ohne Torrent | Kern sucht selbst (alle installierten Torrent-Anbieter, die im Profil genannten zuerst bzw. nur diese, je `smartSearch` für die Folge, Fehler eines Anbieters fallen weg) und wählt nach der Regel unten |
| Torrent ohne Magnet und Info-Hash | sein Anbieter wird gefragt: `getTorrentMagnetLink`, sonst `getTorrentInfoHash` → Magnet. Gilt für `start` und `torrent-file-previews` |

**Auswahl-Regel** (eigene, `chooseTorrent`): 1. Raus: kein Weg zum Torrent; weniger Seeder als `minSeeders` (mindestens 1); Begriff aus `excludeTerms` im Namen; außerhalb `minSize`/`maxSize`; Auflösung nicht im Profil (wenn es welche nennt); eine Vorliebe „never“, die zutrifft, oder „only“, die nicht zutrifft (Batch, beste Release, mehrere Tonspuren, mehrere Untertitel); fehlende Pflicht-Sprache/-Codec/-Quelle; ein Torrent einer anderen Folge (ein Batch, dessen Bereich die Folge enthält, oder ein Name ohne Folge bleibt drin). 2. Reihenfolge: Auflösung (Reihenfolge im Profil, sonst die `preferredResolution` der Stream-Einstellungen zuerst, sonst die höhere) → Vorlieben (+1 „prefer“, −1 „avoid“, +1 je gefundener bevorzugter Sprache/Codec/Quelle) → Release-Gruppe (Profil-Reihenfolge) → Anbieter (Profil-Reihenfolge) → Seeder → kleinerer Download. 3. Der erste gewinnt; keiner: Fehler 404 mit der Zahl der angesehenen Torrents. Bereiche im Namen („(01-12)“) liest die Regel selbst, `$habari` lässt sie im Titel.

**Einstellungen in der Sitzung:** `sessionSettingsOf` gibt dem Gerät beim nächsten Start der Sitzung `downloadDir` (absoluter Pfad oder `file:///`; sonst Cache der App) als Ablage der Stream-Dateien und `torrentClientPort` (1–65535) als Port. `useSettings` an der Gerät-Seite (`core-torrent.ts`) merkt sie für den nächsten Start; eine laufende Sitzung behält ihre (sie endet mit jedem `stop`). Die übrigen Felder (`disableIPV6`, `slowSeeding`, …) haben im Modul kein Gegenstück und bleiben nur gespeichert; Verbindungs-Grenze und DHT sind keine Felder der Einstellungen der App.

**Prüf-Link** (nur Test- und scratch-App): `core?torrent=search-check&media=<AniList-ID>[&episode=<n>][&provider=<id>]` (`api/client/core-torrent-search-check.ts`). Fragt über dieselbe Tür wie die Hooks (der Schalter entscheidet, wer antwortet): je Anbieter intelligente Suche der Folge und einfache Suche mit dem Titel, das Profil, dann wendet er die Regel des Kerns auf alle Treffer an. Kein Torrent wird hinzugefügt, nichts geladen oder gespielt; im Log nur Zahlen und Feldnamen.

**Vergleich am Gerät** (S22, Test-App, Nutzer 0, Build von `6a22112`, 14.11.2026 12:20–12:22, Dr. STONE Folge 1, zwei installierte Torrent-Anbieter, nur lesend):

| | Server | Kern |
|---|---|---|
| Anbieter 1 intelligent | 6 Torrents, 6 Vorschauen (2 mit Folge), 6 Metadaten, 6 Magnet, 6 Info-Hash, 0 Batch, 6 für Folge 1; 2694 ms | **6 / 6 (6 mit Folge) / 6 / 6 / 6 / 0 / 6**; 1488 ms |
| Anbieter 1 einfach | 85 Torrents, 0 Vorschauen, 85 Metadaten; 1878 ms | **85 / 0 / 85**; 583 ms |
| Anbieter 2 intelligent | 0; 5402 ms | **0**; 2459 ms |
| Anbieter 2 einfach | 74 / 0 / 74; 1177 ms | **74 / 0 / 74**; 402 ms |
| Felder der Torrents | `confirmed/date/downloadCount/downloadUrl/episodeNumber/formattedSize/infoHash/isBestRelease/leechers/link/magnetLink/name/provider/resolution/seeders/size` | gleich |
| Profil | `dbId` 0, 15 Felder | gleich |
| Auto-Auswahl (Regel des Kerns aus 6 Treffern) | – | Wahl getroffen: Anbieter 1, gleiche 16 Felder, 1080p, kein Batch, Folge im Namen gelesen, Seeder > 0, Magnet und Info-Hash da |
| Such-Anfragen beim Server | 4 (`/torrent/search`) + 1 (`/auto-select/profile`) | **0** („answered by the core, no HTTP“, im Server-Log keine Zeile) |

Abweichung: Vorschauen mit Folge – der Server hängt nur an 2 von 6 eine Folge, der Kern an alle 6 für Folge 1 (die Phone-Ansicht nutzt nur `preview.torrent`). Danach alle Bereiche aus (`areas answered by the core: none`); keine Absturz-Zeile.

**Stücke über 8 ms:** die einfache Suche hielt den Faden der App 56,5 ms (85 Namen) bzw. 80,5 ms (74 Namen) am Stück (`after sql, until end`): das Lesen der Namen und die Abstände. Behoben nach dem Build: `metadataOf` gibt den Faden alle 8 Torrents zurück (`pause`). Unter vitest grün, **am Gerät nicht nachgemessen** (nur ein Build in dieser Phase).

**Größe:** APK der Test-App vorher 115 125 609, nachher **115 157 065 Bytes** (+31 456).

**Offen:** Debrid (6c-2); Nachmessung der 8-ms-Stücke; Batch-Suche bei `autoSelect` (heute eine intelligente Suche ohne Batch je Anbieter); `start` mit `autoSelect` am Gerät (beitreten zu einem Schwarm war hier verboten, nur unter vitest belegt); Einstellungen ohne Gegenstück im Modul.

**Testweg:** `core/torrent/search.test.ts` (Routen und Schalter, Form gegen die Aufzeichnung, intelligent/einfach/neueste, Anbieter ohne intelligente Suche, Profil speichern/lesen/löschen, Regel, Start mit Auto-Auswahl, Magnet vom Anbieter, Einstellungen an die Sitzung), `core-torrent.test.ts` (Prüf-Link `search-check`).

### Phase 6c-2: Debrid und Torrent-Client (14.11.2026)

Drei Teile: Debrid im Kern (eigener Bereich `debrid`, Standard aus), die Entscheidung zu den Torrent-Client-Schnittstellen und die Nachmessung der 8-ms-Stücke aus 6c-1. Am Aussehen der App ändert sich nichts; keine neue Abhängigkeit, kein neuer Schema-Schritt (Einstellungen in `torrent_kept`, Schlüssel `debrid-settings`).

**Warum ein eigener Bereich `debrid` und nicht `torrent`:** Debrid braucht das Torrent-Modul nicht (der Anbieter lädt, mpv spielt seine Adresse direkt), ist ein bezahlter fremder Dienst mit Schlüssel und soll einzeln zum Server zurückschaltbar sein (§2 Regel 8), ohne Torrent-Stream und Suche mitzunehmen. Er nutzt aus `torrent/` nur Datei-Wahl, Magnet-Bau und `autoSelect`.

**Anbieter** (aus `settings-torrents.tsx` `DEBRID_PROVIDERS`: alle vier, die die App anbietet), je ein kleiner Client in `native/src/core/debrid/providers.ts`, geschrieben nach der öffentlichen Doku:

| Anbieter | Doku | Hinzufügen | Torrent / Liste | Datei wählen | Direkte Adresse | Löschen |
|---|---|---|---|---|---|---|
| TorBox | `api.torbox.app/openapi.json` (Oberfläche `api-docs.torbox.app`) | `POST /v1/api/torrents/createtorrent` (`magnet`) | `GET /v1/api/torrents/mylist?id=…&bypass_cache=true` | – | `GET /v1/api/torrents/requestdl?token=…&torrent_id=…&file_id=…` | `POST /v1/api/torrents/controltorrent` (`delete`) |
| Real-Debrid | `api.real-debrid.com` | `POST /rest/1.0/torrents/addMagnet` | `GET /torrents/info/{id}`, `GET /torrents` | `POST /torrents/selectFiles/{id}` (nur die gewollte Datei) | `links[]` der gewählten Datei → `POST /unrestrict/link` → `download` | `DELETE /torrents/delete/{id}` |
| AllDebrid | `docs.alldebrid.com` (v4, Status v4.1) | `POST /v4/magnet/upload` (`magnets[]`) | `POST /v4.1/magnet/status` (mit/ohne `id`), Dateien `POST /v4/magnet/files` (Baum `n/s/l/e`) | – | `l` der Datei → `POST /v4/link/unlock` → `link` | `POST /v4/magnet/delete` |
| Premiumize | `www.premiumize.me/api` | `POST /api/transfer/create` (`src`) | `GET /api/transfer/list`, Dateien `GET /api/folder/list?id=…` (Unterordner) bzw. `GET /api/item/details` | – | `link` der Datei | `POST /api/transfer/delete` |

Schlüssel überall als `Authorization: Bearer` (alle vier nehmen das an; AllDebrid dazu `agent=seanime-mobile`); einzige Ausnahme TorBox `requestdl`, das ihn laut Doku als `token` in der Adresse verlangt. Fehlertexte nennen den Anbieter und seine eigenen Worte, nie den Schlüssel; 401/403 → „refused the API key“; nach 30 s ohne Antwort gibt der Kern auf. Antworten in der Form der App (`Debrid_TorrentItem`: Status auf `downloading/completed/seeding/error/stalled/paused/other` abgebildet, Größe in Worten, Fortschritt 0–100, ETA, Datum ISO).

**Schnittstellen** (`native/src/core/debrid/debrid.ts`):

| Schnittstelle | Im Kern |
|---|---|
| `PATCH /api/v1/debrid/settings` | bleibt im Bereich `settings` eingetragen: mit `debrid` an speichert der Kern die Zeile (Form `Models_DebridSettings`, `id` 1) ohne Schlüssel in `core.db`, den Schlüssel in `expo-secure-store` (`seanime-core-debrid-api-key`, leer = vergessen), „-“ = kein Anbieter; einem laufenden Server werden dieselben Einstellungen mitgegeben (für das, was bei ihm bleibt). `GET /status` trägt sie samt Schlüssel ein (wie der Server; die Schlüssel-Prüfung der Einstellungen braucht ihn) |
| `GET /api/v1/debrid/torrents` | Liste des Anbieters. Ohne Anbieter oder ausgeschaltet die aufgezeichnete Antwort `debrid: Provider not set` (500), ohne Schlüssel `debrid: no API key saved for the provider` – sofort, ohne Netz |
| `POST …/debrid/torrents/file-previews` | Torrent beim Anbieter anlegen, auf die Dateiliste warten (höchstens 90 s) → Videodateien als `DebridClient_FilePreview` mit `fileId` des Anbieters |
| `POST …/debrid/stream/start` | Torrent der App oder `autoSelect` (Regel aus 6c-1, Auflösung aus `streamPreferredResolution`) → hinzufügen → Dateiliste → Datei (`fileId`, sonst `fileIndex`, sonst Name wie beim Torrent-Stream) → bei Real-Debrid nur diese Datei wählen → warten, bis bereit (alle 3 s, höchstens 2 h, abbrechbar) → direkte Adresse an den Player als `native-player` „watch“ (`streamType: "debrid"`). Dazu `debrid-stream-state` (`started`/`downloading` mit Prozent/`ready`/`failed`) und `open-and-await`/`abort-open` mit eigenen Worten. `externalPlayerLink` abgelehnt |
| `POST …/debrid/stream/cancel` | Warten beendet; `removeTorrent` löscht den Torrent beim Anbieter |
| `POST /api/v1/debrid/torrents` (Hinzufügen zum Herunterladen in einen Ordner) | **bleibt beim Server**: Das Laden der fertigen Dateien vom Anbieter in den Bibliotheks-Ordner ist ein Download-Dienst mit Warten, Fortschritt und Hintergrund (wie 4b), nicht Teil dieser Phase. Damit er mit den Einstellungen des Kerns arbeitet, bekommt ein laufender Server sie beim Speichern mit. Ohne Server scheitert die Anfrage sofort (§4p) |

Nicht drin: `debridInstantAvailability` in der Suche (bleibt `null`), Batch-Verlauf für Debrid-Streams, verzögerte AllDebrid-Links (`link/delayed`: klare Fehlermeldung statt Warten).

**Torrent-Client (`TORRENT_CLIENT.*`, `DownloadTorrentFile`): bleibt beim Server.** Aufrufer: `GET /torrent-client/list` und `POST /torrent-client/action` (Pause, Fortsetzen, Entfernen mit/ohne Dateien) nur im Bildschirm Downloads → Torrents (`android-downloads/_screens/torrent-downloads.tsx`), `POST /torrent-client/download` im Download-Blatt der Torrent-Suche (`torrent-search-phone.tsx`), `get-files` und `download-torrent-file` ohne Aufrufer. Das ist ein dauerhafter Download-Client (Warteschlange über Neustarts, Pause/Fortsetzen, Resume-Daten, Hintergrund-Dienst); dem Modul aus 6b fehlen dafür Pause/Fortsetzen und eine zweite, nicht flüchtige Torrent-Art neben dem einen Stream – das wäre Änderung am C++-Modul plus Download-Dienst, eine eigene Phase. Ohne Server scheitern die Anfragen schon heute sofort mit „needs the server“ (§4p, `requests.ts`), der Bildschirm zeigt seinen Fehlerzustand, nichts hängt.

**Am Gerät (S22, 14.11. 12:42–12:46, ein Build, nur lesend):** Bereiche `settings` + `debrid` an → Einstellungen → Torrents & debrid → „Debrid service“ an: `PATCH /api/v1/debrid/settings answered by the core, no HTTP (60 ms)` und `told the server: PATCH /api/v1/debrid/settings` (Server-Log `No provider set`, 200), der Bildschirm liest die gespeicherte Zeile zurück (Schalter an, Anbieter „None“, Auto-Auswahl und Bibliothek aus); ohne Schlüssel gespeichert, danach wieder aus (54 ms, Stand wie vorher). Die Fehlermeldung ohne Anbieter/Schlüssel zeigt kein Bildschirm ohne Konto (die Schlüssel-Prüfung läuft erst mit Schlüssel) → nur unter vitest belegt (sofort, ohne Netz). Downloads → Torrents (Server, Bereiche aus): „No torrents“, kein Hänger. Danach alle Bereiche aus (`areas answered by the core: none`), 0 `FATAL EXCEPTION`.

**8 ms aus 6c-1 nachgemessen** (Prüf-Link `search-check`, Bereich `torrent`, Dr. STONE Folge 1; Ergebnisse wie 6c-1: 6 / 85 / 0 / 74, Auto-Auswahl trifft eine Wahl): die einfache Suche hält den Faden nicht mehr 56,5 bzw. 80,5 ms am Stück. Jetzt längstes Stück **13,4 ms** (Anbieter 1, `after sql, until pause`: Antwort der Erweiterung bis zur ersten Pause) bzw. **24,5 ms** (Anbieter 2, dito); die Namen-Stücke zwischen zwei Pausen 8,9–11,0 ms (5 bzw. 1 über 8 ms). Besser, aber **nicht unter 8 ms** → offen: kürzere Abstände (alle 4 statt 8 Namen) und eine Pause vor dem Lesen der Antwort.

**Größe:** APK der Test-App vorher 115 157 065, nachher **115 210 085 Bytes** (+53 020: Debrid-Code im JS-Bündel).

**Offen:** 8-ms-Stücke der einfachen Suche (13,4/24,5 ms, s. o.); Debrid mit echtem Konto (nur unter vitest mit den Antwort-Formen der Doku belegt; Nick hat kein Konto); Debrid-Download in den Ordner im Kern; Sofort-Verfügbarkeit in der Suche; Torrent-Client im Kern (Modul: Pause/Fortsetzen, dauerhafte Torrents).

**Testweg:** `core/debrid/debrid.test.ts` (30 Tests: Einstellungen und Schlüssel-Ablage, Mitgeben an den Server, Schalter aus; Fehler ohne Anbieter/Schlüssel sofort und ohne Netz, abgelehnter Schlüssel und kein Netz ohne Schlüssel im Text; je Anbieter Liste in App-Form, Stream bis zur direkten Adresse, Datei nach `fileId`, Zeitgrenze, Abbrechen mit Löschen; Datei-Vorschau; Datei-Wahl).

### Gerätetest echter Torrent (14.11.)

Ziel: Dr. STONE Folge 1 über die Oberfläche als Torrent-Stream im Kern, echter Schwarm (DHT, Tracker, Metadaten von Peers), mpv über den Ausgang, Sprung, Schließen mit Aufräumen. **Ergebnis: nicht abgespielt.** Zwei Fehler im Kern gefunden und behoben (unter vitest belegt), ein dritter Befund offen; die Wiedergabe in mpv über den Ausgang bleibt offen.

**Ablauf** (S22, Test-App, Nutzer 0, Build von `3c5afb5`, APK 115 216 789 Bytes, 14:50–15:01, Uhr des Geräts): Bereiche `extensions`, `torrent`, `settings`, `anilist`, `library`, `playback` an (`areas answered by the core: extensions, settings, anilist, library, playback, torrent`); DHT, Tracker, LSD, uTP im Kern an (Standard der Gerät-Seite). „Autoplay next episode“ aus, „Auto update progress“ an – Fortschritt erst bei 80 % (`COMPLETION_RATIO`), und nie kleiner als der Listen-Eintrag (24/24). Einstellungen → Torrents & debrid → „Torrent streaming“ an: `PATCH /api/v1/torrentstream/settings answered by the core, no HTTP (16 ms)` (im Kern gespeichert, der Server-Wert bleibt aus).

| Schritt | Ergebnis |
|---|---|
| Auto-Auswahl, Folge 1 | Kern sucht selbst (`Looking for a torrent…`), wählt einen Treffer des Anbieters „Internet Archive“, Magnet hinzugefügt nach 5,0 s (`torrent: magnet added (…, trackers 2)`) |
| Metadaten von Peers | **nicht gekommen**: nach 60 s `the torrent's file list did not come (no peer has it)`, `start failed in the core (65352 ms)`, Player bekommt `abort-open`, nichts gespielt |
| Suche per Hand (Liste der Treffer) | **Fehler im Kern:** `torrent provider not found: archive-org,dkb` – die Phone-Suche schickt die gewählten Anbieter mit Komma verbunden in `provider`, der Kern suchte genau eine Kennung |
| Torrent-Anfragen beim Server | **0** (5 Antworten vom Kern, keine „answered by the server“ im Zeitraum) |
| AniList | Dr. STONE vorher und nachher `progress 24, COMPLETED, updatedAt 1778012557` – unverändert; 0 `update-progress` |
| Danach | Blatt geschlossen, alle Bereiche aus (`areas answered by the core: none`), 0 `FATAL` |

Wiedergabe-Sekunden: **0**. Zeit bis Metadaten / erstes Bild / Bild nach Sprung: **nicht gemessen** (kein Stream kam zustande).

**Fehler 1 (behoben, `3c5afb5`): Schließen des Players beendete den Torrent-Stream nicht.** `video-terminated` ging je nach Bereich `playback` an den Server oder an `hearPlayer`; keiner von beiden kannte den Stream des Kerns, der Torrent lief weiter und lud. Jetzt: `tellPlayer` gibt `video-terminated` mit `playbackType: "torrent"` bei Bereich `torrent` an immer auch dem Kern; `torrentHearsPlayer` (`core/torrent/torrent.ts`) entfernt dann den Torrent samt Dateien und beendet die Sitzung, wie `stop`. Dazu Log-Zeilen der Gerät-Seite (`api/client/core-torrent.ts`): Magnet hinzugefügt (Info-Hash gekürzt, Zahl der Tracker), Dateiliste mit ms seit dem Hinzufügen, Ausgangs-Adresse ohne Token, Entfernen mit Zahl der Einträge, die im Stream-Ordner übrig sind (der Ordner liegt im Cache der App und ist ohne `run-as` von außen nicht lesbar).

**Fehler 2 (behoben, `1d0b414`): Suche mit mehreren Anbietern.** `searchTorrents` teilt `provider` an Kommas, sucht jeden Anbieter, legt die Antworten zusammen (meiste Seeder zuerst); ein scheiternder Anbieter fällt weg, nur wenn alle scheitern, kommt der erste Fehler.

**Befund 3 (offen): keine Metadaten in 60 s.** Der gewählte Torrent kam vom Anbieter „Internet Archive“: dessen Torrents leben vor allem von Web-Seeds über HTTPS, und das Modul hat noch kein TLS (CMake: keine OpenSSL); Peers über DHT/Tracker kamen in 60 s keine. Ob DHT am Gerät überhaupt Knoten findet, zeigt das Log nicht (Alarm-Maske ohne `dht`/`tracker`, der Status kennt keine Knotenzahl). Nächste Schritte: Peer-/DHT-Zahlen während des Wartens loggen, Torrent eines Anbieters mit vielen Seedern wählen, Auto-Auswahl Treffer ohne Peer-Weg (nur Web-Seed) nicht nehmen lassen, TLS.

**Nicht belegt:** Aufräumen nach dem gescheiterten Start – der Kern ruft `remove(…, true)` (Weg `catch` in `startTorrentStream`), die Zeile „removed“ kam aber nicht: für einen Torrent ohne Metadaten meldet libtorrent das Löschen der Dateien als gescheitert, `drop` schluckt den Fehler. Da ohne Metadaten keine Datei angelegt wird, ist nichts geladen; der Ordner war von außen nicht prüfbar.

**Tests:** `tsc` 0; vitest `src/core` + `src/api/client` 38 Dateien / 578 Tests grün (neu: Player-Schließen in `torrent.test.ts`, mehrere Anbieter in `search.test.ts`). Der Build am Gerät enthält Fehler 1, nicht Fehler 2 (ein Build je Lauf).

### Phase 6b-3: TLS und echter Torrent-Stream (14.11.2026)

Das Torrent-Modul spricht jetzt TLS (HTTPS-Tracker, HTTPS-Web-Seeds), sagt während des Starts jede Sekunde in Zahlen, was es sieht, räumt auch einen Torrent ohne Dateiliste sauber weg, und ein Torrent wird über seine `.torrent`-Datei hinzugefügt, wenn der Anbieter eine nennt. Am Aussehen ändert sich nichts.

**TLS: BoringSSL statt OpenSSL** (die eine neue Abhängigkeit aus dem Plan 6a). Gründe:

- BoringSSL baut mit CMake und dem NDK allein, also im selben Bauweg wie libtorrent (`add_subdirectory`, statisch, `-Os`, `--gc-sections`). Der Bau von OpenSSL verlangt Perl und `make` auf dem Bau-Rechner; unter Windows hätte das einen zweiten Bauweg gebraucht.
- Lizenz Apache-2.0 (seit der Umstellung von BoringSSL), verträglich mit der GPL-3.0 der App. `licenses/boringssl-LICENSE.txt`.
- Boost.Asio kennt BoringSSL (`OPENSSL_IS_BORINGSSL`), libtorrent 2.1.2 übersetzt dagegen ohne eine Änderung.
- Nachteil: BoringSSL verspricht keine stabile Schnittstelle und hat datierte Releases. Deshalb feste Version mit SHA-256, wie bei libtorrent und Boost.

| Was | Quelle | SHA-256 |
|---|---|---|
| BoringSSL 0.20261105.0 | `github.com/google/boringssl/releases/download/0.20261105.0/boringssl-0.20261105.0.tar.gz` (74,8 MB) | `2df2b287…f02c3ac4` (gleich dem `digest` der Release-Seite) |

`cmake/fetch-deps.cmake` holt das Archiv wie die anderen beiden in `<Gradle-Cache>/caches/seanime-core-torrent/` und entpackt nur, was der CMake-Bau der beiden Bibliotheken liest (97 MB statt 260 MB: ohne Testvektoren und Fuzzing-Daten). Das Laden über das Skript ist gelaufen (Prüfsumme von CMake geprüft).

Neu ist `cmake/libtorrent.cmake` (plattformneutral, von `android/CMakeLists.txt` eingebunden): erst BoringSSL (`crypto`, `ssl`, Tests aus – sie bräuchten Go), dann zwei importierte Ziele `OpenSSL::SSL` und `OpenSSL::Crypto`, die auf diese beiden zeigen. libtorrents eigene Suche (`FindOpenSSL`) findet nichts und nimmt die Ziele; damit sind `TORRENT_USE_OPENSSL` und `TORRENT_SSL_PEERS` gesetzt. Fehlt TLS, bricht schon der Konfigurations-Schritt ab („libtorrent was configured without TLS“), nicht erst der Tracker am Gerät.

**Zertifikate.** libtorrent prüft die Zertifikate von HTTPS-Trackern und -Web-Seeds (`validate_https_trackers`, bleibt an). Android hat keinen Ort, an dem BoringSSL die Stellen des Systems von selbst findet: Sie liegen einzeln unter `/apex/com.android.conscrypt/cacerts` (älter: `/system/etc/security/cacerts`), benannt nach dem alten Subject-Hash. Das Modul legt sie beim Start der Sitzung zu einer Datei `<Sitzungs-Ordner>/ca-bundle.pem` zusammen und setzt `SSL_CERT_FILE` (einmal je Prozess). Falle: Die Umgebungsvariable gilt für den ganzen Prozess; eine andere Bibliothek, die sie liest, bekäme dieselbe Datei. Vom Nutzer installierte Stellen sind nicht dabei.

**Größe und 16-KB-Seiten** (APK des zweiten Builds, `llvm-readelf -l` an den Dateien aus der APK):

| | arm64-v8a | armeabi-v7a |
|---|---|---|
| `libSeanimeCoreTorrent.so` in der APK | 6 553 080 Bytes, gepackt 2 343 517 | 4 258 764 Bytes, gepackt 1 971 670 |
| zum Vergleich 6b-1 (ohne TLS, ohne Ausgang) | 3 777 960 Bytes, gepackt 1 314 698 | 2 499 740 Bytes, gepackt 1 172 597 |
| `LOAD`-Ausrichtung | 3 × 0x4000 | 3 × 0x4000 |

APK der Test-App: vorher 115 216 789 Bytes (Build von `3c5afb5`), nachher **116 907 245 Bytes** (+1 690 456 Bytes, +1,61 MiB für beide ABIs; darin auch die Arbeit des Tablet-Agenten zwischen den beiden Builds). Die Schätzung aus 6a (+1–2 MB je ABI gestrippt) trifft zu. Ein Probe-Bau außerhalb der App (libtorrent + BoringSSL + Sitzung, arm64, 594 Schritte) dauert 54 s; der ganze App-Build mit dem ersten Bau von BoringSSL 6 min 31 s.

**Sichtbarkeit.** Der Status des Moduls (`CoreTorrentStatus`, einmal je Sekunde und auf Abruf) trägt sechs Felder mehr; die Alarm-Maske nimmt dafür die Kategorie `tracker` dazu, die DHT-Zahl kommt aus den Sitzungs-Statistiken (`post_session_stats`, Zähler `dht.dht_nodes`):

| Feld | Inhalt |
|---|---|
| `peersKnown` | Peers, die der Torrent kennt (verbunden oder nicht); `peers` bleibt die Zahl der verbundenen |
| `dhtNodes` | Knoten in der Routing-Tabelle der DHT (ganze Sitzung) |
| `trackersOk`, `trackersFailed`, `trackerError` | beantwortete und gescheiterte Ansagen an Tracker seit dem Hinzufügen, dazu der Text des letzten Fehlers |
| `webSeeds` | Web-Seed-Adressen des Torrents |

Die Gerät-Seite (`api/client/core-torrent.ts`) schreibt daraus **eine Zeile je Sekunde**, vom Hinzufügen bis die ersten Bytes da sind (höchstens 180 s; bei einem Torrent, von dem nichts gewollt ist, bis zur Dateiliste):

```
[Core] info torrent: start 0123abcd… 3 s: peers 2/14, seeds 1, dht 187, trackers 1 ok 2 failed, web seeds 0, metadata no, 0 B/s
```

Ein Tracker-Fehler steht einmal mit seinem Text dabei (`torrent: a tracker of … failed: …`). Der Ausgang schreibt je Anfrage eine Zeile ins System-Log (Android: Marke `SeanimeTorrent`, nur Zahlen, weder Token noch Dateiname): `outlet: GET Range bytes=<von>-<bis> of <Größe> -> 206`.

**Torrent über seine `.torrent`-Datei.** Am Gerät gefunden: Für Dr. STONE liefert nur der Anbieter „Internet Archive“ Treffer, und jeder davon meldet fest „1 seeders“. Die Dateiliste eines Magnet-Links kommt aber nur von Peers; ein Web-Seed hat die Dateien, nicht die Liste. Nennt ein Treffer eine `.torrent`-Adresse über HTTPS (`downloadUrl`), lädt die Gerät-Seite sie (höchstens 8 MB, 15 s) und fügt den Torrent damit hinzu (`addTorrentFileFrom`): Dateiliste, Tracker und Web-Seeds sind sofort da, ein Torrent ohne Seeder kann über seine HTTPS-Web-Seeds laufen. Geht das nicht (keine Adresse, kein HTTPS, Datei nicht lesbar), bleibt der Magnet-Link der Weg. Gilt für den Stream und für die Datei-Auswahl.

**Auto-Auswahl** (`autoselect.ts`). Ein Treffer ohne Weg zu seinen Daten fällt weg: 0 Seeder und kein Web-Seed im Magnet-Link (`ws=`). Ein Treffer, der nur einen Web-Seed nennt, bleibt, kommt aber hinter jeden Treffer mit Seedern, und nie unter die Mindestzahl des Profils. Grenze der Regel: Sie kann nur lesen, was der Anbieter meldet – eine fest gemeldete „1“ sieht für sie wie ein Seeder aus.

**Zeitüberschreitung.** Kommt die Dateiliste eines Magnet-Links in 60 s nicht, sagt der Fehler, woran es lag, mit den Zahlen der Sitzung: `the torrent's file list did not come within 60 s: no peer was reached (peers 0 of 4 known, DHT nodes 87, trackers 1 answered, 2 failed, web seeds 0). Another torrent with more seeders may start.` – bei verbundenen Peers „no connected peer has it“. Der Player bekommt den Satz als `abort-open`.

**Aufräumen.**

- Ein Torrent ohne Dateiliste hat keine Dateien. libtorrent beantwortete die Bitte, sie zu löschen, mit „konnte nicht gelöscht werden“, und der Kern schluckte das (Befund aus dem Gerätetest). Das Modul nimmt einen solchen Torrent jetzt nur aus der Sitzung; die Antwort kommt mit `torrent_removed`, ohne Fehler, und die Log-Zeile `removed … entries left in the folder` erscheint.
- Lehnt das Modul ein Entfernen ab, steht das mit dem Ordner-Rest im Log (`could not be removed (…); N entries left in the folder`).
- Endet die Sitzung, wird der Stream-Ordner im Cache der App geleert, falls dort noch etwas liegt (`session stopped; N entries left in the folder, folder cleared: …`). Ein Ordner, den der Nutzer gewählt hat (`downloadDir`), bleibt unberührt.

**Gerätetest** (S22, Android 16, Test-App, Nutzer 0, 14.11.2026 15:33–16:09, Uhr des Geräts). Zwei Builds: Build 1 (`315d589`, 116 901 905 Bytes) nur für App-Start, Bereiche und Suche, kein Treffer angetippt; Build 2 (`b40d44e`, 116 907 245 Bytes, dazu der `.torrent`-Weg und die Zeile des Ausgangs) für den Stream. Bereiche `extensions`, `settings`, `anilist`, `library`, `torrent` an, `playback` aus. Dr. STONE → Reiter „Torrent“ → „Pick the best torrent“ aus → Folge 1.

Suche: `POST /api/v1/torrent/search answered by the core` (2384 ms), beide Anbieter gewählt (Internet Archive, DKB). **24 Treffer, alle von Internet Archive, alle als „Batch“ und mit „1 seeders“**; DKB lieferte für diese Folge nichts. Ein Treffer mit vielen Seedern stand also nicht zur Wahl.

| Schritt | Ergebnis |
|---|---|
| Treffer 1 (Sammlung, 863 MiB) | `torrent file added (…, 43937 bytes)`, `file list … has 42 files, 5 ms after adding`, dann `no file of the torrent fits episode 1` → `removed with its files; folder gone`, `start failed in the core (2075 ms)`, Player `Abort open`. Nichts gespielt |
| Treffer 2 (eine Folge, 167 MiB, Video 173 342 635 Bytes) | `.torrent` geladen und hinzugefügt 3,3 s nach dem Tipp (8431 Bytes), Dateiliste 13 ms danach (4 Dateien, kein Peer nötig), Ausgang und `Watch` im selben Augenblick |
| Start in Zahlen | `1 s: peers 1/2, seeds 0, dht 235, trackers 1 ok 2 failed, web seeds 3, metadata yes, 0 B/s` … `4 s: peers 1/3, seeds 0, dht 246, trackers 1 ok 2 failed, web seeds 3, metadata yes, 310928 B/s`; dazu einmal `a tracker of … failed: skipping tracker announce (unreachable)` |
| Erstes Bild in mpv | zwischen 8,3 und 15,2 s nach `Watch` (die Bildschirmfotos brauchten unter Last bis zu 7 s), also spätestens 18,5 s nach dem Tipp. mpv setzte an der gemerkten Stelle fort (4:33 von 24:00) |
| Sprung, pausiert | Tipp auf die Leiste bei 70 %: `Range bytes=122766973-…` (70,8 % der Datei), Bild an der neuen Stelle zwischen 4,0 und 9,1 s nach dem Tipp, Stand 16:49 von 24:00 |
| Wiedergabe | Pause-Taste ab `Watch` in jeder Runde; vor dem Sprung höchstens 6,9 s (Abstand zweier Pause-Tasten, eher weniger: zwei Fotos im Abstand von 9 s sind gleich), nach dem Sprung 3,1 s. Zusammen höchstens rund 10 s; danach stand das Bild (zwei Fotos im Abstand von 2 s gleich) |
| Schließen (Vollbild verlassen → Home → „Close player“ am Mini-Player) | `… removed with its files; 0 entries left in the folder`, `session stopped; 0 entries left in the folder`, `videocore video-terminated heard by the core: torrent stream stopped, its torrent removed with its files` |
| Torrent-Anfragen | 7 vom Kern beantwortet, **0 beim Server** |
| AniList | Dr. STONE vorher und nachher `24/24`, `Completed` (Seite der App, nachher mit allen Bereichen aus vom Server gelesen); 0 Fortschritts- oder Listen-Anfragen im Log. `updatedAt` diesmal nicht gelesen |
| Danach | alle Bereiche aus (`areas answered by the core: none`), 0 `FATAL` |

Range-Zeilen des Ausgangs (alle vier des Laufs):

```
16:03:03.120 outlet: GET Range bytes=0-173342634 of 173342635 -> 206
16:03:10.273 outlet: GET Range bytes=41771288-173342634 of 173342635 -> 206
16:04:46.112 outlet: GET Range bytes=122766973-173342634 of 173342635 -> 206
16:05:46.526 outlet: GET Range bytes=173015040-173342634 of 173342635 -> 206
```

Die Bildschirmfotos (erstes Bild pausiert bei 4:33, Bild nach dem Sprung bei 16:49, Seite vorher und nachher) sind angesehen; sie liegen nicht im Repo.

**Was der Lauf belegt und was nicht.**

- Belegt: Torrent-Stream aus dem Kern bis ins Bild in mpv, mit Sprung, über den Ausgang mit Range; `.torrent`-Weg; Start-Zeilen; Aufräumen mit Dateiliste (0 Reste); kein Server beteiligt.
- Nicht einzeln belegt: dass die Bytes über **HTTPS**-Web-Seeds kamen. `seeds 0` und `web seeds 3` bei 1–3 verbundenen Peers (verbundene Web-Seeds zählen als Peers) legen Web-Seeds nahe; das Log trennt aber weder Peers von Web-Seeds noch http von https. Ein Zertifikatsfehler stand nicht im Log.
- Nicht am Gerät gesehen (nur unter vitest bzw. im Probe-Bau): die Dateiliste eines Magnet-Links von Peers, die Meldung bei Zeitüberschreitung, das Entfernen eines Torrents ohne Dateiliste. Ein Schwarm mit vielen Seedern stand nicht zur Wahl.

**Offen:**

- Datei-Wahl in Sammlungen: Treffer 1 hatte 42 Dateien, keine passte dem Namen nach zu Folge 1. Die Datei-Auswahl der Oberfläche wurde nicht benutzt.
- Der Anbieter „Internet Archive“ meldet fest „1 seeders“; die Auto-Auswahl kann solche Treffer nicht von echten unterscheiden. Mit dem `.torrent`-Weg laufen sie trotzdem.
- Zwei von drei Trackern „unreachable“ (Ursache nicht untersucht).
- Stirbt die App mitten im Stream, bleibt der Torrent in den Resume-Daten und käme mit der nächsten Sitzung zurück (nicht untersucht).
- Zeit bis zum ersten Bild nur grob (Abstand der Bildschirmfotos); der Player schreibt keinen Zeitpunkt des ersten Bildes ins Log.

**Testweg:** `core-torrent.test.ts` (neue Zahlen im Status, fehlende zählen 0; Start-Zeile je Sekunde bis zu den ersten Bytes, Tracker-Fehler einmal; Entfernen mit Ordner-Rest, auch abgelehnt; Leeren des Cache-Ordners, gewählter Ordner bleibt), `torrent.test.ts` (Zeitüberschreitung mit Zahlen und Entfernen; `.torrent`-Datei vor Magnet-Link mit Rückfall), `search.test.ts` (Auto-Auswahl: kein Weg zu den Daten, Web-Seed zuletzt, Mindestzahl). Das C++ des Moduls läuft unter vitest nicht; es ist im Probe-Bau übersetzt und am Gerät gelaufen.

### Torrent-Reste (14.11.)

Phase 6e: drei offene Punkte aus 6b-3. Am Aussehen ändert sich nichts.

**Datei-Wahl in Sammlungen** (`torrent.ts`, `episodeOfName`, `fileChoiceOf`). Ursache des Fehlschlags mit 42 Dateien: Der eigene `$habari` liest bei Namen wie `Show 01.mkv`, `Show 1.mkv` oder `01.mkv` keine Folge (die Zahl bleibt im Titel), und jedes Wort einer Art (auch `Movie`) machte eine Datei zum Extra. Neue eigene Regel, in dieser Reihenfolge:

1. Gewählte Datei (`fileIndex`), sonst die einzige Videodatei.
2. Je Videodatei: Folge aus `$habari`; liest er keine, die letzte Zahl des Namens (1–4 Ziffern, auch `01v2`, ohne Klammer-Teile, kein Jahr 19xx/20xx). Staffel aus `$habari`, sonst aus dem nächsten Ordner (`Season 2`, `S02`).
3. Extras fallen weg: Arten OP/ED/NC/SP/OVA/OAD/PV/Menü…, im Namen `NCOP1`, `ED2`, `SP01`, `Special`, `Recap`, `Menu`, `Trailer`, eine Zahl mit Komma (`01.5`), und alles in Ordnern wie `Extras`, `Specials`, `NC`, `OVA`, `Bonus`, `Menus`.
4. Mehrere Staffeln in den Namen: die Staffel aus dem Namen des Torrents (genau eine), sonst die niedrigste.
5. Treffer mit der Folgen-Nummer → die größte Datei (Kopien wie `.ia.mp4` sind kleiner).
6. Kein Treffer und die Nummern gehen über die Folgenzahl des Eintrags (aus `animeWithEpisodes`, nur dann gefragt): absolute Nummerierung, Folge n = kleinste Nummer + n − 1. Fehlt nur die erste Folge (2–12 bei 24 Folgen), gilt das nicht.

Das Log sagt, wie gewählt wurde (neues `TorrentDevice.note`, nur Zahlen): `torrent: file 1 of 34 chosen for episode 1: 32 video files, 8 extras left out, 2 copies of the episode, the largest (400.0 MB)`. Grenze: Eine Sammlung zweier Staffeln mit durchgehender Nummer 1–48 für den Eintrag der zweiten Staffel wird nicht erkannt.

**Seeder-Angabe** (`autoselect.ts`, `providersWithoutCount`). Regel: Ein Anbieter, dessen sämtliche Treffer einer Suche – mindestens drei – dieselbe Seeder-Zahl melden, zählt nicht; seine Zahl gilt als unbekannt (eine echte Schwarm-Zahl ist bei drei Torrents nie gleich; Internet Archive meldet immer „1“). Weg zu den Daten, der sichere zuerst: 0 gezählte Seeder > 1 Web-Seed im Magnet-Link (`ws=`) > 2 unbekannte Zahl mit `.torrent`-Adresse über HTTPS (Tracker und Web-Seeds kommen beim Hinzufügen) > 3 kein Weg → fällt weg. Die Stufe ist das erste Sortier-Merkmal; eine unbekannte Zahl erfüllt nie die Mindestzahl des Profils. `torrentFileAddressOf` liegt jetzt in `autoselect.ts` (von `torrent.ts` weitergereicht). Grenze: Bei ein oder zwei Treffern eines Anbieters greift die Regel nicht.

**`SSL_CERT_FILE` weg** (`TorrentCore.cpp`). libtorrent 2.1.2 hat keine Einstellung für die Zertifikats-Stellen; es ruft beim Start `set_default_verify_paths` am eigenen TLS-Kontext (das las die Umgebungsvariable). Der Kontext ist aber erreichbar: `session_handle::native_handle()` (laut Doku für Plugins, ohne stabile Schnittstelle) → `aux::session_interface::ssl_ctx()` (in `session_impl` privat überschrieben, über die Schnittstelle öffentlich). Das Modul legt die Systemstellen wie bisher zu `ca-bundle.pem` zusammen und lädt sie direkt nach dem Anlegen der Sitzung mit `load_verify_file` in diesen Kontext, bevor ein Torrent hinzukommt; der Zertifikat-Speicher von BoringSSL sperrt sich selbst gegen den Faden der Sitzung. Die Umgebung des Prozesses bleibt unberührt. Der erste Bau scheiterte an genau dieser privaten Überschreibung (`ssl_ctx is a private member`), behoben in `ada28f6`.

**Gerätetest** (S22, Test-App, Nutzer 0, 14.11.2026 17:04–17:09, ein Build von `ada28f6`, APK 117 145 233 Bytes). Bereiche `extensions`, `settings`, `anilist`, `library`, `torrent` an, `playback` aus. AniList Dr. STONE vorher `24/24`, `Completed`.

| Schritt | Ergebnis |
|---|---|
| Start | **Nicht wie geplant:** Beim Ausschalten von „Pick the best torrent“ lief die Seite nach einem Wisch noch; der Tipp traf das Element darunter und startete per Auto-Auswahl Folge 23 (`Starting torrent stream (auto select)`, 17:06:38.6). Ein Sammlungs-Treffer wurde daher nicht gewählt |
| Torrent | `.torrent` geladen (20 988 Bytes), Dateiliste 4 ms danach (4 Dateien), `file 0 of 4 chosen for episode 23: the only video file`, `start … answered by the core (6437 ms)`, `Watch` 17:06:45.05 |
| Start in Zahlen | `1 s: peers 6/4, seeds 4, dht 75, trackers 1 ok 2 failed, web seeds 3` … `2 s: … 240368 B/s`; kein Zertifikats- oder SSL-Fehler im Log |
| Range | `outlet: GET Range bytes=0-501021012 of 501021013 -> 206` (17:06:45.158) |
| Bild in mpv | Bildschirmfoto bei 0:06; **Pause erst bei 0:26** (17:07:14.6) – rund 26 s Wiedergabe, über der Grenze von 10 s. Ursache: Foto und Ansehen des Fotos vor der Pause-Taste |
| Schließen (Vollbild verlassen → Home → × am Mini-Player) | `removed with its files; 0 entries left in the folder`, `session stopped; 0 entries left in the folder`, `video-terminated heard by the core` (17:08:57) |
| Server | 0 Torrent-Anfragen beim Server; 0 Fortschritts- oder Listen-Schreibanfragen |
| AniList | nachher (alle Bereiche aus, vom Server gelesen) Dr. STONE `24/24`, `Completed` – gleich |
| Danach | `areas answered by the core: none` (17:09:20) |

**Offen:** Datei-Wahl in einer echten Sammlung am Gerät (nur unter vitest belegt); HTTPS-Web-Seed weiterhin nicht einzeln belegt (der neue Weg der Zertifikate lief ohne Fehler, ob ein HTTPS-Tracker darunter war, sagt das Log nicht); zwei von drei Trackern „unreachable“ (nicht untersucht); vor einer Wiedergabe im Test künftig die Pause-Taste direkt hinter den Tipp setzen, nicht hinter ein Foto.

**Testweg:** `torrent.test.ts` („picking the file in a collection (phase 6e)“: Zahl im Titel, Extras, Kopien, nackte Nummern mit Staffel-Ordnern, SxxEyy, absolute Nummerierung, Log-Zeile), `search.test.ts` („a provider that does not count seeders (phase 6e)“). Vorher rot (8 Tests), nachher grün.

### Phase 6f: Torrent-Client im Kern (14.11.2026)

Downloads → Torrents und das Download-Blatt der Torrent-Suche gehen ohne Server (Bereich `torrent`, Standard aus). Am Aussehen ändert sich nichts; keine neue Abhängigkeit, kein Schema-Schritt.

**Modul:** `setPaused(infoHash, paused)` (libtorrent `pause`/`resume`, nicht auto-verwaltet, Resume-Daten sofort angefordert); beim Wiederherstellen bleibt ein pausierter Torrent pausiert (`applyFlags(…, keepPaused)`). Dauerhaft und mit eigenem Ziel-Ordner je Torrent war das Modul schon (`resume/<hash>.resume`, `savePath`). Download-Torrents laufen in **derselben Sitzung** wie ein Stream; `torrentstream/stop` beendet die Sitzung nur noch, wenn der Client keine Torrents hat.

**Hintergrund:** `core-download` bekommt `keepTorrents(on, title)` → `TorrentKeepService` (Typ `dataSync`, laufender Hinweis im vorhandenen Kanal, Teil-Wakelock). Grund: ohne den Server-Dienst hält nichts den Prozess, Android friert ihn im Hintergrund ein. Gehalten wird nur, solange ein Client-Torrent lädt (`downloading`/`metadata`/`checking`); Start aus dem Hintergrund lehnt Android ab → nächster Versuch beim nächsten Wechsel. Android 15: `onTimeout` beendet ihn nach dem Tageskontingent.

**Kern** (`native/src/core/torrent/client.ts`, Zuordnung in `torrent_kept` unter `client:<hash>`):

| Schnittstelle | Im Kern |
|---|---|
| `GET /torrent-client/list` | Client-Torrents in Form `TorrentClient_Torrent`; leer `null` wie aufgezeichnet. Status: `paused`, `seeding` (auch `finished`), `downloading` (auch `metadata`), `error`, sonst `other`; Restzeit im Wortlaut, den die Seite liest („3 minutes left“, „No ETA“); `contentPath` = Ziel/Name; `ratio` 0 |
| `POST /torrent-client/action` | `pause`, `resume`, `remove` (mit Dateien), `remove-keep-files`; `open…` → 400 „not available on the phone“ (kein Dateimanager, der Server öffnete einen Ordner auf seinem Rechner); andere Aktionen 400, fremder Hash 404 |
| `POST /torrent-client/download` | jeder Torrent (Magnet/Info-Hash, sonst beim Anbieter erfragt, `.torrent` per HTTPS wie beim Stream) in `destination`; `smartSelect`: nur Videodateien der fehlenden Folgen (Namen wie beim Stream, Extras raus; passt keine, alles), `deselect`: Indizes aus |
| `DownloadTorrentFile`, `get-files`, `details` | ohne Aufrufer in der App → bleiben beim Server |

Seite und Blatt pollen (alle 1,5 s), Ereignisse braucht keiner. **Ablage:** `destination` des Blatts = Anime-Ordner in der eingestellten Bibliothek (`getDefaultDestination`), also findet der Scan (5b) die Folgen; ohne Bibliothek bietet das Blatt kein Ziel, ein Ziel ohne Pfad (`content://`) wird mit 400 abgelehnt statt in einen Ordner gelegt, den der Scan nicht kennt. **Nach Neustart:** die erste Kern-Antwort eines Laufs (`core-switch.ts`) ruft `resumeClientAtStart` (einmal, nur mit `torrent` an): Sitzung startet, Torrents kommen aus den Resume-Daten, Prozess wird gehalten.

**Prüf-Link** (nur Test-/scratch-App): `core?torrent=client-check&do=start|add|peer|list|pause|resume|remove|remove-keep-files|hash`, je Schritt ein Link; Sitzung mit DHT, LSD, Trackern, PEX, Port-Freigabe, uTP aus; `add` gibt die `.torrent`-Bytes in `<Dokumente>/client-check/<name>` und ruft dann die Download-Route (die antwortet mit dem vorhandenen Torrent), `start` auch mit Bereich aus.

**Gerät (S22, Test-App, Nutzer 0, Build `138e513`, 14.11. 17:38–17:48):** eigene Zufallsdateien (30 und 60 MiB), eigene Seeder (BEP 3, `127.0.0.1`, `adb reverse`, B auf 200 KB/s gebremst). B hinzugefügt (Download-Route 40 ms, „process held in front“) → Pause (7,1 %, „released“, bleibt 7,1 %) → Fortsetzen („held“). A: fertig `seeding 100 %`, 31 457 280 Bytes, **SHA-256 gleich** der Quelle. Bereich aus → `adb install -r` desselben APK bei B ≈ 17 % → nach 12 s `do=start` → Bereich an: B aus den Resume-Daten zurück bei 18,8 %, `downloading`, Prozess gehalten; 31,3 % → 32,1 % → 39 % (Seite). A mit Dateien entfernt: „the file is gone“. Downloads → Torrents zeigt B (39 %, 62,9 MB, ↓ 201,8 KB/s, „3 minutes left“, Pause-Knopf; Screenshot angesehen). Danach B entfernt, Bereich aus, Seeder beendet, `adb reverse --remove`. **Befunde:** Pause trennt die Peers; ohne Peer-Suche (Test) kommt der eine Peer nur per `do=peer` zurück (im Alltag DHT/Tracker). Der Neustart-Auslöser lief am Gerät noch über die Liste (Build vor `57af642`), der Auslöser „erste Kern-Antwort“ ist nur unter vitest belegt.

**16 KB:** `libSeanimeCoreTorrent.so` arm64 6 663 360 / armeabi-v7a 4 343 716 Bytes, `LOAD` je 3 × 0x4000. APK 117 171 105 Bytes (6e: 117 145 233).

**Testweg:** `core/torrent/client.test.ts` (7: leere Liste `null`, Form, Datei-Wahl, Pause/Fortsetzen/Entfernen, Ablehnungen, Neustart mit Resume-Daten und pausiertem Torrent, Stream-Stop lässt Sitzung, Restzeit/Status), `core-torrent.test.ts` (`setPaused`).

## 4r. Rest (Stufe 7)

### Phase 7a: bewusst entfernt

Ohne Server gibt die App diese Funktionen bewusst auf. **Mit Server bleibt alles wie vorher**: Die Antworten des Kerns gelten nur, solange die App ohne ihren Server läuft (`withoutServer` in `core/registry.ts`, Schnittstellen in `core/removed/removed.ts`), nicht schon bei einzeln eingeschalteten Bereichen – sonst würde ein laufender Server mit Plugins leer überdeckt. Lesen antwortet leise und leer (Form wie die Aufzeichnung), Ändern antwortet über den vorhandenen Fehlerweg mit 503 `<Was> not available without the server`. Mit Server gehen diese Anfragen ungezählt zum Server (`coreHasRoute` nennt sie nicht).

| Funktion | was ohne Server | warum | rückholbar wie |
|---|---|---|---|
| Plugins | `extensions/plugin-settings` → `{ pinnedTrayPluginIds: [], pluginGrantedPermissions: {} }`, `list/development` und `list/anime-entry-episode-tabs` → `null`; `plugin-settings/pinned-trays`, `plugin-permissions/grant`, `playground/run` → „not available without the server“. Plugin-Knopf (`plugin-tray.tsx`) und „Erlaubnis nötig“ (`extensions-phone-sheets.tsx`) ohne Server ausgeblendet; Plugin-Aktionen in Folgen, Menü-Seiten und Folgen-Tabs in den Einstellungen sind ohne Server ohnehin leer (sie kommen nur über den WebSocket des Servers bzw. die leere Liste) | Vertrag riesig (`$ui`, `$storage`, `$anilist`, `$database`, Hooks, `$os`/`$downloader`), Nutzung null | Plugin-Laufzeit im Kern bauen und die Zeilen aus `removed.ts` durch echte Schnittstellen ersetzen; die zwei `isServerOff()`-Abfragen entfernen |
| Nakama-Cloud-Räume (`seanime.app/api/rooms`) | `nakama/room/available` → `false` (kein „Cloud-Raum erstellen“), `room/create` und `room/disconnect` → „not available without the server“. Gast-Verbindung zu einem PC-Gastgeber nicht angefasst (7e) | fremder Dienst, für Gast am PC nicht nötig | Zeilen aus `removed.ts` löschen und Räume im Kern bauen |
| Discord | `discord/presence/manga` und `presence/cancel` → `true` (nichts zu tun) | keine Aufrufer, Android hat kein Discord-IPC | Zeilen aus `removed.ts` löschen |
| Fehlerbericht | `report/issue` und `report/issue/download` → „not available without the server“ | keine Aufrufer, der Bericht besteht aus den Logs des Servers | Zeilen aus `removed.ts` löschen und einen Bericht aus den Logs der App schreiben |

Die Hintergrund-Abfragen aus 5c-2 (`onlyWithServer`) bleiben: Ohne Server fragen sie gar nicht; fragt doch jemand (Invalidierung, anderer Aufrufer), antwortet der Kern leer.

**Tests:** `core/removed/removed.test.ts` (ohne Server: leise Antworten und 503 mit Text, 0 Anfragen an den Server; mit Server: alle 13 gehen zum Server, `coreHasRoute` false; Plugin-Knopf und Erlaubnis ausgeblendet), `manage.test.ts` angepasst (Plugin-Schnittstellen gehören dem Kern nur ohne Server).

**Am Gerät** (Tablet, scratch, Build `29cdf21`, 14.11. 15:22–15:26): `core?server=off`, Neustart per `install -r` (15:23:06), Log `The app runs without its server` und alle Bereiche an, kein `libseanime.so` als Kind. Dr. STONE per Link, Erweiterungen, Einstellungen (App, Nakama): kein Plugin-Knopf, kein Toast, im Log 0 Zeilen „needs the server“. Das Nakama-Fenster selbst öffnet nur aus dem Menü bei eingeschaltetem Nakama (Einstellung aus, nicht geändert) – `room/available` am Gerät daher nicht belegt, nur im Test. Gespeicherte Folge `105333-1-sub` (671 MB) per `core?offline=remove&id=105333-1-sub` gelöscht: Log `folder gone`, `files/core-offline/episodes/` leer. `core?server=on` → `areas answered by the core: none`, `libseanime.so` Kind von scratch (15:25:25), Port 43213 lauscht. Dabei gesehen (nicht 7a): Home direkt nach `server=on` „Home could not load“ (Anfrage 1 s nach Server-Start, `ERR_NETWORK`), nach „Try again“ normal. ✅ Behoben im Reste-Lauf (unten).

### Reste-Lauf (14.11.)

Kleine offene Punkte aus früheren Phasen; je erst mit vitest nachgestellt (rot), dann behoben (grün). Code in den WIP-Commits `3bf5501`, `1d705b3`, `e9591b7`, `35917f6`, `ff1832e`.

| Punkt | Ursache | Fix | Beleg |
|---|---|---|---|
| Home nach `core?server=on` „Home could not load“ (7a) | Der Link startet den Server-Dienst und lässt sofort alles neu lesen; der Prozess lauscht erst ~1 s später → `ERR_NETWORK` | `waitUntilServerListens` (`native/src/core/start/start.ts`) hält Anfragen an den Server sofort zurück, bis `serverListens` stimmt (alle 250 ms gefragt, höchstens 60 s); aufgerufen über `waitForServerSwitchedOn` (`core-switch.ts`) in `app-links-handler.ts` | `start.test.ts` (3 Tests). Tablet, scratch, 15:46: `server=off` + Neustart, dann `server=on` 15:46:40.9, Server lauscht 41.9, `server-ready` 42.3; im App-Log kein Fehler, Home ohne „could not load“ (Screenshot) |
| MangaFire-Kapitel gemischt (§4n) | Kern sortierte global nach `index`, MangaFire zählt je Sprache neu | `chaptersOf` (`native/src/core/manga/manga.ts`) behält die Reihenfolge der Erweiterung wie der Server; die Zuordnungs-Vorschau nennt weiter das Kapitel mit dem höchsten `index` | `manga.test.ts` (zwei Sprachen). Prüf-Link `core?manga=check` Dr. STONE: Kern 1202 Kapitel `index 0..233` (3851 ms), Server 1202 `index 0..233` |
| Einstellungen speichern vor dem Server (§4g) | `PATCH /api/v1/settings` und `/settings/path` speicherten im Kern, die Antwort (Status) kam aber vom Server | `statusAfterSave` (`start.ts`), in `registry.ts`: Status des Starts, scheitert er und der Server lauscht nicht → Server-Teil wie gemerkt, `serverReady: false`. `GET /api/v1/status` unverändert | `start.test.ts` (Bereiche `settings`+`anilist` und `settings` allein). Am Gerät nicht gezeigt: das Fenster bis zum Lauschen ist ~1 s, von Hand nicht erreichbar |
| Sammlung in Stücken (§4g) | – | begründet geschlossen (§4g) | – |
| Datum löschen (§4g) | – | kein Fehler | `changes.test.ts`: geleerte Daten → `{ year: null, month: null, day: null }`, Eintrag ohne Datum |
| 8 ms `library scan match` 42,2 ms (5b-2) | bis zu 20 Dateien je Stück gegen alle Anime der Listen | `scan.ts`: Pause vor jeder Datei | `scan.test.ts` (45 Dateien → ≥ 45 Pausen; vorher 3) |

Prüfzahlen: `npx tsc --noEmit` 0 Fehler; `npx vitest run` 155 Dateien / 1502 Tests grün; `npx expo lint` 0 Fehler, 341 Warnungen. APK scratch 124,5 MB. AniList-Wächter vorher ok, `anilist-clear` danach 0 Einträge. Am Ende `server=on`, `areas answered by the core: none`.

**Offen:** Speichern vor dem Lauschen am Gerät; `library scan match` am Gerät nachmessen (Tablet ohne Bibliotheksordner).

### Phase 7c-1: DLNA finden und steuern

Ohne Server findet und steuert der Kern Fernseher über DLNA (UPnP MediaRenderer) selbst. Vorlage: UPnP Device Architecture 1.0, AVTransport:1, RenderingControl:1 (öffentliche Spezifikation), `cast-controller.ts` / `dlna_cast.helpers.ts` (Ereignis `dlna-cast` und seine Form), Aufzeichnung `DLNA_CAST.*` (Anfrage-Formen, `current` → `null`).

| Teil | Ort | Inhalt |
|---|---|---|
| UPnP-Wörter | `native/src/core/cast/upnp.ts` | M-SEARCH bauen, SSDP-Antwort lesen (`LOCATION`), Geräte-Beschreibung lesen (Name, Hersteller, Modell, UDN, Steuer-Adressen von AVTransport und RenderingControl, `URLBase`/relative Adressen), SOAP-Hülle bauen (`SOAPAction`), Antwort und UPnP-Fehler lesen, DIDL-Lite, Zeiten `H:MM:SS`. Eigenes XML-Lesen, keine Abhängigkeit |
| Bereich `cast` | `native/src/core/cast/cast.ts`, `registry.ts`, `switches.ts` | Schalter `cast`, Standard aus, mit „ohne Server“ an. Alle 10 Adressen von `API_ENDPOINTS.DLNA_CAST`: `discover` (antwortet sofort `true`, nach 3 s Ereignis `devices`), `start` (Stop → SetAVTransportURI mit DIDL-Lite → Play, bis 50 s wiederholt, weil LG erst nach dem Öffnen „Play“ annimmt → Seek REL_TIME), `control` (play/pause/seek/skip/volume, danach Status), `status`, `stop` (`stopped` mit Position des Fernsehers), `current`, `load`, `switch-stream`, `forward`, `forward-close`. Während einer Sitzung jede Sekunde ein `status`-Ereignis; 5 Fehlversuche → `tv-off` + `stopped`. LG (Hersteller „LG“) heißt `webos`, Lautstärke dann `-1` wie beim Server |
| Adresse für den Fernseher | `reachableUrl` in `cast.ts` | Eine Quelle aus dem Netz geht unverändert durch (auch bei `forward`); eine Adresse des Geräts selbst (`127.*`, `localhost`, `::1`) → 503 „needs the outlet (7b)“, `file:` → `invalid-stream`. Kopfzeilen kennt die Anfrage nicht; der WLAN-Ausgang kommt in 7b |
| Modul | `native/modules/core-cast/` | Nitro wie `core-sandbox`: `cpp/SsdpSearch.cpp` (geteiltes C++, nur POSIX: UDP-Socket, TTL 2, zwei Sendungen, `poll` bis zur Frist, Antworten an den Absender), `cpp/HybridCoreCast.hpp` (eigener Faden je Suche), `HybridCoreCastLock.kt` (dünn: `WifiManager.MulticastLock` nur während der Suche, Berechtigung `CHANGE_WIFI_MULTICAST_STATE` im Manifest des Moduls). Erzeugter Code eingecheckt (`npx nitrogen@0.37.2`). iOS: podspec da, ungebaut (iOS verlangt dafür die Multicast-Berechtigung von Apple) |
| App | `native/src/api/client/core-cast.ts`, `core-switch.ts` | `cast` in der Umgebung des Kerns; Prüf-Link `core?cast=discover` (nur Test/scratch): Suche, je Gerät Name und Steuer-Adressen ins Log, dann nur lesend `GetTransportInfo` und `GetVolume` |

Bewusst nicht in 7c-1: Wiedergabe auf dem Fernseher (nicht freigegeben), WLAN-Ausgang und Google Cast über ihn (7b/7c-2), Ereignis-Abo (GENA) statt Abfragen.

**Tests:** `cast/upnp.test.ts` (SSDP, Beschreibung, SOAP, DIDL-Lite, Zeiten; erfundene Beispiele nach Spezifikation, Adressen aus 192.0.2.0/24), `cast/cast.test.ts` (erfundener Fernseher: Suche mit doppelter Antwort, `webos`, leere Liste ohne Multicast, Start-Reihenfolge, Play-Wiederholung, Steuern, Stop, Laden, Spur wechseln, `gone`/`not-connected`/`tv-off`, Adressen; alle 10 Adressen gehören `cast`; `current` = `null` wie aufgezeichnet), `app-links.test.ts`.

**Am Gerät** (Tablet, scratch, Build `c2ac9a2`, 14.11. 16:07): `libSeanimeCoreCast.so` geladen, `core?cast=discover` → Suche lief ohne Fehler, **0 Renderer in 3143 ms**. Der Fernseher war nicht erreichbar: Ping vom Tablet und vom PC ohne Antwort, eine SSDP-Suche vom PC fand ihn ebenfalls nicht → vermutlich aus/Standby. **LG-Fund, `GetTransportInfo` und `GetVolume` am Gerät daher nicht belegt** – bei eingeschaltetem LG den Link wiederholen. Kein SetAVTransportURI/Play gesendet. Danach `areas answered by the core: none`.

**16-KB-Seiten:** `libSeanimeCoreCast.so` aus der APK, arm64-v8a 238 656 Bytes, armeabi-v7a 152 920 Bytes, alle `LOAD` mit Ausrichtung `0x4000` ✅. APK scratch 130 744 500 Bytes.

Prüfzahlen: `npx tsc --noEmit` 0 Fehler; `npx vitest run` 157 Dateien / 1533 Tests grün (im ersten Lauf während des Builds 3 zeitabhängige Fehlschläge in `manage.test.ts` / `notice-behavior.test.ts`, allein und im zweiten Gesamtlauf grün); `npx expo lint` 0 Fehler, 341 Warnungen.

**Offen:** LG eingeschaltet suchen und lesend abfragen; Wiedergabe am LG nach Nicks Freigabe; WLAN-Ausgang (7b) und Google Cast darüber (7c-2).

### Phase 7b: Ausgang im WLAN

Ein Fernseher (DLNA oder Google Cast) holt Dateien der App jetzt über einen zweiten Port des vorhandenen Asio-Ausgangs aus 6b-2, statt über Gos `/dlna-cast/forward`. Vorlage: RFC 7233 (Range), DLNA-Kopfzeilen nach öffentlicher DLNA-/UPnP-Doku, POSIX (`pread`, `getifaddrs`, `getsockname`); kein Go, keine neue Abhängigkeit. **Nicht drin:** Wiedergabe am Fernseher (nicht freigegeben, 7c-2), Online-Streams mit Kopfzeilen, Tonspur-Remux (`?audioTrack` des Servers entfällt).

**Ausgang** (`native/modules/core-torrent/cpp/StreamServer.hpp/.cpp`, Sitzungs-Seite `TorrentServe.cpp`, Nitro `shareFile`/`shareTorrent`/`unshare` in `CoreTorrent.nitro.ts`, erzeugter Code neu mit `npx nitrogen@0.37.2`):

| | |
|---|---|
| Adresse | `http://<WLAN-Adresse>:<Port>/<Token>/<Dateiname>`. Port vom System gewählt, eigener Token je Freigabe (64 Hex-Zeichen aus `std::random_device`), der 127.0.0.1-Port des Players bleibt wie in 6b-2 |
| Bindung | nur an die IPv4-Adresse des Geräts zum Empfänger hin (UDP-`connect` + `getsockname`, nur private Bereiche 10/8, 172.16/12, 192.168/16), sonst die erste Adresse eines `wlan*`-Geräts, sonst eine private außer `rmnet*` (Mobilfunk). Keine: Fehler „the device is in no Wi-Fi“ |
| Offen | nur während einer Freigabe: der Port öffnet mit der ersten, schließt mit `unshare` oder von selbst nach **10 min ohne Leser** (Prüfung alle 30 s; ein offener Leser hält ihn). Andere Adresse → alter Port und seine Leser enden |
| Anfragen | wie 6b-2: nur `GET`/`HEAD` (sonst 405), `Range` nach RFC 7233 (206/416), falscher Token, Wurzel oder jeder andere Pfad → 404, keine Listen |
| Quellen | (a) Datei eines Torrents der Sitzung (Stücke wie 6b-2, Leser warten), (b) normale Datei per Pfad (Offline-Folge `core-offline/…`, alte Server-Downloads `mobile-offline/…`, lokale Bibliothek): `stat` beim Freigeben, dann `pread64` in Teilen zu 256 KiB auf dem Faden des Ausgangs, keine Sitzung nötig. Hält die Sitzung beim Stop noch Datei-Freigaben, bleibt der Ausgang offen und vergisst nur die Torrents |
| Kopfzeilen | `Content-Type` nach Endung (mp4/m4v, mkv, webm, avi, ts/m2ts, vtt, srt, ass/ssa), `Accept-Ranges: bytes`; Video zusätzlich `transferMode.dlna.org: Streaming` und `contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000` (Bytes-Range, kein Zeit-Sprung), anderes `Interactive` |
| Log | je Anfrage eine Zeile `outlet (wifi): GET Range bytes=a-b of n -> 206`, dazu `open` / `closed` / `closed after 10 minutes without a reader`; nie Token oder Dateiname. Die App loggt die Adresse mit `<token>` |

**Kern-Anbindung** (`native/src/core/cast/cast.ts`, Umgebung `castOutlet` in `registry.ts`, Geräte-Seite `castOutletFor` in `api/client/core-cast.ts` über `deviceTorrent()`):

| Quelle in der Anfrage | Ergebnis |
|---|---|
| `file:///…` oder `/…` | Datei-Freigabe Richtung Fernseher |
| Torrent-Ausgang `http://127.0.0.1:<Port>/<32 Hex>/<Info-Hash>/<Index>/<Name>` | Freigabe derselben Torrent-Datei |
| Adresse im Netz ohne Kopfzeilen | unverändert durchgereicht |
| Anfrage mit `headers` (nicht leer) | 501 „a stream that needs request headers cannot be cast by the core“ |
| anderer Loopback (Server-Streams, `localhost`, `[::1]`) | 503 „this stream of the device cannot be cast by the core …“ |
| ohne `castOutlet` | 503 „the outlet into the network is not available here“ |

`DlnaCastStart` (Richtung = Host der AVTransport-Steueradresse), `load`, `switch-stream`, `forward` (Richtung = `host` des Google-Cast-Geräts) beenden zuerst die alte Freigabe und geben dem Fernseher die neue Adresse. Freigabe endet bei `stop`, `forward-close`, misslungenem Öffnen, `tv-off` (5 Fehlversuche), einer Netz-Quelle per `load`, spätestens nach 10 min Leerlauf im Modul.

**Prüf-Link** (nur Test- und scratch-App): `core?cast=outlet-check` schreibt eine eigene Prüfdatei (`core-outlet-check.mkv`, 131 072 Zeilen zu 32 Bytes + `end\n` = 4 194 308 Bytes) in die Dokumente, gibt sie über den Bereich `cast` frei (`forward` ohne Host), loggt die **ganze Adresse samt Token** (nur dieser Link, damit ein PC im WLAN sie lesen kann), hält 120 s, dann `forward-close` und die Datei wird gelöscht. Kein Fernseher, keine Wiedergabe.

**Am Gerät** (S22, Test-App, Nutzer 0, Build von `d3bf158`, 14.11.2026 16:39–16:42, Abfrage von einem Node-Skript am PC im selben WLAN, Adresse aus dem Log; kein Fernseher, keine Wiedergabe):

| | |
|---|---|
| Freigabe | `outlet (wifi): open`, Adresse an der WLAN-Adresse des S22 auf einem Port vom System, 52 ms nach dem Schreiben der Prüfdatei |
| `HEAD` | 200, `Content-Length` 4 194 308 = Dateigröße, `video/x-matroska`, `Accept-Ranges: bytes`, `transferMode.dlna.org: Streaming`, `contentFeatures.dlna.org: DLNA.ORG_OP=01;…` |
| Anfang `bytes=0-1048575` | 206, `Content-Range` richtig, SHA-256 gleich (`ed0aad43…`), 230 ms |
| Mitte `bytes=2000000-3048575` | 206, richtig, SHA-256 gleich (`7799dbe8…`), 235 ms |
| Ende `bytes=-1048576` | 206, `bytes 3145732-4194307/4194308`, SHA-256 gleich (`d96672f9…`), 226 ms |
| ganze Datei / hinter dem Ende | 200, SHA-256 gleich (`5976856b…`) / 416 `bytes */4194308` |
| falscher Token / Wurzel / `POST` | 404 / 404 / 405 |
| nach 120 s `forward-close` | `outlet (wifi): closed`, danach vom PC **Verbindung abgelehnt** (`ECONNREFUSED`), Port nicht mehr lauschend; die Prüfdatei löscht der Link danach selbst (nicht nachgeprüft) |
| Log | je Anfrage eine `outlet (wifi)`-Zeile ohne Token und Namen; Abstürze 0; danach `areas answered by the core: none` |

**16-KB-Seiten:** `libSeanimeCoreTorrent.so` aus der APK, arm64-v8a 6 647 104 Bytes, armeabi-v7a 4 329 068 Bytes, alle `LOAD` mit Ausrichtung `0x4000` ✅. APK der Test-App 117 131 325 Bytes.

Prüfzahlen: `npx tsc --noEmit` 0 Fehler; `npx vitest run` 157 Dateien / 1540 Tests grün; `npx expo lint` 0 Fehler, 341 Warnungen. `backend/` und `native/modules/seanime-server` unverändert.

**Tests:** `cast/cast.test.ts` (Quelle unterscheiden, Google Cast teilen und schließen, DLNA-Start/`switch-stream`/`load`/`stop` mit Freigabe und Ende, `tv-off` beendet die Freigabe, Fehler vor jeder Frage an den Fernseher), `core-torrent.test.ts` (Hülle: Pfad, Form der Adresse, `unshare`), `app-links.test.ts`. Der C++-Teil ist am Gerät über den Prüf-Link belegt.

**Offen für 7c-2:** Wiedergabe am LG über den Ausgang (nach Nicks Freigabe), Google Cast mit echtem Gerät, Untertitel als eigene Freigabe neben dem Video, Online-Streams mit Kopfzeilen (eigener Weiterleiter), Tonspur-Wahl ohne Server-Remux, IPv6.

### 8-ms-Sammellauf (14.11.)

Sammel-Lauf für die offenen Kern-Stücke über 8 ms aus 3g, 4a-2, 4b-C1K, 4b-C2, 5a-3 und 5b-2. Ein Fix, ein Test-Build (scratch, Stand `d3bf158`, APK 130 808 716 Bytes), am Pixel Tablet (Nutzer 10) nur Links: vorher mit dem zuvor installierten Build (16:15), nachher mit dem neuen (16:46). Kein Abspielen, nichts an AniList geschrieben.

**Ursache (gemeinsam für die „after start“-Stücke):** `afterCallersTurn()` (3g) wartete nur einen Promise-Job. Der Aufrufer (Hook, Query-Bibliothek, React nach dem Aufbau einer Seite, der Player mit seinen Nachrichten) macht aber in eigenen Promise-Jobs weiter; beim ersten `await` des Kerns auf etwas schon Erfülltes liefen diese Jobs im offenen Stück und zählten als Kern-Zeit. Nachgestellt in `blocking.test.ts` „starts a request after its caller's promise jobs too, in front only“: mit einem Promise-Job **21 ms** (20 ms Arbeit des Aufrufers + 1 ms Kern), mit Fix **1 ms**. **Fix:** neue Methode `watch.afterCallersTurn()` (`core/blocking.ts`): vorn ein Zeitgeber (`free`), dann sind Durchgang und Promise-Jobs des Aufrufers vorbei; im Hintergrund (Zeitgeber stehen) wie bisher ein Promise-Job. `core-switch.ts` nutzt sie für Anfragen, Player- und Playlist-Nachrichten.

| Stück | vorher | nachher (Tablet) | Ursache | Stand |
|---|---|---|---|---|
| `GET /status/home-items` beim Einschalten (`area=settings`, Link frischt alle Abfragen auf) | 72,7 ms „after start, until sql“ (Tablet, 16:15) | keine Meldung | Promise-Jobs des Aufrufers im Stück | behoben (Fix oben) |
| 5a-3 `library/collection` erster Aufruf | 11,4 ms (Tablet) / 5,7 ms (16:15) | **16,6 ms** „after start, until sql“ | beginnt jetzt nach dem Zeitgeber → echte Kern-Arbeit vor dem ersten SQL beim ersten Aufruf nach dem Einschalten (Prüf-Link `library=home`) | **offen** (teilen, nächster Lauf) |
| 5a-3 `list-missed-sequels` | 9,4 / 9,2 / 12,4 ms (S22) | 7,7 ms („after sql, until sql“) | Seiten von 25 (5a-3 nach der Messung) | geschlossen, unter 8 ms |
| 5a-3 `schedule` | 8,4 ms (S22) | 3,8 ms | – | geschlossen, unter 8 ms |
| 5b-2 `video-seeked`, `anime-entry/{id}`, `play/localfile` | 25,2 / 8,9 / 9,7 ms | nicht nachgemessen (kein Abspielen) | „after start“: dieselbe Ursache wie oben (5a-1: 28,8 ms ohne SQL beim ersten Sprung) | Fix greift, Gerät offen |
| 4b-C1K `done` im Hintergrund | 13,2 / 26,1 ms | nicht nachgemessen | im Hintergrund kein sichtbares Bild; Pausen warten dort bewusst nicht (Zeitgeber stehen), der gebremste Faden misst langsamer | **geschlossen:** kein Ruckeln möglich, Wächter zählt dort nur mit |
| 4b-C2 „event of the loader“ im Hintergrund | 22,9 ms | nicht nachgemessen | wie 4b-C1K | **geschlossen** wie 4b-C1K |
| 4b-C2 vorn: Auftrag bauen, `download-data`, `downloads` (erster Aufruf) | 12,1 / 12,0 / 10,6 ms | nicht nachgemessen (Download in scratch nicht gestartet) | ohne Ort („where“) im Protokoll; erste Aufrufe aus Hooks → Fix greift für „after start“ | offen bis Nachmessung |
| 3g A/C, 4a-2 Sandkasten kalt | 29,5 / 22,7 ms; 82,6 / 30,7 / 16,2 / 14,5 ms | Selbsttest: längstes **16,5 ms** (vorher am Tablet 18,8 ms), 2 von 355 über 8 ms; längster Modul-Aufruf `keepScript` 5,96 ms | Selbsttest nennt den Ort nicht; Sandkasten-Arbeit selbst läuft im eigenen Faden | offen (Messpunkt im Selbsttest nötig) |
| neu: `GET /status` kalt nach Start | – | 13,5 ms „after sql, until sql“, 30,8 ms „after sql, until end“, 9,6 ms „reading AniList's answer“ | Lesen/Formen nach SQL beim ersten Aufruf | **offen** (neu gefunden) |

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 157 Dateien / 1534 Tests grün (`manage.test.ts` „closes an idle sandbox …“ lief parallel zum Build in den 6-s-Timeout, einzeln 27/27 grün); `npx expo lint` 0 Fehler, 341 Warnungen. Endstand: `areas answered by the core: none`.

**Build:** Der erste Versuch brach bei `packageRelease` ab, der Wiederholungsversuch am Fehler in `core-torrent/cpp/StreamServer.cpp` aus `6f453b7` (Torrent-Lauf, behoben in `d3bf158`); gebaut wurde dann vom Stand `d3bf158`.

### 8-ms-Runde 2 (14.11.)

Zweiter Lauf für die offenen Stücke aus dem Sammellauf. Erst Messpunkte (`mark`), dann Teilen; ein Test-Build (scratch, Stand `34a4fe4`, APK 130 823 628 Bytes; der erste Versuch brach wie im Sammellauf bei `packageRelease` ab, der unveränderte zweite lief durch), am Pixel Tablet (Nutzer 10) nur Links, kalt nach `install -r`. Kein Abspielen, nichts an AniList geschrieben; das eine geladene Manga-Kapitel (Dr. STONE, `dipland-mangafire`, 53 Seiten, 48 960 211 Bytes) wieder gelöscht (`remove: 1 chapters deleted, folders left 0`).

**Neu:** Messpunkte `core` (Kern beginnt) und `answered` (Kern fertig, danach nur Rückweg und Log-Zeile) in jeder Anfrage (`core-switch.ts`); Pausen mit Messpunkt vor jedem Lesen in `library/collection` (`library: database/kept lists/watched/own files`, `library/home.ts`) und `GET /status` (`status: settings/user/kept part/build/answer/built`, `start/start.ts`); Download-Tabelle in Schritten zu 50 Zeilen mit Pause dazwischen, Messpunkte beim Bauen des Auftrags und in der Download-Liste (`manga/downloads.ts`); der Sandkasten-Selbsttest schreibt jedes Stück über 8 ms mit Probe und Wartestellen ins Log (`piecesOverLimit`, `extensions/sandbox/selftest.ts`, `core-sandbox.ts`). Tests vorher rot / nachher grün: `home.test.ts` (18 → ≤ 8 ms), `start.test.ts` (10 → ≤ 8 ms), `downloads.test.ts` (0 → ≥ 2 Pausen bei 130 Zeilen), `sandbox.test.ts` (`piecesOverLimit`), `blocking.test.ts` (Naht mit `core`/`answered`).

**Befund (gemeinsam):** Die Messpunkte zeigen lange Abschnitte, in denen der Kern selbst fast nichts tut: `library/collection` 16,0 ms, davon **11,8 ms zwischen `library: database` und `library: kept lists`** (nur `await database()` auf ein schon erfülltes Versprechen und eine Pause, die nicht wartete, weil das Stück bei ihrer Prüfung noch unter 4 ms lag); `GET /manga/downloads` 17,8 ms, davon 16,0 ms ab `manga downloads: list` (zwei Manga filtern, dann die erste Anweisung); `download-data` 14,9 ms für zwei Zeilen. Zur selben Zeit liefen andere Kern-Anfragen des Prüf-Links (Zeitplan, Status, Laden-Ereignis); deren Teil-Namen erscheinen im fremden Stück (`GET /status (reading AniList's answer)`, `GET /library/schedule (library: kept lists)` 19,4 ms). **Ursache:** Mehrere gleichzeitige Anfragen machen in Promise-Jobs desselben Durchgangs weiter; der Faden kommt dazwischen nicht frei, und der Wächter (ein offenes Stück) rechnet die Summe der gerade offenen Anfrage zu. Das Halten des Fadens ist echt, der Ort im Namen nicht. Eine Pause hilft nur, wenn sie das lange Stück sieht – sie prüft vor den Sprüngen der anderen.

| Stück | vorher | nachher (Tablet) | Ursache | Fix / Stand |
|---|---|---|---|---|
| 5a-3 `library/collection` erster Aufruf | 16,6 ms „after start, until sql“ | 16,0 ms, davon 11,8 ms zwischen zwei Messpunkten ohne Kern-Arbeit | gleichzeitige Anfragen im selben Durchgang (s. o.) | Messpunkte + Pausen (`library/home.ts`); **offen:** Wächter je Anfrage oder Anfragen des Prüf-Links nacheinander |
| `GET /status` kalt nach Start | 13,5 / 30,8 / 9,6 ms | kalt mit `settings`+`anilist` an (zweites `install -r`): **keine Meldung**; beim Einschalten 13,5 ms unter fremdem Teil-Namen | dto. | Messpunkte + Pausen (`start/start.ts`); kalt **geschlossen** |
| Sandkasten-Selbsttest kalt | 16,5 ms, 2 von 355 über 8 ms, Ort unbekannt | 3 von 355: **24,3 ms `open`** (after start, until sandbox create = erstes Anlegen), **29,8 ms `helpers`** (zwischen zwei `keepScript`, längster Modul-Aufruf `keepScript` 6,72 ms), 8,7 ms `helpers` (network 7,2) | erstes Anlegen bzw. Vorbereiten des Helfer-Skripts im Faden | Ort jetzt im Log (`piecesOverLimit`); **offen:** teilen |
| 4a Manga kalt (Prüf-Link `manga=check`) | Suche 82,6, Details 30,7, Seite 16,2 ms | Suche 41,9 („after sql, until pause“), `findChapters` 28,8, `pages` 21,8 („core 21,7“), Seite 16,1, Details 11,3 ms | wie oben + Sandkasten-Antworten formen | **offen** |
| 4b-C2 `download-data` erster Aufruf | 12,0 ms | 14,9 ms „until end; core 14,6“ bei 2 Zeilen | gleichzeitige Anfragen (Tabelle in Schritten bringt hier nichts) | Tabelle in 50er-Schritten (`manga/downloads.ts`), sonst **offen** |
| 4b-C2 `downloads` | 10,6 ms | 17,8 ms (16,0 ms ab `manga downloads: list`) | dto. | **offen** |
| 4b-C2 Auftrag bauen | 12,1 ms | keine Meldung (`download-chapters (manifests)` 16,1 ms „after sql, until sql“) | – | Auftrag **geschlossen**; Manifeste offen |
| 4b-C2 Laden-Ereignis (vorn) | – | 17,1 ms „after start, until sql“ | dto. | **offen** |

**Nächster Schritt:** der Wächter muss gleichzeitige Anfragen auseinanderhalten (oder eine Pause muss auch nach den Sprüngen der anderen prüfen), sonst landet jede Teilung am falschen Ort.

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 157 Dateien / 1551 Tests grün; `npx expo lint` 0 Fehler, 341 Warnungen; `git diff --stat a197993 -- backend/ native/modules/seanime-server` leer. Endstand: `areas answered by the core: none`.

### Phase 7f: Server-Reste vor Stufe 8

Vor dem Löschen des Servers: jede Schnittstelle, die die App wirklich aufruft (Hook mit Aufrufer auf einem Bildschirm, nicht nur Invalidierung) und die der Kern ohne Server nicht beantwortet hat. Abgleich der Liste vor Stufe 5 gegen alle Routen in `native/src/core` (155). Ausgenommen: Torrent-Client (läuft parallel), Nakama-Gast, Cast-Wiedergabe. Ohne echten Aufrufer und deshalb nicht angefasst: `anilist/cache-layer/status` (schon `onlyWithServer`), `library/missing-episodes` (nur invalidiert), `directory-selector`, `filecache/*`, `logs/*`, `memory/*`, `videocore/*`, `playback-manager/next-episode|cancel|sync`, `mobile-offline/manga`, `download-torrent-file`, `open-in-explorer`, `local/sync-simulated-to-anilist`.

Regel: bauen, wenn klein und sauber ohne fremden Code, sonst bewusst entfernen nach Muster 7a (nur ohne Server, `withoutServer`; mit Server geht alles wie vorher zum Server).

| Schnittstelle | gebaut / entfernt | Grund | rückholbar wie |
|---|---|---|---|
| `GET`/`POST`/`DELETE /api/v1/manga/source-refresh` | **gebaut**, nur Modus `refresh_selected` (`core/manga/source-refresh.ts`, Routen in `registry.ts`): für jede Manga mit gewählter Quelle (`mangaPreferences`, bei `mediaIds` nur diese) das Gemerkte vergessen und die Kapitel-Liste neu holen; dabei schreibt `keepChapterNumber` die „neueste Kapitel“-Zahl. Lauf im Hintergrund, Zustand per Ereignis `manga-source-refresh-job-updated`; `DELETE` hält einen Lauf nach der laufenden Manga an bzw. vergisst einen beendeten. Andere Modi → 503 „Finding other manga sources is not available without the server“; im Blatt (`manga-source-refresh-sheet.tsx`) ohne Server ausgeblendet, „Alternativen finden“ ebenso. Die GET-Abfrage ist nicht mehr `onlyWithServer` | eigene einfache Regel; Finden/Ersetzen von Quellen folgt Regeln, die keine Aufzeichnung nennt | Modi `find_missing`/`refresh_and_find`/`reevaluate_all` im Kern bauen, Filter im Blatt entfernen |
| `POST /api/v1/custom-source/provider/list/anime` und `/manga` | **entfernt** (`removed.ts`): leise leere Liste `{ media: [], page: 1, totalPages: 0, total: 0 }`; „Durchsuchen“ (Erweiterungen), „Quelle durchsuchen“ (Erweiterungs-Blatt) und „Eigene Quellen“ (Suche) ohne Server ausgeblendet | Nummern der Medien vergibt der Server, und die Seiten dieser Medien (Anime-/Manga-Seite mit fremden Nummern) kann der Kern nicht; die Liste allein führte ins Leere | Tabelle eigener Nummern in `core.db` plus Seiten für diese Nummern bauen, Zeilen aus `removed.ts` und die drei `isServerOff()` entfernen |
| `POST`/`DELETE /api/v1/metadata-provider/filler` | **entfernt**: 503 „Filler lists are not available without the server“; Gruppe „Filler-Folgen“ im Blatt „Filler und Specials“ (`anime-entry-phone-menu.tsx`) ohne Server ausgeblendet | Quelle ist eine fremde Webseite ohne Schnittstelle/Lizenz (§4p) | Zeilen aus `removed.ts` löschen, Abfrage bauen, `isServerOff()` entfernen |
| `POST /api/v1/debrid/torrents` (Debrid-Download in einen Ordner) | **entfernt**: 503 „Debrid downloads into a folder are not available without the server“; Schalter „über Debrid“ im Download-Blatt (`torrent-search-phone.tsx`) ohne Server aus (`debridOn`) | nicht klein: Warten auf den Dienst (Stunden), mehrere Dateien in den Bibliotheksordner, am Gerät ohne Debrid-Konto nicht prüfbar; Debrid-Stream bleibt im Kern | Lauf über `native/modules/core-download` + Bereich `offline` bauen, Zeile aus `removed.ts` und `!isServerOff()` entfernen |
| `POST /api/v1/playback-manager/manual-tracking/start` (externer Player) | **entfernt**: 503 „Tracking an external player is not available without the server“ (klarer Toast statt „needs the server“) | Teil der Wiedergabe-Verwaltung des Servers; externe Player-Links zeigen ohne Server ohnehin auf keine Datei | Verfolgung im Kern bauen, Zeile aus `removed.ts` löschen |

`PATCH /debrid/settings` und `PATCH /torrentstream/settings` erschienen im groben Abgleich, beantwortet der Kern aber schon (andere Schreibweise in `registry.ts`).

**Tests:** `core/manga/manga.test.ts` (Lauf: Kapitel neu geholt, Zahl 5 gemerkt, Job `completed`, `DELETE` vergisst; Such-Modi → 503 mit Text; Routen nur `withoutServer`), `core/removed/removed.test.ts` (6 neue Zeilen leise/503 ohne Server, mit Server zum Server und `coreHasRoute` false; Ausblenden in 5 Bildschirmen), `without-server.test.ts` und `ui-parity-r5.test.ts` angepasst.

**Am Gerät** (Tablet, scratch, Build `ae50d69`, 14.11. 17:45–17:49): AniList-Wächter ok. `core?server=off`, Neustart per `install -r` (17:46:18), Log `The app runs without its server`, alle Bereiche an. Dr. STONE per Link → „Mehr“ → „Filler und Specials“: Filler-Gruppe weg (Screenshot). Listen des Test-Kontos leer → keine Manga-Seite mit „Quelle neu laden“ und kein „Quellen“-Knopf (zeigt sich nur mit Manga in der Liste); dafür nur im Test belegt. Im Log 0 Zeilen „needs the server“. `core?server=on` → `areas answered by the core: none`, `libseanime.so` Kind von scratch, `anilist-clear` über den Server: 0 Einträge.

**Offen:** Für Anime mit AniDB-Nummer ist das Blatt „Filler und Specials“ ohne Server leer (Specials nur ohne AniDB) – der Menüpunkt sollte dann ganz wegfallen. Source-Refresh am Gerät mit einer Manga in der Liste.

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 158 Dateien / 1576 Tests grün; `npx expo lint` 0 Fehler, 341 Warnungen. APK scratch 124,8 MB. `git diff --stat f560c3c -- backend/ native/modules/seanime-server` leer.

### Phase 7d: Nakama aufgezeichnet

**Aufbau** (14.11.2026 21:08–21:11): Gastgeber = Seanime Denshi 3.10.4 am PC (Nakama-Gastgeber war schon an, Bibliothek geteilt; nur das Gastgeber-Passwort für die Dauer auf ein Zufallspasswort gestellt, danach zurück). Gast = scratch-App mit Server (Build von `c409e31`, `libseanime.so` drin) am Tablet, Nutzer 10. Weg: Tablet → `adb reverse tcp:43299` → Mitschnitt-Proxy am PC (nur `127.0.0.1:43299` → `127.0.0.1:43211`), der HTTP (Methode, Pfad, Kopfzeilen ohne Geheimnis-Werte, Körper-Form) und WebSocket-Rahmen (Richtung, Typ, Felder) protokolliert. Gast-Einstellungen über die Einstellungs-Schnittstelle des Gast-Servers gesetzt (wie „Speichern“ in der Oberfläche), danach zurück. Mitschnitt außerhalb des Repos. Zahlen: 2 WS-Verbindungen, 10 HTTP-Anfragen, 32 WS-Textnachrichten (2 `auth`, 2 `auth_reply`, Rest `ping`/`pong`).

**Auth:** Kein Passwort in der URL. Der Gast öffnet `GET /api/v1/nakama/ws` (WebSocket) mit den Kopfzeilen `X-Seanime-Nakama-Token` (= Gastgeber-Passwort im Klartext), `X-Seanime-Nakama-Username` (Gast-Name), `X-Seanime-Nakama-Peer-Id` (UUID des Gasts, bleibt über Neuverbindungen gleich), `X-Seanime-Nakama-Server-Version` (z. B. `3.10.4`). Erste Nachricht des Gasts: `{type:"auth", payload:{password, peerId}, timestamp}`; Antwort `{type:"auth_reply", payload:{success, message, username (= Gastgeber-Name), peerId}, timestamp}`. Alle HTTP-Anfragen an den Gastgeber tragen ebenfalls `X-Seanime-Nakama-Token`; der Gastgeber setzt zusätzlich ein Cookie und `X-Seanime-Client-Id`/`-Proof`, die der Gast (Go-Client) mitschickt, aber nicht braucht.

**WS-Nachrichten:** Form immer `{type, payload, timestamp}` (Zeit RFC 3339). Gesehen: `auth`, `auth_reply`, `ping`/`pong` (payload `null`) – beide Seiten pingen: der Gastgeber etwa alle 10 s, der Gast alle 30 s, die andere Seite antwortet mit `pong`. Kein eigenes Abmelde-Telegramm: Trennen = TCP zu (ohne Close-Rahmen). Beim Umstellen der Einstellungen baut der Gast sofort neu auf (alte Verbindung zu, neue mit `auth`).

**HTTP Gast → Gastgeber:**
- `GET /api/v1/nakama/host/anime/library` → `{data:{localFiles:[LocalFile…], animeCollection:{MediaListCollection:{lists:[{name,status,isCustomList,entries:[…]}]}}}}` – geholt direkt nach der Anmeldung und bei jedem Laden der Bibliothek beim Gast (~700 KB bei 27 Dateien/171 Listeneinträgen). `LocalFile` = `{path, name, parsedInfo, parsedFolderInfo, metadata:{episode, aniDBEpisode, type}, locked, ignored, mediaId}`.
- `GET /api/v1/nakama/host/anime/library/files/{mediaId}` → `{data:{localFiles:[…nur diese Serie…], …}}` – beim Öffnen einer Serie, die nur der Gastgeber hat.
- `GET /api/v1/nakama/host/anime/library/shared` → `{data:true|false}` (teilt der Gastgeber seine Bibliothek).
- `GET|HEAD /api/v1/nakama/host/anime/library/stream?path=<Base64 des Gastgeber-Pfads>` → Datei mit `Accept-Ranges: bytes`, `206` + `Content-Range` bei `Range`, `Content-Type` nach Endung (z. B. `video/x-matroska`). Nur Token-Kopfzeile, kein Cookie nötig.

**Gast-Seite (was der Kern nachbauen muss):** Gast-Bibliothek = Gastgeber-Einträge ohne eigene Dateien als Nakama-Einträge (`nakamaLibraryData:{unwatchedCount, mainFileCount}`, `libraryData:null`), Serien-Seite mit `_isNakamaEntry`/`_isNakamaEpisode` aus `…/files/{id}`. Der Gast-Server reicht `GET /api/v1/nakama/stream?type=file&path=<Base64>` 1:1 (inkl. `Range`) an `…/host/anime/library/stream?path=` weiter. `POST /api/v1/nakama/play {path, mediaId, anidbEpisode, clientId, forcePlaybackMethod}` antwortet `{data:true}` und liest die Datei beim Gastgeber an (zwei `HEAD`, `GET Range: bytes=0-`, abgebrochen, `GET` auf die letzten ~280 Byte: Container-Kopf und -Ende); es schickt dabei keine WS-Nachricht an den Gastgeber. Ohne Server kann der Kern den Player direkt auf die Gastgeber-Adresse mit Token-Kopfzeile zeigen lassen.

**Nicht aufgezeichnet:** Wiedergabe am Gerät (der Player öffnete sich ohne `clientId` nicht – es lief nichts), Watch Party (braucht eine vom Gastgeber erstellte Party bzw. ein Zweitgerät), Gastgeber-Ereignisse beim Gast-Abspielen, Cloud-Räume (gestrichen, §4r 7a).

**Aufräumen belegt:** Denshi-Einstellungszeile in `seanime.db` nach dem Rücksatz in allen 110 Spalten gleich der Sicherung (nur `updated_at` neu), `config.toml` byte-gleich; Gast-Einstellungen der scratch-App gleich vorher; `adb reverse`/`forward` leer; Worktree entfernt; Tablet wieder mit der scratch-Fassung ohne Server.

**Offen für 7e (Gast im Kern):** WS-Client mit `auth`/`ping`/`pong` und Neuverbindung, Bibliothek mischen, Serien-Dateien, Stream-Adresse mit Token-Kopfzeile für den Player (Kopfzeile statt Query – Player muss Kopfzeilen können), Fortschritt beim Gast nur über AniList.

### Phase 7e: Nakama als Gast im Kern

**Stand 14.11.2026 (Kern + Tests, Gerät offen).** Code: `native/src/core/nakama/guest.ts` (Tests `guest.test.ts`). Die App ist nur Gast eines PC-Gastgebers (Seanime/Denshi); Gastgeber am Handy bleibt entfernt.

- **Verbindung:** WebSocket `<host>/api/v1/nakama/ws` mit `X-Seanime-Nakama-Token` (Passwort), `-Username` (Einstellung, sonst „Peer xxxx“), `-Peer-Id` (UUID, je Lauf gleich über Neuverbindungen), `-Server-Version` (`3.10.4`, die Version der Aufzeichnung). Erste Nachricht `auth{password, peerId}`; `auth_reply.success` → verbunden (Ereignisse `nakama-host-connected`, `nakama-status`). `ping` → `pong`, eigener `ping` alle 30 s. Verbindung weg → neuer Versuch nach 5 s, verdoppelt, höchstens 60 s. Abgelehntes Passwort → `nakama-error`, kein neuer Versuch bis Neuverbinden oder Einstellungs-Änderung. Start: mit der ersten Kern-Antwort eines Laufs (`nakamaAtStart`, `core-switch.ts`); jede gespeicherte `nakama.*`-Einstellung baut neu auf bzw. trennt (Nakama aus, keine Adresse). Den WebSocket mit Kopfzeilen liefert die App (`environment.nakamaSocket`, React Natives `WebSocket(url, null, {headers})`).
- **Einstellungen:** `nakama.enabled`/`remoteServerURL`/`includeNakamaAnimeLibrary` aus dem Kern-Speicher; das Gastgeber-Passwort geht beim Speichern in `expo-secure-store` (`seanime-nakama-host-password`), `core.db` hält `""`, der Status zeigt es wieder an (`withNakamaPassword`).
- **Schnittstellen:** `POST nakama/reconnect` (`{success, message}`), `POST nakama/cleanup` (Gast hat keine Peers), `GET nakama/host/anime/library/shared` (fragt den Gastgeber), `POST nakama/play`. Status: Der Nakama-Manager fragt den Kern (`coreAskNakamaStatus`) statt des Server-Sockets, Antwort als Ereignis `nakama-status` in Form `Nakama_NakamaStatus` (`isHost:false`, `connectionMode:"direct"`, `hostConnectionStatus{connected, authenticated, url, lastPing, peerId, username}`). Log-Zeilen `Nakama: connected to the host as a guest` / `disconnected` / Fehlertext, nie ein Passwort.
- **Bibliothek:** mit `includeNakamaAnimeLibrary` und Verbindung mischt `library/collection` die Gastgeber-Anime mit Dateien dort und ohne eigene Dateien als Nakama-Einträge ein (`nakamaLibraryData{unwatchedCount, mainFileCount}`, kein `libraryData`, Liste = eigener AniList-Status, sonst der des Gastgebers). `library/anime-entry/{id}` ohne eigene Dateien holt `…/files/{id}` und wird `_isNakamaEntry` mit Folgen `_isNakamaEpisode` („Shared by“ auf der Seite). Gastgeber nicht erreichbar → eigene Bibliothek unverändert.
- **Abspielen:** `nakama/play` sucht die Datei in `…/files/{mediaId}` und schickt `native-player`/`watch` mit `streamType:"nakama"`, `streamUrl = <host>/api/v1/nakama/host/anime/library/stream?path=<Base64 UTF-8, URL-kodiert>` und `requestHeaders{X-Seanime-Nakama-Token}`; der Player setzt sie als mpv `http-header-fields` (`streamHeadersOf` in `player-logic.ts`). Jede andere Datei setzt die Kopfzeilen leer, damit das Token nie an eine andere Adresse geht. Fortschritt läuft über `playback` wie bei jeder Folge.
- **Nicht gebaut:** Watch Party (Erstellen/Beitreten/Chat bleiben „needs the server“), Relay-Modus, Gastgeber am Handy.

**Gerät offen:** Build `8d73cb4` (scratch, `D:\SNB\Seanime-Native-4.0.0-scratch.apk`, 79 832 136 Bytes) liegt auf dem Tablet (Nutzer 10). Denshi-Gastgeber-Passwort war für den Lauf auf ein Zufallspasswort gestellt und ist zurück (Einstellungen gleich Sicherung außer `updatedAt`, `config.toml` byte-gleich), `adb reverse` entfernt. Verbinden, Bibliothek und ≤ 10 s Wiedergabe am Tablet sind nicht belegt (Aufruf-Budget des Laufs aufgebraucht, Nakama-Einstellungen der scratch-App nicht geändert).

**Gerätenachweis (14.11.2026, 21:36–21:46, Tablet Nutzer 10, scratch `8d73cb4`, Test-Konto):** Gastgeber = Denshi am PC (Nakama-Gastgeber an, Bibliothek geteilt, Passwort für den Lauf zufällig), Weg `adb reverse tcp:43211`. In der scratch-App über die Oberfläche Adresse `http://127.0.0.1:43211`, Passwort, „Use the host's anime library“ und Nakama an gesetzt.
- **Verbinden:** Kern-Log `Nakama: connected to the host as a guest` ~1 s nach dem Einschalten; Einstellungen zeigen „Connected to <Gastgeber>“, Nakama-Fenster Host = Gastgeber-Name, Modus „Direct“. „Reconnect“ → `disconnected` und nach ~0,1 s wieder `connected`, danach `library/collection` neu geladen.
- **Bibliothek:** Der Gastgeber teilt 3 Serien mit Dateien (27 Dateien); `library/collection` liefert danach Einträge (Kopfzeilen-Aktion „Playlists“ erscheint nur bei Einträgen). Sichtbar als Karten ist das auf Home nicht, weil die Home-Anordnung des Test-Kontos nur „Continue watching“ enthält (kein Abschnitt „local-anime-library“) und „My lists“ nur AniList zeigt – kein Fehler des Kerns. Anime-Seite einer Gastgeber-Serie (über den AniList-Link geöffnet): „Shared by <Gastgeber>“ neben „More“, Folgen aus `…/files/{id}` mit „Available“.
- **Abspielen:** `nakama/play` → `native-player`/`watch` mit `streamType:"nakama"`; mpv öffnet `http://127.0.0.1:43211/api/v1/nakama/host/anime/library/stream?path=…` mit der Token-Kopfzeile, Bild sichtbar, danach `KEYCODE_MEDIA_PAUSE`, Player über das × des Mini-Players geschlossen. Gegenprobe am PC mit derselben Adressform + Token + `Range: bytes=0-99`: `206`, `Content-Range: bytes 0-99/…`. Die Wiedergabe lief ~34 s statt ≤ 10 s (Warteschleife des Prüfskripts lief wegen einer fehlerhaften Zeitmarke voll durch); dabei setzte die Folge den Fortschritt des Test-Kontos auf 1 (Status „Watching“). Erster Versuch mit einer anderen Serie: „Playback error: loading failed“ – der Gastgeber antwortet `404 file not found`, weil deren Dateien auf dem PC nicht mehr liegen (Gastgeber-Bibliothek veraltet; 18 der 27 Dateien fehlen); kein Fehler des Gasts. Dass die Seite solche Folgen trotzdem als „Available“ zeigt, kommt aus der Liste des Gastgebers.
- **Aufräumen:** Adresse und Passwort in der scratch-App geleert, beide Schalter wieder aus (Ausgangszustand), `adb reverse` leer; Denshi-Passwort zurück (Einstellungen gleich Sicherung außer `updatedAt`, `config.toml` byte-gleich), Sicherungen mit Token gelöscht.
- **Offen:** Fortschritt des Test-Kontos (1/12) bleibt; Watch Party weiter nicht gebaut.

## 4s. Abschluss (Stufe 8)

### Stufe 8a-1 (14.11.2026): der Go-Server kommt aus der App

**Entfernt:** `native/modules/seanime-server/` (Dienst `SeanimeServerService`, `SeanimeServerModule`, Manifest mit `FOREGROUND_SERVICE_SPECIAL_USE` und dem `specialUse`-Dienst, `jniLibs/<abi>/libseanime.so`), `native/plugins/with-server-port.js` (samt Eintrag in `app.config.js`, schrieb nur `seanime.serverPort` für das Gradle des Moduls), `src/lib/server/server-restart.ts` + Test, Eintrag in `.gitignore`. `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` und `POST_NOTIFICATIONS` bleiben über `core-download`.

**Umgezogen** (brauchten nie den Server): `legacyPreferences()` und `feedbackState()` in das Modul `core-download` (`CoreDownloadModule.kt`, Typen in `modules/core-download/index.ts`); das Benachrichtigungs-Symbol `ic_stat_seanime.xml` nach `modules/core-download/android/src/main/res/drawable/` (liest `with-notification-icon.js` und `LoaderWays.kt`). `setLanguage` (nur Sprache der Server-Benachrichtigung) entfällt.

**Immer ohne Server:** `core-switch.ts` setzt `connectServerOff(() => true)` in jeder Variante, der MMKV-Wert `seanime-core-server-off` wird nicht mehr gelesen; `setServerOff`/`waitForServerSwitchedOn`/`connectServerState` entfallen, der Server „lauscht“ nie. Damit gelten wie in 5c-1 alle Bereiche als an, keine Startschranke, kein WebSocket `/events`, kein Neuladen nach `server-ready`; was nur der Server konnte, antwortet sofort mit 503 „needs the server“ bzw. der Meldung aus `removed.ts`. Der Link `core?server=off|on` wird weiter gelesen, ist aber ohne Wirkung (Log `without the server: yes (always, …)`). `client-providers.tsx` startet nichts mehr (Log `The app runs without its server, the server is not started`); `nativeServerAtom` ist fest „stopped“ für die Seite „Server-Status“ (Aussehen unverändert). Die Weiche `isServerOff()` und der Weg „mit Server“ bleiben im Code bis 8a-2; die Tests prüfen ihn, indem sie den Schalter direkt setzen.

**Bau:** `build-android.ps1` ohne Go-Schritt, ohne `-SkipGoBuild`, ohne Go-Umgebung; die Prüfung am Ende verlangt jetzt, dass **keine** `libseanime.so` im APK liegt.

**Daten-Umzug bleibt:** `core-move.ts` liest `seanime.db` und `cache/*.cache` direkt aus `Paths.document`, alte Offline-Folgen/-Kapitel und `files/extensions/` liegen ebenfalls im App-Speicher; nichts davon fragt einen laufenden Server. Am Tablet liegen `seanime.db`, `extensions`, `mobile-offline`, `manga` nach dem Update unverändert, die 10 Erweiterungen erscheinen.

**Release gesperrt (für 8b):** Der Updater von Seanime Mobile 2.0.33 (`app/…/AppUpdater.kt`, `validate()`) nimmt nur ein APK mit `lib/<abi>/libseanime.so` an. Ein Release ohne Server würde von 2.0.33 aus abgelehnt („APK does not support this device“). `build-android.ps1 -Release` bricht deshalb mit Begründung ab, bis 8b den Weg festlegt.

**APK** (Bau ohne Go, `unzip -l`):

| APK | vorher (Stand `c409e31`, mit Server) | **nachher** | `libseanime.so` | Bibliotheken entpackt |
|---|---|---|---|---|
| Test-App | 117,2 MB (117.171.105 B) | **71,0 MB (70.979.685 B)** | 2 → **0** | 251,9 → 121,6 MB |
| scratch | 130,9 MB (130.850.716 B) | **79,9 MB (79.878.580 B)** | 2 → **0** | – |

**Am Gerät** (14.11.2026 18:12–18:18, je `install -r`, nach ≥ 12 s `am start -W`):

- Pixel Tablet, scratch, Nutzer 10, Test-Konto: kein `libseanime.so` der scratch-App (der einzige Server-Prozess gehört der älteren Test-App in Nutzer 10, nicht angefasst); Log: alle Bereiche an, `The app runs without its server`. Home ✓, Meine Listen ✓ (Test-Konto leer), Downloads ✓, Menü ✓, Erweiterungen ✓ (10 installiert, wie vorher). 0 Zeilen „needs the server“, 0 JS-Fehler.
- S22, Test-App, Nutzer 0, echtes Konto, nur lesend: Play Protect fragte beim Installieren nach einem Scan (geänderte Datei) → „Nicht senden“. Danach **kein** `libseanime.so`-Prozess (vorher lief der Server der Test-App). Home mit „Weiterschauen“ und „Schaue gerade“ ✓, Black Clover 12/170 ✓, Downloads ✓. 0 „needs the server“, 0 JS-Fehler.
- Manga-Seite und Einstellungen wurden nicht einzeln geöffnet (Menü-Einträge sichtbar); keine Wiedergabe.

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 157 Dateien / 1574 Tests grün (−1 Datei `server-restart.test.ts`, Server-Weg-Tests setzen den Schalter jetzt selbst); `npx expo lint` 0 Fehler, 341 Warnungen. `backend/` nicht geöffnet.

**Offen für 8a-2/8b:** `backend/` und `app/` löschen (der Release-Test liest `app/…/AppUpdater.kt`), toter Code des Weges „mit Server“ (`isServerOff()`-Zweige, Startschranke, `askServer`, WebSocket, `server-url.ts`/Port, Seite „Server-Status“, `measure-android.sh` `server_pid`), Release-Weg von 2.0.33 (siehe oben), README/Name.

### Stufe 8a-2 (14.11.2026): Server-Code und alte App aus dem Repo

**Gelöscht (Git, bleibt in der Geschichte bis `cc0d8e7`):** `backend/` (Go-Server + `seanime-web`, 1583 Dateien), `app/` (alte Kotlin-App, 83 Dateien), dazu was nur sie baute oder prüfte: `Build.ps1`, Gradle-Wrapper und `build.gradle.kts`/`settings.gradle.kts`/`gradle.properties` im Wurzelordner, `tests/` (Python-/Playwright-Harnesse der Web-Oberfläche), `.github/workflows/ios-core.yml` (baute den Go-Kern für iOS), `native/scripts/record-server.mjs` (zeichnete Antworten des laufenden Servers auf; die Aufzeichnungen bleiben unter `D:\SNB\`, die daraus erzeugte Test-Datei `fetch-manifest.recorded.json` bleibt). `git ls-files backend app` = 0. Am Rechner bleibt ein ungetrackter Rest `backend/codegen/generated/hooks.mdx` (war ignoriert, nicht angefasst).

**Vertrag gerettet:** die acht Erweiterungs-`.d.ts` (`goja_plugin_types/{core,app,plugin,system}.d.ts`, `manga-provider`, `onlinestream-provider`, `anime-torrent-provider`, `custom-source`) unverändert nach `native/src/core/extensions/contract/`, mit `README.md` (Herkunft, Seanime GPL-3.0). Kein Test las sie zur Laufzeit; sie sind die Grundlage der „geschrieben nach“-Zeilen. `tsconfig.json` und ESLint lassen den Ordner aus (die `.d.ts` erklären eigene Globale wie `Buffer`), `core.test.ts` „says in every file what it was written after“ ebenso.

**Tests umgestellt:** `listeners.test.ts` las `backend/seanime-web/…/main-layout.tsx` → feste Liste der sechs Hörer (Stand `cc0d8e7`, damals grün). `release-from-2-0-33.test.ts` las `app/…/AppUpdater.kt`, `AppReleasePolicy.kt` und das alte Manifest, um die Abschrift zu prüfen → Vergleich entfernt, die Abschrift der Regeln (`oldUpdaterAccepts`) bleibt; der Updater 2.0.33 auf den Geräten ändert sich nicht mehr. `legacy-preferences.test.ts` las Kotlin-Dateien aus `app/` → dieser eine Fall entfernt. Fälle, die den Weg „mit Server“ prüften (Anfragen gehen zum Server, Server-Adressen, Hintergrund-Abfragen „solange er läuft“, Server-Dateien alter Downloads), sind weg.

**Toter Code entfernt:**
- `requests.ts`: `askServer` (axios, Kopfzeilen, Client-Id aus Antworten, Warten auf den Server nach §4e, Zeitmessung „answered by the server“) weg; was der Kern nicht beantwortet, scheitert sofort mit 503 und „needs the server, the app runs without it“ wie seit 8a-1.
- WebSocket `/events` (`websocket-provider.tsx` 273 → 42 Zeilen): keine Verbindung, kein Ping/Neuverbinden; bleibt nur Client-Id und der Kontext der Sender. Die Ereignisse des Kerns kamen schon immer über seinen Verteiler (§4b).
- Startschranke: `src/lib/server/start-gate.ts` + Test weg, `server-data-wrapper.tsx` ohne „L o a d i n g“-Warten, `client-providers.tsx` ohne `NativeServer`/`nativeServerAtom`/Port, ohne Neuladen nach `server-ready` und ohne 2-s-Abfrage „solange der Server startet“.
- Seite „Server-Status“ (`src/app/(main)/server-status.tsx`, nur `__DEV__`) samt Menü-Eintrag, Tab-Route und Freigabe im Inhalts-Gate.
- `without-server.ts`: Helfer ohne `isServerOff()` (Adressen leer, Hintergrund-Abfragen aus, Fehler immer); `anilist-public.ts` liest den Nutzer nur noch aus dem Status des Kerns (Schleife gegen `127.0.0.1` weg); `core-library-check.ts` ohne Server-Seite; `measure-android.sh` misst nur den App-Prozess.

**Bewusst behalten (für 8b):** die Bereichs-Schalter und `isServerOff()` im Kern (`src/core/switches.ts` und ~60 Kern-Dateien/Tests, die beide Wege prüfen; Verhalten gleich, weil `connectServerOff(() => true)` fest ist), die Stellen in den Bildschirmen, die in 7a/7f bewusst Entferntes ausblenden (`!isServerOff()` bei Plugins, filler, custom-source, Debrid-Download, Quellen-Suche; `removed.test.ts` hält sie fest), `server-url.ts` (`getServerBaseUrl` steckt noch in ~10 Adress-Bauern, deren Ergebnis `serverAddress` leert), die Vergleichs-Links `core-*-check.ts` außer Bibliothek. Grund: das Aufruf-Budget dieser Stufe; jedes davon ist toter, aber harmloser Code.

**Doku:** `AGENTS.md` „Native app“ statt Verweis auf `app/`/`backend/seanime-web`; `docs/NATIVE-UMBAU.md` oben als historisch markiert, Build-Zeile auf den Bau ohne Go (privater Werkzeugpfad entfernt); `DEVELOPMENT.md` und `docs/BUILD.md` oben als veraltet markiert (Neufassung mit README in 8b).

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 156 Dateien / 1527 Tests grün (−1 Datei `start-gate.test.ts`, −47 Fälle des Server-Weges); `npx expo lint` 0 Fehler, 341 Warnungen.

**APK und Gerät:** Test-App 70.963.869 B (8a-1: 70.979.685, −15,8 kB), scratch 79.862.764 B (8a-1: 79.878.580, −15,8 kB), je 0 `libseanime.so` (Bau-Prüfung „PASS“). S22, Test-App, Nutzer 0, echtes Konto nur lesend: Play Protect fragte → „Nicht senden“; `am start -W` 896 ms, Home mit „Weiterschauen“/„Schaue gerade“ (Black Clover 12/170) ✓, kein `libseanime`-Prozess, 0 „needs the server“, 0 JS-Fehler. Tablet, scratch, Nutzer 10: Home ✓, Downloads → Manga zeigt den **alten Server-Download aus 4c-2** („Welcome to Demon School! Iruma-kun“, 1 Kapitel bereit, nicht gelöscht) ✓, 0 „needs the server“, 0 JS-Fehler. **Nicht geprüft (Aufruf-Budget):** Reader Seite 1 aus der alten Datei (belegt zuletzt in 4c-2, §4o), Listen, Anime-Seite, Einstellungen, Erweiterungen; keine Wiedergabe.

### Stufe 8b-1 (14.11.2026): Schalter-Links weg, Geräte-Rundgang, Endmessung

**Entfernt:** die Links `core?area=<bereich>&on=…` und `core?server=off|on` (beide ohne Wirkung, seit 8a-1 gilt jeder Bereich als an) samt Ziel-Arten und Handler; der Vergleich Kern gegen Server `core-library-check.ts` (130 Zeilen, Links `core?library=check|home`; `core?move=again` liest danach nur neu ein); `core-switch.ts` verbindet die gespeicherten Bereichs-Schalter (MMKV `seanime-core-areas`) nicht mehr. `.gitignore` ohne `backend/seanime-web/…` und `tests/plugin-dom-test.js`, `.gitattributes` ohne `/backend/web/**`. Zusammen 8 Dateien, −221 / +16 Zeilen.

**Fehler gefunden und behoben:** Nach dem Wegfall des `area`-Links öffnete die scratch-App beim Neustart nach `install -r` ihren zuletzt gespeicherten Link (`seanime-scratch://core?area=streams&on=0`) als „Unmatched Route“. Ursache alt: `redirectAppLink` schickte unbekannte App-Links nach Home, kannte aber das Schema `seanime-scratch` nicht. Jetzt drin; am Tablet danach Home ✓.

**Bewusst geblieben (offen für 8b-2):** `switches.ts` mit `isServerOff()`/`isCoreAreaOn()` und der Weg „mit Server“ in ~25 Kern-Dateien samt Tests (die Tests laufen standardmäßig mit Server und Bereichen aus; Umbau = Neuschreiben vieler Testfälle, zu groß für das Aufruf-Budget), die Ausblend-Stellen aus 7a/7f (`removed.test.ts`), `server-url.ts` (noch in 10 Adress-Bauern, u. a. Player und Untertitel; ohne Wiedergabe-Test nicht anfassen), die übrigen Prüf-Links (`core-*-check.ts` messen den Kern; nur ihre Log-Wörter „core/server“ sind Reste).

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 156 Dateien / 1525 Tests grün (−2 Fälle: die Link-Fälle für `area` zusammengelegt; ein Lauf während eines Baus hatte 2 Zeit-Ausfälle, einzeln und im Voll-Lauf danach grün); `npx expo lint` 0 Fehler, 341 Warnungen.

**Gerät, Rundgang (keine Wiedergabe, nichts geändert):** S22, Test-App, Nutzer 0, echtes Konto nur lesend: Home, Meine Listen, Entdecken, Suche, Zeitplan, Menü, Erweiterungen, Einstellungen (Übersicht der Reiter), Anime-Seite Dr. STONE (Reiter „Online“ mit Anbieter, Folgen mit Bildern), Manga-Übersicht, Downloads Anime/Manga/Torrents ✓; 0 JS-Fehler, 0 „needs the server“. Tablet, scratch, Nutzer 10, Test-Konto: dieselben Bildschirme ✓ (Home/Listen des Test-Kontos leer, wie erwartet), Downloads → Manga → alter 4c-2-Download → Kapitel 44 lesen → **Reader Seite 1 / 22 aus der alten Datei** ✓; 0 JS-Fehler, 0 „needs the server“. **Nicht geöffnet:** Online-Stream-Bildschirm selbst (nur der Reiter auf der Anime-Seite), Manga-Seite und Reader am S22, die einzelnen Einstellungs-Reiter über den ersten hinaus. Play Protect fragte am S22 bei jeder Installation → „Nicht senden“.

### Stufe 8b-2 (14.11.2026): Tablet-CPU, Ruckeln, PSS geklärt

**CPU im Leerlauf, je Faden** (`/proc/<pid>/task/*/stat`, 3 × 60 s, Home vorn, 0 Bilder gezeichnet, ohne Neuinstallation, Prozess 2–9 min alt):

| | gesamt | Haupt-Faden | JS (`mqt_v_js`) | alle anderen |
|---|---|---|---|---|
| Tablet, scratch (debuggable), 60 Hz | 14,5 / 14,7 / 14,6 % | 13,7–13,9 % | 0,6 % | ≤ 0,2 % je Faden |
| S22, Test-App, 120 Hz | 10,3 / 10,1 / 10,4 % | 9,7–10,1 % | 0,3 % | 0,0 % |

Der Kern rechnet im Leerlauf nicht: JS-Faden 0,3–0,6 %, kein Zeitgeber, keine Torrent-Sitzung, kein DLNA-Abfragen, kein Download-Dienst sichtbar (deren Fäden 0,0 %). Der Haupt-Faden wacht ~61-mal/s auf (freiwillige Kontextwechsel), also einmal je Bild. simpleperf (Tablet, 10 s, `-g`): `Choreographer.doFrame` 70 %, davon Fabric `DispatchUIFrameCallback` 27 % und ein Bild-Rückruf von `react-native-worklets` (`AnimationFrameQueue.executeQueue`, eine Reanimated-Schleife auf der UI-Laufzeit) 22 %; der Rest wartet. Gleich auf Home und Menü, also nicht an einen Bildschirm gebunden. 42–45 % der Haupt-Faden-Zeit liegen im ART-Interpreter (`libart.so`), 22 % im JIT-Cache: Die scratch-App wird `debuggable` gebaut, ihr Java-Code läuft deshalb deutlich langsamer.

**Ursache der „schlechteren“ Tablet-CPU:** andere App. Stufe 0 maß am Tablet die Test-App (nicht debuggable, 6,2 %), 8b-1 die scratch-App. Die scratch-App mit Server maß in Stufe 5 schon 15,9 % (App 14,9). Gegen diesen vergleichbaren Wert ist die scratch-App heute mit 14,5–15,0 % gleich. Am S22 (dieselbe Test-App wie Stufe 0) ist die CPU besser (10,3 gegen 11,4 %). Die Test-App am Tablet wurde nicht angefasst (Regel: Tablet nur scratch).

**Versuch, nicht die Ursache:** Die zwei endlosen Reanimated-Animationen (Logo-Puls beim Start, Dreh-Symbol in der Listen-Kopfzeile) wurden beim Abbauen nicht gestoppt; jetzt `cancelAnimation` im Aufräumen (wie in `tour-overlay.tsx`). Nach dem Build blieb die Worklet-Schleife (22 %) und die CPU gleich (14,8–15,8 %). Die Quelle der Schleife ist offen; sie kostet am Tablet (debuggable) etwa 3 % eines Kerns und lief auch schon in der scratch-App mit Server.

**Ruckeln, gleiche Liste wie Stufe 0** (S22, Test-App, Link `entry?id=97940`, Reiter „Online“, 5 Wischer runter + 5 hoch, x = 720, y 2400 → 900, 3 Läufe): 1,76 / 1,24 / 1,48 % (34/1937, 25/2013, 22/1486), p90 10 ms, p99 16–17 ms, langsame Bild-Uploads 19–24 je Lauf. Stufe 0: Ø 1,06 % (Läufe 0,84–1,50; 2. Build 0,71–1,86), p90 8–9 ms, p99 11–15 ms. **Leicht schlechter** (+0,4 Punkte, Läufe überlappen mit Stufe 0).

**PSS Tablet, ein Build, 3 Läufe** (Ablauf wie 8b-1): 316 / 273 / 280 MB; derselbe Prozess vorher nach 8 min Laufzeit 252 MB. Die Unterschiede liegen in Grafik (98 MB in Lauf 1, als Android die Aktivität nach dem Update neu baute (`TotalTime` 85 ms), sonst 72 MB) und Code (55 MB nach 8 min, 69 → 74 → 81 MB in den Läufen direkt nach der Installation). Die 65 MB zwischen den beiden 8b-1-Builds sind Messrauschen dieses Ablaufs, kein Unterschied im Build. Vergleichbar bleibt der Mittelwert gegen Stufe 0 (348 MB): auch der höchste Lauf liegt 32 MB darunter.

**Stufe 8 fertig: nein.** Erfüllt: APK ohne `libseanime.so`, PSS beider Geräte, S22-CPU. Nicht erfüllt: Ruckeln Black Clover (1,49 gegen 1,06 %); Tablet-CPU nur gegen die scratch-App vergleichbar (gleich, nicht besser). Dazu bleiben die Punkte aus 8b-1 offen (Release-Weg, Name, README, `isServerOff()`, Ausblend-Stellen, `server-url.ts`).

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 156 Dateien / 1525 Tests grün; `npx expo lint` 0 Fehler, 341 Warnungen; ein scratch-Build (76,1 MB), am Tablet per `install -r` installiert.

### Stufe 8b-4 (14.11.2026): Gerät und Update-Weg

**Gerät (Nachweis für 8b-3):** ein Build der Test-App von `71e8377` (4.0.0, versionCode 1), 70.906.489 B (67,6 MB), 0 `libseanime.so`, Bau-Prüfung „PASS“. S22, Nutzer 0, `install -r`, Play Protect fragte → „Nicht senden“; `am start -W` 692 ms. Rundgang, echtes Konto nur lesend, keine Wiedergabe: Home („Weiterschauen“, „Schaue gerade“, Black Clover 12/170) ✓, Meine Listen (340 Anime, 7 schaue ich) ✓, Entdecken ✓, Zeitplan (149 Folgen in 2 Wochen) ✓, Suche „Dr. STONE“ (9 Treffer) ✓, Anime-Seite Dr. STONE (24/24, Reiter „Online“ mit KickAssAnime, Folgen mit Bildern) ✓, Manga-Übersicht (5 Manga, Weiterlesen Overgeared) ✓, Downloads Anime/Manga/Torrents (leer, wie vorher) ✓, Menü („App 4.0.0 · up to date“) ✓, Erweiterungen (6 installiert) ✓, Einstellungen (Übersicht der Reiter) ✓. logcat des App-Prozesses ab Start (1537 Zeilen): 0 `E ReactNativeJS`, 0 „needs the server“, 0 Absturz; kein `libseanime.so`-Prozess. Nicht geöffnet: Online-Stream-Bildschirm, Reader, einzelne Einstellungs-Reiter, scratch am Tablet.

**Welche Updater gibt es bei Nutzern?** Beide wählen gleich (`AppReleasePolicy.kt` = `app-release-policy.ts`): der neueste stabile Tag mit genau `Seanime-Mobile-<version>.apk`.

| installiert | prüft nach dem Laden | nimmt APK ohne `libseanime.so`? | Beleg |
|---|---|---|---|
| 2.0.33 (Kotlin) | minSdk, Paket, versionName = Release, versionCode > 31128, gleiches Zertifikat, **`lib/<abi>/libseanime.so`** | **nein** („APK does not support this device“) | `git show 8efb166:app/src/main/java/com/seanime/app/AppUpdater.kt` Z. 178–186 |
| 3.0.0 (native, `c3366ab`) | GitHub-SHA-256 + Größe (`checkDownload`), dann Androids Installer (Paket, Zertifikat, versionCode) | **ja** | `c3366ab:native/src/lib/app-updates/app-updater.ts` Z. 126–153, `updater-state.ts` `checkDownload`; seitdem unverändert |

Folge: Sobald 4.0.0 veröffentlicht ist, bietet 2.0.33 nur noch 4.0.0 an (das Neueste gewinnt) und lehnt es ab; über 3.0.0 geht es dann nicht mehr. **Gewählter Weg:** 3.0.0 → 4.0.0 in der App; 2.0.33 → 4.0.0 von Hand (APK aus dem Release über die App installieren: gleiches Paket, gleicher Schlüssel, höherer versionCode, Daten bleiben), im Release-Text als erste Zeile (`📝 BREAKING:`). Keine Schein-`libseanime.so`.

**Vorbereitet (nicht veröffentlicht):** `native/app.json` Version 4.0.0, `native/app-variants.json` Release-versionCode 31129 → 40000; `build-android.ps1 -Release` wieder erlaubt (Sperre aus 8a-1 weg; Prüfungen bleiben: Zertifikat von 2.0.33, Paket, versionName/-Code, jetzt versionCode > 31129, keine `libseanime.so`); Release-Text-Entwurf `docs/RELEASE-4.0-DRAFT.md`. `release-from-2-0-33.test.ts` prüft jetzt beide Updater (2.0.33 bietet an und lehnt nur wegen `libseanime.so` ab, von Hand installierbar; 3.0.0 bietet an, nimmt über `checkDownload` und Android an; Nachfolger 4.0.x).

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 155 Dateien / 1460 Tests grün (+2); `npx expo lint` 0 Fehler, 340 Warnungen.

**Offen:** Name der App (README nennt „Yomimi“, App-Name unverändert), `server-url.ts` in Player/Untertiteln/Cast mit Wiedergabe-Test, Ruckeln (8b-2), scratch-Rundgang am Tablet; Release erst auf Nicks Go.

### Stufe 8b-5 (14.11.2026): Name in der App, Leerlauf je Bild

**Name (`358b0a0`):** 20 Zeilen in 14 Dateien (sichtbare Texte, je Englisch und Deutsch) sagen jetzt „Yomimi“: Willkommen/„Yomimi starten“ (Erste Schritte), Tour-Start, kleine Zeile über „Home“ (`home-mobile-header.tsx`), Ladewort `Y o m i m i`, Update-Karte und Hinweis „Erlaube Yomimi …“, Release-Name im Updater, Ordner-, Widget-, Benachrichtigungs-, Listen- und Erweiterungs-Meldungen, AniList-Anmeldung („Yomimi speichert …“), Cast-Titel ohne Folge, `accessibilityLabel` des Logos in der Seitenleiste. **Bewusst „Seanime“ geblieben:** wo das Upstream-Projekt gemeint ist (Zeile „Seanime 3.10.4“ in den Einstellungen, Erweiterungs-Version, „Seanime 3.4 und älter“, Spende an den Seanime-Entwickler, Seanime-Repositories/-Community, Nakama über Seanimes Server, Seanime am PC, „allow Seanime“ auf AniList), Theme „Seanime“, Asset-Name `Seanime-Mobile-<version>.apk` (Updater 3.0.0) und `build-android.ps1`. Test- und scratch-App behalten ihre Namen (`app-variants.json`). Am S22 (Test-App) zeigt Home oben „YOMIMI“.

**Quelle der Schleife je Bild (8b-2):** nicht App-Code, sondern `react-native-worklets` 0.13.0. `setupRequestAnimationFrame` (`node_modules/react-native-worklets/src/runLoop/uiRuntime/requestAnimationFrame.ts`, Z. 62–67 und 82–83 vor dem Patch) startet beim Laden der UI-Laufzeit `nativeFlushQueue` und meldet sich darin **ohne Bedingung** für das nächste Bild an („Schedule next frame“) – auch wenn keine Animation, kein Mapper und kein Zeitgeber wartet. Jedes Bild ruft Android deshalb `AnimationFrameQueue.executeQueue` (Kotlin) und darüber die UI-Laufzeit auf: genau der Rückruf, den simpleperf in 8b-2 mit 22 % zeigte. Deshalb half `cancelAnimation` in 8b-2 nicht. Code-Suche in `native/src`: keine weitere endlose Animation (`withRepeat(-1)` nur Logo-Puls, Dreh-Symbol, Tour-Ring, alle mit `cancelAnimation`), kein `useFrameCallback`, keine CSS-Animationen.

**Fix (`e6eea7f`):** `native/patches/react-native-worklets+0.13.0.patch` (patch-package war schon da, keine neue Abhängigkeit): die Schleife läuft nur, solange ein `requestAnimationFrame`-Rückruf oder ein Finalizer (Mapper) wartet; `requestAnimationFrame` und `requestAnimationFrameFinalizer` starten sie wieder. Aussehen unverändert (jede Animation fragt ihr nächstes Bild selbst an). Restrisiko: Mikroaufgaben der UI-Laufzeit, die außerhalb eines Bildes oder `runGuarded` entstehen, laufen erst mit dem nächsten Bild statt spätestens im nächsten Bild – im Rundgang nicht aufgefallen. Fabrics `DispatchUIFrameCallback` meldet sich weiterhin je Bild an (React Native selbst), der Haupt-Faden wacht also weiter ~123-mal/s auf.

**Messung S22, Test-App, Nutzer 0** (CPU: `/proc/<pid>/task/*/stat`, 3 × 60 s, Home vorn; Ruckeln: Link `entry?id=97940`, Reiter „Online“, je Lauf 5 Wischer runter + 5 hoch, `gfxinfo reset` vor jedem Lauf):

| | vorher (Build 8b-4, Prozess > 1 h alt) | nachher (Build `e6eea7f`, frischer Prozess) |
|---|---|---|
| CPU gesamt | 12,8 / 12,6 / 12,4 % | 10,5 / 10,5 / 10,4 % |
| CPU Haupt-Faden | 10,1 / 9,7 / 9,7 % | 10,2 / 10,2 / 10,1 % |
| Aufwachen Haupt-Faden | 124–125/s | 123/s |
| Ruckeln (Janky frames) | 3,90 / 4,61 / 4,97 % (erste Messreihe 5,12 / 4,08 / 3,89 %), p99 25–26 ms | 1,53 / 1,35 / 1,41 %, p90 10–15 ms, p99 17–21 ms |

**Bewertung, ehrlich:** Der Patch ist im ausgelieferten Bundle (`loopRunning` in `index.android.bundle`), aber an der nicht debuggablen Test-App ist **am Haupt-Faden keine Ersparnis messbar** (Unterschied im Rauschen); die 22 % aus 8b-2 galten für die debuggable scratch-App im Interpreter. simpleperf läuft am S22 für die Test-App nicht („Event type … is not supported“), ein Beleg, dass die Schleife im Leerlauf wirklich stoppt, fehlt deshalb noch (ein zweiter Build mit Log-Zeilen scheiterte an patch-package auf der veränderten Datei; das Budget erlaubte keinen dritten). Die besseren Werte bei CPU gesamt und Ruckeln fallen mit der Neuinstallation zusammen (frischer Prozess gegen einen > 1 h alten) und sind **nicht sicher dem Patch zuzuschreiben**; sie liegen beim Ruckeln wieder auf dem Stand von 8b-2 (Ø 1,49 %), nicht auf Stufe 0 (1,06 %).

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 156 Dateien / 1471 Tests grün; `npx expo lint` 0 Fehler, 340 Warnungen; `npx patch-package --check` ✔ für alle drei Patches; Test-APK 67,6 MB, Bau-Prüfung „PASS“; S22 `install -r`, Play Protect „Nicht senden“, `am start -W` 595 ms. Keine Wiedergabe.

**Offen:** Beleg „Schleife stoppt im Leerlauf“ an der scratch-App mit simpleperf (Tablet, wie 8b-2); Ruckeln gegen Stufe 0; `server-url.ts`; Release erst auf Nicks Go.

### Stufe 8c-1 (14.11.2026): Tablet – Leerlauf je Bild und Ruckeln

Nur gemessen, kein Code geändert. scratch-App frisch gebaut (22:23, 76,1 MB, Patch im Bundle: `loopRunning`; die vorher installierte APK von 21:33 hatte ihn nicht), Tablet Nutzer 10. Rohwerte und Skripte: `D:\SNB\kern-aufzeichnungen\2026-11-14\messung\8c-tablet\`.

**Leerlauf (Home, 60 s, 0 Bilder, `/proc/<pid>/task/*/stat`):** alter Build gesamt 12,5 %, Haupt-Faden 11,7 % (60/s Aufwachen); neuer Build 15,1 / 14,6 / 16,3 %, Haupt-Faden 14,0–14,5 % (60–69/s), JS 0,6–1,2 %, alle anderen ≤ 0,4 %. **Die Schleife läuft im Leerlauf weiter.** simpleperf (scratch ist debuggable), Haupt-Faden 10 s: `AnimationFrameQueue.executeQueue` 23,3 % → 22,7 %, darunter `worklets::AnimationFrameBatchinator::addToBatch` 9,5 % – im UI-Runtime fordert jemand jedes Bild neu `requestAnimationFrame` an; die native Seite arbeitet nur auf Anfrage (`AnimationFrameQueue.kt:80-91`, `AnimationFrameBatchinator.cpp:33-54`), der Patch greift also, ein JS-Auftraggeber hält die Schleife am Leben. Zusätzlich plant RN selbst `DispatchUIFrameCallback` jedes Bild neu ein (`FabricUIManager.java:1666`, 28,5 %). Vermutung (nicht bewiesen): ein Reanimated-Mapper, der im Lauf Werte setzt (`react-native-reanimated/src/mappers.ts:132-146`), oder eine endlose Animation; Kandidaten mit `withRepeat`: `lists-phone-header.tsx:34`, `tour-overlay.tsx:311`, `loading-overlay-with-logo.tsx:14` – keiner eindeutig auf Home aktiv.

**Ruckeln Black Clover** (Online, 5 Wischer runter + 5 hoch, x = 1800, y 1400 ↔ 400): **1,64 / 0,95 / 0,63 % (Ø 1,07 %)**, p90 22 ms, p99 24–36 ms; 4. Lauf mit Mitschnitt 1,31 %. Stufe 0 Tablet 4,45 / 2,72 / 4,22 % (Ø 3,80 %), Stufe 5 scratch 3,85 / 2,43 % → **besser, Spannen überlappen nicht**. Vorbehalt: Stufe 0 maß die nicht debuggable Test-App. framestats: UI-Faden klein (Eingabe 0,4, Animation 0,9–1,4, Layout 0,3, Aufzeichnen 1,0 ms), RenderThread Sync 2,1 / Befehle 3,1–3,5 ms, GPU 12,6–16,6 ms (p90 15–16 ms bei 16,7 ms Budget); langsame Bilder warten meist auf die GPU (376/387 in Lauf 4). Engpass beim Wischen = GPU-Last, nicht JS/UI-Faden. CPU beim Wischen: RenderThread 18,3 %, Haupt-Faden 17,1 %, JS 6,2 %.

**Offen:** wer im UI-Runtime jedes Bild `requestAnimationFrame` anfordert (Probe in der scratch-App, die `globalThis.requestAnimationFrame` im UI-Runtime umhüllt und Rückrufe je Sekunde zählt); welche Ebene die GPU-Zeit beim Wischen kostet.

### Stufe 8c-2 (14.11.2026): `server-url.ts` weg

Commit `6fd61ebf`. Kein Code baut mehr eine Adresse auf den gelöschten Server (127.0.0.1:43212/43211); `server-url.ts` + Test gelöscht. Je Stelle: Player `resolveStreamUrl` entfernt (der Kern schickt nie `{{SERVER_URL}}`); Untertitel nur noch ganze Adressen (http, `file://`), `streamFileAddress(src)` mit einem Argument; Cast-Basis `castableStreamUrl` entfernt, Player übergibt `castUrl: null` (war vorher schon immer null), ein laufender Cast wird weiter verfolgt; Offline-Helfer nur eigene Dateien (sonst Folge „“, Bild → Online-Adresse); `assets.ts` nur http-Links, `serverAddress` entfernt; externer Player und „Stream-URL kopieren“ (Bibliothek + Nakama) zeigen nur noch den bisherigen Hinweis „needs the server“, toter Code raus; Medialinks: Abruf lokaler Untertitel (lieferte schon immer []) entfernt; `use-save-server-file` wirft sofort den bekannten Fehler; `__DEV_SERVER_PORT` raus; Testdaten nutzen Port 8080. Verbliebene 4321x-Treffer meinen den Nakama-Gastgeber am PC (`core/nakama/guest.ts:58` + Tests) bzw. Adressen im Netz.

**Prüfzahlen:** tsc 0; vitest 155 Dateien / 1465 Tests grün (vorher 156 / 1471, gelöschte Tests); lint 0 Fehler / 340 Warnungen. S22 Test-App gebaut + installiert, Dr. STONE Folge 1 online ~9 s mit Untertiteln, Medientaste-Pause, × des Mini-Players; keine heruntergeladene Folge vorhanden; logcat der App-PID 0 Treffer auf 127.0.0.1:4321 / ECONNREFUSED / „needs the server“.

**Offen:** `serverPort` in `native/app-variants.json` und dessen Ausgabe in `native/scripts/build-android.ps1` sind tot; Cast von Torrent-/Offline-Dateien über den Kern-Ausgang (`core/cast`) im Player (7c-2) – braucht Nicks Go; `castTrackNumbers`/`castUrlWithTracks` bleiben dafür, getestet, im Player ungenutzt.

### Stufe 8c-3 (14.11.2026): Reanimated-Mapper nur bei Bedarf, `serverPort` weg

Commits `cacb9ece`, `51a32278`. **Ursache der Leerlauf-Schleife im UI-Runtime:** `react-native-reanimated/src/mappers.native.ts:116-120` (4.7.1) – `scheduledMapperRun()` plant sich über `requestAnimationFrameFinalizer` in jedem Bild neu ein („We always run mappers on native“), dadurch läuft die worklets-Bildschleife auch im Leerlauf. **Fix:** Patch `native/patches/react-native-reanimated+4.7.1.patch` (`src/mappers.native.ts` + `lib/module/mappers.native.js`): ein Mapper-Lauf wird nur eingeplant, wenn ein Mapper „dirty“ ist, ein Mapper startet/stoppt oder ein Props-Flush ansteht, und plant sich nur bei offener Arbeit neu ein. `npx patch-package --check` ✔ (4 Patches).

**Leerlauf Tablet, scratch, Home, 3 × 60 s:** Haupt-Faden 14,5 / 14,0 / 14,0 % → **11,5 / 11,6 / 10,2 %**, gesamt 15,1 / 14,6 / 16,3 % → 12,1 / 12,1 / 10,7 %; simpleperf: `AnimationFrameQueue.executeQueue` (22,7 %) und `AnimationFrameBatchinator::addToBatch` (9,5 %) verschwunden. Aufwacher bleiben 60/s: RN Fabric ruft in `FabricUIManager.java:1666` (`finally { schedule(); }`) jedes Bild `postFrameCallback` auf, solange die App vorn ist (`DispatchUIFrameCallback` 35,6 %, `schedule()` 19 %); kein Feature-Flag, ein Patch wäre ein Umbau im RN-Kern (Mount-Items aus Hintergrund-Fäden) – nicht gemacht; Stufe 0 hatte ebenfalls 60/s. scratch ist debuggable (Java teils interpretiert), Release vermutlich sparsamer, nicht gemessen. Rohwerte: `D:\SNB\kern-aufzeichnungen\2026-11-14\messung\8c3-mapper\`.

**`serverPort`:** niemand liest ihn mehr (auch kein Kotlin); entfernt aus `native/app-variants.json`, `native/scripts/build-android.ps1`, Kommentar `native/src/lib/app-variant.ts`.

**Prüfzahlen:** tsc 0; vitest 155 / 1465 grün; lint 0 Fehler / 340 Warnungen; scratch-Build PASS, läuft am Tablet. **Offen:** Fabric-Bildtakt (eigener Auftrag, nur auf Nicks Wunsch); Test-App mit Patch nicht gebaut/gemessen.

### Stufe 8c-4 (14.11.2026): Animationen mit dem Mapper-Patch (Prüfer, Tablet)

scratch mit `cacb9ece`, Bildschirm-Mitschnitt + Einzelbilder, Belege `D:\SNB\kern-aufzeichnungen\2026-11-14\messung\8c4-anim\`. **Bestanden mit Vorbehalt:** nichts bleibt hängen oder läuft erst beim nächsten Antippen weiter; logcat (ReanimatedError/Worklets/FATAL/Exception) 0 Treffer. OK: Navigations-Markierung (`glide.tsx`, ~6 Stufen), Refresh-Drehsymbol (`lists-phone-header.tsx`) + Toast, Cover-Flug hin/zurück (`cover-flight.tsx`; erster Hinweg bei kalter Seite = `missFlight`, weich ausgeblendet), Einstellungs-Schalter (`switch.tsx`, ~6 Stufen), Druck-Verkleinerung (`press.ts`). **Auffällig:** Umschalter Anime|Manga und Local library|Online streaming (`tabs.tsx`/`glide.tsx`) springen in 3 von 4 Wechseln statt zu gleiten (`tabs-2.png`, `tabs-3.png`, `seg-11.png`; Ziel stimmt immer) – vermutlich blockiert der Aufbau des neuen Inhalts den UI-Faden; ohne Gegenprobe mit ungepatchter APK nicht vom Patch zu trennen. Nicht geprüft: `player-box.tsx` (Scroll-Handler, `useAnimatedReaction`, nur mit Wiedergabe erreichbar).

**Offen:** Gegenprobe Umschalter mit ungepatchter scratch-APK (Patch kurz zurücknehmen, bauen, gleicher Mitschnitt); Player-Animationen mit kurzer Wiedergabe.

### Phase 7c-2 (14.11.2026): Cast aus dem Player an den LG

Commit `45e6083d`. `player-cast.ts:31` `playerCastUrl()`: an den Fernseher gehen nur Gerätedateien (`file://`/Pfad) und der Kern-Torrent-Stream (`127.0.0.1/<32hex>/<40hex>/<idx>/<name>`); Online-Streams, Dateien mit Kopfzeilen (Nakama) und andere Adressen → null (unverändert kein Cast). `player-screen.tsx:815-826` übergibt `castUrl` statt null. `castUrlWithTracks` bewusst nicht genutzt: der Ausgang (7b) packt keine Tonspuren um, `core/cast` lehnt Adressen mit Anhang (`?audioTrack=`) ab → TV spielt die Standard-Spuren.

**Am LG belegt** (S22 Test-App, Torrent Dr. STONE Folge 1, Nicks Freigabe 14.11.): Panel zeigt „[LG] webOS TV OLED65B59LA · direct (DLNA)“; UPnP vom PC gelesen: TRANSITIONING → PLAYING 0:02/0:04/0:08 (Dauer 24:06, Datei über Ausgangs-Port mit Token) → per App pausiert PAUSED_PLAYBACK 0:20 → „Stop casting“ STOPPED; Kern-Log „outlet: shares into the network ended“, Port danach zu. Keine Abfrage am TV. Prüfzahlen: tsc 0; vitest 155 / 1469 grün; lint 0 Fehler.

**Offen:** TV startet bei 0:00 statt an der Handy-Position (4:47) – Sprung nach Play in `core/cast/cast.ts` greift am LG nicht, Fehler werden verschluckt; Offline-Datei und Google Cast am Gerät ungetestet; Untertitel als eigene Freigabe, Online-Streams mit Kopfzeilen (Weiterleiter).

**Nachtrag 7c-2b (15.11.2026, Commit `64d538f8`):** `core/cast/cast.ts` `seekOnceShown()`: Start-Sprung erst bei PLAYING, Position nach 2 s prüfen, erneute Versuche bis 30 s; Fehler nicht mehr verschluckt (`[Core] warn cast: seek to … failed: …` + `fail("control-failed")`, Panel zeigt den vorhandenen Hinweis „The TV did not answer.“ – Wortlaut passt nicht genau). Tests: vitest 155 / 1472 grün, tsc 0, lint 0 Fehler. **Am LG weiter 0:00:** `Seek REL_TIME 0:04:21` ohne SOAP-Fehler angenommen, kurz TRANSITIONING 0:04:21, dann PLAYING ab Anfang; TV-Screenshot zeigt „Diese Funktion ist jetzt nicht verfügbar.“ **Vermutete Ursache:** DIDL-Lite in `core/cast/upnp.ts:160` meldet `protocolInfo="http-get:*:<mime>:*"` ohne `DLNA.ORG_OP` – der LG hält die Quelle für nicht spulbar; der Ausgang sendet `DLNA.ORG_OP=01;…` nur als HTTP-Kopfzeile (`core-torrent/cpp/StreamServer.cpp:148`). Regelverstöße im Lauf: TV-Wiedergabe je Versuch 40–50 s statt ≤ 20 s („Stop casting“ im Querformat erst nach Scrollen), einmal gesendet, während YouTube vorn war, ohne Screenshot-Prüfung; Player am Handy nur minimiert.

**Nachtrag 7c-2c (15.11.2026, Commit `42ae1c40`): Start-Position am LG gelöst.** `core/cast/upnp.ts:161` Konstante `DLNA_VIDEO_FEATURES` (gleicher String wie `dlnaHeadersOf` in `core-torrent/cpp/StreamServer.cpp`), `protocolInfoOf()` (`upnp.ts:164`) setzt sie bei `video/*` ins 4. Feld von `protocolInfo`, sonst `*`; Test in `upnp.test.ts` liest die C++-Datei und schlägt fehl, wenn die Strings auseinanderlaufen. Am LG (1 Versuch, TV-Screenshot vorher ohne Video): Handy pausiert 4:00 → TV TRANSITIONING, ab erstem PLAYING 3:59 → 4:01/4:04/4:06, Stop per SOAP nach 15 s → STOPPED, Mini-Player-× → Ausgangs-Port zu. Prüfzahlen: tsc 0; vitest 155 / 1473 grün; lint 0 Fehler. **Offen:** TV zeigt die Standard-Untertitelspur der Datei (hier Arabisch), nicht die am Handy gewählte; Cast-Panel im Querformat ohne „Stop casting“-Knopf und zeigt nach dem Schließen weiter „Playing on …“, obwohl der TV STOPPED ist (erst das × am Mini-Player beendet den Ausgang); Sprung-Fehler hat keinen eigenen Hinweistext (nur `control-failed` „The TV did not answer.“). Regelverstöße: Handy-Wiedergabe ~28 s statt ≤ 10 s; ein Befehl mit `wm size` vom Classifier gesperrt (lief nicht).

## 4t. Zweite Quelle TVmaze (Phase B1, nur Kern)

Titel, die AniList nicht hat (Beispiel „Dreamland“, französische Serie 2026, TVmaze 95063), kommen aus TVmaze (öffentlich, kein Schlüssel). Noch keine Oberfläche.

- **Nummern:** ein TVmaze-Titel hat in der App die Nummer `-tvmazeId` (Dreamland = -95063); AniList-Nummern sind immer positiv. DB, Downloads, Torrent und Online-Stream nehmen sie ohne Umbau. `core/tvmaze/tvmaze.ts`: `isTvmazeId`, `toTvmazeId`, `fromTvmazeId`.
- **Client** `core/tvmaze/client.ts`: GET `https://api.tvmaze.com…`, eigenes Fenster 20 Aufrufe / 10 s, 429 → Retry-After (sonst 10 s) abwarten, höchstens 2 Wiederholungen; Zeitlimit 10 s; Fehler als `TvmazeFailure(status)`.
- **Abbildung:** `mediaOfShow` macht aus der Show ein AniList-förmiges Anime (title romaji/english/userPreferred = name, coverImage aus image, bannerImage aus `/shows/{id}/images` Hintergrund, description ohne HTML, format TV, status Running → RELEASING / Ended → FINISHED / vor Premiere oder „In Development“ → NOT_YET_RELEASED, startDate/endDate, season/seasonYear nach AniList-Regel, genres, duration, meanScore, episodes = reguläre Folgen, nextAiringEpisode = erste reguläre Folge mit airstamp in der Zukunft). `metadataOfShow` macht die Folgen zu `Metadata_AnimeMetadata`, durchnummeriert 1… über alle Staffeln, Specials nur gezählt.
- **Weiterleitung:** `anilist/media-details/{id}` (`anilist.ts` `animeDetails`), Bibliotheks-Eintrag/Folgen-Sammlung (`library.ts` `mediaOf`, `mediaIdOf` nimmt jetzt negative Nummern) und Folgen-Metadaten (`metadata.ts` `animeMetadata`) gehen bei negativer Nummer an TVmaze; positive Nummern unverändert.
- **Speicher:** jede Antwort unter ihrer Frage (`tvmaze/show/{id}`, `tvmaze/search/{q}`) im Antwort-Speicher; TVmaze scheitert → letzte Antwort; nichts gespeichert → 500 „no cached data available“, TVmaze kennt die Show nicht → 404. Der Schalter „AniList-Cache aus“ gilt hier nicht.
- **Suche:** `searchOtherSources(environment, q)` → `{ Page: { pageInfo, media } }` wie list-anime (ohne Folgenzahl/nächste Folge). Kein Registry-Endpunkt: die Registry nimmt nur Adressen aus `src/api/generated/endpoints.ts` (Test in `core.test.ts`); der kommt mit der Oberfläche.

**Belegt (21.11.2026):** echte Probe gegen TVmaze: Suche „Dreamland“ findet -95063 (2026); Details id -95063, Titel „Dreamland“, Cover `static.tvmaze.com/…/1616388.jpg`, 7 Folgen, RELEASING, nächste Folge 6. Tests `core/tvmaze/tvmaze.test.ts` (13).

**Offen:** Oberfläche (Suche „weitere Quellen“, Karten/Eintrag mit negativer Nummer), Endpunkt in `endpoints.ts` + Registry, Listen-Eintrag für TVmaze-Titel (AniList-Liste kann sie nicht halten), Torrent-/Stream-Suche nach Namen statt AniList-Titeln prüfen.

**B3 (Folgen, Fortschritt, Meine Serien).** Die Suche der anderen Quellen nimmt nur Serien mit TVmaze-Typ
„Animation“; Realserien gleichen Namens bleiben draußen. Torrent-Suche und Online-Streams gelten auch für negative
IDs. Entscheidung zur Zählung: gesucht wird mit dem Titel und der durchgehenden Folgennummer 1 … N über alle
Staffeln (so vergibt sie `metadataOfShow`, `absoluteEpisodeNumber`), weil Anime-Anbieter so zählen; Staffel und
Folge der Staffel bleiben in den Metadaten. Positive IDs bleiben unverändert. Der Fortschritt einer negativen ID
bleibt auf dem Gerät (Tabelle `own_shows`, Schritt 20, `tvmaze/own-shows.ts`): `update-progress` schreibt dorthin,
ohne AniList zu fragen oder zu ändern; der automatische Fortschritt des Players senkt nie. Die Eintragsseite zeigt
ihn als `listData` mit „Weiter mit Folge X“, Wiedergabepositionen und Verlauf nehmen negative IDs an. „Meine
Serien“: `GET`/`POST /api/v1/other-sources/my-shows` (Spalte `listed`), eine Reihe auf Home (nur wenn nicht leer)
und in Meine Listen. Offen: Abgleich von „Meine Serien“ und dem lokalen Fortschritt mit dem Seanime-Konto.

## 5. Messwerte

Gemessen wird nur an der Test-App `com.seanime.app.native`. Methode: `native/scripts/measure-android.sh` (kein Beenden, kein Löschen, keine Einstellung wird geändert). Diese Tabelle wird nach jeder Stufe neu gefüllt.

Geräte: **S22 Ultra** (SM-S908B, Android 16, 120 Hz) und **Pixel Tablet** (Android 17, 60 Hz).

### Endmessung (Stufe 8, nach 8b-1, 14.11.2026)

Je Gerät 3 Läufe: `adb install -r` desselben APK, 15 s warten, `am start -W`, 60 s Leerlauf auf Home, PSS (`dumpsys meminfo`, TOTAL), dann CPU über 60 s (`/proc/<pid>/stat`, 0 Bilder gezeichnet). Ruckeln: `dumpsys gfxinfo`, 5 Wischer runter + 5 hoch, 3 Läufe (S22 x=720 y 2400→900).

| Messwert | Stufe 0 S22 | **S22 jetzt** | Stufe 0 Tablet | **Tablet jetzt** |
|---|---|---|---|---|
| Start `am start -W` | 0,73 s (kalt) | 528 / 1157 / 736 ms, **WARM** (der Prozess lief nach `install -r` schon wieder, ein echter Kaltstart ist ohne Beenden nicht herstellbar) | 0,59 s | nicht messbar (`TotalTime 0`: Android startet die App nach dem Update selbst wieder in den Vordergrund) |
| JS „Running main“ → Home-Sammlung vom Kern | – (Home mit Covern 2,65 s ab Fenster) | 0,82 / 1,27 / 0,76 s (Ø 0,95 s) | – (2,75 s) | – |
| **PSS gesamt** | 352 MB (App 266 + Server 86) | 291 / 287 / 286 MB (**Ø 288 MB, −18 %**) | 348 MB (258 + 90) | Build 1: 207 / 206 / 208 MB; Build 2: 275 / 267 / 273 MB (**Ø 272 MB, −22 %**); 8b-2, ein Build: 316 / 273 / 280 MB, Prozess nach 8 min 252 MB (Streuung erklärt unten) |
| **CPU Leerlauf** (% eines Kerns) | App Ø 10,9 + Server Ø 0,5 = 11,4 % | 9,5 / 10,2 / 9,9 (**Ø 9,9 %**); 8b-2 ohne Neuinstallation 10,3 / 10,1 / 10,4 | App Ø 5,6 + Server 0,6 = 6,2 % (**Test-App**, nicht debuggable) | scratch (**debuggable**): 12,8 / 13,6 / 13,3 bzw. 14,9 / 15,3 / 15,5; 8b-2 14,5 / 14,7 / 14,6 und 14,9 / 15,0 / 14,8. **Nicht vergleichbar mit Stufe 0**; vergleichbar ist scratch mit Server aus Stufe 5: 15,9 % → **gleich** (8b-2, §4s) |
| Ruckeln | 1,06 % (Folgenliste Black Clover) | Home 4,09 / 4,09 / 3,62 %, p99 22–25 ms; Meine Listen 3,75 / 4,45 / 3,74 %, p99 20–24 ms; **8b-2 Black Clover (gleiche Liste wie Stufe 0): 1,76 / 1,24 / 1,48 % (Ø 1,49 %), p90 10 ms, p99 16–17 ms → etwas schlechter** | 3,80 % | nicht messbar (Home und Listen des Test-Kontos zu kurz, 0 Bilder) |
| **APK** | 107,6 MB, 42,9 % `libseanime.so` | **70,95 MB** (70.949.165 B, −34 %), 0 `libseanime.so` | gleiche Datei | scratch 79,85 MB (79.848.080 B) |

Bewertung: Speicher und APK deutlich besser, S22-CPU gleich bis besser. **Nicht besser:** Tablet-CPU im Leerlauf (≈ 14 % gegen 6,2 %, gemessen 1–3 min nach dem Update, wenn der Kern nach dem Neustart noch arbeiten kann; Ursache nicht untersucht) und das Ruckeln am S22 – das aber auf anderen Listen als Stufe 0 (Home und Meine Listen statt Folgenliste), also nicht direkt vergleichbar. Der Tablet-PSS unterscheidet sich zwischen den zwei scratch-Builds um ~65 MB bei gleichem Code bis auf eine Zeile; die Läufe lagen je nach dem gleichen Ablauf, Unterschied ungeklärt (Grafik-Speicher). Rohwerte nicht im Repo.

**Korrektur 8b-2 (14.11.2026, §4s):** Die Tablet-CPU ist kein Rückschritt des Kerns. Stufe 0 maß am Tablet die Test-App (nicht debuggable), 8b-1 die scratch-App, die `debuggable true` gebaut wird – dort läuft Java-Code im Interpreter (simpleperf: 42–45 % der Zeit des Haupt-Fadens in `libart.so`). Je Faden: Haupt-Faden 13,7–14,8 %, JS-Faden 0,6 %, alle anderen ≤ 0,2 % (kein Torrent-, DLNA-, Download- oder Kern-Faden aktiv). Die scratch-App mit Server maß in Stufe 5 schon 15,9 %. Das Ruckeln auf der Stufe-0-Liste (Black Clover) liegt mit Ø 1,49 % über 1,06 % (Stufe 0, 2. Build 1,12 %, Läufe 0,71–1,86 %; Stufe 5 mit / ohne Server 1,05 / 1,19 %), also leicht schlechter. Der Tablet-PSS streut am selben Build um 43 MB: Grafik 72 ↔ 98 MB, je nachdem, ob die Aktivität nach dem Update neu gebaut wurde, und Code 55–81 MB, je nachdem, wie lange das Update her ist. Die 65 MB zwischen den 8b-1-Builds sind deshalb Messrauschen, kein Unterschied im Build.

**Nachtrag 8b-5 (14.11.2026, §4s):** S22, Test-App, Schleife je Bild aus `react-native-worklets` per Patch nur noch bei Bedarf. CPU gesamt 12,8 / 12,6 / 12,4 % → 10,5 / 10,5 / 10,4 %, Haupt-Faden 9,7–10,1 % → 10,1–10,2 % (gleich); Ruckeln Black Clover 3,90 / 4,61 / 4,97 % (alter Prozess) → 1,53 / 1,35 / 1,41 % (frischer Prozess nach Neuinstallation). Der Unterschied fällt mit der Neuinstallation zusammen und ist nicht sicher dem Patch zuzuschreiben; Ruckeln weiter über Stufe 0 (1,06 %).

### Stufe 8b-3 (14.11.2026): der Weg „mit Server“ aus dem Kern

**Entfernt (Code ohne Tests: 45 Dateien, −874 / +148 Zeilen):**
- Schalter: `switches.ts` hat nur noch `CORE_AREAS`/`isCoreArea` als Namen; `isServerOff`, `isCoreAreaOn`, `coreAreasOn`, `setCoreArea`, `connectCoreSwitches`, `connectServerOff` weg, ebenso `withoutServer` an den Routen (`removed.ts`, Quellen-Aktualisierung) und `coreHasRoute`. `coreAnswerFor` antwortet für jede Route des Registers.
- Umgebung des Kerns ohne `server`/`serverListening`: keine Anfrage an einen laufenden Server mehr – Status vom Server (`statusWithOwnSettings` → immer `statusWithoutServer`), Bibliotheks-Einstellungen aus dem Server-Status (`scan.ts`, `playback.ts`), Fortschritt über die Server-Schnittstelle (`progressTo` nur noch über die Warteschlange des Kerns), Anime-Seite vom Server oder aus `server_answers` (`onlinestream.ts` nur noch `animeWithEpisodes`), Server-Sammlung/-Eintrag (`libraryCollection`/`animeEntry` → `ownLibraryCollection`/`libraryEntry` direkt im Register), `serverSettingsSaved` (Torrent-/Debrid-Einstellungen speichert immer der Kern).
- Server benachrichtigen/mitziehen: `tellServer` (Anmelden/Abmelden), „Server liest Listen neu“ nach Änderungen (`changes.ts`, `home.ts`), Debrid-Einstellungen an den Server, Erweiterungs-Neuladen/-Abschalten (`install.ts`, `manage.ts`), Manga-Cache leeren beim Server.
- Umzug-Rückfragen an einen laufenden Server: Manga-Vorlieben (`GET /manga/preferences`, Quellen-Aktualisierung des Servers), letzte Kapitelnummern, heruntergeladene Kapitel des Servers. Die Seiten der Server-Quelle „local-manga“ und der Doppelseiten-Ansicht scheitern wie bisher sofort mit 503 „needs the server“ (jetzt als `CoreError` im Kern statt als Server-Fehler, gleicher Text und Status).
- Startschranke: `isServerHeldBack`, `serverWait`, `giveUpServerWait`, `waitUntilServerListens`, `lastStateOf` samt 60-s-Grenze in `core-switch.ts` (`start.ts` 287 → 32 Zeilen). `coreRequestFor` ohne `askServer`, `coreEnvironment()` ohne `loggingTells`/`latestAskServer`.
- Player/Playlist: `tellPlayer`/`tellPlaylist`/`coreTakesPlayer` weg, die Nachrichten gehen direkt an `coreHearPlayer`/`coreHearPlaylist` (vorher dieselbe Seite, der Server-Zweig war tot).
- App: Prüf-Links `core-*-check.ts` ohne „Bereich aus“-Zweige; Manga-Seiten ohne Bild-Proxy des Servers (`handle-manga-utils.ts`: Quelle direkt mit Kopfzeilen, gespeicherte Kapitel `file://`, Server-Adressen leer wie bisher über `serverAddress`); Online-Stream immer direkt (`buildOnlineStream(source, "", "", true)`, ohne Proxy-Token); Download-Hinweise immer im Modus „Kern“.

**Ausblend-Stellen 7a/7f (bleiben, vereinfacht ohne Verhaltensänderung):** Filler-Gruppe im „Mehr“-Menü und „Eigene Quellen“ auf der Suche ganz entfernt (samt nicht mehr genutzter Hooks); Plugin-Knopf blendet sich über die ohnehin leeren Plugin-Listen aus; „Durchsuchen“ bei eigenen Quellen `undefined`; Debrid-Download `debridOn = false`; Quellen-Aktualisierung nur „gewählte Quellen“; Erlaubnis-Block und „Quelle durchsuchen“ als `false && …` (ihr Inhalt hängt an weiteren Variablen, Ausbau größer als diese Stufe). `removed.test.ts` prüft den neuen Stand.

**Bewusst geblieben:** der einmalige, nur lesende Umzug (`core/move/`, alte Offline-Folgen, Manga-Kapitel, Erweiterungen, `serverPlaylists`); `statusWithoutServer` liest weiter den zuletzt vom Server behaltenen Status-Teil aus `server_answers` (alte Geräte behalten so Version/Feature-Flags/Einstellungen wie bisher; Tabelle bleibt im Schema); `server-url.ts` in Player (`resolveStreamUrl`), Untertiteln (`streamFileAddress`), Cast (`castableStreamUrl`) und ~6 Adress-Bauern (Assets, Offline-Bilder, externe Player, Medienlinks, Datei speichern) – ohne Wiedergabe-Test nicht angefasst, Wiedergabeweg unverändert; `useServerHMACAuth` in `handle-manga-utils.ts` nur noch für `isReady` (ein alter Status kann „Server hat Passwort“ sagen).

**Tests:** standardmäßig ohne Server (es gibt keinen anderen Weg mehr). 156 Dateien / 1525 Fälle → **155 / 1458** (−1 Datei, −67 Fälle). Entfernt, weil sie nur den Weg „mit Server“ oder den Schalter prüften: `start.test.ts` ganz (Startschranke, gehaltene Anfragen, Server-Antworten der ersten Bildschirme, Server wieder an; der Status ohne Server bleibt in `start/without-server.test.ts`), Schalter-Fälle in `core.test.ts`, `requests.test.ts`, `without-server.test.ts` (beide), „Bereich aus → Server“-Fälle in anilist/changes/debrid/home/library/scan/manga/offline/playback/playlists/torrent/search, `tellPlayer`/`tellPlaylist`, Server-Benachrichtigungen (Erwartungen gestrichen, Fälle bleiben), Server-Quelle „local-manga“/heruntergeladene Server-Kapitel, Fortschritt über den Server. **Mit entfernt, obwohl sie auch Kern-Verhalten berührten (Testumgebung hätte AniList-Konto/Metadaten gebraucht):** Torrent-Einstellungen im Status (`withTorrentSettings`, steckten in Fällen mit „Bereich aus“), Online-Stream-Folgenliste gegen die Server-Seite (2 Fälle), die laufende Playlist mit Fortschritt (1 Fall), „video-completed“ im 8-ms-Fall. Umgestellt: Einstellungs- und Wiedergabe-Tests legen die Bibliotheks-Einstellungen über `POST /api/v1/start` im Kern an statt über den Server-Status; Einstellungs-Aufzeichnungen vergleichen gegen den Status ohne Server.

**Prüfzahlen:** `npx tsc --noEmit` 0 Fehler; `npx vitest run` 155 Dateien / 1458 Tests grün; `npx expo lint` 0 Fehler, 340 Warnungen (vorher 341). `git diff --stat 4028cfc`: 74 Dateien, −2061 / +193 (Tests −1187 / +45).

**Gerät: nicht geprüft** (Aufruf-Budget dieser Stufe aufgebraucht). Offen: je ein Build Test-App + scratch, Rundgang beide Geräte (Home, Listen, Dr. STONE mit Folgen-Bildern + Online-Reiter, Manga, Downloads, Einstellungen, Erweiterungen), logcat; danach `server-url.ts` in Player/Untertiteln/Cast mit Wiedergabe-Test.


Je 1 Lauf nach `install -r` (Prozess startete durch einen Broadcast vor der Aktivität, also kein reiner Kaltstart); PSS `dumpsys meminfo`, ~60 s nach `am start -W`, Home vorn.

| Messwert | S22 Ultra (Test-App) | Pixel Tablet (scratch) | Stufe 0 (S22 / Tablet) |
|---|---|---|---|
| JS „Running main“ → Home-Sammlung | 1,38 s | 0,76 s | – (Home mit Covern 2,65 / 2,75 s ab Fenster) |
| `am start -W` `TotalTime` | 1764 ms (erste Aktivität nach dem Update) | 0 ms (App war schon vorn) | 0,73 / 0,59 s |
| **PSS gesamt** | **276 MB** (276.073 kB, kein Server) | **268 MB** (267.607 kB, kein Server) | **352 / 348 MB** (App 266 / 258 + Server 86 / 90) |
| **APK** | 71,0 MB, 0 % `libseanime.so` | 79,9 MB (scratch) | 107,6 MB, davon 42,9 % `libseanime.so` |

Bewertung: Speicher −76 / −80 MB, APK −34 % gegen Stufe 0. Die Startzeit ist mit 1 Lauf und anderem Messweg nicht gegen Stufe 0 vergleichbar; gegen Stufe 5 „ohne Server“ (0,93 / 0,80 s) S22 langsamer (erster Start nach dem Update), Tablet gleich. Ruckeln und CPU nicht neu gemessen.

### Stufe 0 (Ausgangswerte, Server läuft mit)

| Messwert | Methode | S22 Ultra | Pixel Tablet | Wann |
|---|---|---|---|---|
| **Kaltstart bis erster Bildschirm mit Inhalt** | Prozess lief nicht. Bildschirmaufnahme, 20 Bilder/s, gezählt vom ersten Bild mit App-Fenster bis zum ersten Bild von Home mit Covern | **2,65 s** | **2,75 s** | 13.11. 08:57 / 08:58, je 1 Lauf, Build vom 11.11. |
| davon bis Fenster da | `am start -W`, `TotalTime` | 0,73 s | 0,59 s | wie oben |
| Erster Start nach einem Update | wie Kaltstart, aber der Prozess lebt schon (Dienst), der Server noch nicht | 3,45 s | nicht messbar (App war nach der Installation schon vorn) | 13.11. 09:33, neuer Build |
| **Speicher App-Prozess** (PSS) | `dumpsys meminfo <pid>`, Zeile TOTAL, Home, 1,5 min nach Kaltstart | **266 MB** | **258 MB** | 13.11. 08:59 / 09:00 |
| **Speicher Server-Prozess** (PSS) | wie oben, Prozess `libseanime.so --port 43212` | **86 MB** | **90 MB** | wie oben |
| Speicher nach 10 min Benutzung | wie oben, nach 2 Wiedergaben und der Aufzeichnung | App 728 MB, Server 137 MB | – | 13.11. 09:43, neuer Build |
| **Leerlauf-CPU App** | `/proc/<pid>/stat` über 10 s, Home vorn, keine Eingabe, 0 Bilder gezeichnet, 3 Läufe; % eines Kerns | 12,2 / 12,3 / 8,1 (**Ø 10,9 %**) | 4,8 / 5,1 / 6,9 (**Ø 5,6 %**) | 13.11. 08:59 / 09:00 |
| **Leerlauf-CPU Server** | wie oben | 0,9 / 0,2 / 0,3 (**Ø 0,5 %**) | 0,5 / 0,6 / 0,8 (**Ø 0,6 %**) | wie oben |
| Leerlauf-CPU, neuer Build | wie oben | App 12,3 / 10,8 / 11,3 (Ø 11,5 %), Server Ø 0,4 % | – | 13.11. 09:43 |
| **Ruckel-Anteil lange Liste** | `dumpsys gfxinfo`, „Janky frames“; Online-Folgenliste von Black Clover (170 Folgen), 5 Wischer runter + 5 hoch, 3 Läufe | 1,50 / 0,84 / 0,85 (**Ø 1,06 %**), p90 8–9 ms, p99 11–15 ms | 4,45 / 2,72 / 4,22 (**Ø 3,80 %**), p90 21–22 ms, p99 22–32 ms | 13.11. 09:01 / 09:02 |
| Ruckel-Anteil, neuer Build | wie oben | 1,86 / 0,78 / 0,71 (Ø 1,12 %) | – | 13.11. 09:44 |
| **APK-Größe** (Test-App, beide CPU-Arten) | Dateigröße | 107,6 MB (107.572.995 Bytes); Release 3.0.0: 107,7 MB | gleiche Datei | Build 13.11. 09:31 |
| **Anteil `libseanime.so`** | `unzip -v`, gepackte Größe | 46,2 MB = **42,9 %** (arm64 22,7 MB + armv7 23,5 MB) | gleiche Datei | wie oben |
| Server-CPU bei Wiedergabe | wie Leerlauf-CPU, 10 s, Online-Stream läuft | über Zwischenstation 3,8 %; direkt 0,3 % (§7) | – | 13.11. 09:37 / 09:38 |

Hinweise:

- Ein echter Kaltstart ist nur messbar, wenn die App gerade nicht läuft (Beenden per Befehl ist verboten). Deshalb je Gerät ein Lauf.
- Der Tablet-Wert der Liste (3,8 %) liegt über dem alten Wert aus r19 (1,2 %, anderes Mess-Skript). Vergleichen darf man künftig nur Werte dieses Skripts miteinander.
- Der neue Build (Schalter aus) misst gleich wie der alte: Der Schalter kostet nichts Messbares.
- Das Tablet war ab 09:42 gesperrt; die Nachmessungen am neuen Build gibt es deshalb nur vom S22.

### Nach Stufe 1 (alle Kern-Bereiche aus, Server läuft mit)

Build `d612984` (Phase 1e), per `install -r` am 13.11. 14:09 (S22, Nutzer 0) und 14:10 (Tablet, Nutzer 10), Daten blieben. Gleiche Methode wie Stufe 0. Rohwerte: `D:\SNB\kern-aufzeichnungen\2026-11-13\messung\1e\` (`mem-cpu.txt`, `jank.txt`, Startvideos und Kontaktbögen).

| Messwert | S22 Stufe 0 | **S22 nach Stufe 1** | Tablet Stufe 0 | **Tablet nach Stufe 1** | Bewertung |
|---|---|---|---|---|---|
| Kaltstart bis Home mit Covern | 2,65 s | nicht messbar | 2,75 s | nicht messbar | Nach `install -r` startet der Dienst den Prozess sofort neu; Beenden ist verboten (wie Stufe 0). Vergleichbar ist nur die nächste Zeile. |
| Erster Start nach einem Update (Prozess lebt, Server nicht) | 3,45 s | **3,20 s** | nicht messbar | **3,45 s** | S22 gleich (Rauschen, je 1 Lauf); Tablet ohne Vergleichswert |
| davon bis Fenster da (`am start -W`, `TotalTime`) | 0,73 s (kalt) | 0,68 s (warm) | 0,59 s (kalt) | 1,38 s (warm) | verschiedene Startarten, nicht vergleichbar |
| Speicher App (PSS, ≥ 1,5 min nach Start, Home) | 266 MB | **272 MB** (271.812 kB) | 258 MB | **243 MB** (242.821 kB) | gleich (S22 +2 %, Tablet −6 %) |
| Speicher Server (PSS) | 86 MB | **92 MB** (91.547 kB) | 90 MB | **68 MB** (68.178 kB) | gleich bzw. niedriger; der Server ist unverändert |
| Leerlauf-CPU App (3 × 10 s, 0 Bilder gezeichnet) | Ø 10,9 % (neuer Build Ø 11,5 %) | 12,5 / 11,5 / 12,5 (**Ø 12,2 %**) | Ø 5,6 % | 5,5 / 6,4 / 7,4 (**Ø 6,4 %**) | im Rauschen: die Stufe-0-Läufe lagen bei 8,1–12,3 % bzw. 4,8–6,9 % |
| Leerlauf-CPU Server | Ø 0,5 % | 0,8 / 0,5 / 1,0 (**Ø 0,8 %**) | Ø 0,6 % | 0,5 / 0,5 / 0,9 (**Ø 0,6 %**) | gleich |
| Ruckel-Anteil Folgenliste Black Clover (3 Läufe) | Ø 1,06 % (neuer Build Ø 1,12 %), p99 11–15 ms | 1,27 / 2,35 / 0,70 (**Ø 1,44 %**), p90 9–10 ms, p99 12–21 ms | Ø 3,80 %, p99 22–32 ms | 2,22 / 1,63 / 2,08 (**Ø 1,98 %**), p90 20–22 ms, p99 22–23 ms | **S22 leicht höher**, getragen von Lauf 2 (27 langsame Bild-Uploads: Folgenbilder frisch nach dem Start dekodiert; langsame UI-Stücke 11 wie in Lauf 1); die anderen zwei Läufe liegen im Stufe-0-Bereich. Kein Kern-Code läuft (Schalter aus). Wisch-Koordinaten von Stufe 0 sind nicht notiert; hier S22 x=720 y 2400→900, Tablet x=1900 y 1450→450. |
| **APK-Größe** | 107,6 MB (107.572.995 B) | **109,8 MB** (109.769.297 B) | gleiche Datei | gleiche Datei | **+2,2 MB (+2,0 %), echt, kein Rauschen.** Ursache: `libexpo-sqlite.so` für beide CPU-Arten, 1,66 MB gepackt (neu seit 1b); der Rest Drizzle, `expo-secure-store` und der Kern-Code im JS-Bündel |
| Anteil `libseanime.so` | 46,2 MB = 42,9 % | 46,2 MB = **42,1 %** (46.194.549 B) | gleiche Datei | gleiche Datei | Server unverändert; der Anteil sinkt nur durch die größere APK |

Ergebnis: Mit allen Schaltern aus misst Stufe 1 wie Stufe 0. Echte Verschlechterung: nur die APK (+2,2 MB durch SQLite). Der S22-Ruckelwert ist leicht höher, aber nicht sicher vom Rauschen zu trennen (1 von 3 Läufen).

### Nach Stufe 2 (alle Kern-Bereiche aus, Server läuft mit)

Build `0e344c2` (Phase 2d), per `install -r` am 13.11. 17:12 (S22, Nutzer 0, und Tablet, Nutzer 10), Daten blieben, in der Test-App nichts eingeschaltet. Gleiche Methode und Wisch-Koordinaten wie nach Stufe 1. Rohwerte: `D:\SNB\kern-aufzeichnungen\2026-11-13\messung\2d\` (`mem-cpu.txt`, `jank.txt`, Startvideos und Kontaktbögen, 20 Bilder/s, 12 je Zeile).

| Messwert | S22 Stufe 0 | S22 Stufe 1 | **S22 Stufe 2** | Tablet Stufe 0 | Tablet Stufe 1 | **Tablet Stufe 2** | Bewertung |
|---|---|---|---|---|---|---|---|
| Erster Start nach einem Update (Prozess lebt, Server nicht), bis Home mit Covern | 3,45 s | 3,20 s | **2,75 s** (Bild 42 → 97) | nicht messbar | 3,45 s | **3,90 s** (Bild 57 → 135) | S22 schneller (passt zu 2c: Home wartet nicht auf den Server); Tablet langsamer, je 1 Lauf, nicht vom Rauschen zu trennen. Auf dem Tablet stand vor dem Neustart noch ein alter Home-Bildschirm (leer) im Video. |
| davon bis Fenster da (`TotalTime`, warm) | 0,73 s (kalt) | 0,68 s | 0,72 s | 0,59 s (kalt) | 1,38 s | 0,88 s | gleich bzw. Rauschen |
| Speicher App (PSS, ≥ 1,5 min nach Start, Home) | 266 MB | 272 MB | **270 MB** (269.799 kB) | 258 MB | 243 MB | **254 MB** (253.674 kB) | gleich |
| Speicher Server (PSS) | 86 MB | 92 MB | **88 MB** (88.268 kB) | 90 MB | 68 MB | **72 MB** (72.449 kB) | gleich |
| Leerlauf-CPU App (3 × 10 s, 0 Bilder gezeichnet) | Ø 10,9 % | Ø 12,2 % | 10,3 / 12,5 / 12,2 (**Ø 11,7 %**) | Ø 5,6 % | Ø 6,4 % | 5,7 / 5,7 / 5,0 (**Ø 5,5 %**) | gleich |
| Leerlauf-CPU Server | Ø 0,5 % | Ø 0,8 % | 0,5 / 0,3 / 0,3 (**Ø 0,4 %**) | Ø 0,6 % | Ø 0,6 % | 0,4 / 0,5 / 0,7 (**Ø 0,5 %**) | gleich |
| Ruckel-Anteil Folgenliste Black Clover (3 Läufe) | Ø 1,06 %, p99 11–15 ms | Ø 1,44 %, p99 12–21 ms | 0,99 / 0,49 / 0,71 (**Ø 0,73 %**), p90 8–10 ms, p99 10–15 ms | Ø 3,80 %, p99 22–32 ms | Ø 1,98 %, p99 22–23 ms | 1,48 / 1,63 / 1,63 (**Ø 1,58 %**), p90 21–22 ms, p99 22–23 ms | gleich oder besser; der höhere S22-Wert nach Stufe 1 kam nicht wieder |
| **APK-Größe** | 107,6 MB | 109,8 MB | **109,9 MB** (109.859.841 B) | gleiche Datei | | | +0,1 MB zu Stufe 1 (Kern-Code von Stufe 2 im JS-Bündel); +2,3 MB zu Stufe 0 |
| Anteil `libseanime.so` | 42,9 % | 42,1 % | **42,0 %** (46.194.549 B) | gleiche Datei | | | Server unverändert |

Ergebnis: Mit allen Schaltern aus misst Stufe 2 wie Stufe 1. Einzige echte Änderung bleibt die APK (+0,1 MB). Der Start-Wert des Tablets ist schlechter, der des S22 besser; beide nur aus einem Lauf.

Rundgang Stufe 2 ohne Änderung, beide Geräte (Belege `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\2d\`, `2d-s22-tour-a.png`, `2d-s22-tour-b.png`, `2d-tab-tour-a.png`, `2d-tab-tour-b.png`, Einzelbilder daneben): Home → Black Clover (Folgenliste, Messung) → zurück → Dr. STONE (`seanime-native://entry?id=105333`) → zurück → Menü → Einstellungen → zurück. Kein Absturz; im App-Log keine Fehlerzeile und keine `[Core]`-Zeile. Am S22 führte ein zweites „Zurück“ (Menü war schon zu) auf den Startbildschirm; dort wurde nichts angetippt.

Rundgang Stufe 1 ohne Änderung, beide Geräte (Belege `D:\SNB\kern-aufzeichnungen\2026-11-13\belege\1e\`, `both-1-home.png` bis `both-8.png`, Einzelbilder je Gerät daneben): Home mit echten Listen → Black Clover (Folgenliste, Messung) → zurück → Dr. STONE (per App-Link `seanime-native://entry?id=105333`) → zurück → Menü → Einstellungen → zurück zu Home. Kein Absturz; im App-Log keine Fehlerzeile und keine `[Core]`-Zeile.

### Phase 5a-2b (14.11.2026): 8 ms im Bereich `playback`, Vorschau einer Manga-Zuordnung

**Ursache:** Die schreibenden Player-Nachrichten (`video-status` im 5-s-Takt, `video-seeked`, `video-completed`) hielten am Tablet 8,1–101 ms „after start, until sql“. Ihre Anweisung wartete in der Reihe der Datenbank (`inOrder`, `database/database.ts`) hinter der Anweisung einer anderen Anfrage. Diese Wartezeit war für den Wächter kein Warten: Das Stück blieb offen, und was der Player in der Zeit auf dem Faden zeichnete, zählte als Kern-Zeit (darum die Häufung an den Schreib-Zeitpunkten und bei 80 %).

**Fix:** `openCoreDatabase(driver, now, waitInLine?)` – wartet eine Arbeit in der Reihe auf eine noch nicht fertige Arbeit davor, geht das über `waitInLine` (`core-switch.ts`: `watch.waiting(…, "database line")`); ist die Arbeit davor fertig, wird nichts gewartet und das Stück läuft weiter (kein Schnitt ohne echtes Warten; „fertig“ wird gesetzt, bevor ihr Versprechen erfüllt ist, damit der nächste Schritt desselben Aufrufers nicht als Warten zählt). Reihenfolge und Fehlerverhalten der Reihe bleiben. Gilt für alle Bereiche. Dazu Messpunkt `watch position row` in `playback.ts` (`keep`).

| Längstes Stück | vorher (Tablet, alter Stand) | Test vorher → nachher | Tablet nachher |
|---|---|---|---|
| `video-status` | 8,1–30,6 ms | 12 → ≤ 8 ms | ≤ 8 ms (keine Warnung) |
| `video-seeked` | 15,5 / 18,0 / 43,7 ms | 12 → ≤ 8 ms | ≤ 8 ms (keine Warnung) |
| `video-completed` | 101 ms | 12 → ≤ 8 ms | ≤ 8 ms (keine Warnung) |

**Testweg:** `playback/playback.test.ts` („the screens' thread“, 3 Fälle): Wächter mit eigener Uhr, jede Anweisung läuft „auf dem Faden der Datenbank“, währenddessen zeichnet der Player 12 ms; die Player-Nachricht kommt, während eine andere Anfrage ihre Anweisung laufen hat. Vorher 12 ms in einem Stück (rot), nachher ≤ 8 ms. `database/database.test.ts` („the database's line“): kein Warten nach fertiger Arbeit, Warten bei laufender, Reihenfolge, Fehler hält die Reihe nicht an. `blocking.test.ts` prüft die neue Zeile in `core-switch.ts`.

**Am Gerät (Pixel Tablet, scratch, Nutzer 10, Build von `2e04bba`, 14.11.2026 08:36–08:39, Wächter vorher „GUARD ok“, Bereiche `settings`, `anilist`, `library`, `extensions`, `streams`, `playback` an):** Dr. STONE Folge 1 online 08:37:54–08:38:03 gespielt (Medientaste Pause), pausiert auf 20:47 gesprungen, 08:38:26–08:38:30 weiter (Pause), Mini-Player geschlossen; Wiedergabe gesamt ≤ 13 s. App-Log: `video-loaded … playing 105333 episode 1`, `video-completed … progress 1 by the core`, `video-terminated … closed 105333 episode 1 at 1251 s`; Anime-Seite 1/24 „Watching“. **Keine einzige Meldung „held the app's thread“** im ganzen Lauf (der Wächter meldet jedes Stück über 8 ms; genaue Höchstwerte je Nachricht gibt das Log darunter nicht aus). Danach `anilist-clear` (Eintrag entfernt, 0), alle Bereiche aus (`areas answered by the core: none`). APK scratch 125 574 922 → 125 575 866 Bytes.

**Reste aus 5a-3:**

| Schnittstelle | Seite | Grund |
|---|---|---|
| `POST /api/v1/manga/manual-mapping/preview` | Kern, Bereich `manga` (`manga/manga.ts` `mangaMappingPreview`) | Form nach App-Typ `Manga_MappingPreview` (nicht aufgezeichnet): `chapterCount`, `latest` = Nummer des Kapitels, das der Anbieter zuletzt ordnet, `languages`/`scanlators` je einmal, ohne Werte weggelassen; nichts wird gespeichert; lokale Quelle → Server. Test in `manga/manga.test.ts` |
| `GET`/`POST`/`DELETE /api/v1/manga/source-refresh` | Server | Hintergrund-Lauf, der die Quellen aller Manga neu bewertet und ersetzt (Modi `find_missing`, `reevaluate_all` …). Die Regeln (wann ersetzt, welche `kind` bei Änderung/Problem) stehen in keiner Aufzeichnung und keinem öffentlichen Vertrag – nachbauen hieße sie erfinden |
| `POST /api/v1/custom-source/provider/list/anime\|manga` | Server | Die Einträge eigener Quellen tragen die Nummern, die der Server vergibt (§4l, `customSourceNumbers`); ohne Aufzeichnung der Antwort kann der Kern diese Form nicht sauber bauen |

### Nach Stufe 3 (14.11.2026, Build vom Stand `5a76a6e`)

| Messwert | Stufe 2 | **Stufe 3** | Bewertung |
|---|---|---|---|
| APK-Größe Test-App | 109,9 MB (109.859.841 B) | **111,9 MB** (111.946.111 B) | +2,1 MB: QuickJS-Modul (beide CPU-Arten), Hilfsfunktionen und Übersetzer im JS-Bündel |
| Selbsttest Sandkasten (S22) | – | **15/15** in 3706 ms | – |
| längstes Stück Selbsttest | – | **5,4 ms** (355 Stücke, 0 > 8 ms) | im Rahmen |
| längstes Kern-Stück im Betrieb | – | **99,8 ms** (Tablet, `fetch`-Antwort an den Sandkasten) | **über 8 ms, offen** (§4m 3f-4) |
| `episode-source` beim Abspielen (S22) | – | 1418 ms, längstes Stück 54,2 ms | vorher 1150 ms am Stück |

### Nach Stufe 5 (ohne Server gegen mit Server)

Build `efc0a7a` (Phase 5c-2, vor den beiden letzten Stillen, §4p), 14.11.2026 09:55–10:15. „Mit Server“ = alle Bereiche aus, Server-Dienst läuft (heutiger Weg); „ohne Server“ = `core?server=off` (alle Bereiche an, kein `libseanime.so`). Neustart je Lauf per `install -r` desselben APK, Daten blieben. Am Tablet startet Android die App danach selbst im Vordergrund; am S22 lebt danach nur ein Prozess für einen Broadcast (JS läuft nicht, Startbildschirm vorn) → dort `am start -W` > 10 s nach der Installation. **Start** gemessen aus dem App-Log, nicht aus Video: „Running "main"“ (JS beginnt) bis `GET /api/v1/library/collection` beantwortet (Home-Sammlung da). Speicher: `measure-android.sh mem` (PSS `dumpsys meminfo <pid>`, ~1,5 min nach Start, Home, vor dem Scrollen), App + Server zusammen. CPU: `measure-android.sh cpu 60` (ein Lauf über 60 s, Home, 0 Bilder gezeichnet), App + Server. Ruckeln: `measure-android.sh jank` (5 Wischer runter + 5 hoch, je 1 Lauf) auf Home und auf der Seite von Black Clover (Link `entry?id=97940`, Online-Folgenliste); Koordinaten wie nach Stufe 1. Seit 5c-2 nimmt das Skript `MEASURE_PACKAGE`/`MEASURE_SERVER_PORT` (scratch: `com.seanime.app.scratch`, 43213) und bricht ohne Server-Prozess nicht mehr ab.

**Pixel Tablet** (scratch, Nutzer 10, Test-Konto):

| Messwert | mit Server | **ohne Server** | Bewertung |
|---|---|---|---|
| Start: JS → Home-Sammlung | 1,98 s (Prozess-Start → Sammlung 4,27 s) | **0,80 s** (Prozess-Start → Sammlung 3,11 s) | schneller: Status, Home und Sammlung vom Kern ohne HTTP |
| PSS gesamt | 337 MB (App 273.972 kB + Server 63.199 kB) | **289 MB** (288.970 kB, kein Server) | −48 MB |
| CPU Leerlauf 60 s | 15,9 % (App 14,9 + Server 1,0) | **16,6 %** (nur App) | gleich (je 1 Lauf, Rauschen) |
| Ruckeln Home | nicht messbar (Home des Test-Kontos passt auf den Schirm, 0 Bilder) | nicht messbar | – |
| Ruckeln Black Clover | 3,85 % (24/623), p90 22 ms, p99 34 ms | **2,43 %** (16/659), p90 22 ms, p99 42 ms | gleich bis besser |

**S22 Ultra** (Test-App, Nutzer 0, echtes Konto, nur lesend):

| Messwert | mit Server | **ohne Server** | Bewertung |
|---|---|---|---|
| Start: JS → Home-Sammlung | 2,08 s (`TotalTime` 722 ms) | **0,93 s** (`TotalTime` 606 ms) | schneller |
| PSS gesamt | 367 MB (App 278.515 kB + Server 88.669 kB) | **402 MB** (402.206 kB, kein Server) | ~~+35 MB, schlechter~~ **Richtigstellung 5c-3:** 1 Lauf, nicht wiederholbar; Nachmessung mit 3 Läufen je Seite unten: ohne Server **−67 MB**. Nach dem Scrollen 573 MB (davon Grafik 257 MB, Bilder) – ohne Gegenwert mit Server, nicht vergleichbar |
| CPU Leerlauf 60 s | 9,4 % (App 9,2 + Server 0,2) | **10,1 %** (nur App) | gleich (je 1 Lauf) |
| Ruckeln Home | 1,97 % (21/1067), p90 11 ms, p99 17 ms | **1,85 %** (20/1079), p90 12 ms, p99 15 ms | gleich |
| Ruckeln Black Clover | 1,05 % (15/1433), p90 10 ms, p99 16 ms | **1,19 %** (17/1431), p90 10 ms, p99 15 ms | gleich |

| APK | Größe |
|---|---|
| Test-App (`efc0a7a`) | 112,4 MB (112.381.459 B) |
| scratch (`efc0a7a`) | 125,7 MB (125.660.738 B) |

Ergebnis: Ohne Server startet Home 1,1–1,2 s früher, CPU und Ruckeln bleiben gleich. Speicher: Tablet −48 MB, S22 damals +35 MB (je 1 Lauf) – **richtiggestellt in 5c-3** (Nachmessung unten): S22 ohne Server −67 MB.

**Nachmessung S22 (Phase 5c-3, §4p):** Test-App, Build `93dfa1f`, 14.11.2026 (ohne Server vormittags, mit Server 14:29–14:35). Je Seite 3 Läufe: `install -r` desselben APK, 12 s warten, `am start -W`, 60 s Leerlauf auf Home, dann `dumpsys meminfo <pid>` (PSS, App Summary) für App und – mit Server – den Prozess `libseanime.so --port 43212`, danach Prüf-Link `core?memory=report`. „Mit Server“ belegt: Log `without the server: no, areas answered by the core: none`, Server-Prozess in allen 3 Läufen gemessen. Mittelwert ± Streuung in MB:

| Kategorie | mit Server: App | mit Server: Server | **ohne Server: App** | ohne − mit (App) |
|---|---|---|---|---|
| Java Heap | 25,5 ± 1,2 | 0,0 | **33,0 ± 0,9** | +7,4 |
| Native Heap | 64,5 ± 0,6 | 0,3 | **69,2 ± 0,1** | +4,7 |
| Code | 46,3 ± 1,0 | 44,9 ± 4,9 | **57,0 ± 2,0** | +10,7 (davon `.apk mmap` +8,4, `.so mmap` −0,2) |
| Grafik | 90,7 ± 0,1 | 0,0 | **88,1 ± 0,9** | −2,6 |
| Private Other | 31,4 ± 0,1 | 38,5 ± 1,3 | **32,6 ± 0,3** | +1,2 |
| System | 10,5 ± 0,6 | 0,3 | **7,1 ± 0,7** | −3,5 |
| Stack | 2,2 | 0,2 | **1,5** | −0,7 |
| PSS App | 271,1 ± 1,0 | – | **288,4 ± 3,1** | +17,3 |
| **PSS App + Server** | **355,5 ± 5,4** (Server 84,4 ± 5,9) | | **288,4 ± 3,1** | **−67,1** |

`memory=report`: mit Server Hermes-Heap 20 MB, ohne 24 MB; gemerkte Antworten je 22 / 0,7 MB; 0 Sandkästen offen; Torrent-Modul nicht geladen (beide).

**Ursache der +17 MB in der App:** der Kern macht ohne Server die Arbeit des Servers selbst. `.apk mmap` +8,4 MB = mehr Seiten des JS-Bündels: `assets/index.android.bundle` (9,35 MB) liegt unkomprimiert im APK und wird direkt gemappt; alle `.so` sind komprimiert (also entpackt, `.so mmap`), und `.so mmap` ist gleich (23,9 / 23,6 MB) → **keine zusätzliche native Bibliothek** (Torrent-Modul laut Bericht nicht geladen, Sandkasten-Modul ohne offene Sandkästen). Java Heap +7,4 und Native Heap +4,7 MB = Daten und Arbeit der Bereiche (Hermes-Heap +4 MB, `core.db`). Eine Aufteilung je Datei (`smaps`/`showmap`) geht an der Test-App nicht: nicht debuggable, S22 ohne Root. **Kein Fix:** kein einzelnes Modul wird unnötig früh geladen, und App + Server brauchen mit Server 67 MB mehr. Der Befund +35 MB aus 5c-2 (1 Lauf, Build `efc0a7a`, ~1,5 min nach Start) ließ sich nicht wiederholen.

## 6. Aufzeichnung

Werkzeug: `native/scripts/record-server.mjs` (Kopf der Datei erklärt alle Befehle). Es spricht nur mit der Test-App (Port 43212 per `adb forward`) und weigert sich bei Port 43211.

Ablage **außerhalb des Repos**: `D:\SNB\kern-aufzeichnungen\<Datum>\` mit `api\` (je Schnittstelle eine Datei: Anfrage + Antwort), `api-faelle\` (die 98 Manifest-Fälle), `events\`, `messung\`, `belege\`.

**Bereinigung im Skript, vor dem Schreiben:** Werte unter Schlüsseln mit token/password/secret/cookie/apikey/proof, Nutzernamen-Felder, der AniList-Name (überall, wo er vorkommt), Avatar- und Profil-Banner-Adressen, JWTs, `Bearer …`, Geheimnisse in Adressen (`?token=…`), Adressen aus dem Heimnetz, gespeicherte Einstellungen von Erweiterungen. Prüfung: `record-server.mjs check` (13.11.: 339 Dateien, kein Fund).

### Schnittstellen (13.11.2026, Server 3.10.4, Beispiel-Anime Dr. STONE)

| | Anzahl |
|---|---|
| Schnittstellen der App (`endpoints.ts`) | 216 |
| **aufgezeichnet** | **76** (95 Antworten, weil je Quelle/Erweiterung eine) |
| davon mit Fehler-Antwort des Servers (auch das ist Verhalten) | 6 |
| **bewusst nicht aufgezeichnet** | **140** (Datei enthält die Anfrage-Form aus `endpoint.types.ts` und den Grund) |
| Fehler beim Aufzeichnen | 0 |

Aufgerufen wird nur, was in der Liste `CALLS` des Skripts steht. Alles andere gilt als „ändert Zustand“.

**Aufgezeichnet (76):**

- `STATUS`: GetStatus, GetLogFilenames, GetLatestLogContent, GetMemoryStats, GetHomeItems
- `EXTENSIONS`: ListExtensionData, ListDevelopmentModeExtensions, GetAllExtensions, GetExtensionUpdateData, ListMangaProviderExtensions, ListOnlinestreamProviderExtensions, ListAnimeTorrentProviderExtensions, ListAnimeEntryEpisodeTabExtensions, ListCustomSourceExtensions, GetPluginSettings, GetMarketplaceExtensions, GetExtensionPayload, GetExtensionUserConfig, FetchExternalExtensionData
- `ANILIST`: GetAnimeCollection, GetRawAnimeCollection, GetRawAnimeCollectionTags, GetAnilistAnimeDetails, GetAnilistStudioDetails, AnilistListAnime, AnilistListRecentAiringAnime, AnilistListMissedSequels, GetAniListStats, GetAnilistCacheLayerStatus
- `ANIME`: GetAnimeEpisodeCollection
- `ANIME_COLLECTION`: GetLibraryCollection, GetAnimeCollectionSchedule
- `ANIME_ENTRIES`: GetAnimeEntry, GetMissingEpisodes, GetUpcomingEpisodes, GetAnimeEntrySilenceStatus
- `CONTINUITY`: GetContinuityWatchHistory, GetContinuityWatchHistoryItem
- `DEBRID`: DebridGetTorrents
- `DIRECTORY_SELECTOR`: DirectorySelector (nur der eigene Datenordner des Servers)
- `DLNA_CAST`: DlnaCastCurrent
- `FILECACHE`: GetFileCacheTotalSize
- `LIBRARY_EXPLORER`: GetLibraryExplorerFileTree
- `MANGA`: GetMangaPreferences, GetMangaSourceRefresh, GetRawAnilistMangaCollection, GetRawAnilistMangaCollectionTags, GetMangaCollection, GetMangaLatestChapterNumbersMap, AnilistListManga, GetMangaEntry, GetMangaEntryDetails, GetMangaEntryDownloadedChapters, GetMangaMapping, MangaManualSearch, GetMangaEntryChapters, GetMangaEntryPages
- `MANGA_DOWNLOAD`: GetMangaDownloadQueue, GetMangaDownloadsList, GetMangaDownloadData
- `METADATA`: GetMediaMetadataParent
- `MOBILE_OFFLINE`: GetMobileOfflineSnapshot
- `NAKAMA`: GetNakamaAnimeLibrary, GetNakamaAnimeLibraryShared
- `ONLINESTREAM`: OnlinestreamManualSearch, GetOnlinestreamMapping, GetOnlineStreamEpisodeList, GetOnlineStreamEpisodeSource
- `PLAYBACK_MANAGER`: PlaybackGetNextEpisode
- `PLAYLIST`: GetPlaylists
- `SCAN_SUMMARY`: GetScanSummaries
- `TORRENT_CLIENT`: GetActiveTorrentList, GetBuiltInTorrentDetails
- `TORRENT_SEARCH`: GetAutoSelectProfile, SearchTorrent
- `TORRENTSTREAM`: GetTorrentstreamBatchHistory

Die Abrufe bei Quellen (Suche, Folgenliste, Folgen-Quelle, Kapitel, Seiten, Torrent-Suche) tun dasselbe wie das Öffnen der Seite in der App: Der Server fragt die Quelle und merkt sich die Antwort in seinem Zwischenspeicher. Am Konto, an Einträgen oder Downloads ändert das nichts; abgespielt wird nichts.

**Fehler-Antworten des Servers (6), alle Status 500 mit `{ "error": … }`:** GetAnilistStudioDetails mit unbekannter Kennung („no cached data available“), DebridGetTorrents („debrid: Provider not set“), GetMangaEntryChapters bei der lokalen Manga-Quelle („no results found for this media“), GetNakamaAnimeLibrary und GetNakamaAnimeLibraryShared („host is not sharing its anime library“), GetBuiltInTorrentDetails („missing torrent hash“).

**Nicht aufgezeichnet (140):**

- **ändert Zustand (113):** `ANILIST`: EditAnilistListEntry, DeleteAnilistListEntry, ToggleAnilistCacheLayerStatus · `ANIME_COLLECTION`: AddUnknownMedia · `ANIME_ENTRIES`: AnimeEntryBulkAction, AnimeEntryManualMatch, ToggleAnimeEntrySilenceStatus, UpdateAnimeEntryProgress, UpdateAnimeEntryRepeat · `AUTH`: Login, Logout · `CONTINUITY`: UpdateContinuityWatchHistoryItem · `DEBRID`: SaveDebridSettings, DebridAddTorrents, DebridStartStream, DebridCancelStream · `DIRECTSTREAM`: DirectstreamPlayLocalFile · `DISCORD`: SetDiscordMangaActivity, CancelDiscordActivity · `DLNA_CAST`: DlnaCastStart, DlnaCastSwitchStream, DlnaCastLoad, DlnaCastControl, DlnaCastStop, DlnaCastForward, DlnaCastForwardClose · `DOWNLOAD`: DownloadTorrentFile · `EXPLORER`: OpenInExplorer · `EXTENSIONS`: InstallExternalExtension, InstallExternalExtensionRepository, UninstallExternalExtension, UpdateExtensionCode, ReloadExternalExtension, SetExternalExtensionDisabled, SetPluginSettingsPinnedTrays, GrantPluginPermissions, RunExtensionPlaygroundCode, SaveExtensionUserConfig · `FILECACHE`: RemoveFileCacheBucket · `LIBRARY_EXPLORER`: RefreshLibraryExplorerFileTree · `LOCAL`: LocalSyncSimulatedDataToAnilist · `LOCALFILES`: ImportLocalFiles, LocalFileBulkAction, UpdateLocalFileData, UpdateLocalFiles, DeleteLocalFiles, RemoveEmptyDirectories · `MANGA`: ImportMangaPreferences, PatchMangaPreference, StartMangaSourceRefresh, StopMangaSourceRefresh, EmptyMangaEntryCache, UpdateMangaProgress, MangaManualMapping, RemoveMangaMapping · `MANGA_DOWNLOAD`: DownloadMangaChapters, StartMangaDownloadQueue, StopMangaDownloadQueue, ClearAllChapterDownloadQueue, ResetErroredChapterDownloadQueue, DeleteMangaDownloadedChapters · `METADATA`: PopulateFillerData, RemoveFillerData, SaveMediaMetadataParent, DeleteMediaMetadataParent · `MOBILE_OFFLINE`: MobileOfflineBatch, MobileOfflineDownload, MobileOfflineAction, MobileOfflineNetwork, MobileOfflineSettings, MobileOfflinePosition, MobileOfflineCacheManga · `NAKAMA`: NakamaPlayVideo, NakamaReconnectToHost, NakamaRemoveStaleConnections, NakamaCreateAndJoinRoom, NakamaDisconnectFromRoom, NakamaCreateWatchParty, NakamaJoinWatchParty, NakamaLeaveWatchParty, NakamaSendChatMessage · `ONLINESTREAM`: OnlineStreamEmptyCache, OnlinestreamManualMapping, RemoveOnlinestreamMapping · `PLAYBACK_MANAGER`: PlaybackPlayVideo, PlaybackPlayRandomVideo, PlaybackSyncCurrentProgress, PlaybackPlayNextEpisode, PlaybackAutoPlayNextEpisode, PlaybackStartManualTracking, PlaybackCancelManualTracking · `PLAYLIST`: CreatePlaylist, UpdatePlaylist, DeletePlaylist · `REPORT`: SaveIssueReport · `SCAN`: ScanLocalFiles · `SETTINGS`: GettingStarted, SaveSettings, PatchSetting, SaveMediaPlayerSettings · `STATUS`: DeleteLogs, ForceGC, UpdateHomeItems · `THEME`: UpdateTheme · `TORRENT_CLIENT`: TorrentClientAction, TorrentClientDownload · `TORRENT_SEARCH`: SaveAutoSelectProfile, DeleteAutoSelectProfile · `TORRENTSTREAM`: SaveTorrentstreamSettings, TorrentstreamStartStream, TorrentstreamStopStream, DeleteTorrentstreamBatchHistory · `VIDEOCORE`: VideoCoreSaveScreenshot
- **liefert eine Datei, kein JSON (5):** `MANGA`.GetLocalMangaPage, `MOBILE_OFFLINE`.MobileOfflineFile und .MobileOfflineArtwork, `MEDIASTREAM`.MediastreamLocalSubtitles, `REPORT`.DownloadIssueReport
- **Diagnose der Go-Laufzeit, im Kern ohne Gegenstück (3):** `STATUS`.GetMemoryProfile, .GetGoRoutineProfile, .GetCPUProfile
- **wirkt nach außen (6):** `DLNA_CAST`.DlnaCastDiscover (Suche im Heimnetz), `NAKAMA`.NakamaWebSocket (Verbindung zu anderem Gerät), `NAKAMA`.NakamaRoomsAvailable (fremder Dienst), `TORRENT_CLIENT`.TorrentClientGetFiles (legt Torrent in einem Programm an), `TORRENTSTREAM`.GetTorrentstreamTorrentFilePreviews (tritt einem Schwarm bei), `VIDEOCORE`.VideoCoreTranslateSubtitleLines (fremder Übersetzungsdienst)
- **in der Test-App nicht möglich (9):** `CUSTOM_SOURCE`.CustomSourceListAnime und .CustomSourceListManga (keine eigene Quelle installiert), `NAKAMA`.GetNakamaAnimeLibraryFiles und .GetNakamaAnimeAllLibraryFiles (kein Gastgeber verbunden), `DEBRID`.DebridGetTorrentFilePreviews (kein Debrid-Konto), `PLAYLIST`.GetPlaylistEpisodes (keine Playlist vorhanden), `DLNA_CAST`.DlnaCastStatus, `VIDEOCORE`.VideoCoreInSightGetCharacterDetails und .VideoCoreGetSubtitleTrack (gehören zu einer laufenden Wiedergabe)
- **im Zweifel nicht (4):** `DIRECTSTREAM`.DirectstreamConvertSubs, `MANGA`.PreviewMangaMapping, `MOBILE_STORAGE`.MobileStorageAccess, `ANIME_ENTRIES`.FetchAnimeEntrySuggestions (liest einen Ordner des Nutzers)

Diese müssen vor ihrer Stufe nachgeholt werden: mit einem Test-Konto und Wegwerf-Daten, oder aus dem App-Code und der Bedienung beschrieben.

### Wegwerf-App „scratch“ (Phase 1a)

Für Schnittstellen, die Zustand ändern, gibt es eine dritte Variante in `native/app-variants.json`: **„Seanime Scratch“**, Paket `com.seanime.app.scratch`, Schema `seanime-scratch`, Port **43213**, versionCode 1, Symbole der Test-App. Sie ist **debuggable** (Plugin `native/plugins/with-debuggable.js`, gesetzt im Gradle-Build-Typ), damit `adb shell run-as com.seanime.app.scratch …` ihre Dateien lesen kann. Nur diese Variante; `release` nie (das Build-Skript lehnt `-Debuggable` zusammen mit `-Release` ab).

- Bauen: `build-android.ps1 -ToolchainRoot <tools> -SkipGoBuild -Variant scratch` → `<Work>\Seanime-Native-<version>-scratch.apk` (Paket, Name, versionCode und `application-debuggable` prüft das Skript per aapt2). Ohne `-Variant` wie bisher die Test-App.
- Einmal-Build der Test-App, die `run-as` erlaubt: `-Debuggable` → `<Work>\Seanime-Native-<version>-test-debuggable.apk` (nur für die DB-Kopie unten; danach die normale Test-APK wieder mit `install -r` drüber, Daten bleiben).
- Installiert am Pixel Tablet, Nutzer 10. Kein AniList-Konto, keine Erweiterungen aus dem Internet. Nichts darin ist echt.
- Port 43213 ist zugleich der voreingestellte Torrent-Client-Port des (ausgeschalteten) Torrent-Streamings; Torrent-Streaming in scratch nie einschalten.

### Aufzeichnung schreibend (13.11.2026, scratch-App)

Befehl: `record-server.mjs api-write [--bucket <name>]` (nur Port 43213; vorher `adb forward tcp:43213 tcp:43213` und `adb reverse tcp:8765 tcp:8765`, danach beide entfernen). Je Schritt: Anfrage, Antwort und der Zustand **vor und nach** dem Aufruf über die passende Lese-Schnittstelle. Erweiterungen kommen vom PC (eigene Probe-Manifeste), nicht aus dem Netz. Die Erststart-Anfrage ist genau die der App (`getting-started-payload.ts`, per jiti geladen). Ablage `D:\SNB\kern-aufzeichnungen\2026-11-13\api-schreibend\`; `record-server.mjs check` danach: 463 Dateien, kein Fund.

Jede der 113 Schnittstellen, die Zustand ändern, steht im Skript entweder als Schritt (`WRITES`) oder mit Grund (`WRITE_SKIPS`); sonst bricht der Lauf vor dem ersten Aufruf ab.

| | Anzahl |
|---|---|
| Schnittstellen, die Zustand ändern | 113 |
| **aufgezeichnet** | **47** (54 Antworten: Umschalter je zweimal, Erweiterungen mehrfach) |
| davon Fehler-Antwort des Servers | 2 Antworten (bis Phase 1e: 5) |
| **bewusst nicht aufgerufen** | **66** |

**Aufgezeichnet (47):** `SETTINGS`: GettingStarted, SaveSettings, PatchSetting, SaveMediaPlayerSettings · `THEME`: UpdateTheme · `STATUS`: UpdateHomeItems, ForceGC · `PLAYLIST`: CreatePlaylist, UpdatePlaylist, DeletePlaylist · `EXTENSIONS`: InstallExternalExtension, SaveExtensionUserConfig, UpdateExtensionCode, ReloadExternalExtension, SetExternalExtensionDisabled, SetPluginSettingsPinnedTrays, RunExtensionPlaygroundCode, InstallExternalExtensionRepository, UninstallExternalExtension · `ONLINESTREAM`: OnlinestreamManualMapping, RemoveOnlinestreamMapping, OnlineStreamEmptyCache · `ANILIST`: ToggleAnilistCacheLayerStatus (nur der lokale Schalter) · `ANIME_ENTRIES`: ToggleAnimeEntrySilenceStatus · `METADATA`: SaveMediaMetadataParent, DeleteMediaMetadataParent, RemoveFillerData · `CONTINUITY`: UpdateContinuityWatchHistoryItem · `MANGA`: MangaManualMapping, RemoveMangaMapping, PatchMangaPreference, ImportMangaPreferences, EmptyMangaEntryCache, StopMangaSourceRefresh · `MANGA_DOWNLOAD`: StopMangaDownloadQueue, ResetErroredChapterDownloadQueue, ClearAllChapterDownloadQueue, DeleteMangaDownloadedChapters (leere Liste) · `TORRENT_SEARCH`: SaveAutoSelectProfile, DeleteAutoSelectProfile · `TORRENTSTREAM`: SaveTorrentstreamSettings (bleibt aus), DeleteTorrentstreamBatchHistory · `MOBILE_OFFLINE`: MobileOfflineSettings, MobileOfflineNetwork, MobileOfflineAction (unbekannte Kennung) · `LIBRARY_EXPLORER`: RefreshLibraryExplorerFileTree · `FILECACHE`: RemoveFileCacheBucket (`watch_history`)

**Repository nachgeholt (Phase 1e, 13.11. 14:04):** Die erste Probe-Datei war eine Liste von Manifest-Adressen; der Server erwartet ein Objekt. Welche Form, wurde an der Vorschau der scratch-App ausprobiert (nur `install: false`): `{ "name": …, "urls": [<Manifest-Adressen>] }` liefert die Erweiterung, `extensions`/`manifests`/`manifestURIs` liefern 0. Mit dieser Datei neu aufgezeichnet per `api-write --only EXTENSIONS.InstallExternalExtensionRepository,EXTENSIONS.UninstallExternalExtension.repo`: Vorschau 200 („fetched 1“), Installieren 200 („installed 1“), Deinstallieren der Repository-Erweiterung 200 (vorher Fehler, weil nichts installiert war). Die übrigen Zeilen in `index.json` blieben, `repeatedAt` nennt den Zeitpunkt. `check` danach: 464 Dateien, kein Fund. Dateien des ersten Laufs enthalten noch `/data/<user>/…` (alte Bereinigung, s. §10); neue nicht mehr.

**Fehler-Antworten (2), beide 500 mit `{ "error": … }`:** RunExtensionPlaygroundCode ohne AniList-Daten („no cached data available“), MobileOfflineAction mit unbekannter Kennung („invalid id“). Bis Phase 1e zusätzlich InstallExternalExtensionRepository (Vorschau + Installieren) und UninstallExternalExtension der Repository-Erweiterung, s. oben.

**Bewusst nicht aufgerufen (66):**

- **ändert das AniList-Konto (11):** EditAnilistListEntry, DeleteAnilistListEntry, AddUnknownMedia, UpdateAnimeEntryProgress, UpdateAnimeEntryRepeat, Login, Logout, LocalSyncSimulatedDataToAnilist, UpdateMangaProgress, PlaybackSyncCurrentProgress, PlaybackStartManualTracking
- **fremder Dienst / sendet nach außen (22):** `DEBRID` 4 (auch SaveDebridSettings), `DISCORD` 2, `NAKAMA` 9, `DLNA_CAST` 7
- **Wiedergabe (9):** DirectstreamPlayLocalFile, PlaybackPlayVideo, PlaybackPlayRandomVideo, PlaybackPlayNextEpisode, PlaybackAutoPlayNextEpisode, PlaybackCancelManualTracking, VideoCoreSaveScreenshot, TorrentstreamStartStream, TorrentstreamStopStream
- **Download / Torrent / Abruf aus dem Internet (10):** TorrentClientAction, TorrentClientDownload, DownloadTorrentFile, DownloadMangaChapters, StartMangaDownloadQueue, MobileOfflineBatch, MobileOfflineDownload, MobileOfflineCacheManga, StartMangaSourceRefresh (fragt alle Manga-Quellen), PopulateFillerData (fremde Seite)
- **lokale Videodateien / Ordner, scratch hat keine (9):** AnimeEntryBulkAction, AnimeEntryManualMatch, ImportLocalFiles, LocalFileBulkAction, UpdateLocalFileData, UpdateLocalFiles, DeleteLocalFiles, RemoveEmptyDirectories, ScanLocalFiles
- **im Zweifel nicht / nicht möglich (5):** MobileOfflinePosition (kann zu AniList-Fortschritt werden), SaveIssueReport (sammelt Logs zum Senden), GrantPluginPermissions (kein Plugin installiert), OpenInExplorer (Desktop-Programm), DeleteLogs (nur die laufende Log-Datei vorhanden, Schritt übersprungen)

### Aufzeichnung AniList ändernd (13.11.2026, scratch-App mit Test-Konto)

Befehl: `record-server.mjs anilist-write --test-account <Test-Konto>` (nur Port 43213, Wächter siehe §4f; `--only <Schritt>,…` oder `--only 21-` wiederholt einzelne). 31 Schritte mit Dr. STONE (105333), einem zweiten Anime (1) und einem Manga (98416): Eintrag anlegen, alle Felder ändern, abschließen, zurück auf „schaue ich“, Fortschritt vor/zurück/letzte Folge, aus jedem Status, ohne Eintrag, Gesamtzahl unbekannt, Wiederholungen, Manga-Kapitel, Löschen, sechs Fehlerfälle. Je Schritt eine Datei unter `D:\SNB\kern-aufzeichnungen\2026-11-13\api-anilist-schreibend\`: Anfrage, Antwort, Ereignisse des Servers an alle Clients, Zustand vor und nach (Anime-/Manga-Seite des Servers, Eintrag in seiner Sammlung, öffentliche AniList-Abfrage). 26 Antworten 200 `true`, 5 Antworten 500; 33 Wächter-Prüfungen, alle Test-Konto; Konto danach leer (`index.json`). `record-server.mjs check`: kein Fund.

Zu beachten: Die **öffentliche** AniList-Abfrage kommt aus einem Zwischenspeicher und zeigt eine Änderung erst nach bis zu einer Minute; maßgeblich für „Zustand danach“ ist die Sammlung des Servers (eigener Token). `anilist-guard --wait-for <Titel>:<STATUS|none>[:<Fortschritt>]` fragt deshalb wiederholt. `anilist-clear` leert das Test-Konto über den Server.

### DB-Kopien (13.11.2026)

Ablage `D:\SNB\kern-aufzeichnungen\2026-11-13\db-kopien\`: `a-scratch-frisch\` (scratch nach dem ersten Start, vor jedem Aufruf), `b-scratch-nach-aufzeichnung\` (dazu die Datei-Cache-Buckets `watch_history`, `manga-preferences`, `plugin-settings`, `extension-settings`), `c-test\` (Test-App mit echten Daten, **bereinigt**), `roh\c-test\` (Roh-Kopie, bleibt nur dort). Je Datenbank daneben `<name>.schema.txt` mit Zeilenzahlen und `.schema`. Neben `seanime.db` liegen `offline/local.db` (Tabelle `simulated_collections`, in allen drei Kopien 2 Zeilen) und `mobile-offline/queue.json`; (c) zusätzlich `cache/watch_history.cache`.

(c) gelesen über einen Einmal-Build der Test-App mit `-Debuggable`, per `install -r` (Nutzer 10) drüber installiert, Dateien per `adb exec-out run-as … cat` kopiert, danach die normale Test-APK wieder per `install -r` drüber (nicht debuggable, Daten blieben, App startet normal). Bereinigt: Spalten mit token/password/secret/api_key → `<redacted>`, `accounts.username` und `accounts.viewer` → `<user>`, JWTs, Heimnetz-Adressen. Beleg: `eyJ` außerhalb von `roh\` 0 Treffer.

`seanime.db` hat in allen drei Kopien dieselben 30 Tabellen (Zeilen):

| Tabelle | (a) scratch frisch | (b) scratch danach | (c) Test-App |
|---|---|---|---|
| `accounts` | 0 | 0 | 1 |
| `debrid_settings` | 1 | 1 | 1 |
| `local_files` | 1 | 1 | 5 |
| `mediastream_settings` | 1 | 1 | 1 |
| `scan_summaries` | 0 | 0 | 4 |
| `settings` | 0 | 1 | 1 |
| `shelved_local_files` | 0 | 0 | 1 |
| `themes` | 0 | 1 | 1 |
| `torrentstream_settings` | 1 | 1 | 1 |
| übrige 21 (`auto_downloader_items`, `auto_downloader_profiles`, `auto_downloader_rules`, `auto_select_profiles`, `chapter_download_queue_items`, `custom_source_collections`, `custom_source_identifiers`, `debrid_torrent_items`, `debrid_transfer_hashes`, `dummy_debrid_settings`, `local_torrents`, `mals`, `manga_mappings`, `media_fillers`, `media_metadata_parents`, `onlinestream_mappings`, `playlist_entries`, `playlists`, `plugin_data`, `silenced_media_entries`, `torrentstream_histories`) | 0 | 0 | 0 |

Beobachtet: Erst `GettingStarted` legt `settings` und `themes` an. In (b) bleiben Playlists, Zuordnungen, Metadaten-Eltern, Stummschaltungen und das Auto-Select-Profil leer, weil jeder Schritt sein Gegenstück hat (anlegen → löschen, an → aus). Manga-Vorlieben, Plugin- und Erweiterungs-Einstellungen und der Verlauf liegen nicht in der Datenbank, sondern im Datei-Cache (`files/cache/*.cache`).

### Ereignisse (WebSocket `/events`)

| Aufnahme | Wie | Ergebnis |
|---|---|---|
| Leerlauf, 5 min | zweiter Teilnehmer an `/events` (`record-server.mjs events`) | nur `client-identity` (1) und `pong` (19). **Im Leerlauf sendet der Server nichts.** |
| Bedienung, 6 min | wie oben, während die App benutzt wurde | wieder nur `client-identity` und `pong` (23): Die Ereignisse gehen an die Kennung der App selbst, ein zweiter Teilnehmer bekommt sie nicht |
| Bedienung, aus dem Server-Log | `record-server.mjs events-log` zählt die Zeilen „ws > Sending message“ (Start nach Installation, Tabs, Anime-Seite, Online-Stream, Erweiterungen) | beim Start: `server-ready` 1, `refreshed-anilist-anime-collection` 1, `refreshed-anilist-manga-collection` 1, `extensions-reloaded` 3, `refreshed-manga-download-data` 2; je Wiedergabe-Start: `in-sight-data` 1 (2 gesamt) |

Die Inhalte der Ereignisse kürzt das Server-Log; sie sind nicht aufgezeichnet. Für den Ereignis-Verteiler (Stufe 1) reicht die Liste der Arten in `native/src/lib/server/ws-events.ts`; die Inhalte kommen je Bereich mit dessen Stufe.

## 7. Probe 1: mpv mit Sonder-Kopfzeilen ohne Server-Zwischenstation

**Frage:** Spielt mpv einen Stream, dessen Quelle eigene Kopfzeilen verlangt, direkt – ohne `/api/v1/proxy`?

**Ergebnis: geht** für Liste, Varianten, Stücke und Untertitel-Dateien. **Nicht belegt** für verschlüsselte Streams (Schlüssel), siehe unten.

**Umsetzung (hinter dem Schalter `streams`, Standard aus):** `buildOnlineStream(…, direct)` gibt die Adressen der Quelle unverpackt weiter, dazu ihre Kopfzeilen. Der Player setzt sie vor dem Öffnen als mpv-Option `http-header-fields` (`mpvHeaderOptions` in `player-logic.ts`; ein Komma in einem Wert wird maskiert). mpv schickt die Felder bei jedem Abruf des Streams mit. Kein natives Modul, kein neuer Patch.

**Beleg (S22, Dr. STONE Folge 1, je wenige Sekunden, 13.11. 09:36–09:39):**

| | über die Zwischenstation (heute) | direkt (Schalter an) |
|---|---|---|
| Bild | läuft | läuft, mit Untertitel |
| Server-Log | 6 Zeilen „proxy > Sending modified HLS playlist“ | keine Proxy-Zeile |
| Server-CPU über 10 s | 3,8 % | 0,3 % |
| App-CPU über 10 s | 28,9 % | 35,8 % |

Dass die Kopfzeilen wirklich nötig sind und wirklich ankommen: Vom PC geprüft antwortet die Quelle auf Liste, Variante, Stück (liegt auf einem **anderen** Host) und Untertitel-Datei mit 403, sobald die Kopfzeilen fehlen, mit 200, wenn sie da sind. Am Gerät spielt der Stream samt Untertitel – also hat mpv sie bei allen vier Arten von Abruf mitgeschickt, auch über Host-Grenzen. Eine zweite Quelle verhält sich vom PC aus gleich (dort ist `Referer` Pflicht statt `Origin`).

**Offen:**

- **Schlüssel (`#EXT-X-KEY`):** Beide Test-Quellen liefern unverschlüsselt (3f-2 am S22 per Prüf-Link nachgesehen: anikoto und kaa, Dr. STONE und Frieren, keine `#EXT-X-KEY`-Zeile). mpv holt einen Schlüssel auf demselben Weg wie ein Stück (verschachtelter Abruf, Optionen werden weitergereicht), gezeigt ist es nicht. Vor Stufe 3 an einem verschlüsselten Stream prüfen.
- Tablet und zweite Quelle am Gerät (Tablet war gesperrt).
- Startzeit im Vergleich: direkt 7 s vom Tipp bis zur Wiedergabe (Fortsetzen bei 3:35); über die Zwischenstation nicht sauber gemessen.
- Wechsel von einer Quelle mit Kopfzeilen zu einer ohne im selben Player (Code leert die Liste, am Gerät nicht geprüft).
- Download einer Folge und Cast gehen weiter über den Server.
- **3f-2 (13.11.2026):** Mit Bereich `streams` kommt die Quelle aus dem Kern; Dr. STONE Folge 1 (kaa) am S22 mit Bild + Untertitel, im Abspiel-Fenster weder Proxy- noch Online-Stream-Anfrage beim Server (§4m 3f-2).

## 8. Probe 2: Erweiterung im QuickJS-Sandkasten

**Frage:** Läuft eine Erweiterung in einem QuickJS-Sandkasten, wenn die App ihr das Netz stellt?

**Ergebnis unter Node: ja, mit gleichem Ergebnis wie der Server.** Auf dem Gerät noch nicht belegt.

**Lauf:** `native/scripts/probe-quickjs.mjs`. QuickJS als WebAssembly (`quickjs-emscripten` 0.32.0, MIT, nur Entwickler-Abhängigkeit). TypeScript-Quellen werden einmal in JavaScript gewandelt. Die Erweiterung bekommt genau zwei Dinge: `console` und ein `fetch`, das der Wirt beantwortet. Grenzen: 64 MB Speicher, 512 KB Stapel, 60 s. Im Sandkasten gibt es kein `process`, `require`, `XMLHttpRequest`, `WebSocket`, `setTimeout`.

| Erweiterung (eigene, wie in der Test-App installiert) | Suche | Sandkasten | Server (Aufzeichnung derselben Minute) | Vergleich |
|---|---|---|---|---|
| Internet Archive (Torrent-Suche, TypeScript) | „dr. stone“ | 85 Treffer, 0,9 s, 1 Abruf, 0,2 MB | 85 Treffer | **85 von 85 gleich, gleiche Reihenfolge** |
| zweite eigene Torrent-Quelle (TypeScript) | „dr. stone“ | 74 Treffer, 0,6 s, 1 Abruf, 0,1 MB | 74 Treffer | **74 von 74 gleich**, Reihenfolge anders: der Server sortiert nach der Quelle noch einmal |

Was der Server zusätzlich tut (für Stufe 6): Er setzt das Feld `provider`, lässt leere Wahlfelder weg (`resolution`, `releaseGroup`, `isBatch`) und liefert neben `torrents` noch `torrentMetadata` (Dateinamen gedeutet) und weitere Felder.

**Welche QuickJS-Anbindung für React Native / Expo SDK 58 (New Architecture) taugt (Stand 13.11.2026):**

| Kandidat | Pflege | 16-KB-Seiten | Lizenz | Urteil |
|---|---|---|---|---|
| `io.github.dokar3:quickjs-kt` (Kotlin) | 1.0.18 vom 07.11.2026, drei Versionen im November | ja (laut Projekt im Januar 2026 ergänzt, selbst nicht nachgemessen) | Apache-2.0 | **Empfehlung.** Asynchrone Wirt-Funktionen (für `fetch`), Abbruch und Zeitlimit eingebaut, Kotlin Multiplatform mit iOS-Zielen. Braucht ein eigenes kleines Expo-Modul |
| `wang.harlon.quickjs:wrapper-android` (Java) | 3.2.3 vom Juli 2025 | ja (laut Projekt) | Apache-2.0 | Ersatz, falls quickjs-kt nicht passt |
| npm `react-native-quickjs` | 0.0.2 vom Juni 2023, zwei Versionen | – | MIT | nicht gepflegt, und es ersetzt die JS-Maschine der App statt einen Sandkasten zu bieten |
| `quickjs-emscripten` (WebAssembly) | 0.32.0 vom Februar 2026 | – | MIT | nur für Tests unter Node: Hermes kann kein WebAssembly |
| `app.cash.zipline` | gepflegt | – | Apache-2.0 | für Kotlin/JS gedacht, hier zu schwer |

Eine fertige, gepflegte QuickJS-Anbindung für React Native gibt es nicht. Stufe 3 braucht ein eigenes Expo-Modul (Kotlin) um `quickjs-kt`. **Überholt am 13.11.2026:** gebaut ist ein geteiltes C++-Modul um quickjs-ng, über Nitro angebunden (§4h).

**Auf dem Gerät noch unbelegt (Stand der Probe; Modul, Speicherlimit und 16-KB-Seiten sind seit 3a belegt, §4h):** das Modul selbst, Speicherlimit in `quickjs-kt` (laut Quelltext vorhanden, siehe §4h; dort auch, warum das Modul noch nicht gebaut ist), Tempo auf dem Handy, 16-KB-Gerät, die rund 30 Hilfsfunktionen der anderen Erweiterungs-Arten (`LoadDoc`, `CryptoJS`, `$habari`, `ChromeDP` …; die beiden getesteten brauchen nur `fetch`), Online-Stream- und Manga-Quellen.

## 9. Werkzeuge

| Datei | Wozu |
|---|---|
| `native/scripts/record-server.mjs` | Server-Antworten aufzeichnen (`api`; Zustand ändernde an der scratch-App: `api-write`, einzelne Schritte neu mit `--only`; das AniList-Konto ändernde nur mit Test-Konto: `anilist-write`, dazu `anilist-guard` und `anilist-clear`, §6), Ereignisse (`events`, `events-log`), Manifest-Fälle (`manifest-cases`, `manifest-fixture`), Bereinigung prüfen (`check`) |
| `native/scripts/build-android.ps1` | APK bauen: Test-App (Standard), `-Variant scratch`, `-Debuggable` (Einmal-Build Test-App), `-Release`; `-ToolchainRoot <tools>` (lokaler Werkzeug-Ordner, steht nicht im Repo) |
| `native/scripts/measure-android.sh` | Messwerte aus §5 (`start`, `mem`, `cpu`, `jank`) |
| `native/scripts/check-migration.mjs` | Daten-Umzug (§4c) gegen Kopien der Server-Dateien: je Teil übernommen / leer / Abweichung, nur Zahlen und Feldnamen |
| `native/scripts/probe-quickjs.mjs` | Suche einer Erweiterung im QuickJS-Sandkasten, Vergleich mit einer Aufzeichnung |
| `.github/workflows/native-check.yml` | bei jedem Push, der `native/` berührt: `npm ci`, `npm run typecheck`, `npm test`, `npm run lint` |

### Nachtlauf 15.11.2026: Blöcke 1–5 (Plan §21)

Prüfzahlen am Ende (HEAD `952bb849`): tsc 0 · vitest 157 Dateien / 1501 Tests · lint 0 Fehler / 340 Warnungen. Nichts gepusht.

- **Block 1 TV/Cast** (`5672b5c6`): „Stop casting“ im Querformat im festen Fuß des Panels; Sitzung endet, wenn der TV nach dem Spielen STOPPED/NO_MEDIA_PRESENT meldet (Port zu, Panel zeigt Geräteliste; nicht am Folgenende, nicht beim Spurwechsel; `core/cast/cast.ts` `sendStatus`); eigener Fehler `seek-failed` mit Zielposition („Playing on the TV, but it could not jump to …“). **Nicht am TV belegt:** der LG war ab ~01:40 aus (Ping 100 % Verlust), deshalb fehlen Gerätebelege, die Offline-Folge am TV, die Untertitelspur am TV (nicht begonnen) und `lgtv.py off` (TV war schon aus; `off` weiter nie ausgeführt).
- **Block 2 Flüssigkeit:** Umschalter Anime|Manga sprang mit UND ohne Reanimated-Patch (0 Zwischenbilder) – Ursache `lists-phone.tsx:136` `key={type}` baut den Umschalter neu, `glide.tsx` las die alte Pillen-Lage einen Wechsel zu spät; Fix `9e0b5454` (`glide.leave()` beim Tipp), danach 3–11 Zwischenbilder. Local|Online gleitet mit/ohne Patch, verliert aber bei 2–3 von 6 Wechseln den Anfang (UI-Faden durch Aufbau blockiert, offen). S22 mit Patch (Build `5672b5c6`): Leerlauf CPU 8,8 % (vorher 10,5 %, Stufe 0 11,4 %), Haupt-Faden 8,1 % (10,1 %), Aufwacher 133/s, Ruckeln Black Clover Ø 1,20 % (1,43 %, Stufe 0 1,06 %). Player: Untertitel-Blatt und Einblenden gleiten; Mini-Player erscheint/verschwindet ohne Gleiten, Steuerleiste blendet in ~120 ms praktisch ohne Übergang aus (offen).
- **Block 3 kleine Fehler:** Playlist-Knopf sitzt über dem Mini-Player (`player-chrome.ts` `playlistButtonBottom`), Standard-Playlist-Quelle kennt jetzt Online (`mobile-playlist-state.ts` `defaultPlaylistWatchType`) – `bb27fa4f`. Nakama auf Home: nicht nachstellbar (Gast am Tablet nicht eingerichtet; Home baut „Continue watching“ nur aus AniList-Listen, `core/library/home.ts:100-112`) – Entscheidung Nick. 8-ms-Reste: nur ein Treffer (`manga/downloads` 16,4 ms bei gleichzeitigen Anfragen), kein klarer Rest. Torrent-Datei-Wahl in Sammlungen: es gibt kein Datei-Auswahl-Blatt (größer, offen). mangadex und Sperrbildschirm-Download nicht angefasst.
- **Block 4 Aufräumen:** Test-Konto leer (öffentliche API 0/0, auch nach allen Tests); `backend/codegen/generated/hooks.mdx` gelöscht; `git fsck --full` Exit 0 (nur dangling) → `D:\SNB\git-pack-backup-2026-11-14` gelöscht.
- **Block 5 App-Test:** Prüfliste `docs/APP-TEST-4.0.md` (6 Läufe, ~330 Zeilen Tablet + S22). Behoben: Blätter scrollen bei langsamem Wischen (`sheet.tsx`: Inhalt nimmt Berührungen zwischen Bedien-Elementen selbst an), „Pick the best torrent“ gespeichert, Texte (`0056778e`); Cache-only über den Kern (`core/anilist/cache-only.ts`, Route `anilist/cache-layer/status`), externer Player abwählbar, veraltete Texte (`e40d0504`); Logs & cache ohne Server-Abfragen, „Cache leeren“ über `core/cache-bucket.ts`, Download-Blatt eine Schnellwahl (`b11019f2`); Leser vor/zurück im gleichen Strang (`9096c21f`); Batch-Markierung unter 500 MiB ignoriert, „1 seeder“, Reiter der Anime-Seite gemerkt, Debrid nur mit Anbieter (`952bb849`). MangaFire-Kapitelnummern kommen falsch aus der Erweiterung selbst (`chapter` = „0“, „0.001“, „0.232“).

## 10. Änderungsprotokoll

| Datum | Was | Geprüft wie |
|---|---|---|
| 13.11.2026 | Stufe 0: Messwerte, Aufzeichnung (76 von 216), Schalter mit Probe-Schnittstelle, Probe 1 und 2, automatische Prüfung | `tsc` 0; vitest 115 Dateien / 951 Tests; `expo lint` 0 Fehler; Test-App auf S22 + Tablet installiert; Schalter und Probe 1 am S22 belegt (§3, §7) |
| 13.11.2026 | Phase 1a: scratch-Variante, Aufzeichnung schreibend (47 von 113), DB-Kopien (a)(b)(c), Herkunfts-Zeile in `core-switch.ts` | `tsc` 0; vitest 115 Dateien / 951 Tests; `expo lint` 0 Fehler; scratch-APK per aapt2 geprüft, am Tablet (Nutzer 10) gestartet; `record-server.mjs check` kein Fund; Test-App danach normal gestartet |
| 13.11.2026 | Phase 1b: eigene Datenbank (`core.db`, Drizzle, Schritt-Liste), Bereich `settings` (8 Schnittstellen, GetStatus als Zwischenlösung), neue Pakete `expo-sqlite` und `drizzle-orm` | `tsc` 0; vitest 117 Dateien / 987 Tests; `expo lint` 0 Fehler; scratch-APK gebaut und am Tablet (Nutzer 10) per `install -r` installiert; Bereich `settings` am Gerät belegt (§4a), danach wieder aus |
| 13.11.2026 | Phase 1c: Ereignis-Verteiler (Kern + beide Hooks), Wächter für den Faden der Oberfläche, Worklet-Probe, Datenbank-Anweisungen im Faden von expo-sqlite | `tsc` 0; vitest 120 Dateien / 1010 Tests; `expo lint` 0 Fehler; scratch-APK gebaut (3-mal: Wächter korrigiert, Treiber umgestellt) und am Tablet (Nutzer 10) installiert; Stücke vorher/nachher und Probe am Gerät belegt (§4b), Bereich danach wieder aus |
| 13.11.2026 | Phase 1d: Daten-Umzug (Konto, Einstellungen, Aussehen, Home-Elemente, Schau-Fortschritt) aus den Dateien des Servers, nur lesend; Schema-Schritt 2 (`account`, `watch_positions`, `move_parts`); Token im gesicherten Speicher; neues Paket `expo-secure-store`; Link `core?move=again`; `check-migration.mjs` | `tsc` 0; vitest 121 Dateien / 1024 Tests; `expo lint` 0 Fehler; `check-migration.mjs` gegen (a), (b), (c): 0 Abweichungen; scratch-APK gebaut (1-mal) und am Tablet (Nutzer 10) per `install -r` installiert; Umzug am Gerät belegt (§4c), Bereich danach wieder aus |
| 13.11.2026 | Phase 1e, Abschluss Stufe 1: Test-App gebaut, auf S22 (Nutzer 0) und Tablet (Nutzer 10) per `install -r` aktualisiert, Messwerte §5 „nach Stufe 1“, Rundgang. Kleinkram: Kopf von `build-android.ps1` (`-Release` mit `-Variant scratch` wird abgelehnt); `jiti` 2.7.0 fest als devDependency; die Bereinigung lernt den Platzhalter-Namen des simulierten Nutzers (scratch: „user“) nicht mehr, er ersetzte „user“ in Pfaden (`/data/user/10/…`) und Wörtern (Dateien des ersten Laufs bleiben so); Wächter loggt nur Warnungen über 8 ms; Worklet-Probe samt Link und Test entfernt (Ergebnis bleibt in §4b); Herkunfts-Zeile in `check-migration.mjs`; InstallExternalExtensionRepository mit echter Repository-Datei nachgeholt (§6, `api-write --only`) | `tsc` 0; vitest 121 Dateien / 1023 Tests (ein Test der Probe entfernt); `expo lint` 0 Fehler; `record-server.mjs check` 464 Dateien, kein Fund; Test-APK per aapt2 geprüft; Home und Rundgang auf beiden Geräten belegt; kein Kern-Bereich eingeschaltet |
| 13.11.2026 | Phase 2a: Bereich `anilist` (AniList lesen im Kern, 11 Schnittstellen), eigener Speicher (Schema-Schritt 3: `anilist_media` mit eigener Kennung, `anilist_list_entries`, `anilist_answers`), Rate-Limit mit 429/`Retry-After`, Ausfall → letzter Stand aus dem Speicher; Umgebung bekommt `secret` | `tsc` 0; vitest 122 Dateien / 1037 Tests; `expo lint` 0 Fehler; Test-App gebaut, am Tablet (Nutzer 10) Home + Listen vom Kern, danach Bereich aus (§4d) |
| 13.11.2026 | Phase 2c: Start ohne Warten auf den Server (§4e): `GetStatus` zerlegt (Kern sofort, Server-Teil aus dem letzten Stand), Start-Schranke (Anfragen an den Server warten bis `server-ready`, höchstens 60 s), letzter Stand von Bibliotheks-Sammlung und Anime-Eintrag (Schema-Schritt 4 `server_answers`), Hänger beim Start per Link untersucht (alt) | `tsc` 0; vitest 124 Dateien / 1064 Tests; `expo lint` 0 Fehler; Test-APK gebaut, am Tablet (Nutzer 10) gemessen: Home mit Covern 0,5 s (an) gegen 2,3 s (aus), Inhalt 1,17 s vor `server-ready`; Bereiche danach aus |
| 13.11.2026 | Phase 2b: AniList ändern im Kern (§4f): 5 Schnittstellen (Eintrag bearbeiten/löschen, Fortschritt Anime/Manga, Wiederholungen), Warteschlange `anilist_changes` (Schema-Schritt 5) mit Konflikt-Regeln, Wächter im Skript und im Kern (`onlyAccount`), Links `core?write-account=…` und `core?anilist=down/up`; Aufzeichnung der ändernden Schnittstellen des Servers mit Test-Konto (31 Schritte, §6); Wertung der Listen jetzt als `POINT_100` gelesen | `tsc` 0; vitest 125 Dateien / 1082 Tests; `expo lint` 0 Fehler; scratch-APK gebaut, am Tablet (Nutzer 10) per `install -r` installiert; Schreiben mit und ohne AniList am Gerät belegt (§4f), Test-Konto danach leer, Bereich wieder aus; `record-server.mjs check` kein Fund |
| 13.11.2026 | Phase 2d, Abschluss Stufe 2: Test-App gebaut (`0e344c2`), auf S22 (Nutzer 0) und Tablet (Nutzer 10) per `install -r` aktualisiert, Messwerte §5 „nach Stufe 2“, Rundgang; Schreibwege am Gerät (scratch, Test-Konto): Bearbeiten-Blatt (Status, Wertung, Fortschritt) und Löschen belegt, Folge als gesehen nicht erreichbar (§4f); Test, dass die Release-Variante die Links `core?write-account`, `core?anilist` und `core?move` nicht annimmt (`app-links.test.ts`); Wächter-Zahl `first use of the core` erklärt und Messung korrigiert (`core-switch.ts`); Liste „offen aus Stufe 2“ (§4g) | `tsc` 0; vitest 125 Dateien / 1083 Tests; `expo lint` 0 Fehler; Rundgang beide Geräte ohne `[Core]`-Zeile; AniList öffentlich für <Test-Konto> nach jedem Schritt, am Ende leer, Bereich `anilist` aus |
| 13.11.2026 | Phase 3a, begonnen: Vertrag des Sandkastens, Unterbau Node (`quickjs-emscripten`), Unterbau Gerät, Selbsttest, Link `core?sandbox=selftest`, Modul `modules/core-sandbox` (Kotlin um quickjs-kt, nicht gebaut und vom Autolinking ausgenommen: quickjs-kt ≥ 1.0.6 braucht Kotlin 2.4 / Coroutinen 1.11.0, §4h) | `tsc` 0; vitest 126 Dateien / 1093 Tests; `expo lint` 0 Fehler; Suche „dr. stone“ beider eigener Quellen über die neue Schicht 85 / 74 Treffer; Autolinking ohne `core-sandbox` geprüft; kein Build, nichts am Gerät |
| 13.11.2026 | Phase 3a, Teil 2: Modul `modules/core-sandbox` neu als geteiltes C++ um quickjs-ng 0.18.0 (Quelltext im Modul, nur Kern), über Nitro angebunden; Kotlin-Modul um quickjs-kt gelöscht; ein Faden je Sandkasten; `device-engine.ts` auf das neue Modul umgestellt; Lizenz `licenses/quickjs-ng-LICENSE.txt`; iOS-Dateien liegen da, ungebaut (§4h) | `tsc` 0; vitest 126 Dateien / 1093 Tests; `expo lint` 0 Fehler; Test-APK gebaut (erster Build), 109 859 841 → 110 985 431 Bytes, `p_align 0x4000`; S22 (Nutzer 0) per `install -r`: Selbsttest per Link 12 von 12 in 2193 ms / 1262 ms, Sandkasten anlegen 5,5 / 2,9 ms, längstes Stück im Faden der Oberfläche 1,5 ms (0 über 8 ms); Beleg `belege/3a-selbsttest-danach-home.png` |
| 13.11.2026 | Phase 3b: leichte Hilfsfunktionen für Erweiterungen (§4i): Vorspann aus eigenem Code + `buffer` 6.0.3, `crypto-js` 4.2.0, `whatwg-url-minimum` 0.2.0, gebündelt mit `rolldown` 1.2.16 (`scripts/bundle-extension-helpers.mjs`); `openExtensionSandbox` mit `fetch`/`log` über die Tür; Probe „helpers“ im Selbsttest; Lizenzen in `licenses/` | `tsc` 0; vitest 127 Dateien / 1106 Tests; `expo lint` 0 Fehler; Test-APK gebaut (1-mal), S22 (Nutzer 0) Selbsttest 13 von 13, längstes Stück 2,1 ms; Praxis-Probe unter Node: Internet Archive 85 und DKB 74 Treffer wie aufgezeichnet |
| 13.11.2026 | Phase 3c: mittlere Hilfsfunktionen für Erweiterungen (§4j): `LoadDoc`/`Doc` und `$goFeed` (zweites Skript, nur bei Erwähnung geladen; `htmlparser2` 12.0.0, `css-select` 7.0.0, `domutils` 4.0.2, `dom-serializer` 3.1.1, `domhandler` 6.0.1), `$habari` und `$torrentUtils` (eigener Code); Probe „medium helpers“ im Selbsttest; Zeitgeber-Messung mit Leerlauf-Vergleich und Zuordnung; offener Punkt Cloudflare für 3d (§4h); Lizenzen in `licenses/` | `tsc` 0; vitest 128 Dateien / 1115 Tests; `expo lint` 0 Fehler; Test-APK gebaut (1-mal), 111 173 679 → 111 301 667 Bytes; S22 (Nutzer 0) Selbsttest 14 von 14 (2 Läufe), längstes Stück 7,7 ms, Zeitgeber ohne Kern 122,9 / 25,8 ms, im Test 12,0 / 11,9 ms; `$habari` gegen 159 aufgezeichnete Namen (Tabelle §4j); Beleg `belege/3c-selbsttest-danach.png` |
| 13.11.2026 | Phase 3d: `ChromeDP` für Erweiterungen über ein verstecktes `react-native-webview` (§4k: `lib/hidden-browser/`, `core/extensions/browser/`, Vorspann `chromedp.js`; Reihe, Zeitlimit, nur `http`/`https`; Screenshots und DevTools-Protokoll nicht machbar und so gemeldet); Cloudflares automatische Prüfung in `fetch` (Erkennen, Seite wartet, zweiter Abruf mit gleichem User-Agent, Merken je Host, `noCloudflareBypass`, höchstens ein Versuch; interaktiv → `CloudflareCheckError`, nichts wird geklickt); Probe „ChromeDP“ im Selbsttest; Praxis-Lauf `core?sandbox=practice` (Erweiterungs-Code nur für den Test per adb am Gerät, danach gelöscht) | `tsc` 0; vitest 130 Dateien / 1139 Tests; `expo lint` 0 Fehler; Test-APK gebaut (2-mal: Probe-Seite korrigiert), 111 301 667 → 111 349 879 Bytes; S22 (Nutzer 0) Selbsttest 15 von 15, längstes Stück 7,1 ms; Praxis: `ChromeDP`-Erweiterung Quelle in 1,3 s, AniStar 2 Treffer ohne Prüfung, öffentliche Prüf-Seite automatisch bestanden (5,7 s); ein Stück von 95,2 ms bei einer Antwort mit 4,3 MB (offen für 3f); Belege `belege/3d-*.png` |
| 13.11.2026 | Phase 3e-1: Erweiterungs-Verwaltung im Kern (§4l: `core/extensions/manage/`, 12 Schnittstellen, Ordner `files/extensions/` des Servers im gleichen Format, Nutzer-Einstellungen einmal aus `ext_user_config_<id>.cache` nach `core.db` (Schritt 6), ein Sandkasten je Erweiterung mit Leerlauf 120 s und Grenze 256 MB, TS→JS mit `sucrase` 3.35.0 im Sandkasten, Installieren/Aktualisieren/Deinstallieren als Kern-Code mit Tests); Vorspann-Cache im C++-Modul (`keepScript` in Teilen, `runKept`) | `tsc` 0; vitest 131 Dateien / 1156 Tests; `expo lint` 0 Fehler; Test-APK 2-mal gebaut (Teil-Übergabe nachgezogen), 111 349 879 → 111 820 295 Bytes; S22 Selbsttest 15 von 15, längstes Stück 7,8 → 4,7 ms; Liste Schalter an = aus; Praxis Node: 1/0/1/85/74/1 Treffer |
| 13.11.2026 | Phase 3e-2 (Teil): 5 schreibende Erweiterungs-Schnittstellen im Kern, Aus/Ein im Datei-Cache des Servers, Server per `reload`/`disabled` mitgezogen, Ereignis `extensions-reloaded` aus dem Kern, Schema-Schritt 7 `extension_settings`, gemeinsamer Ordner-Lesevorgang, Server-Antwortzeiten im App-Log | `tsc` 0; vitest siehe Bericht; `expo lint` 0 Fehler; scratch 2-mal gebaut; Tablet: Installieren, Update, Aus mit Rückweg; Listen Kern 8–20 ms / Server 28–86 ms |
| 13.11.2026 | Phase 3e-2, Abschluss (§4l): Ursachen der Stücke über 8 ms – Datei-Zugriffe nicht als Warten gesehen (`placeWithWaits`), Stück blieb bei `Promise.all` nach dem ersten Warten offen (Wächter `blocking.ts`: Stück beginnt erst beim Weiterlaufen), Mitlesen eines laufenden Lesevorgangs/Sandkasten-Starts (`ExtensionPlace.join`); Schlüssel der gemerkten `getSettings()`-Antworten aus Größe + Änderungszeit der Erweiterungs-Datei und der Server-Datei mit den Nutzer-Einstellungen; Gerät a–f mit Rückweg | `tsc` 0; vitest 131 Dateien / 1165 Tests; `expo lint` 0 Fehler; scratch-APK 2-mal gebaut (Builds 3, 4); Tablet (Nutzer 10): Listen und Ein/Aus/Deinstallieren ohne Stück > 8 ms, offen Code-Ansicht 31,4 ms, Installieren 22,3 ms, Kaltstart-Liste 15,1 ms; Endstand Bereich `extensions` aus, Internet Archive installiert und eingeschaltet; Belege `belege/3e2-1*.png` |
| 13.11.2026 | Phase 3f-1: Online-Stream im Kern (§4m: `core/streams/`, 7 Schnittstellen im Bereich `streams`, Ablauf search → Auswahl → findEpisodes → findEpisodeServer im Sandkasten der Erweiterung, eigene Auswahl-Regeln, Zuordnungen in `core.db` Schema-Schritt 8 mit einmaligem Umzug aus der Server-DB, Cache 60/10 min); Prüf-Link `core?streams=check` (Test-/scratch-App) | `tsc` 0; vitest 132 Dateien / 1182 Tests; `expo lint` 0 Fehler; Test-APK gebaut (1-mal) und am S22 (Nutzer 0) per `install -r` installiert; Vergleich Kern/Server je Erweiterung und Anime am Gerät (§4m), alle Bereiche danach aus; Folgen-Listen-Screenshots fehlen (Tipp abgelehnt) |
| 13.11.2026 | Phase 3f-2: Abspielen ohne Server (Quelle aus dem Kern direkt an mpv), `$scannerUtils` (13 Funktionen, Vorspann), Wächter mit benannten Warten + Messpunkten + längstem Stück je Anfrage im Prüf-Link, HLS-Schlüssel-Probe, Fix `ExtensionLoader.close` (§4m) | `tsc` 0; vitest 133 Dateien / 1192 Tests; `expo lint` 0 Fehler; zwei Test-Builds (`e3532a5`, `001aa0c`); S22: Selbsttest 15/15, anikoto-Suche 49 = Server, Stücke je Abschnitt vorher/nachher, Dr. STONE abgespielt ohne Proxy/Server, Bereiche am Ende aus; APK 111 900 419 → 111 916 311 → 111 915 855 Bytes |
| 13.11.2026 | Phase 3f-3 (Teil): Downloads im versteckten WebView unterbunden (Patch `downloadsDisabled`), `CloudflareCheckError` als verständlicher Satz über den Fehler-Weg, Prüf-Links Installieren/Zuordnung/`searchonly`; Installieren der fünf Quellen am Tablet gemessen; Vergleich, Wiedergabe `aq-anikoto` und Zuordnung am Gerät offen (Tablet gesperrt) | `tsc` 0; vitest 134 Dateien / 1197 Tests; `expo lint` 0 Fehler; scratch-APK gebaut (1 Build) und am Tablet (Nutzer 10) per `install -r` installiert; Install-Log, Endstand „areas answered by the core: none“ |
| 13.11.2026 | Phase 3f-3, Gerätearbeit: Vergleich Kern/Server der fünf Quellen, Wiedergabe mit `aq-anikoto` ohne Server, Zuordnung am Gerät, Installieren im Vordergrund nachgemessen (§4m 3f-3); nur Doku, kein Code | Tablet (scratch, Nutzer 10, Build `5ec105c`): Prüf-Links `streams=check` (aus/an), `streams=mapping`, `extensions=install`; logcat gefiltert (0 Proxy-/Online-Stream-Anfragen beim Server während Kern-Lauf und Wiedergabe); Screenshot `belege/3f3-01-wiedergabe-anikoto.png`; Endstand alle Bereiche aus. Offen: AniStar nur erster Server (Code-Fehler gemeldet) |
| 14.11.2026 | Phase 3f-4: Quellen aller Server, Wächter vergisst Warten ohne Fortsetzung, Dateien der Erweiterungen über `expo-file-system/legacy`, Pause zwischen Manifesten; Tablet- und S22-Nachmessung (§4m 3f-4, §5 „Nach Stufe 3“) | `tsc` 0; vitest 134 Dateien / 1200 Tests; `expo lint` 0 Fehler; 3 Builds (scratch (vor der Manifest-Pause), scratch und Test vom Stand `5a76a6e`); Tablet AniStar/AniWorld Kern = Server, Stücke je Abschnitt; S22 Selbsttest 15/15 (5,4 ms), Wiedergabe `episode-source` 54,2 ms; Beleg `belege/3f4-01-wiedergabe-s22.png`; Endstand alle Bereiche aus. Offen: Kern-Stücke über 8 ms (bis 99,8 ms) |
| 14.11.2026 | Phase 3g: Seite von `fetch` neben dem JSON an den Sandkasten (Nitro `answerHost(…, body)`), geprüfte Manifeste gemerkt, Anfrage beginnt nach dem Durchgang des Aufrufers (`afterCallersTurn`), Messpunkte für RN-`fetch` und Einstellungen (§4m 3g) | `tsc` 0; vitest 135 Dateien / 1204 Tests; `expo lint` 0 Fehler; 1 Test-Build (`3aba7cb`, APK 111 949 611 Bytes); S22 Selbsttest 15/15 (2,5 ms), `streams=check` kalt/warm, warm alle ≤ 2,9 ms; Endstand alle Bereiche aus. Offen: kalt A 29,5 ms, C 22,7 ms |
| 14.11.2026 | Phase 4a-1: Manga lesen im Kern (§4n): Bereich `manga`, sechs Schnittstellen (Manga-Seite, Details, Kapitel, Seiten, Zuordnung lesen, Suche), Zuordnungen `manga_mappings` (Schema-Schritt 9) mit einmaligem Umzug, `local-manga`/Downloads/Doppelseite beim Server, Prüf-Link `core?manga=check` | `tsc` 0; vitest 136 Dateien / 1216 Tests; `expo lint` 0 Fehler; 1 Test-Build (`672f7a1`, APK 111 990 631 Bytes); S22 Kern/Server: Kapitel 81 = 81, Suche 25 = 25, Seite/Details/Zuordnung gleich, Seiten `mangadex` im Kern abgewehrt (Bot-Abwehr der Quelle, offen); längstes Stück 4,9 ms; danach alle Bereiche aus |
| 14.11.2026 | Phase 4a-2: Manga ohne Downloads im Kern (§4n 4a-2): Zuordnung setzen/löschen, Cache leeren, Vorlieben (Umzug lesend, Ergebnis des Quellen-Auffrischens übernommen), Sammlung mit eigener Regel, neueste Kapitelnummern in core.db (Schema-Schritt 10), Seitenbilder mit Kopfzeilen direkt statt über den Bild-Proxy, Prüf-Link `core?manga=write`; Quellen-Auffrischen bleibt beim Server; mangadex-Seiten: Bot-Prüfung wegen Browser-User-Agent der Erweiterung, offen | `tsc` 0; vitest 136 Dateien / 1224 Tests; `expo lint` 0 Fehler; 1 scratch-Build (`ca231cf`, 125 262 150 Bytes); Tablet Schreib-Link zweimal, alles zurückgesetzt; Reader mit Kern-Seiten nicht belegt (mangadex); Endstand alle Bereiche aus |
| 14.11.2026 | Phase 4b-A: nativer Lader des Download-Dienstes (§4o): lokales Expo-Modul `modules/core-download` (Kotlin; ab Android 14 vom Nutzer gestartete Datenübertragung, darunter WorkManager mit Vordergrund-Dienst `dataSync`), Vertrag `core/download/loader.ts`, Hülle `api/client/core-download.ts`, Prüf-Link `core?download=selftest`; einzige neue Gradle-Abhängigkeit `androidx.work:work-runtime:2.12.0` (die schon aufgelöste Version) | `tsc` 0; vitest 137 Dateien / 1237 Tests; `expo lint` 0 Fehler; 1 Build (Test-App 112 053 531 Bytes, +62 900); S22 (API 36), fünf Läufe per Prüf-Link: Abbruch + Fortsetzen (206), 86 s im Hintergrund mit Benachrichtigung, WorkManager erzwungen, Quelle ohne Range → von vorn, 403 → `SOURCE_REFUSED`; Größe und SHA-256 jeweils gleich. Unbelegt: API 24–33, `interrupted`, Stopp durch System/Nutzer, voller Speicher (§4o) |
| 14.11.2026 | Phase 4b-B: Offline-Folgen im Kern (§4o): Bereich `offline` mit sieben Schnittstellen (`snapshot`, `batch`, `download`, `action`, `settings`, `position`, `network`), Warteschlange und Zustände in `core.db` (Schema-Schritt 11), Wiederholen, WLAN-Regel, Neustart; HLS im Kern (`offline/hls.ts`), Sammel-Auftrag im Lader (`LoaderParts.kt`: ein Job je Folge, AES-128 und Zusammenfügen im Kotlin-Teil, Fortsetzen je Segment), Ablage `core-offline/episodes/<id>/`, Wiedergabe über `file://`, Prüf-Link `core?offline=check`; keine neue Abhängigkeit | `tsc` 0; vitest 139 Dateien / 1261 Tests; `expo lint` 0 Fehler; 2 Builds (Test-App 112 110 019 Bytes, +56 488); S22: Test-HLS mit AES Größe und SHA-256 gleich (1,0 s), MP4 gleich, Dr. STONE 1 über `kaa` 702 MB mit Home-Taste (fertig 37 s danach), Abspielen mit `file://` und 0 Anfragen an `/mobile-offline/file`, Fortsetzen nach 429 mit 694,8 MB behalten; längstes Stück 14,7 ms (offen), Löschen von 50,6 ms behoben; danach alle Bereiche aus. Offen: Zeitgeber im Hintergrund, Artwork, Manga (4b-C), Übernahme (4c) |
| 14.11.2026 | Phase 4b-C1: Warteschlange im Hintergrund (§4o 4b-C1): nächste Folge über Ereignisse des Laders, Wartezeit nativ (`WakeWorker`, `wakeIn`), Bremse im Lader (`Retry-After`, Pausen 5/15/45 s, Fortsetzen per Range bzw. je Segment), Headless-Aufgabe für die Zeitgeber (reicht am S22 nur rund 5 s), Bilder als Neben-Teile (`coverAsset` usw.), Angaben aus den gemerkten Listen, `audioLanguage`; Modul mit `compileOnly` auf React Native. Offen: Hinweise im Hintergrund, Cover auf der Downloads-Seite, Stück beim `done` | `tsc` 0; vitest 140 Dateien / 1273 Tests; `expo lint` 0 Fehler; 3 Build-Anläufe (Bundler-Absturz, Kotlin-Fehler, dann Test-Build von `ca56b0b`, APK 112 125 643 Bytes); S22: drei Folgen im Hintergrund fertig 64 s nach der Home-Taste, Größe und SHA-256 gleich |
| 14.11.2026 | Korrektur 4b-C1K (§4o): End-Hinweise vom Gerät (`notice` im Lader-Modul, Kanal `episode-downloads`), JS zeigt sie mit Bereich `offline` nicht mehr; Headless-Aufgabe und `compileOnly` entfernt; `pause()` wartet nicht, wenn die App nicht vorn ist (`inFront`, `connectAppFront`); Cover: später Fehler der Online-Adresse traf die Datei (`key={source}`); `has` als Modul-Funktion. Offen: Stück beim `done` im Hintergrund 13,2 / 26,1 ms | `tsc` 0; vitest 140 Dateien / 1275 Tests; `expo lint` 0 Fehler; 1 Build (APK 112 125 375 Bytes, −268); S22: zwei Folgen im Hintergrund fertig, beide Hinweise 04:37:10 / 04:37:20 im System, während der Launcher vorn war; Cover sichtbar |
| 14.11.2026 | Phase 4b-C2: Manga-Kapitel-Downloads im Kern (§4o 4b-C2): Bereich `manga` beantwortet Download, Warteschlange (start/stop/reset/leeren), Liste, Löschen, `downloaded-chapters` und Seiten heruntergeladener Kapitel als `file://`; `core.db` Schema-Schritt 12 `manga_downloads`; ein Sammel-Auftrag des Laders je Kapitel (neu: Kopfzeilen je Teil); Prüf-Links `core?manga=download|remove`; am Tablet 2 Kapitel im Hintergrund geladen, im Leser geöffnet |
| 14.11.2026 | Phase 4c (§4o 4c): fertige Folgen des Servers (`mobile-offline/queue.json`, Ordner `episodes/<id>/`) einmal je `core.db` in den Bereich `offline` übernommen, nur lesend, gespielt aus den alten Dateien; Schema-Schritt 13 `offline_moves`; `core?move=again` holt Neues nach; Löschen im Kern nimmt nur den Eintrag; am Tablet belegt (file://, 0 Server-Anfragen, Rückweg); Manga-Übernahme offen |
| 14.11.2026 | Phase 4c-2 (§4o 4c-2): fertige Manga-Kapitel des Servers (`files/manga/<Anbieter>_<mediaId>_<Kapitel>_<Nummer>/` mit `registry.json`) einmal je `core.db` in den Bereich `manga` übernommen, nur lesend, gelesen aus den alten Dateien; Schema-Schritt 14 (Spalte `old`); `core?move=again` auch für Manga; Löschen im Kern nimmt nur den Eintrag; Log-Zeile beim automatischen ersten Umzug (Folgen und Manga); am Tablet belegt (Leser, 0 `manga-downloads`, Rückweg). Offen: Server-Kapitel am Ende löschen |
| 14.11.2026 | Phase 5a-1 (§4p): Status ganz vom Kern (keine Server-Anfrage, Server-Teil je Build aufgehoben, Torrent-/Debrid-Speichern zieht mit), neuer Bereich `library`: Anime-Eintrag und Folgen-Sammlung aus eigenen Listen + Folgen-Metadaten von ani.zip (Schema-Schritt 15 `episode_metadata`), Online-Stream nimmt sie; Prüf-Link `core?library=check` | `tsc` 0; vitest 143 Dateien / 1303 Tests; `expo lint` 0 Fehler (341 Warnungen); S22 Test-App: Prüf-Link Kern = Server (Zahlen §4p), Anime-Seite Dr. STONE ohne Server-Anfrage für Status/Eintrag/Folgen, längstes Stück 3,9 ms; danach alle Bereiche aus |
| 14.11.2026 | Phase 5a-2 (§4p): neuer Bereich `playback`: Player-Nachrichten (`videocore`) gehen bei Bereich an nur an den Kern (`tellPlayer`/`coreHearPlayer`), eigener Schau-Verlauf in `watch_positions` (`continuity/history`, `continuity/item/{id}`, PATCH `continuity/item`), AniList-Fortschritt bei 80 % mit „automatisch speichern“, nie kleiner, über die Warteschlange (§4f) | `tsc` 0; vitest 144 Dateien / 1313 Tests; `expo lint` 0 Fehler (341 Warnungen); Tablet scratch: Fortschritt 0 → 1 vom Kern, Verlauf Folge 1 bei 1236 s, Server-Verlauf leer, zurückgesetzt, alle Bereiche aus; offen: Wächter 8,8–44,1 ms während der Wiedergabe |
| 14.11.2026 | Phase 5a-3 (§4p): Home-Sammlung (`stream`), kommende Folgen, Zeitplan (Bereich `library`), verpasste Fortsetzungen, „Refresh AniList“, An-/Abmelden mit Token in `expo-secure-store` (Bereich `anilist`), Stilllegen und Eltern-Eintrag der Metadaten in `core.db` (Schema-Schritt 16); Füller bleibt beim Server (keine frei nutzbare Quelle); Prüf-Link `core?library=home` | `tsc` 0; vitest 146 Dateien / 1329 Tests; lint 0 Fehler, 341 Warnungen |
| 14.11.2026 | Phase 5a-4 (§4p): Playlists im Bereich `playback`: `GET /playlists`, `POST`/`PATCH`/`DELETE /playlist`, `GET /playlist/episodes/{id}` aus `core.db` (Schema-Schritt 17 `playlists`, `playlist_move`), einmaliger Umzug der Server-Playlists aus der DB-Kopie (keine Server-Anfrage), Kanal `playlist` (start/stop/reopen/play-episode/current-playlist) im Kern über `tellPlaylist`/`coreHearPlaylist`, Abhaken bei `video-completed` | `tsc` 0; vitest 147 Dateien / 1338 Tests; lint 0 Fehler / 341 Warnungen; Gerät: Build + Bereiche an/aus, Playlist-Ablauf am Gerät offen |
| 14.11.2026 | Phase 5a-4 (§4p), zweiter Geräte-Lauf: die 3 `GET /playlists` um 07:44:55 sind von der Startschranke angehaltene Anfragen (Kern-Log „not ready after 60 s“, wiederholt 07:51:15); 07:51:16–07:54:12 mit `playback` an 0 Playlist-Anfragen beim Server. Playlist nicht angelegt: Knopf „Zur Liste hinzufügen“ fehlt am Tablet (kein Nutzer im Status der App), Stilllegen/Eltern-Eintrag ohne lokale Dateien nicht erreichbar | kein Code geändert; Wiedergabe 0 s; alle Bereiche aus, Test-Konto leer |
| 14.11.2026 | Korrektur 5a-K (§4p): Knopf „Zur Liste hinzufügen“ blieb nach einem von außen entfernten Eintrag weg (alter Erfolg der Änderung, `entryButton`/`addingDone`); Startschranke hielt 60 s, weil der native Zustand bei belegtem Torrent-Port nie `ready` wurde (`serverListens`: `starting` + offene Ereignis-Verbindung). Tablet: Knopf da, 0 × „not ready after 60 s“; Playlist-Ablauf am Gerät weiter offen |
| 14.11.2026 | Phase 5a-4 (§4p), dritter Geräte-Lauf (Build `2130e16`): Playlist am Tablet angelegt, gestartet, Folge 1 → „Nächste“ → Folge 2, gestoppt, umbenannt, gelöscht – alles vom Kern; Server-Log 08:14:18–08:23:08: 0 Playlist-Anfragen, 0 `videocore`. Offen (Oberfläche): leere Quelle bei nur einer möglichen Art, × des Mini-Players unter dem Playlist-Knopf. Wiedergabe gut 95 s (Regel 15 s verletzt). Stücke beim Abspielen: `video-status` bis 30,6 ms im 5-s-Schreibtakt, `video-completed` 101 ms |
| 14.11.2026 | Phase 5a-2b (§4p): Player-Nachrichten über 8 ms (`video-status`/`-seeked`/`-completed`, bis 101 ms) lagen am Warten in der Datenbank-Reihe, das der Wächter nicht sah; `inOrder` wartet jetzt über `waitInLine` („database line“), Tablet-Lauf ohne Meldung über 8 ms. `POST /manga/manual-mapping/preview` vom Kern; `source-refresh` und `custom-source/provider/list/*` bleiben beim Server (Begründung §4p). |
| 14.11.2026 | Phase 5b-1 (§4p): eigene Videodateien im Bereich `library` – Scan (eigener `$habari`, eigene Zuordnungs-Regel, AniList-Suche bei „erweitert“), `core.db` Schritt 18 (`local_files`, `scan_summaries`), Datei-Änderungen, `libraryData`/Dateien auf Anime-Seite und Home, Abspielen per `file://` über `native-player`. Tablet: Dr. STONE mit 2 Dateien, dritte unzugeordnet, 0 Server-Anfragen für den Scan; Abspielen am Gerät offen. |
| 14.11.2026 | Phase 5b-2 (§4p): lokale Ordner fertig – `explorer/file-tree` (+ `refresh`), `DELETE /library/empty-directories` (nur ganz leere Ordner unter dem Bibliotheks-Ordner), `anime-entry/suggestions`, Scan beim Start (`refreshLibraryOnStart`), Geräte-Ordner nur noch über asynchrone Funktionen als Warten (9,5 ms weg), eigene kleine AniList-Suche. Tablet: Scan, „Add to AniList“ (Test-Konto), lokale Folge per `file://` vom Kern gespielt (0 Anfragen an `/playback-manager/play`/`/directstream` beim Server, Fortschritt über `playback`); Wiedergabe gut 24 s statt 10 s (Tipp auf „vorige Folge“ + Autoplay). Offen: 42,2 ms im Scan nach der Suche, Ordner-Wächter bewusst nicht. |
| 14.11.2026 | Phase 5c-1 (§4p): ohne Server – Link `core?server=off` / `on` (nur Test/scratch) lässt den Server-Dienst ungestartet, alle Bereiche gelten als an, Status/Erststart/Speichern vom Kern ohne Rückfrage, keine Startschranke; was nur der Server kann, scheitert sofort mit 503 „needs the server“; direkte Server-Adressen ausgelassen oder Fehler; Tablet: kein Server-Prozess, Home nach 0,8 s JS-Start, normaler Tag ok, Torrent sofort sauber, zurück auf `server=on` mit `none` |
| 14.11.2026 | Phase 5c-2 (§4p, §5): Hintergrund-Abfragen ohne eigenen Bildschirm still ohne Server (`onlyWithServer`: Plugin-Einstellungen, Entwickler-Erweiterungen, Manga-Quellen-Auffrischen, Cache-only-Status, Nakama-Räume, Plugin-Folgen-Tabs); `measure-android.sh` für scratch und ohne Server-Prozess; Messung ohne gegen mit Server auf beiden Geräten (§5 „Nach Stufe 5“); Stufe 5 abgenommen mit Vorbehalt Speicher S22 | `tsc` 0; vitest 150 Dateien / 1393 Tests; lint 0 Fehler, 341 Warnungen; Builds `efc0a7a` auf S22 (Test-App) und Tablet (scratch), beide Geräte am Ende `server=on`, `none`, Server-Prozess läuft |
| 14.11.2026 | Phase 6a (§4q): Vorprüfung der Torrent-Bibliothek – libtorrent (C++), frostwire-jlibtorrent, libtorrent4j verglichen (Lizenz, Version, Abhängigkeiten, Größe, 16 KB, minSdk, iOS, Streaming); Empfehlung libtorrent 2.1.2 als Nitro-Modul mit lokalem HTTP-Ausgang (Range); Stufe 6 in Arbeit | Bautest außerhalb des Repos mit NDK 27.1 + CMake 3.31.6 + Boost 1.92 (nur Kopfdateien): libtorrent 2.0.15 und 2.1.2 für arm64-v8a gebaut, Probe-`.so` 2,68 / 2,78 MB gestrippt, alle `LOAD` 0x4000 (`llvm-readelf -l`); jlibtorrent-2.1.2.1-arm64-`.so` geladen und vermessen (17,4 MB, 0x4000, API 26). Kein App-Code, kein App-Build, kein Gerät |
| 14.11.2026 | Phase 6b-1 (§4q): natives Torrent-Modul `native/modules/core-torrent` – libtorrent 2.1.2 statisch hinter Nitro (geteiltes C++, eigener Faden), libtorrent und Boost-Kopfdateien per Version + SHA-256 in den Gradle-Cache geholt (nicht im Repo), ohne TLS; Sitzung mit Resume-Daten, Magnet/`.torrent`, Dateien, Prioritäten, sequenziell, Stück-Fristen, Status 1×/s, Peer direkt; DHT/LSD/Tracker/PEX/Port-Freigabe/uTP abschaltbar; Hülle `api/client/core-torrent.ts`, Prüf-Link `core?torrent=selftest` (nur Test/scratch); Lizenztexte libtorrent + Boost | `tsc` 0; vitest 151 Dateien / 1404 Tests; lint 0 Fehler, 341 Warnungen; zwei Builds der Test-App (`6493a53`, `233ee18`), APK 112 381 459 → 114 907 537 Bytes, `libSeanimeCoreTorrent.so` beider ABIs alle `LOAD` 0x4000; S22: Prüf-Link 7 × ok (50 MB eigene Testdatei vom eigenen Seeder über `adb reverse`, SHA-256 gleich, Übertragung 1,4–1,5 s, Neustart aus Resume-Daten, Entfernen mit Dateien, Magnet), 0 Abstürze, lädt mit der `libc++_shared.so` von expo-mpv; 8-ms-Wächter in 4 von 7 Läufen gehalten (sonst 12–16 ms, Ort offen) |
| 14.11.2026 | Phase 6b-2 (§4q): Torrent-Stream im Kern – lokaler HTTP-Ausgang im Modul (`StreamServer`, Boost.Asio, nur 127.0.0.1, Token in der Adresse, GET/HEAD mit Range, 206/416, wartet auf fehlende Stücke und setzt Fristen ab der gelesenen Stelle, mehrere Leser), `serve()` in Modul und Hülle; Bereich `torrent` (Schalter, Standard aus): Einstellungen, Start mit Datei-Wahl nach Namen, Stopp, Datei-Vorschau, Batch-Verlauf, Zustands-Ereignis, Adresse als „watch“ an den Player; Tabelle `torrent_kept` (Schritt 19); Prüf-Link `core?torrent=stream-check`; S22: `stream-check` ok (Anfang, Sprung, Ende, weiterer Teil je SHA-256 gleich, erstes Byte nach Sprung 538 ms, 2 Leser, Abbruch, 416), Bereich an: 0 Anfragen an den Server, 0 Abstürze, nichts abgespielt; 8 ms: Ort `download → end` (`File`-Objekt im Faden der App), behoben, 3 Läufe ohne Stück über 8 ms; APK +218 072 Bytes; offen 6c: Suche, `autoSelect`, Debrid, Wiedergabe in mpv am Gerät |
| 14.11.2026 | Phase 6c-1 (§4q): Torrent-Suche und Auto-Auswahl im Bereich `torrent` – `POST /api/v1/torrent/search` über die Torrent-Anbieter-Erweiterungen im Sandkasten (intelligent mit AniDB-Nummern, einfach, neueste; Form wie Aufzeichnung mit Metadaten und Vorschauen), Auto-Select-Profil in `core.db` (`GET/POST/DELETE /api/v1/auto-select/profile`), eigene Auswahl-Regel, `autoSelect` und Magnet vom Anbieter beim Start, Ablage und Port aus den gespeicherten Einstellungen in der Sitzung, Prüf-Link `core?torrent=search-check`; S22: Kern = Server (6/85/0/74 Treffer, gleiche Felder), 0 Such-Anfragen beim Server, Auto-Auswahl trifft eine Wahl; 8-ms-Stücke der einfachen Suche nach dem Build behoben (nicht nachgemessen); APK 115 157 065 Bytes |
| 14.11.2026 | Phase 6c-2 (§4q): Debrid im eigenen Bereich `debrid` (Standard aus) – TorBox, Real-Debrid, AllDebrid, Premiumize nach ihrer öffentlichen API-Doku; Einstellungen in `core.db`, Schlüssel in `expo-secure-store`, einem laufenden Server mitgegeben; Liste, Datei-Vorschau, Stream (direkte Adresse an den Player, `debrid-stream-state`), Abbrechen; ohne Anbieter/Schlüssel sofort Fehler. Hinzufügen zum Herunterladen und Torrent-Client (`TORRENT_CLIENT.*`, `DownloadTorrentFile`) bleiben begründet beim Server. Stufe 6 auf Abnahme-Stand | S22: Debrid-Einstellungen ohne Schlüssel vom Kern gespeichert und zurückgesetzt (60/54 ms), Torrent-Liste leer ohne Hänger; Such-Prüf-Link: längstes Stück 13,4 / 24,5 ms statt 56,5 / 80,5 ms (noch über 8 ms); vitest 154 Dateien / 1455 Tests; APK 115 210 085 Bytes |
| 14.11.2026 | Phase 5c-3 (§4p, §5): Arbeitsspeicher am S22 – Prüf-Link `core?memory=report` (nur Test/scratch); Nachmessung je 3 Läufe: ohne Server App 288,4 MB gegen mit Server App 271,1 + Server 84,4 = 355,5 MB → −67 MB; App allein +17 MB (JS-Bündel-Seiten, Java/Native Heap der Bereiche), keine zusätzliche `.so`, Torrent-Modul nicht geladen → kein Fix; Befund 5c-2 (+35 MB, 1 Lauf) richtiggestellt | S22 Test-App Build `93dfa1f`; Endstand `server=on`, `areas answered by the core: none`, `libseanime.so --port 43212` läuft; kein Code geändert |
| 14.11.2026 | Phase 6d: Gerätetest echter Torrent (§4q) – kein Stream (keine Metadaten in 60 s); Player-Schließen beendet den Torrent-Stream, Log-Zeilen der Torrent-Gerät-Seite, Suche mit mehreren Anbietern (Komma) | `tsc` 0; vitest `src/core` + `src/api/client` 38 Dateien / 578 Tests; S22 Build `3c5afb5`, 0 Torrent-Anfragen beim Server, AniList-Eintrag vorher = nachher, alle Bereiche aus, 0 `FATAL` |
| 14.11.2026 | Gerätetest MangaFire (§4n): `dipland-mangafire` im Kern installiert, Kern = Server (1202 Kapitel, 53 Seiten Kapitel 1), Leser zeigt Seiten direkt mit Kopfzeilen (0 `image-proxy`), Kapitel geladen, aus Datei gelesen, gelöscht; Abweichung Kapitel-Reihenfolge bei mehreren Sprachen festgehalten (Oberfläche sortiert selbst, kein Fix) | Tablet scratch, vorhandener Build, kein Code geändert; AniList-Wächter ok, `anilist-clear` 0 |
| 14.11.2026 | Gerätetest gesperrter Bildschirm (§4o, Stufe 4): Dr. STONE Folge 1 über `kaa`, gesperrt 15:00:37, Download lief gesperrt weiter (40 % nach 170 s), Tablet 15:03:27 von Hand entsperrt, `done` 15:04:24 (702 453 449 Bytes); gesperrt langsamer; Benachrichtigungen für scratch vom Nutzer aus | Tablet scratch, kein Code geändert; Folge bleibt gespeichert, alle Bereiche aus |
| 14.11.2026 | Phase 7a (§4r): ohne Server bewusst entfernt – Plugins (Lesen leer, Ändern „not available without the server“, Plugin-Knopf und Erlaubnis ausgeblendet), Nakama-Cloud-Räume (`room/available` false), Discord (`true`), Fehlerbericht; mit Server unverändert; gespeicherte Folge `105333-1-sub` gelöscht | `tsc` 0; vitest 155 Dateien / 1494 Tests; `expo lint` 0 Fehler / 341 Warnungen; Tablet scratch Build `29cdf21`: kein Toast, 0 „needs the server“, Ordner der Folge weg, danach `server=on`, alle Bereiche aus, Server-Prozess läuft |
| 14.11.2026 | Reste-Lauf (§4r): Home nach `server=on` wartet auf den lauschenden Server; Manga-Kapitel in der Reihenfolge der Erweiterung (MangaFire Kern = Server, `index 0..233`); Speichern der Einstellungen ohne Server-Antwort; Datum löschen per Test geprüft; Sammlung in Stücken begründet geschlossen; Pause vor jeder Datei beim Scan |
| 14.11.2026 | Phase 7c-1 (§4r): DLNA im Kern – Bereich `cast` (Standard aus, ohne Server an) mit allen 10 DLNA-Adressen und Ereignis `dlna-cast`; SSDP-Suche im neuen Modul `core-cast` (geteiltes C++ hinter Nitro, MulticastLock dünn in Kotlin), Geräte-Beschreibung und SOAP (AVTransport, RenderingControl) per `fetch`; nicht erreichbare Quelle → „needs the outlet (7b)“; Prüf-Link `core?cast=discover` | `tsc` 0; vitest 157 Dateien / 1533 Tests; `expo lint` 0 Fehler / 341 Warnungen; Tablet scratch Build `c2ac9a2`: Modul geladen, Suche ohne Fehler, 0 Renderer (LG nicht erreichbar, auch vom PC nicht) → Abfragen am LG nicht belegt; 16 KB ✅; APK 130 744 500 Bytes; alle Bereiche aus |
| 14.11.2026 | Phase 6b-3 (§4q): TLS im Torrent-Modul (BoringSSL 0.20261105.0 statisch, feste Version + SHA-256 im Gradle-Cache, Systemzertifikate über `SSL_CERT_FILE`), Status mit Peers/DHT/Trackern/Web-Seeds und eine Log-Zeile je Sekunde beim Start, Torrent über seine `.torrent`-Datei, Auto-Auswahl ohne Treffer ohne Weg zu den Daten, Zeitüberschreitung mit Zahlen, Entfernen ohne Dateiliste, Stream-Ordner beim Sitzungsende geleert; echter Torrent-Stream am S22 bis ins Bild mit Sprung | `tsc` 0; vitest 155 Dateien / 1504 Tests; `expo lint` 0 Fehler / 341 Warnungen; `llvm-readelf -l` 3 × 0x4000 je ABI; APK 115 216 789 → 116 907 245 Bytes; S22 Test-App, zwei Builds (`315d589`, `b40d44e`), Wiedergabe zusammen höchstens rund 10 s, danach alle Bereiche aus |
| 14.11.2026 | Phase 6e (§4q „Torrent-Reste“): Datei-Wahl in Sammlungen (Zahl im Titel, Staffel aus dem Ordner, Extras raus, absolute Nummerierung, größte Kopie, Log-Zeile), Anbieter ohne Seeder-Zählung (gleiche Zahl bei ≥ 3 Treffern) nach dem Weg zu den Daten gewichtet, Systemstellen direkt in libtorrents TLS-Kontext statt `SSL_CERT_FILE`; Gerätetest mit Folge 23 (Auto-Auswahl, versehentlich gestartet, rund 26 s Wiedergabe) | `tsc` 0; vitest 157 Dateien / 1547 Tests; `expo lint` 0 Fehler / 341 Warnungen; APK 117 145 233 Bytes; S22 Test-App, ein Build (`ada28f6`), danach alle Bereiche aus |
| 14.11.2026 | Phase 7b (§4r): Ausgang im WLAN – zweiter Port des Asio-Ausgangs an der WLAN-Adresse, nur während einer Freigabe (zu bei Stop/`forward-close`/`tv-off`, spätestens nach 10 min ohne Leser), 64-Hex-Token je Freigabe, Datei-Quelle mit `pread`, DLNA-Kopfzeilen; Bereich `cast` gibt DLNA (`start`/`load`/`switch-stream`) und Google Cast (`forward`) die Ausgangs-Adresse für Dateien und Torrent-Streams, Kopfzeilen-Quellen 501; Prüf-Link `core?cast=outlet-check` | `tsc` 0; vitest 157 Dateien / 1540 Tests; `expo lint` 0 Fehler / 341 Warnungen; S22: HEAD + 3 Range-Abrufe mit gleicher SHA-256, falscher Token 404, nach dem Schließen Verbindung abgelehnt; 16 KB ✅ |
| 14.11.2026 | 8-ms-Sammellauf (§4r): Anfragen und Player-/Playlist-Nachrichten beginnen vorn erst nach einem Zeitgeber (`watch.afterCallersTurn`), nicht mehr nach einem Promise-Job – die Promise-Jobs des Aufrufers zählten als Kern-Zeit (Test 21 → 1 ms; Tablet `home-items` beim Einschalten 72,7 ms → keine Meldung); Hintergrund-Stücke 4b-C1K/4b-C2 mit Begründung geschlossen, missed-sequels/schedule unter 8 ms; offen: `library/collection` erster Aufruf 16,6 ms, `GET /status` kalt, Sandkasten kalt, Wiedergabe/Downloads nicht nachgemessen | Tablet scratch Build `d3bf158`; Endstand `areas answered by the core: none` |
| 14.11.2026 | 8-ms-Runde 2 (§4r): Messpunkte `core`/`answered` je Anfrage, Pausen mit Messpunkten in `library/collection` und `GET /status`, Download-Tabelle in 50er-Schritten, Selbsttest nennt Stücke über 8 ms mit Ort; `GET /status` kalt ohne Meldung, Auftrag bauen ohne Meldung; Befund: gleichzeitige Anfragen halten den Faden gemeinsam, der Wächter rechnet es der offenen zu (11,8 ms zwischen zwei Messpunkten ohne Kern-Arbeit); offen: Wächter je Anfrage, Sandkasten `open` 24,3 / `helpers` 29,8 ms, Manga kalt, `downloads`/`download-data` | Tablet scratch Build `34a4fe4`; Endstand `areas answered by the core: none` |
| 14.11.2026 | Phase 6f (§4q): Torrent-Client im Kern – `setPaused` im Modul, pausiert über Neustart, Download-Torrents in der Stream-Sitzung, Routen list/action/download, `TorrentKeepService` in `core-download`, Wiederaufnahme bei der ersten Kern-Antwort, Prüf-Link `client-check` | `tsc` 0; vitest 158 Dateien / 1576 Tests; `expo lint` 0 Fehler / 341 Warnungen; S22 ein Build (`138e513`): Pause/Fortsetzen, SHA-256 gleich, Neustart per `install -r` setzt bei 18,8 % fort, Entfernen mit Dateien, Seite zeigt Eintrag; 16 KB ✅; APK 117 171 105 Bytes |
| 14.11.2026 | Phase 7f (§4r): Server-Reste vor Stufe 8 – Manga-`source-refresh` ohne Server im Kern (eigene Regel, nur `refresh_selected`), custom-source-Listen, filler, Debrid-Download in einen Ordner und Verfolgung externer Player ohne Server bewusst entfernt (`removed.ts`), Oberfläche ohne Server ausgeblendet; Tablet: Filler weg, 0 „needs the server“, Endstand `server=on`. |
| 14.11.2026 | Stufe 8a-1 (§4s): Go-Server-Modul aus der App, App immer ohne Server (`connectServerOff(() => true)`), Geräte-Funktionen nach `core-download`, Bau ohne Go und Prüfung „keine `libseanime.so`“, `-Release` bis 8b gesperrt (Updater 2.0.33) | `tsc` 0; vitest 157 Dateien / 1574 Tests; `expo lint` 0 Fehler / 341 Warnungen; APK Test 71,0 MB, scratch 79,9 MB, je 0 `libseanime.so`; S22 + Tablet per `install -r`, kein Server-Prozess, Daten da, PSS 276 / 268 MB |
| 14.11.2026 | Stufe 8a-2 (§4s): `backend/`, `app/`, `Build.ps1`, Gradle-Wrapper, `tests/`, `ios-core.yml`, `record-server.mjs` aus dem Repo; Erweiterungs-Vertrag (8 `.d.ts`) nach `native/src/core/extensions/contract/`; `askServer`, WebSocket `/events`, Startschranke, Seite „Server-Status“, Server-Teil von `measure-android.sh` weg; Doku: AGENTS.md, NATIVE-UMBAU als historisch | `tsc` 0; vitest 156 Dateien / 1527 Tests; `expo lint` 0 Fehler / 341 Warnungen; `git ls-files backend app` 0; APK Test 70,96 MB, scratch 79,86 MB, je 0 `libseanime.so`; S22 Home ✓, Tablet Home + alter Manga-Download sichtbar; je 0 „needs the server“, 0 JS-Fehler; Reader nicht geöffnet |
| 14.11.2026 | Stufe 8b-1 (§4s, §5 „Endmessung“): Links `core?area=`/`core?server=` und `core-library-check.ts` weg, gespeicherte Bereichs-Schalter nicht mehr gelesen, tote Zeilen in `.gitignore`/`.gitattributes` weg; Fehler „Unmatched Route“ bei alten scratch-Links behoben; Rundgang beide Geräte, Endmessung 3 Läufe je Gerät | `tsc` 0; vitest 156 Dateien / 1525 Tests; `expo lint` 0 Fehler / 341 Warnungen; APK Test 70,95 MB, scratch 79,85 MB; PSS S22 Ø 288 MB, Tablet Ø 272 MB; CPU S22 Ø 9,9 %, Tablet Ø ~14 % (schlechter als Stufe 0); je 0 JS-Fehler, 0 „needs the server“ |
| 14.11.2026 | Stufe 8b-2 (§4s, §5 „Endmessung“): Tablet-CPU je Faden geklärt (Haupt-Faden je Bild, debuggable scratch statt Test-App wie in Stufe 0; Kern-Fäden still), Ruckeln auf der Stufe-0-Liste Black Clover nachgemessen, Tablet-PSS-Streuung erklärt; endlose Reanimated-Animationen beim Abbauen gestoppt (ohne messbare Wirkung); Stufe 8 noch nicht fertig | `tsc` 0; vitest 156 Dateien / 1525 Tests; `expo lint` 0 Fehler / 341 Warnungen; ein scratch-Build am Tablet; CPU Tablet 14,5–15,0 %, S22 10,1–10,4 %; Ruckeln S22 1,76 / 1,24 / 1,48 %; PSS Tablet 316 / 273 / 280 MB |
| 14.11.2026 | Stufe 8b-3 (§4s, §3): Weg „mit Server“ aus dem Kern – keine Bereichs-Schalter, kein `isServerOff`/`isCoreAreaOn`, keine Anfragen an/Benachrichtigungen eines laufenden Servers, keine Startschranke, Umzug-Rückfragen an den Server weg; Umzug aus alten Dateien und behaltener Status-Teil bleiben; Tests nur noch ohne Server | `tsc` 0; vitest 155 Dateien / 1458 Tests; `expo lint` 0 Fehler / 340 Warnungen; Diff −2061 / +193 (Code −874 / +148); Gerät nicht geprüft, `server-url.ts` im Player offen |
| 14.11.2026 | Stufe 8b-4 (§4s): S22-Rundgang für 8b-3; Update-Weg: 3.0.0 nimmt die APK ohne `libseanime.so` in der App, 2.0.33 lehnt sie ab → Installation von Hand (Release-Text); Version 4.0.0, Release-versionCode 40000, `-Release` wieder erlaubt, Entwurf `docs/RELEASE-4.0-DRAFT.md` | `tsc` 0; vitest 155 Dateien / 1460 Tests; `expo lint` 0 Fehler / 340 Warnungen; Test-APK 70,9 MB, 0 `libseanime.so`; S22 alle Hauptbildschirme ✓, 0 JS-Fehler, 0 „needs the server“ |
| 14.11.2026 | Phase 7d (§4r): Nakama zwischen PC-Gastgeber (Denshi 3.10.4) und Gast (scratch mit Server, Build `c409e31`, Tablet) über Mitschnitt-Proxy aufgezeichnet – WS `/api/v1/nakama/ws` mit Token-Kopfzeile, `auth`/`auth_reply`, `ping`/`pong`; Gastgeber-Endpunkte `library`, `library/files/{id}`, `library/shared`, `library/stream?path=`; Gast-Ablauf für 7e beschrieben; ohne Wiedergabe am Gerät und ohne Watch Party | Mitschnitt 10 HTTP / 32 WS-Nachrichten; Denshi-Einstellungen gleich Sicherung (110 Spalten, `config.toml` byte-gleich); Tablet wieder scratch ohne Server |
| 14.11.2026 | Phase 7e (§4r): Nakama als Gast im Kern – WS-Client mit `auth`/`ping`/`pong`, Neuverbindung mit Pause, Passwort in `expo-secure-store`, `nakama/reconnect`/`cleanup`/`play`/`host/anime/library/shared`, Status als Kern-Ereignis, Gastgeber-Bibliothek in Bibliothek und Anime-Seite, Abspielen direkt vom Gastgeber mit `X-Seanime-Nakama-Token` als mpv-Kopfzeile; Watch Party offen | `tsc` 0; vitest 156 Dateien / 1471 Tests; `expo lint` 0 Fehler / 340 Warnungen; Build `8d73cb4` scratch; Gerät nicht belegt; Denshi zurück (Einstellungen gleich Sicherung, `config.toml` byte-gleich) |
| 14.11.2026 | Phase 7e Gerätenachweis (§4r): Tablet (scratch `8d73cb4`, Test-Konto) als Nakama-Gast am PC-Gastgeber – verbunden (Kern-Log + Status), Gastgeber-Serie mit „Shared by“ und Folgen, eine Folge vom Gastgeber gespielt (mpv öffnet Gastgeber-Adresse mit Token-Kopfzeile, Bild sichtbar); Home zeigt die Gastgeber-Bibliothek beim Test-Konto nicht, weil dessen Anordnung keinen Bibliotheks-Abschnitt hat; eine Serie mit fehlenden Dateien beim Gastgeber → 404 | kein Code geändert; PC-Gegenprobe `206`; Wiedergabe ~34 s statt ≤ 10 s (Prüfskript-Fehler), Fortschritt Test-Konto 1; scratch-Nakama-Einstellungen zurück; Denshi zurück (Einstellungen gleich Sicherung, `config.toml` byte-gleich), Token-Sicherungen gelöscht |
| 14.11.2026 | Stufe 8b-5 (§4s, §5): App-Texte sagen „Yomimi“ (Upstream-Bezüge, APK-Asset-Name, Test-/scratch-Namen bleiben); Schleife je Bild gefunden: `react-native-worklets` 0.13.0 meldet `nativeFlushQueue` ohne Bedingung für jedes Bild an → Patch, Schleife nur bei wartendem Rückruf/Finalizer; Ersparnis am Haupt-Faden der Test-App nicht messbar, Stopp im Leerlauf noch nicht belegt | `tsc` 0; vitest 156 Dateien / 1471 Tests; `expo lint` 0 Fehler / 340 Warnungen; Test-APK 67,6 MB; S22 Home „YOMIMI“; CPU 12,6 → 10,5 % (Haupt-Faden 9,7–10,1 → 10,1–10,2 %); Ruckeln 3,9–5,0 → 1,35–1,53 % (frischer Prozess, nicht sicher dem Patch zuzuschreiben) |
| 14.11.2026 | Stufe 8c-1 (§4s): Tablet-Messung ohne Code-Änderung – scratch frisch gebaut (Patch im Bundle), Leerlauf-Schleife läuft weiter (Haupt-Faden 14 %, 60/s; ein JS-Auftraggeber im UI-Runtime fordert jedes Bild `requestAnimationFrame` an, Quelle offen); Ruckeln Black Clover Ø 1,07 % gegen Stufe 0 Ø 3,80 % (besser), Engpass GPU. |
| 14.11.2026 | Stufe 8c-2 (§4s): `server-url.ts` und alle Adressen auf den gelöschten Server (127.0.0.1:4321x) entfernt (`6fd61ebf`); tsc 0, vitest 155/1465, lint 0 Fehler; S22 Dr. STONE online mit Untertiteln, logcat ohne Anfragen an 4321x. |
| 14.11.2026 | Stufe 8c-3/8c-4 (§4s): Reanimated-Mapper nur bei Bedarf (Patch `cacb9ece`), Leerlauf Haupt-Faden Tablet 14 → ~11 %, 60 Aufwacher/s bleiben (RN Fabric `FabricUIManager.java:1666`); `serverPort` entfernt (`51a32278`); Animations-Prüfung am Tablet bestanden mit Vorbehalt (Umschalter Anime|Manga springen, Gegenprobe offen). |
| 14.11.2026 | Phase 7c-2 (§4r): Cast aus dem Player (Torrent + Gerätedateien) über den Kern-Ausgang (`45e6083d`), am LG belegt (PLAYING, Stop → STOPPED, Port zu); Start-Position am TV fehlt noch. |
| 15.11.2026 | Phase 7c-2b (§4r): Start-Sprung beim Cast wartet auf PLAYING, prüft und meldet Fehler (`64d538f8`); LG springt trotzdem nicht („Funktion nicht verfügbar“) – Ursache vermutlich fehlendes `DLNA.ORG_OP` im DIDL-`protocolInfo`. |
| 15.11.2026 | Phase 7c-2c (§4r): DLNA-Kennung im DIDL-`protocolInfo` (`42ae1c40`) – LG startet an der Handy-Position (4:00 → 3:59); offen: Untertitelspur am TV, Panel im Querformat ohne Stop, Panel-Zustand nach Stop. |
| 15.11.2026 | Nachtlauf Blöcke 1–5 (§9 „Nachtlauf 15.11.2026“): Cast-Panel Stop/Zustand/Sprung-Hinweis (`5672b5c6`, TV aus → ohne Gerätebeleg); Umschalter Anime\|Manga gleitet (`9e0b5454`, Ursache nicht der Reanimated-Patch); S22 Leerlauf 10,5 → 8,8 %; Playlist-Knopf/Quelle (`bb27fa4f`); Test-Konto leer, Pack-Sicherung gelöscht; App-Test `docs/APP-TEST-4.0.md` + Fixes `0056778e`, `e40d0504`, `b11019f2`, `9096c21f`, `952bb849`; tsc 0, vitest 157/1501, lint 0 Fehler. |
| 15.11.2026 | Nicks Entscheidungen zum Nachtlauf: Seanime-Desktop-Version aus Einstellungen/Über-Seite entfernt, nur „Yomimi 4.0.0“ (`84ec5aa8`); S22 Test-App Bibliotheks-Ordner gesetzt (Dr. STONE 1–4 lokal gefunden); Tablet scratch als Nakama-Gast zum PC (Home zeigt Gastgeber-Bibliothek über Abschnitt „Anime library“, ohne Code-Änderung); MangaFire-Nummern bleiben (Daten der Quelle); Debrid-Anbieter-Zeile bleibt sichtbar; Internet-Archive-Erweiterung erkennt „Sub 2“ (eigenes Repo, lokaler Commit `0d8b2c5`, nicht veröffentlicht). |
| 15.11.2026 | Release-Vorbereitung 4.0.0: Erststart auf einen Schritt + AniList-Blatt mit einem Haupt-Knopf je Schritt, Token-Erkennung aus Zwischenablage, Vorschau-Link `…://dev/intro` nur test/scratch (`8c929dd7`); Marktplatz hinzufügen per Link einfügen → Vorschau → Hinzufügen, zuletzt genutzte Marktplätze ein Tipp (`828e4f0c`); Durchsicht-Fixes Tablet (`b618b785`) und Handy (`37e69278`, Toasts unter dem Kopf); Kern wartet einmal auf AniLists Rate-Limit (30/min), wenn nichts gespeichert ist – Zeitplan scheiterte nach vollem Start (`f13ccbe2`, am Gerät nicht belegt); Release-APK `-Release` erstmals gebaut und geprüft (com.seanime.app.local 4.0.0/40000, Zertifikat = 3.0.0, ohne libseanime), Notes `docs/RELEASE-4.0-DRAFT.md` (`5d159cd9`); vitest 159/1528. Nicht veröffentlicht. |
| 15.11.2026 | Name zurück auf Seanime Mobile (Nick 15.11.): App-Texte, Release-Name (`app-variants.json`), README, Release-Notes; Ladewort „S e a n i m e“; „Export library data“ entfernt (brauchte den Server, Sicherung ersetzt es). |
| 15.11.2026 | Nachmittag: A1 ohne AniList (Sync-Hinweis, Senden bei Start/Netz/Vordergrund, Listen des lokalen Kontos, `5f0373eb`), A3 Widget „Continue watching“ (`1e3957ad`), A2 Sicherung/Wiederherstellen + „Upload local lists“ (`91cca5ed`), `docs/BUILD.md` (`e9660f56`), Name zurück auf Seanime Mobile (`de565bbc`), „Export library data“ weg (`f083b59c`), F6 (`3c594764` Sicherung über Ordner-Wahl, `ca5ce995` kein Doppel in Weiterschauen, `618e09fb` Suchtastatur); ungenutzter Hook `use-save-server-file.ts` gelöscht (`0cb052bc`); Release-APK neu (com.seanime.app.local 4.0.0/40000, „Seanime Mobile“, 71 244 948 Bytes, Zertifikat = 3.0.0, ohne libseanime); README + Release-Notes ergänzt; tsc 0, vitest 161/1552, eslint 0 Fehler / 340 Warnungen. Nicht veröffentlicht. |
| 15.11.2026 | Abend: Scan + Plan → B1 `5dc480f6`/`61fe4604`/`03ae3ec5`, B2 `de7f90ff`/`1e66eb34`/`e956b120`, E `20b1d8a2`, B3 `c0705845`, B4a `77f03a1d`/`b4cb09ba`, P3 `713e17b7`, B4b `df2b5520`; Abschluss-Lauf: Verlauf-Titel (Details-Form ohne Titel zählte als gefunden → Titel/Cover per AniList `HISTORY_TITLES`, gemerkt unter `history-title/<id>`, offline aus dem Gemerkten; `66a92950`, `aaf3476b`, S22 zeigt Dr. STONE/Black Clover statt „Anime“), vorab geladene Folgen je Auftrag nur WLAN (`OfflineItem.wifiOnly`, unabhängig vom Schalter; `66a92950`), eslint `DeviceLoader`; tsc 0, vitest 172/1623, eslint 0 Fehler (339 Warnungen); Release-APK neu (71 351 444 Bytes, Zertifikat gleich 3.0.0, 0 `libseanime.so`). |
