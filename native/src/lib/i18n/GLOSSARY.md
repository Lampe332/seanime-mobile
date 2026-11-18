# Translation glossary

The app's texts are `t(en, de)` pairs in the code. English and German stay there; every other language has a catalog
`<lang>.json` next to this file (key = the exact English text, value = the translation, `""` = not translated yet, the
app then shows English). `node scripts/i18n-extract.mjs` (in `native/`) adds new texts and prints the coverage.

## Rules for every language

- Short UI language, sentence case like the English text. Address the user informally (Spanish tú, French tu,
  Russian ты, Portuguese você, Japanese and Chinese plain polite UI style without honorific padding).
- Keep every placeholder `{0}`, `{1}`, … (the test checks that a translation has the same set as its key); you may
  move them. They stand for numbers, names, titles or already translated parts. Singular and plural are separate keys
  (`1 change waiting` / `{0} changes waiting`). When the number decides the form in your language, give the key an
  object with one text per plural form instead of a string: Russian `{ "one": …, "few": …, "many": … }` (1, 21 / 2-4,
  22 / 5-20, 25), French and Portuguese `{ "one": …, "other": … }` (`one` also covers 0). The number is the first
  placeholder that holds one; add `"count": "{1}"` when it is another. Chinese and Japanese always use a plain string.
- Rich texts keep a literal `{0}` in the key (`Tap {0} to watch.`): the app puts a bold button name or an icon there.
  Move it wherever your sentence needs it, but keep it exactly once.
- Dates, times, weekdays and months come from the app (Intl with the language's locale); season names are texts of
  their own (`Fall {0}` = season and year), so write them in your language's order.
- English words must not hide inside a placeholder: the script lists such calls ("English words inside ${…}"); split
  them in the code into separate `t()` calls instead of translating around them.
- Keep leading and trailing spaces, line breaks (`\n`), quotes and punctuation that join texts (`·`, `–`, `:`).
- Locale keys: `en-US` -> the language's locale tag (`es`, `ru-RU`, `zh-CN`, `pt-BR`, `fr-FR`, `ja-JP`), `en` -> the
  language code (`es`, `ru`, `zh`, `pt`, `fr`, `ja`). The app formats numbers and dates with them.
- A key that is a code value or a technical label (codec names, `OVA`, `ONA`, `TV`, `HEVC, x265, H.265`) keeps its
  English form; enter it unchanged so the catalog counts it as done.
- Brand and product names are never translated: Seanime, Seanime Mobile, AniList, MyAnimeList, Kitsu, AniDB, Nakama,
  Debrid, Real-Debrid, TorBox, Torrent, qBittorrent, Transmission, mpv, VLC, MX Player, Android, Play Protect, GitHub,
  Discord, Wi-Fi, APK, Chromecast, DLNA, Jellyfin, Plex.
- `Unofficial · built on Seanime by 5rahim` stays English in every language.
- Anime and Manga stay as they are (they are loanwords in all target languages; Japanese uses アニメ / マンガ,
  Chinese 动画 / 漫画, Russian аниме / манга).

## Terms

| English | Español |
|---|---|
| Anime | anime (el anime, los anime) |
| Manga | manga (el manga) |
| Episode / Ep | episodio / Ep. |
| Chapter | capítulo |
| Season (anime) | temporada |
| Library | biblioteca |
| My lists | Mis listas |
| Discover | Descubrir |
| Schedule (calendar) | Calendario |
| Settings | Ajustes |
| Search | Buscar |
| Download / Downloads | descargar / Descargas |
| Continue watching | Seguir viendo |
| Watch history | historial de reproducción |
| Playlist | lista de reproducción |
| Extension | extensión |
| Plugin | plugin |
| Source | fuente |
| Provider | proveedor |
| Server | servidor |
| Torrent, Debrid | Torrent, Debrid |
| Seeder / seeders | seeder / seeders |
| Stream / streaming | streaming |
| Subtitles / Dub | subtítulos / doblaje |
| Watching / Planning / Completed / Paused / Dropped / Rewatching | Viendo / Pendiente / Completado / En pausa / Abandonado / Volviendo a ver |
| Reading / Rereading | Leyendo / Releyendo |
| Score | puntuación |
| Progress | progreso |
| Sign in / Sign out | Iniciar sesión / Cerrar sesión |
| Scan (library) | escanear / escaneo |
| Match (file to anime) | asignar |
| Unmatched | sin asignar |
| Player | reproductor |
| Cast (to a TV) | transmitir |
| Device / phone / tablet | dispositivo / teléfono / tablet |
| Widget | widget |
| Backup | copia de seguridad |
| Add | Agregar |
| Account | cuenta |
| Sync / synced | sincronizar / sincronización / sincronizado |
| Recovery code | código de recuperación |
| Encryption key / key | clave de cifrado / clave |
| Approve / approval (a new device) | aprobar / aprobación |
| Start fresh | Empezar de cero |
| Security events | eventos de seguridad |
| Password / Email | contraseña / correo |
| Attack | ataque |

Spanish is neutral (understood in Latin America and Spain): `Agregar`, `teléfono`, no `vosotros`, no regional slang.

Account and security texts: the terms above are fixed in every language (account, sync, recovery code, encryption key,
approve, device). Security warnings say plainly what happened and what to do; never soften "This could be an attack."
or a "deleted for good".

When you translate another language, add its column to this table with the same terms before you start, then follow it.
