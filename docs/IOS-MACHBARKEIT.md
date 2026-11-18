# iOS-Fassung: Machbarkeit (Stand 18.11.2026)

Ziel: Seanime Mobile (Expo 58, React Native 0.88, eigener TS-Kern) als Test-App auf einem iPad, ohne eigenen Mac.
Grundlage: `origin/main` = `5f09a412` (4.1.0), nur gelesen. Nichts gebaut, kein Gerät, kein Push.

## Kurzfassung

- **Machbar.** Der größte Teil der App ist TypeScript und läuft auf iOS unverändert. Der Player (`expo-mpv`) hat einen fertigen iOS-Teil (MPVKit). Zwei eigene Module (`core-sandbox`, `core-cast`) haben schon ein podspec, sind aber nie für iOS gebaut worden.
- **Was auf iOS zuerst fehlt:** Downloads (`core-download`, nur Kotlin), Torrent (`core-torrent`, libtorrent ohne iOS-Bau), TV-Suche per SSDP (braucht eine Apple-Berechtigung, die es mit kostenloser Apple-ID nicht gibt), Widgets, Hintergrund-Benachrichtigungen, App-Updater.
- **Ohne Änderung stürzt die App auf iOS beim Start ab:** `native/index.ts` lädt als Erstes `src/lib/legacy-preferences-run.ts`, und das lädt sofort das Android-Modul `core-download` (`requireNativeModule("SeanimeCoreDownload")`). Dasselbe in `src/lib/feedback.ts`. Zwei kleine Weichen nötig (siehe Abschnitt 5).
- **Erste Test-App** (AniList, Bibliothek, Online-Stream über Erweiterungen, mpv-Player, Manga lesen): **ca. 1 bis 2 Arbeitstage**, davon das meiste für Fehler im ersten iOS-Bau, die man vorher nicht sieht.
- **Volle Gleichheit mit Android** (Downloads, Torrent, Cast, Widgets, Benachrichtigungen): **mehrere Wochen** (L).
- **Empfohlener Weg:** GitHub-Actions-Mac baut ein unsigniertes `.ipa` (für das öffentliche Repo kostenlos) → am Windows-PC signiert man es mit **Sideloadly** und einer **eigenen, zweiten kostenlosen Apple-ID** → iPad per USB. Grenze: alle 7 Tage neu signieren.
- **App Store: realistisch nein** (Torrent, nachgeladener Erweiterungs-Code, Streams ohne Lizenz, GPL-3.0). Sideload für eigene Geräte ist der Weg.

Aufwand: **S** = unter einer Sitzung, **M** = 1 bis 3 Sitzungen, **L** = mehr als 3 Sitzungen.

## 1. Native Teile: Stand für iOS

### Eigene Module (`native/modules/`)

