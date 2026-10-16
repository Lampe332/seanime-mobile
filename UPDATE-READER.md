Nick — Seanime Android 3.10.4 Reader-Update, 15.10.2026.

Paket: com.seanime.app.local. Android-VersionName bleibt 3.10.4; VersionCode ist 31005. Backend 3.10.4, arm64-v8a und armeabi-v7a. Derselbe lokale Signierschlüssel wie bei der bestehenden Installation.

Änderungen:

- Android-Zurück schließt zuerst das geöffnete Leser-Menü, die Leseeinstellungen oder den Leser. Die Manga-Detailseite bleibt beim Schließen des Lesers erhalten.
- Die Doppelseiten-Auswahl nutzt den echten Lesemodus. Auf Android wird Querformat angefordert; beim Verlassen wird die Ausrichtung freigegeben. Die bisherige CSS-Übersteuerung wurde durch die Anbindung an den React-Lesemodus ersetzt.
- Bild-in-Bild kehrt auch bei entfernten Nachbarelementen zurück. Wurde der ursprüngliche Player entfernt, wird das alte Video beendet und entfernt. PiP-CSS wird aufgeräumt, bestehende Inline-Stile bleiben erhalten. Wiederholter Eintritt erzeugt keine verwaisten Videopositionen.
- Größere Touchflächen im mobilen Leser (mindestens 44 CSS-Pixel), mit eindeutigen Beschriftungen für Schließen, Kapitelwechsel, Seitensprung und Einstellungen.
- Das Zahnrad öffnet die Leseeinstellungen direkt. Vollbild und das Ausblenden der Bedienleiste bleiben in den Einstellungen erreichbar.
- Resume reading zeigt Kapitel und gespeicherte Seite. Eine gültige Lesestelle in der ausgewählten Quelle wird gegenüber dem ersten ungelesenen Kapitel bevorzugt.
- Die vorhandene Speicherung der Lesestelle wird erst freigegeben, wenn der wiederhergestellte Seitenindex im Zustand angekommen ist. Im Scrollmodus wird das Nachladen vorangehender Bilder beim Wiederherstellen berücksichtigt; eigene Touch-/Scroll-Eingaben beenden die Wiederherstellung.
- Die angezeigte Seite im Scrollmodus wird an einer Leselinie innerhalb des Leserfensters erkannt, damit auch lange Webtoon-Seiten erfasst werden.
- Die eigene untere Navigation verwendet vorhandene App-Links und vermeidet dadurch vollständige Neuladungen, soweit ein passender App-Link existiert.
- Die Android-Activity sichert und restauriert die WebView-Historie bei einer Neuerstellung durch Android.

Browserprüfung: echte Overgeared-Daten und die Android-UI-Patches bei 360, 384 und 412 CSS-Pixeln; direkte Einstellungen, tatsächliche Doppelseiten-Auswahl, Android-Zurück-Skript, Touchflächen, Resume-Anzeige und Navigation ohne Dokumentneuladung bestanden. Wiederaufnahme einer gespeicherten Seite in Paged und Long Strip bestanden. PiP-Originalskripte in vier Szenarien bestanden: unveränderter Player, entferntes Nachbarelement, entfernter Player, wiederholter Eintritt.

Build über Build.ps1 mit dem bisher verwendeten ToolchainRoot. signing enthält den privaten lokalen Schlüssel für kompatible Folgeupdates; dieses Archiv privat aufbewahren. Gerätespezifische Verifikation steht im separat mitgelieferten Prüfbericht.
