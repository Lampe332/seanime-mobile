# Seanime Mobile selbst bauen

Anleitung für Windows 10/11 (PowerShell). Stand: App 1.7.0, Seanime-Backend 3.10.4, versionCode 31014.

Es gibt zwei Wege:

| Weg | Wann | Braucht |
|---|---|---|
| **A: Nur die Android-App** | Du änderst Kotlin-Code (`app/`) | Java 21 + Android SDK |
| **B: Alles** | Du änderst Backend (`backend/`) oder Oberfläche (`backend/seanime-web/`) | zusätzlich Go, Node.js, Android NDK |

Bei Weg A werden die mitgelieferten fertigen Backend-Dateien `app/src/main/jniLibs/*/libseanime.so` verwendet.

---

## 1. Werkzeuge installieren

### Java 21 und Node.js

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

PowerShell danach neu öffnen und prüfen:

```powershell
java -version    # openjdk version "21..."
node -v          # v22 oder neuer
```

### Werkzeugordner anlegen

`Build.ps1` erwartet alle Android- und Go-Werkzeuge in **einem** Ordner, zum Beispiel `D:\Android-Toolchain`:

```
D:\Android-Toolchain\
├─ android-sdk\
│  ├─ platforms\android-36\
│  ├─ build-tools\36.0.0\
│  ├─ platform-tools\
│  └─ ndk\29.0.14206865\        (nur für Weg B)
├─ go\bin\go.exe                (nur für Weg B)
├─ gradle-cache\                (legt der Build selbst an)
├─ gopath\  go-cache\  npm-cache\   (legt der Build selbst an)
```

### Android SDK