| Modul | Was es tut | iOS heute | Was fehlt / Weg | Aufwand | Erste Test-App |
|---|---|---|---|---|---|
| `core-sandbox` | QuickJS-Sandkasten für Erweiterungen (geteiltes C++, Nitro) | podspec + erzeugter Nitro-Code da, **nie gebaut** | Nur bauen und Selbsttest laufen lassen. Der C++-Teil ist plattformneutral (einzige Weiche `malloc_zone_statistics` unter Apple, `EIGENER-KERN.md` §4h). QuickJS ist ein Interpreter ohne JIT, also auf iOS erlaubt. | S bis M | **an** (ohne Sandkasten keine Online-Streams) |
| `core-cast` | TV-Suche per SSDP (C++), Multicast-Lock (Kotlin) | podspec da, nie gebaut | iOS verlangt für Multicast die Berechtigung `com.apple.developer.networking.multicast`. Die gibt Apple nur auf Antrag, nur dem Konto-Inhaber eines **bezahlten** Kontos; persönliche (kostenlose) Teams bekommen sie nicht. Code baut wahrscheinlich, die Suche findet ohne Berechtigung aber nichts. | S (Bau) + Antrag bei Apple | **aus** (Bau darf drin bleiben; scheitert er, `ios` aus `react-native.config.js` nehmen) |
| `core-torrent` | BitTorrent-Sitzung + lokaler HTTP-Stream (libtorrent 2.1.2, Boost-Header, BoringSSL) | **kein podspec**, `react-native.config.js` nennt nur Android, damit iOS es gar nicht einbindet | libtorrent + BoringSSL als statische Bibliothek/xcframework für `ios-arm64` bauen (CMake mit iOS-Toolchain auf dem Mac-Runner), podspec schreiben. Lizenzfalle: `aux_/route.h` (APSL 2.0) wird nur unter iOS eingebunden und ist GPL-unverträglich, vorher durch eigene Kopfdatei ersetzen (`EIGENER-KERN.md` §4q). Auf iOS läuft die Sitzung nur, solange die App vorn ist (kein Dauer-Dienst wie Android). | L | **aus** (fehlt automatisch; Torrent-Einstiege ausblenden) |
| `core-download` | Lader für einzelne Dateien (WorkManager/UIDT), Benachrichtigungen, Wecker, Torrent-Halten **und** `legacyPreferences()`/`feedbackState()` | **gar nichts**, `expo-module.config.json` nur `android` | Dünne Swift-Schicht mit `URLSessionConfiguration.background` nach demselben Vertrag (`core/download/loader.ts`), wie in `EIGENER-KERN.md` §4o „iOS" geplant. `legacyPreferences` braucht iOS nicht (es gab nie eine alte iOS-App). `feedbackState` (Klingelmodus) gibt es auf iOS nicht öffentlich. | M bis L | **aus**, aber Start-Absturz vorher beheben (Abschnitt 5) |
| `core-sodium` | im Auftrag genannt | **nicht auf `origin/main`** (kein Ordner, kein `sodium` im Code) | Falls es auf einem anderen Zweig liegt: libsodium gibt es fertig als xcframework/Swift-Paket (z. B. `swift-sodium`) bzw. per CocoaPods. | S bis M | entfällt |

### Bibliotheken aus `native/package.json`

| Paket | iOS? | Bemerkung | Erste Test-App |
|---|---|---|---|
| `expo-mpv` 0.1.27 | **ja**, MPVKit (libmpv), Metal über MoltenVK, ab iOS 16.0 | Der Config-Plugin lädt die MPVKit-xcframeworks beim `prebuild` (Netz auf dem Runner, ok). Unser Patch (`patches/expo-mpv+0.1.27.patch`) ändert nur Android- und Typ-Dateien, iOS bekommt also den unveränderten Upstream-Player: PiP-Knöpfe und eigene Android-Fixes fehlen dort. | an |
| `react-native-google-cast` | ja (Google Cast SDK) | Die App ruft Google Cast auf iOS schon jetzt nicht auf (`src/lib/cast/cast-controller.ts:122`). Nativ bleibt es gebaut. Später einschalten: S bis M (Info.plist `NSBonjourServices`, Local-Network-Text). | aus (JS-seitig schon) |
| `react-native-android-widget` | nein | JS-Teil ist auf iOS ein Leermodul (`Platform.OS === 'android' ? … : noopModule`), stürzt nicht ab. Widget auf iOS = WidgetKit (Swift, eigenes Ziel, App Group): **L**. | aus |
| `expo-intent-launcher`, `expo-navigation-bar` | nein | Auf iOS leere Module; Aufrufe stehen schon hinter `Platform.OS`-Weichen. | aus |
| `expo-share-intent` | ja | In `app.json` mit `disableIOS: true` abgeschaltet. Später: Share-Extension, S bis M. | aus |
| `expo-notifications` | ja | Lokale Benachrichtigungen gehen mit kostenloser Apple-ID, **Push nicht** (Berechtigung `aps-environment` muss raus, macht der Workflow-Entwurf). | an (lokal) |
| `expo-background-task` | ja (BGTaskScheduler) | iOS startet Hintergrund-Aufgaben selten und nach eigenem Ermessen. Neue-Folgen- und Kapitel-Prüfung (`airing-notifier.ts`, `chapter-check.ts`) sind schon nur Android. Auf iOS nachziehen: M, aber nie so zuverlässig wie Android. | aus |
| `expo-quick-actions`, `expo-sqlite`, `expo-file-system`, `react-native-mmkv`, `react-native-nitro-modules`, `react-native-webview` (WKWebView), `react-native-volume-manager`, `expo-brightness`, `expo-audio`, `expo-haptics`, Reanimated/Worklets, Screens, Gesture Handler | ja | Standard-Bibliotheken mit iOS-Teil. Unsere Patches für Reanimated, Worklets und WebView ändern JS bzw. Android; der WebView-Patch ändert auch Typen/JS, iOS-Verhalten dort beim ersten Lauf prüfen. | an |

