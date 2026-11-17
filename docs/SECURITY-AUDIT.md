# Security audit — Seanime Mobile 4.0.1

- **Scope:** the app in `native/` (Expo 58 / React Native 0.88, own TypeScript core in `native/src/core/`, native modules in `native/modules/`, config plugins, patches), the CI workflow, and the dependency tree. Base: `origin/main` at `7bcb6736` (v4.0.1). Branch: `security-hardening`.
- **Date:** 2026-11-17
- **Method:** source review only. Nothing was run on a device, no APK was built, no network service was probed. Reading code is implementation evidence, not proof of runtime behaviour.
- **Lenses used:** OWASP Top 10:2021 / CWE Top 25 and STRIDE per trust boundary (skill `cybersecurity`, its eight dimensions worked through one after the other by one reviewer instead of eight parallel agents), the diff review rules of `security-review` for the changes on this branch, the mobile quick lens of `threat-model` (Grim Prompter), Google's `android-intent-security` and `android-permissions-security`, and the criteria of Trail of Bits' `supply-chain-risk-auditor` (its collector scripts were not run; the figures below come from `npm audit` and the lockfile).

## Summary

The code base was clearly written with security in mind, and most of the usual mobile findings do not apply. No critical or high finding was found in the app's own code. Three weaknesses around **restoring a backup file that the app did not write** and around **`intent://` player links** were fixed on this branch. What remains open are design decisions that would change what users can do (cleartext traffic, `http://` extension repositories, what an extension may reach), and dependency advisories that only have a major-version fix.

| Severity | Count | Fixed here | Open (decision) |
| --- | --- | --- | --- |
| Critical | 0 | – | – |
| High | 0 | – | – |
| Medium | 3 | 1 | 2 |
| Low | 8 | 2 | 6 |
| Info | 6 | – | – |