1. [Android Command-line Tools](https://developer.android.com/studio#command-line-tools-only) für Windows herunterladen.
2. Entpacken nach `D:\Android-Toolchain\android-sdk\cmdline-tools\latest\` (dort muss danach `bin\sdkmanager.bat` liegen).
3. Pakete installieren:

```powershell
$sdk = 'D:\Android-Toolchain\android-sdk'
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;29.0.14206865"
```

Das NDK (~1 GB) brauchst du nur für Weg B.

### Go (nur Weg B)

[Go für Windows (ZIP)](https://go.dev/dl/) herunterladen und so entpacken, dass `D:\Android-Toolchain\go\bin\go.exe` existiert. Die genaue Go-Version aus `backend/go.mod` lädt Go beim ersten Build automatisch nach.

---

## 2. Quellcode holen

```powershell
git clone https://github.com/Lampe332/seanime-mobile.git
cd seanime-mobile
```

---

## 3A. Nur die Android-App bauen (Debug)

```powershell
$env:ANDROID_HOME = 'D:\Android-Toolchain\android-sdk'
.\gradlew.bat --no-daemon :app:assembleDebug
```

Ergebnis: `app\build\outputs\apk\debug\app-debug.apk`

Aufs Handy (USB-Debugging an):

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

> Ein Debug-Build ist mit einem anderen Schlüssel signiert. Er lässt sich **nicht** über eine installierte Release-Version installieren. Vorher deinstallieren oder einen signierten Release bauen (siehe 4).

## 3B. Alles bauen (Backend + Oberfläche + App)

```powershell
.\Build.ps1 -ToolchainRoot 'D:\Android-Toolchain' -WorkDirectory 'D:\Seanime-Build' -RebuildBackend
```

Das Skript:

1. kopiert den Quellcode in einen Zwischenordner unter `-WorkDirectory` (dein Checkout bleibt sauber),
2. baut die React-Oberfläche (`npm ci`, `npm run build` inkl. TypeScript-Prüfung) und bettet sie in `backend/web` ein,
3. kompiliert das Go-Backend für `arm64-v8a` und `armeabi-v7a` als `libseanime.so`,
4. baut und lintet die Release-APK, prüft Signatur und 16-KiB-Ausrichtung,
5. legt `Seanime-Mobile-<Version>.apk` in `-WorkDirectory` ab.

Ohne `-RebuildBackend` werden nur Schritte 1, 4 und 5 ausgeführt.

`Build.ps1` erzeugt einen **signierten** Release und braucht deshalb einen Schlüssel (nächster Abschnitt).

---

## 4. Signieren

Android installiert Updates nur, wenn sie mit **demselben Schlüssel** signiert sind wie die installierte App. Der private Schlüssel der offiziellen Releases liegt nicht im Repository.

### Eigenen Schlüssel erzeugen (einmalig)

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore D:\seanime-key.p12 -alias seanime-android -keyalg RSA -keysize 4096 -validity 10000
```

Schlüssel und Passwort gut aufbewahren. Ohne sie kannst du keine Updates für deine Installation mehr bauen.

### Schlüssel angeben

Entweder per Umgebungsvariablen:

```powershell
$env:SEANIME_SIGNING_STORE    = 'D:\seanime-key.p12'
$env:SEANIME_SIGNING_ALIAS    = 'seanime-android'
$env:SEANIME_SIGNING_PASSWORD = '<dein Passwort>'
```

oder als Ordner **neben** dem Repository (wird automatisch gefunden):

```
seanime-mobile\                  (dieses Repository)
seanime-mobile-signing\
├─ seanime-android.p12
└─ password.txt                  (nur das Passwort, eine Zeile)
```

Dann:

```powershell
.\Build.ps1 -ToolchainRoot 'D:\Android-Toolchain' -WorkDirectory 'D:\Seanime-Build'
```

Ohne Schlüssel baut `.\gradlew.bat :app:assembleRelease` eine unsignierte APK, die sich nicht installieren lässt.

---

## 5. Tests

```powershell
# Gradle-Lint
.\gradlew.bat :app:lintRelease

# Oberfläche: TypeScript + Unit-Tests
cd backend\seanime-web
npm ci
npm run typecheck
npm test
cd ..\..

# Navigationstests im Browser (Python + Playwright)
python -m pip install playwright
python -m playwright install chromium
python tests\mobile_navigation.py
python tests\plugin_dom.py
```

Gerätetest (Handy per USB, AniList-Konto in der App angemeldet):

```powershell
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb install -r app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
adb shell am instrument -w com.seanime.app.local.test/com.seanime.app.audit.MobileInstrumentation
```

Die Instrumentierung liest die AniList-Liste und stellt den vorherigen Widget-Cache wieder her; sie verändert keinen AniList-Fortschritt.

### Erststart testen, ohne die installierte App anzufassen

Eine Kopie mit eigener Paket-ID (`com.seanime.app.local.fresh`) lässt sich neben der normalen App installieren und startet komplett leer, inklusive Einrichtungs-Assistent und Tutorial:

```powershell
.\gradlew.bat :app:assembleRelease -PseanimeAppIdSuffix=.fresh
adb shell am force-stop com.seanime.app.local
adb install -r app\build\outputs\apk\release\app-release.apk
```

Beide Apps nutzen denselben lokalen Server-Port (`127.0.0.1:43211`). Deshalb vorher die normale App stoppen, sonst verbindet sich die Test-Kopie mit deren Server. Danach `adb uninstall com.seanime.app.local.fresh`.

---

## Wie die App aufgebaut ist

```
┌──────────────── Android-APK ────────────────┐
│  Kotlin-Hülle (app/)                        │
│   • SeanimeService (Vordergrunddienst)      │
│   • WebView → http://127.0.0.1:43211        │
│   • Offline-Player (Media3/ExoPlayer)       │
│   • Download-Warteschlange                  │
│                                             │
│  libseanime.so = Go-Programm (backend/)     │
│   • Seanime-Server inkl. eingebetteter      │
│     React-Oberfläche (backend/web)          │
└─────────────────────────────────────────────┘
```

`libseanime.so` ist kein JNI-Modul, sondern ein ausführbares Go-Programm (PIE), das Android aus der APK entpackt und `SeanimeService` aus `nativeLibraryDir` startet. Mehr Details: [upstream/DEVELOPMENT.md](upstream/DEVELOPMENT.md).

## Probleme

| Fehlermeldung | Lösung |
|---|---|
| `Android SDK platform 36 is required.` | `sdkmanager "platforms;android-36"` ausführen, `-ToolchainRoot` prüfen |
| `Set SEANIME_SIGNING_STORE ...` | Schlüssel angeben, siehe Abschnitt 4 |
| `Native build failed: arm64-v8a` | NDK `29.0.14206865` fehlt oder `go\bin\go.exe` liegt nicht im Werkzeugordner |
| `npm ci failed.` | Node.js installiert? PowerShell nach der Installation neu öffnen |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Anderer Signierschlüssel als die installierte App; alte App deinstallieren |