### Android-eigene App-Funktionen

| Funktion | Stelle | iOS-Weg | Aufwand | Erste Test-App |
|---|---|---|---|---|
| App-Updater (APK) | `src/lib/app-updates/app-updater.ts` (schon Android-Weiche) | Gibt es auf iOS nicht. Ersatz: neu signieren bzw. später TestFlight. | entfällt | aus |
| Ordnerwahl / alle Dateien | `src/lib/folder-picker.ts`, `settings/_components/pick-folder.tsx` (schon Weichen) | iOS-Sandbox; Dokumente-Ordner der App über die Dateien-App sichtbar machen (`UIFileSharingEnabled`). | S | aus |
| Benachrichtigungen neuer Folgen / Kapitel | `airing-notifier.ts`, `chapter-check.ts` (Weichen da) | BGTaskScheduler (siehe oben) | M | aus |
| Download-Benachrichtigungen | `src/main/android-downloads/_lib/download-notifications.ts` (Weichen da) | mit iOS-Downloads | M | aus |
| Widgets | `src/lib/widget/*`, `settings-app.tsx:83` (Weiche da) | WidgetKit | L | aus |
| App-Links anilist.co / myanimelist.net | `app.json` `intentFilters` | Universal Links brauchen die Domain (geht nicht für fremde Domains); eigenes Schema `seanime-native://` geht. | S | Schema an |
| Klartext-HTTP | `usesCleartextTraffic: true` | `NSAppTransportSecurity` / `NSAllowsArbitraryLoads` (im Workflow-Entwurf gesetzt) | S | an |
| iPad als echte iPad-App | fehlt (`ios.supportsTablet`) | `supportsTablet: true`, sonst läuft sie als vergrößerte iPhone-App | S | an |
| Bundle-ID | `app.json` hat keinen `ios`-Block | eigene Test-ID, z. B. `com.seanime.app.iostest`. **Nie** `com.seanime.app.local`. | S | an |

## 2. Build-Weg ohne Mac

| Weg | Kosten | Ergebnis | Brauchbar ohne Mac? |
|---|---|---|---|
| **GitHub Actions, macOS-Runner** (`macos-26`, M1, 3 Kerne) | Standard-Runner sind für **öffentliche Repos kostenlos und unbegrenzt** (GitHub-Doku). Nur die großen macOS-Runner kosten auch bei öffentlichen Repos. Privates Repo: ca. 0,062 $/min aus dem Freikontingent. | Unsigniertes `.ipa` als Artefakt (`xcodebuild CODE_SIGNING_ALLOWED=NO`, `.app` in `Payload/` zippen). Sideloadly signiert es danach. | **Ja, empfohlen.** Kein Apple-Konto im CI, keine Geheimnisse. Ein Lauf vermutlich 30 bis 60 min (MPVKit-Download + C++). |
| **EAS Build** (Expo-Cloud) | Free-Plan mit kleinem Kontingent (Zahlen schwanken in den Quellen: bis 15 iOS-Builds/Monat). | Geräte-Builds (ad hoc / Store) werden mit Verteilungs-Zertifikat signiert, das gibt es **nur mit bezahltem Apple-Konto** (99 $/Jahr). Ohne Konto nur Simulator-Builds (laufen nicht auf dem iPad). | Erst mit bezahltem Apple-Konto sinnvoll. Dann aber bequem (Signatur, TestFlight-Upload). |
| `eas build --local` / Expo auf eigenem Mac | | braucht einen Mac | nein |
| Gemieteter Cloud-Mac (MacinCloud, AWS EC2 Mac u. a.) | Stunden- bzw. Monatsmiete; EC2 Mac mindestens 24 h am Stück | Xcode per Fernzugriff | Nur wenn GitHub Actions scheitert und man interaktiv debuggen muss. |