Category view in the format of the `cybersecurity` skill (0–100, a reviewer's judgment, not a measurement): vulnerabilities 90 · authorization 92 · secrets 95 · dependencies 80 · CI/infrastructure 90 · threat intelligence (malware, backdoor, C2 patterns) 100 · AI-code patterns 92 · logic and design 85 — weighted 91 (A). No prompt-injection text aimed at reviewers was found in the repository.

## What was checked and found in order

These are observations from the source, listed so that a later audit does not have to repeat them.

| Area | Observation | Where |
| --- | --- | --- |
| AniList token | Kept only in the device's secured storage (`expo-secure-store`, Android Keystore); the `account` row has no token; the status answer carries `token: ""` | `src/core/anilist/auth.ts`, `src/core/start/without-server.ts`, `src/api/client/core-move.ts` |
| Debrid key, Nakama password | Secured storage as well; the settings hold `""` in their place | `src/core/debrid/debrid.ts`, `src/core/nakama/guest.ts` |
| Backup file | Never contains the token, the debrid key, the Nakama password, or any field named like a secret; file names of extensions are checked against `^[\w.-]+\.json$` (no path) | `src/core/backup/backup.ts` |
| Android backup | `allowBackup: false` | `app.json:9` |
| Logs | Request errors, playback info and player links are reduced before logging; `token=` values are cut | `src/lib/helpers/log-safe.ts` |
| Extension code | Runs in its own QuickJS engine (64 MB, 512 KB stack, 60 s), one door to the app (`__host`), host functions looked up with `Object.hasOwn`, arguments passed as JSON, extension ids restricted to `[a-zA-Z0-9-]`, development-mode extensions refused, an update must keep its id | `src/core/extensions/sandbox/sandbox.ts`, `fetch-manifest.ts`, `manage/install.ts` |
| Hidden WebView (Cloudflare check) | No file access, no downloads (own patch), no new windows, no geolocation or media capture, navigation limited to `http(s)/about/data/blob`, debugging off | `src/lib/hidden-browser/hidden-browser.tsx` |
| Deep links | Release build accepts only `entry`, `manga`, `open` (allow-listed pages) and the AniList/MyAnimeList anime links; every test link is bound to the `test`/`scratch` variant; no link carries a token or starts a change | `src/lib/app-links.ts` |
| Links opened from content | `file`, `content`, `javascript`, `intent`, `data`, `about` are never handed to the system | `src/lib/helpers/browser.ts` |
| App updater | Installs only an APK whose size and SHA-256 match GitHub's own digest of the release asset; no digest, no install; Android checks signature and version code | `src/lib/app-updates/` |
| Local stream server | Bound to loopback, random port, 128-bit random token from the OS; files found by key, never by a path from the request; the LAN share for casting uses a separate port and a 256-bit token per file | `modules/core-torrent/cpp/StreamServer.cpp` |
| Download module | Every path from JavaScript is made canonical and must lie inside the app's own folders; services are `exported="false"`; `PendingIntent`s are immutable | `modules/core-download/android/` |
| File names from providers | Reduced to `[A-Za-z0-9._-]` before they become a file name | `src/core/manga/downloads.ts`, `src/core/offline/offline.ts`, `src/core/offline/legacy.ts` |
| SQL | Drizzle with bound parameters; the one raw statement binds its value | `src/core/anilist/store.ts` |
| Secrets in the repository | None found (keys, tokens, private keys, keystores); signing files are ignored | `.gitignore`, `native/.gitignore` |
| Telemetry | No analytics, crash or advertising SDK | `package.json` |
| CI | Read-only token, no secrets, no publishing, first-party actions only | `.github/workflows/native-check.yml` |
| Lockfile | Version 3, every package from registry.npmjs.org with an integrity hash; the only install script is `fsevents` (macOS, optional); `postinstall` runs `patch-package` | `native/package-lock.json` |

## Findings

### Fixed on this branch

**F-01 · Medium · A restore wrote device-bound preference keys from the file** — fixed in `db2bef25`
`native/src/lib/app-backup.ts:82`, new `native/src/lib/app-backup-keys.ts`
The export left out the keys that belong to the device or the install (the updater's record of a checked APK, the client id, the core's own switches, …), but the restore wrote every key the file named. A file that was not made by the app — sent by someone, or changed in a cloud folder — could set, for example, `seanime-mobile-app-update` (file name, hash and version the updater treats as already checked) or `seanime-client-id`. Android's signature check still stood between that and an install, so the practical impact was limited; the state itself must not come from outside. The same list now guards both directions. Backups made by the app never contained these keys, so nothing changes for them. CWE-15 / CWE-20.

**F-02 · Low · Secrets named in a hand-made backup reached the settings** — fixed in `1871872a`
`native/src/core/backup/backup.ts:305`
A backup made by the app holds no password, key or token, and a restore puts the device's own values back. Where the device had no value, a secret-named field of a hand-edited file passed through into the settings, the extension settings and the torrent settings — against the documented rule of the format. The restore now removes such fields exactly as the export does. CWE-20.

**F-03 · Low · A stream address could redirect an `intent://` player link** — fixed in `0a4b11e1`
`native/src/lib/external-player-link/android-player-presets.ts:43`
`parseIntentLink` read the first `#Intent;` of the finished link. An address put in for `{url}` (it comes from a provider) could bring its own `#Intent;component=…;end` and so choose the activity that is started inside the chosen player's package (intent redirection, CWE-926/CWE-940). The link's own part is the last one; the parser now takes that. In 4.0.1 the path is hardly reachable (without the server, `{url}` stays empty), so this is hardening. One rest remains, see O-08.

**Not a security fix:** `5cf1140c` keeps the two generated bundles LF on every checkout. With `core.autocrlf` on Windows two tests that compare the bundles byte for byte failed; found while establishing the baseline.

### Open — decisions for the maintainer

Each of these would remove something users can do today or change stored data, so none was changed.

**O-01 · Medium · Cleartext traffic is allowed for the whole app** — `native/app.json:77`
`usesCleartextTraffic: true` is needed for DLNA/UPnP TVs, the local stream address `http://127.0.0.1`, a Nakama host on the home network, and `http://` sources of extensions. The price: any request the app or an extension makes to an `http://` address can be read and changed on the network. Option: a network security config that allows cleartext only for loopback and private address ranges. That breaks `http://` extension sources and hosts on public addresses, so it needs a decision and a device test.

**O-02 · Medium · Extension code can be loaded over `http://`** — `native/src/core/extensions/manage/install.ts:76`, `manage.ts:342`, `fetch-manifest.ts:213`
Marketplace, repository, manifest and payload addresses accept `http://`, as upstream Seanime does. On a hostile network the code of an extension can be replaced on install or update. The sandbox limits what such code reaches (no files, no secrets of the app), but it can still make any web request and return any stream. Options: refuse `http://` for these addresses (breaks self-hosted repositories without TLS), or keep it and show a warning in the install dialog.

**O-03 · Low · An extension can reach loopback and the local network** — `native/src/core/extensions/helpers/helpers.ts:100`
`fetch` inside an extension accepts every `http(s)` host, including `127.0.0.1` and private ranges (routers, NAS, other apps' local servers). The app's own stream server is protected by its token. Blocking private ranges would break custom-source extensions that talk to a server at home; blocking only loopback is the smaller step.

**O-04 · Low · Passwords of other programs lie in the settings table as plain text** — `native/src/core/settings/shape.ts:60,74,87,94,141`
`vlcPassword`, `qbittorrentPassword`, `transmissionPassword`, `vcTranslateApiKey` and `hostPassword` are part of the settings JSON in the app's private SQLite file (not in backups, not in Android's backup). Reading them needs root or a debuggable build. Moving them to the secured storage, as was done for the debrid key and the Nakama password, needs a tested migration of stored data.

**O-05 · Low · Dependency advisories without a compatible fix** — see the npm audit section. `zod` (high, direct) validates only what the user types into the settings forms; the fix is the next major version.

**O-06 · Low · Actions in CI are pinned to a tag, not a commit** — `.github/workflows/native-check.yml:31,33`
`actions/checkout@v4` and `actions/setup-node@v4` are first-party and the job has a read-only token and no secrets, so the exposure is small. Pinning to commit SHAs is the usual hardening.

**O-07 · Low · The Nakama password travels as a header, by default over `http://`** — `native/src/core/nakama/guest.ts:62,259`
This is the upstream protocol (`X-Seanime-Nakama-Token`). On a shared network the password and the streams can be read. A host address typed with `https://` is used as such; a hint in the settings is the only change that does not break existing setups.

**O-08 · Low · Title and subtitle placeholders in a custom `intent://` link are not encoded** — `native/src/lib/external-player-link/external-player-link.ts`
Rest of F-03: in a link the user wrote themselves, `{mediaTitle}` or `{subtitleUrl}` placed after `#Intent;` can add fields (a title containing `;package=…`). Presets are not affected. Encoding `;` and `#` in these values for `intent://` links closes it; left open because the path has no test seam yet and is not reachable with a stream in 4.0.1.

### Informational

- **I-01 · Restoring a backup installs the extensions in it.** That is the feature; a backup from someone else is code from someone else. The restore dialog already shows the number of extensions.
- **I-02 · Broad permissions.** `MANAGE_EXTERNAL_STORAGE` (local library on shared storage) and `REQUEST_INSTALL_PACKAGES` (the updater) are both tied to features (`app.json:17-18`). They matter for store policies, not for an attack found here.
- **I-03 · Token comparison in the stream server is not constant-time** (`StreamServer.cpp:376`). With a 128-bit token and a local caller this is not a practical attack; a constant-time comparison would be a small native change that needs a build to verify.
- **I-04 · The torrent client listens on all interfaces** (`TorrentCore.cpp:222`). Inherent to BitTorrent; libtorrent's input handling is the trust boundary.
- **I-05 · Test-only deep links depend on the build variant.** `app-variants.json` stays on `test` in the repository; the release script switches its staged copy. A release built another way would ship the test links. `release-from-2-0-33.test.ts` guards parts of this.
- **I-06 · The Nakama peer id comes from `Math.random`** (`guest.ts:133`). It is an identifier, not a secret.

## Threat model (mobile quick lens)

A compact pass with the mobile lens of the `threat-model` skill. It is **not** a full Grim Prompter run: no evidence bundle and no JSON envelope were written, and no verification was executed.

**Assets:** AniList token; debrid key; Nakama password; watch history, lists and playlists; downloaded media; the user's network position (torrents, streams).

**Actors:** a network attacker on the same Wi-Fi; a hostile or compromised extension or marketplace; another app on the device; someone who hands the user a file or link; someone with the unlocked device. No backend of this project exists, so there is no server-side authorization to rely on or to attack.

| Boundary | Main threats (STRIDE) | State |
| --- | --- | --- |
| App ↔ AniList / debrid services (HTTPS) | Disclosure of the token | Token only in secured storage and in the `Authorization` header; not in logs, status or backups |
| App ↔ extension code | Elevation, tampering, disclosure | Sandbox with one door; reaches the web but no files and no secrets. Open: O-02, O-03 |
| App ↔ marketplace / repositories | Tampering with code in transit | HTTPS by default (official marketplace); `http://` possible → O-02 |
| App ↔ local network (DLNA, cast share, Nakama, torrents) | Spoofed devices, disclosure of streams | Cast share behind a 256-bit token per file; DLNA answers parsed as data; cleartext by nature → O-01, O-07 |
| App ↔ other apps (links, share sheet, widgets, notifications, loopback server) | Spoofed entry, intent redirection | Links only navigate; no exported services; loopback server behind a token; F-03 fixed |
| App ↔ files the user picks (backup, local library) | Tampering through a prepared file | F-01 and F-02 fixed; I-01 remains by design |
| App ↔ GitHub releases (updater) | Tampered update | Digest, size, signature and version checks |
| Device storage | Disclosure on a lost or rooted device | Secrets in the Keystore; the rest in app-private storage → O-04 |

**Lifecycle checks of the lens:** account change — signing in as another account forgets the kept lists, and waiting AniList changes carry the account they were made for (`anilist/auth.ts`, `anilist/changes.ts`). Notification and widget taps — they open a page by id; the page reads with the current account. Offline queue — bound to its account as above. Sharing out — player links and logs are cut of tokens; backups hold no secrets. Recovery — a restore writes a safety copy of the state before it.

**Proposed verification (not run):** restore a prepared file that names `seanime-mobile-app-update` on a device and confirm the updater state is unchanged; open an `http://` marketplace through a proxy that rewrites the payload to confirm O-02 and to test any change made for it.

## npm audit

`npm audit` in `native/` on 2026-11-17 (1,105 packages): **14 advisories — 0 critical, 1 high, 13 moderate.**

| Package | Severity | Direct | In the shipped app | Fix |
| --- | --- | --- | --- | --- |
| `zod` < 4.6.6 (memory use while validating oversized collections) | high | yes | yes, settings forms only (`src/lib/server/settings.ts`); input is the user's own | major (4.x) |
| `glob` 9–14 / `minimatch` 7–11 (via `@expo/cli`, `@expo/fingerprint`, `sucrase`, `typescript-eslint`) | moderate | no | no — build and lint tooling | `npm audit fix` for `@expo/cli`, `sucrase` 3.35.1 and `typescript-eslint`; the rest only with a major change of `expo` |
| `expo`, `expo-share-intent`, `react-native-android-widget` | moderate | yes | listed only because they depend on the tooling above | none that is not a downgrade |

Nothing was changed: the compatible fixes touch only developer tooling and move the build chain of a released version, and `sucrase` is pinned on purpose (its version is part of the generated transpiler bundle that a test compares byte for byte). Recommended with the next dependency round: `npm audit fix` without `--force`, then rebuild the transpiler bundle; plan the move to zod 4 separately.

## Verification of this branch

Run in `native/` after the last commit:

- `npm run typecheck` — 0 errors
- `npm test` — 173 files, 1,635 tests, all passed (base: 172 files, 1,629 tests; 6 tests added for F-01 to F-03)
- `npm run lint` — 0 errors, 339 warnings (unchanged from the base)

Not verified: behaviour on a device, the native modules (no build), and the open items above.
