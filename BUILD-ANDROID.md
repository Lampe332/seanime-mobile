Seanime Mobile 1.6.0, Seanime-Backend 3.10.4, VersionCode 31013.

## Werkzeugstand

Java 21, Android SDK Platform 36, Build Tools 36.0.0, Gradle-Wrapper 9.2.1 und Android Gradle Plugin 9.0.1. Android-NDK 29.0.14206865, Node/npm und Go gemäß `backend/go.mod` (Go 1.27.1) werden zusätzlich benötigt, wenn Backend und Oberfläche neu gebaut werden.

## Android-Hülle aus gelieferten nativen Bibliotheken bauen

`ANDROID_HOME` auf das Android-SDK setzen; Java im PATH oder über JAVA_HOME bereitstellen:

```powershell
.\gradlew.bat --no-daemon :app:assembleDebug :app:lintDebug
```

Ohne Signierkonfiguration kann auch ein unsignierter Release-Build erzeugt werden. Für einen installierbaren signierten Release sind ein eigener Keystore und die Umgebungsvariablen `SEANIME_SIGNING_STORE`, `SEANIME_SIGNING_ALIAS` und `SEANIME_SIGNING_PASSWORD` erforderlich. Der private bisherige Schlüssel wird nicht veröffentlicht. Ein eigener Schlüssel erzeugt keine kompatiblen Updates für die vorhandene lokal signierte Installation.

```powershell
.\gradlew.bat --no-daemon :app:assembleRelease :app:lintRelease
```

Für den privaten Folge-Build bleibt alternativ der Nachbarordner `../seanime-mobile-signing/seanime-android.p12` (außerhalb des Repositorys) unterstützt. Kennwörter werden aus der Umgebung gelesen. Das öffentliche Archiv enthält weder diesen Ordner noch Kennwörter.

## Gesamten Quellstand bauen

`Build.ps1` erwartet einen Werkzeugordner mit `android-sdk`, `go/bin/go.exe` und den Cache-Verzeichnissen. Node/npm und Java müssen verfügbar sein. Signierdateien über die oben genannten Umgebungsvariablen bereitstellen. Der Build erfolgt in einem separaten Zwischenordner.

```powershell
.\Build.ps1 -ToolchainRoot 'D:\Android-Toolchain' -WorkDirectory 'D:\Seanime-Build' -RebuildBackend
```

Die Option baut zuerst die mobile React-Oberfläche mit TypeScript-Prüfung, bettet sie unter `backend/web` ein und erzeugt Go-Programme für arm64-v8a und armeabi-v7a. Für App 1.3.3 wurden die mobile Oberfläche und die nativen Go-Programme für beide ABIs aus dem aktualisierten Quellstand neu gebaut. Die Backend-Versionsnummer bleibt 3.10.4; die App besitzt unabhängig davon Version 1.3.3.

Die nativen Dateien `libseanime.so` sind Go-Programme im PIE-Format, keine JNI-Bindings. Android extrahiert sie aus der APK; `SeanimeService` startet sie aus `nativeLibraryDir` mit Bindung an `127.0.0.1:43211`. Die vorhandenen NDK-Bibliotheken und 16-KiB-Ausrichtung bleiben erhalten. Ausführliche ursprüngliche Hinweise stehen in `DEVELOPMENT.md`; bei Abweichungen gilt diese Build-Anleitung für den gelieferten Quellstand.

## Prüfungen

```powershell
python tests/mobile_navigation.py
.\gradlew.bat :app:assembleRelease :app:lintRelease
```

Danach APK mit `apksigner verify --verbose` und `zipalign -c -P 16 4` aus den Android Build Tools prüfen. Ein sauberer Android-Build ersetzt keine Laufzeittests auf verschiedenen Geräten.

Der Testlauf dieses Updates ist im separat gelieferten Prüfbericht dokumentiert. Keine privaten Signierschlüssel oder Appdaten veröffentlichen; vorhandene GPL-Lizenzen und Hinweise beibehalten.