Wichtig zu GitHub Actions: Ein Workflow mit `workflow_dispatch` lässt sich in der Oberfläche **erst starten, wenn die Datei auf dem Standard-Zweig (`main`) liegt**. Der Entwurf läuft deshalb zusätzlich bei einem Push auf den Zweig `ios-test`. Beides heißt: Ein Push ist nötig. Artefakte eines öffentlichen Repos kann jeder angemeldete GitHub-Nutzer laden; im `.ipa` steckt nichts Privates (gleicher Code wie das öffentliche Repo).

Xcode: Expo SDK 58 verlangt **Xcode 26.4+** und setzt **iOS/iPadOS 16.4** als Mindestversion. Der Entwurf wählt das neueste Xcode 26 des Runners und bricht ab, wenn es älter als 26.4 ist.

## 3. Installation aufs iPad von Windows

### Grenzen mit kostenloser Apple-ID

- Signatur gilt **7 Tage**, danach öffnet die App nicht mehr, bis sie neu signiert ist. Daten bleiben erhalten, wenn mit derselben Apple-ID und Bundle-ID neu signiert wird (nicht vorher löschen).
- Höchstens **3 selbst signierte Apps** gleichzeitig pro Gerät, begrenzte Zahl neuer App-IDs pro Woche.
- Keine Push-Benachrichtigungen, keine Multicast-Berechtigung (TV-Suche), kein iCloud. Lokale Benachrichtigungen gehen.
- iPad braucht **iPadOS 16.4 oder neuer** (Expo 58). Unter iPadOS 16 und neuer muss der **Entwicklermodus** an sein. Das heißt: iPad 5. Generation (2017) oder neuer, iPad Air 3+, mini 5+, alle Pro mit aktuellem Update.

### Werkzeuge

| Werkzeug | Wie | Einsatz |
|---|---|---|
| **Sideloadly** (Windows) | `.ipa` hineinziehen, Apple-ID eingeben, per USB installieren; kann bei eingeschaltetem WLAN-Sync automatisch alle 7 Tage neu signieren, solange PC und iPad im selben Netz sind | **Empfohlen für den ersten Test.** Einfachster Weg. Braucht iTunes + iCloud **von apple.com, nicht aus dem Microsoft Store**. |
| AltStore (klassisch) | AltServer auf Windows, AltStore-App auf dem iPad, erneuert über WLAN mit laufendem AltServer | gleiche Grenzen, mehr Einrichtung |
| SideStore | Abspaltung von AltStore; erneuert nach einmaliger Einrichtung (Pairing-Datei vom PC) **auf dem iPad selbst** über ein lokales VPN, ohne PC | **Besser, wenn das iPad nicht beim PC steht** und der PC nicht in der Nähe ist. Einrichtung fummeliger. |
| AltStore PAL (EU-Marktplatz) | offizieller EU-Weg | Verlangt vom Entwickler ein bezahltes Apple-Konto und Apples Beglaubigung (Notarisierung). Für einen Test zu groß. |

### Schritt für Schritt (Sideloadly)

Vorbereitung am PC (einmalig):
1. iTunes und iCloud für Windows **direkt von apple.com** installieren (Microsoft-Store-Versionen vorher deinstallieren, falls vorhanden).
2. Sideloadly von `sideloadly.io` installieren.
3. **Eine eigene Apple-ID nur zum Signieren** anlegen (nicht die Haupt-ID des iPad-Besitzers), mit Zwei-Faktor. Grund: Sideloadly ist ein Fremdprogramm, das sich mit dieser ID bei Apple anmeldet.

