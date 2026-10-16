Nick — Seanime Android 3.10.4, Stand 15.10.2026.

Paket: com.seanime.app.local, VersionCode 31004. Bestehender Signierschlüssel erhalten.
Upstream: https://github.com/5rahim/seanime/releases/tag/v3.10.4
Die Änderungen von 3.10.3 und 3.10.4 sind mit den vorhandenen Custom-Quellen zusammengeführt.
Android-Hülle mit den bisherigen UI-, Vollbild-, PiP- und Navigationsanpassungen übernommen.

Manga-Korrektur: Grid-Kinder können auf die Bildschirmbreite schrumpfen; Quellenfilter und Lesekopf umbrechen. Scanlator und Sprache nutzen auf schmalen Bildschirmen jeweils eine eigene Zeile.
Geänderte UI-Quelldateien:
- backend/seanime-web/src/app/(main)/manga/entry/page.tsx
- backend/seanime-web/src/app/(main)/manga/_containers/chapter-list/chapter-list.tsx

Die nativen Bibliotheken für arm64-v8a und armeabi-v7a enthalten Backend 3.10.4 und die neu gebaute mobile Oberfläche.
docs/BUILD.md beschreibt den Build. Go lädt die im go.mod geforderte Toolchain 1.27.1 automatisch.
Historische Notiz: Der ursprüngliche private Build enthielt den Ordner signing. Das öffentliche Mobile-Quellarchiv enthält keine Signierschlüssel. Aktueller Stand und Build-Anleitung: README.md und docs/BUILD.md.
