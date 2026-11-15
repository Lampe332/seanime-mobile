# Erweiterungs-Vertrag (aus Seanime)

Diese `.d.ts`-Dateien beschreiben, was eine Seanime-Erweiterung sieht und liefern muss (Anbieter-Klassen, `$`-Helfer, Plugin-API). Der Kern (`src/core/extensions/`, `src/core/manga/`, `src/core/streams/`, `src/core/torrent/`) ist nach ihnen geschrieben; Verweise wie „geschrieben nach: goja_plugin_types/core.d.ts“ meinen diese Dateien.

**Herkunft:** unverändert kopiert aus dem früheren Ordner `backend/internal/extension_repo/` dieses Repos (Stufe 8a-2, Stand `cc0d8e7`), der ein Android-Fork von [Seanime](https://github.com/5rahim/seanime) 3.10.4 war:

| Datei | früher |
|---|---|
| `core.d.ts`, `app.d.ts`, `plugin.d.ts`, `system.d.ts` | `goja_plugin_types/` |
| `manga-provider.d.ts` | `goja_manga_test/` |
| `onlinestream-provider.d.ts` | `goja_onlinestream_test/` |
| `anime-torrent-provider.d.ts` | `goja_torrent_test/` |
| `custom-source.d.ts` | `goja_usermedia_test/` |

**Lizenz:** Seanime steht unter der GNU General Public License v3.0 (GPL-3.0), wie dieses Repo (`LICENSE` im Wurzelordner). Urheber der Dateien ist das Seanime-Projekt (5rahim und Mitwirkende).

Nur lesen, nicht ändern: Erweiterungen aus fremden Quellen sind gegen genau diesen Vertrag geschrieben.