Bauen:
4. Zweig `ios-test` pushen (enthält den Workflow und die zwei Start-Weichen aus Abschnitt 5) → GitHub › Actions › „iOS test build (unsigned)" → Artefakt `Seanime-iOS-test-unsigned` laden und entpacken.

Am iPad (beim ersten Mal):
5. iPad per USB an den PC, „Diesem Computer vertrauen" antippen, Code eingeben.
6. In Sideloadly das iPad auswählen, `Seanime-iOS-test-unsigned.ipa` hineinziehen, die Signier-Apple-ID eingeben, Start. Eventuell Zwei-Faktor-Code eingeben.
7. iPad: Einstellungen › Datenschutz & Sicherheit › **Entwicklermodus** an → iPad startet neu → nach dem Neustart „Einschalten" bestätigen, Code eingeben. (Der Schalter erscheint erst, nachdem eine selbst signierte App installiert wurde.)
8. iPad: Einstellungen › Allgemein › **VPN und Geräteverwaltung** › Entwickler-App mit der Signier-Apple-ID › „Vertrauen" (braucht Internet).
9. App öffnen.

Alle 7 Tage: Schritt 6 wiederholen (oder Sideloadly-Automatik über WLAN). Ohne PC in der Nähe: SideStore statt Sideloadly.

### Was am iPad verändert wird

- Entwicklermodus ist an (Warnhinweis beim Einschalten, Neustart). Kann jederzeit wieder ausgeschaltet werden.
- Ein Entwickler-Profil der Signier-Apple-ID wird vertraut, eine App mehr ist installiert.
- **Nicht** verändert: Apple-ID des Besitzers, iCloud, Garantie, Systemdateien. Kein Jailbreak.
- Rückgängig: App löschen (Profil verschwindet mit), Entwicklermodus aus.

## 4. Apple-Regeln: App Store oder Sideload

- **App Store: realistisch nein.** Gründe, jeder für sich reicht:
  - Torrent-Client: Apple lässt BitTorrent-Clients seit Jahren nicht zu (Dateitausch / Rechte Dritter, u. a. Richtlinie 5.2.3).
  - Streams aus Quellen ohne Lizenz (5.2.3, Audio/Video Dritter ohne Erlaubnis).
  - Erweiterungen laden ausführbaren Code nach und führen ihn im eigenen QuickJS aus (2.5.2: Apps dürfen nach der Prüfung keinen Code nachladen, der Funktionen ändert).
  - Lizenz: Die App steht unter GPL-3.0 und enthält Code aus dem Seanime-Upstream. Die Bedingungen des App Store gelten nach verbreiteter Ansicht (FSF) als GPL-unverträglich; ohne Zustimmung aller Rechteinhaber heikel.
- **TestFlight** (bezahltes Konto, 99 $/Jahr): Interne Tester (Personen im eigenen App-Store-Connect-Team) bekommen Builds ohne menschliche Prüfung, 90 Tage gültig. Die Testperson müsste dafür als Nutzer im Konto angelegt werden. Ob der Torrent-/Erweiterungs-Inhalt beim automatischen Upload-Check auffällt, ist offen. Externe Tester brauchen eine Beta-Prüfung, dort gelten die Regeln oben.
- **Sideload mit kostenloser Apple-ID** ist für eigene Geräte und Familie gedacht und erlaubt; Apple prüft dabei keine Inhalte. Das ist der Weg für den Test.

## 5. Erste iOS-Test-App: was per `Platform.OS` abgeschaltet würde

**Stand Zweig `ios-test`: eingebaut.** `modules/core-download/index.ts` nutzt `requireOptionalNativeModule` (auf iOS `null`, alle Aufrufer behandeln das); `src/lib/device-features.ts` (`DOWNLOADS_ON_DEVICE`, `TORRENTS_ON_DEVICE`) blendet auf iOS aus: Downloads-Eintrag in Leiste, Menü und Navigations-Editor (`use-device-nav-items.ts`), „Downloads ansehen/lesen", Manga-Downloads-Knopf, Download-Knopf im Online-Stream, „Torrent herunterladen" und den Download-Knopf je Folge, in Einstellungen › Torrents die Gruppen Streaming und Downloads (Anbieter und Debrid bleiben). Android unverändert: `tsc` 0, vitest 175 Dateien / 1649 Tests, `expo lint` 0 Fehler.

Viele Weichen gibt es schon (24 `Platform.OS`-Stellen in `native/src`). Was **zwingend** fehlt, sind zwei Stellen, die das Android-Modul beim Laden der Datei anfassen:

| # | Datei | Problem | Änderung (Vorschlag, nicht eingebaut) |
|---|---|---|---|
| 1 | `native/src/lib/legacy-preferences-run.ts` | wird als Erstes von `index.ts` geladen; `import DeviceFacts from "../../modules/core-download"` ruft sofort `requireNativeModule("SeanimeCoreDownload")` → **Absturz beim Start** | Nur unter Android laden: `if (Platform.OS === "android") { const DeviceFacts = require("../../modules/core-download").default; copyLegacyPreferences(storage, () => DeviceFacts.legacyPreferences()) }`. Auf iOS gibt es keine alte App, also nichts zu übernehmen. |
| 2 | `native/src/lib/feedback.ts:5` | gleicher Import oben in der Datei, wird von vielen Bildschirmen geladen | Import entfernen, in `hasVibrator()` und den Android-Zweigen erst bei Bedarf `require(...)`; die Aufrufe stehen schon hinter `Platform.OS !== "android"`. |

Alternative zu beiden: in `modules/core-download/index.ts` `requireOptionalNativeModule` statt `requireNativeModule` (liefert auf iOS `null`); dann zwingt `tsc` alle Aufrufer, `null` zu behandeln. Sauberer, aber mehr Stellen.

**Empfohlen auszublenden** (laden das Modul nur bei Bedarf über `await import(...)`, scheitern also mit einer Fehlermeldung statt Absturz; für einen ruhigen Test trotzdem verstecken):

| Bereich | Stellen | Grund |
|---|---|---|
| Downloads (Folgen, Manga-Kapitel), Offline-Bibliothek | `src/api/client/core-offline.ts`, `core-manga-check.ts`, `core-download.ts`, `src/main/android-downloads/` | `core-download` fehlt auf iOS |
| Torrent-Stream, Torrent-Client, Einstellungen „Torrents" | `src/api/client/core-torrent.ts:343`, `core-torrent-client-check.ts`, `src/main/settings/_screens/settings-torrents.tsx` | `core-torrent` fehlt auf iOS |
| TV-Suche (SSDP/DLNA) im Player | `src/api/client/core-cast.ts`, `src/main/_features/player/player-cast-panel.tsx` | keine Multicast-Berechtigung mit kostenloser ID |
| Prüf-Links für Selbsttests | `src/lib/app-links-handler.ts` (Download-, Torrent-Selbsttest) | nutzen die fehlenden Module |

**Bleibt an:** AniList-Anmeldung und Listen, Suche, Bibliothek, Online-Stream über Erweiterungen (`core-sandbox`), mpv-Player, Manga lesen (online), Einstellungen, lokale Daten (SQLite, MMKV).

Welche Stellen der Oberfläche genau noch Torrent/Downloads anbieten, zeigt erst der erste Lauf auf dem Gerät; die Tabelle nennt die Einstiege im Code.

## 6. Workflow-Entwurf

`.github/workflows/ios-test-build.yml` (nur in diesem Zweig, nicht gepusht):

- startet von Hand oder bei Push auf `ios-test`, Runner `macos-26`, keine Geheimnisse, nur `contents: read`
- Node 24, `npm ci` (wendet die Patches an)
- nimmt den `ios`-Block aus `app.json`: Bundle-ID `com.seanime.app.iostest`, `supportsTablet`, `NSAllowsArbitraryLoads`, Local-Network-Text
- `expo prebuild --platform ios`, `pod install`, entfernt `aps-environment`
- `xcodebuild … -sdk iphoneos CODE_SIGNING_ALLOWED=NO`, packt `Payload/*.app` zu `Seanime-iOS-test-unsigned.ipa`, lädt es als Artefakt (7 Tage), bei Fehler das Build-Log

Ungeprüft: Der Entwurf ist nie gelaufen (kein Mac hier). Erwartbare Stolpersteine beim ersten Lauf: Name des Xcode-Ordners im Runner-Image, Fehler beim ersten Bau von `core-sandbox`/`core-cast` (C++20, Nitro 0.37), MPVKit mit RN 0.88, Fonts-Einstellung von `expo-font` für iOS. Wenn `core-cast` nicht baut: in `modules/core-cast/react-native.config.js` `ios: {}` herausnehmen (wie bei `core-torrent`).

Später: eine eigene Variante `ios-test` in `app-variants.json` (Name, Symbol), heute nimmt iOS den Namen der Test-Variante.

## 7. Gesamtaufwand

| Stufe | Inhalt | Aufwand |
|---|---|---|
| 1. Erste Test-App | 2 Start-Weichen, Einstiege ausblenden, `ios`-Config, Workflow zum Laufen bringen, erster Gerätetest | **S + M**, ca. 1 bis 2 Arbeitstage |
| 2. Downloads | Swift-Lader (`URLSession` im Hintergrund) nach `core/download/loader.ts` | M bis L |
| 3. Torrent | libtorrent/BoringSSL für iOS bauen, podspec, APSL-Datei ersetzen, nur im Vordergrund | L |
| 4. Cast | Google Cast auf iOS einschalten (S bis M); SSDP nur mit bezahltem Konto + Apple-Antrag | M |
| 5. Komfort | lokale Benachrichtigungen per BGTaskScheduler, Widgets (WidgetKit), Share-Extension | M bis L |

## 8. Offene Entscheidungen

1. **Gerät:** erledigt für den ersten Test (iPadOS 26, iPad steht beim PC, eigene Apple-ID zum Signieren, Weichen per `requireOptionalNativeModule`).
2. **Steht das iPad später weit vom PC weg?** Dann SideStore oder bezahltes Apple-Konto (TestFlight intern, 90 Tage statt 7).
3. **99 $/Jahr für ein Apple-Entwicklerkonto?** Nur nötig für: TestFlight, längere Gültigkeit, Multicast-TV-Suche, EAS-Geräte-Builds. Für den ersten Test nicht.

## Quellen

- GitHub: [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- Expo: [SDK 58 Versionen (iOS 16.4+, Xcode 26.4+)](https://docs.expo.dev/versions/v58.0.0), [Apple Developer Program free vs paid](https://expo.dev/blog/apple-developer-program-explained-free-vs-paid), [iOS development build for devices](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/), [EAS Free-Plan-Grenzen](https://expo.dev/changelog/2023-08-01-eas-free-plan-limits), [Expo-Forum: Build ohne bezahltes Konto](https://forums.expo.dev/t/building-ios-app-without-paid-developer-account/67973)
- Sideload: [sideloadly.io](https://sideloadly.io), [Sideloadly FAQ](https://sideloadly.io/faq), [AltStore Windows-Installation](https://faq.altstore.io/altstore-world/how-to-install-altstore-windows), [Wie Sideload 2025 funktioniert](https://dev.to/1_king_0b1e1f8bfe6d1/how-ios-sideloading-actually-works-in-2025-dev-certs-altstore-and-the-eu-exception-1m2h)
- Apple: [Multicast-Berechtigung](https://developer.apple.com/forums/thread/773395), [Supported capabilities](https://apple.co/3rOhlNW), [Forum 2.5.2 Rejection](https://developer.apple.com/forums/thread/835555), [Forum 5.2.3](https://developer.apple.com/forums/thread/703797), [Torrent-Apps und EU-Marktplätze](https://www.idropnews.com/news/think-eu-app-stores-break-apples-control-think-again/252245/)
- Repo: `docs/EIGENER-KERN.md` §4h (Sandkasten), §4o (Lader iOS), §4q (Torrent, APSL), §4r (Cast); `node_modules/expo-mpv/ExpoMpv.podspec` und `plugin/build/withExpoMpv.js` (MPVKit)
