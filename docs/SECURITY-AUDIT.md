# Security audit — Seanime Mobile 4.0.1

- **Scope:** the app in `native/` (Expo 58 / React Native 0.88, own TypeScript core in `native/src/core/`, native modules in `native/modules/`, config plugins, patches), the CI workflow, and the dependency tree. Base: `origin/main` at `7bcb6736` (v4.0.1). Branch: `security-hardening`.
- **Date:** 2026-11-17
- **Method:** source review only. Nothing was run on a device, no APK was built, no network service was probed. Reading code is implementation evidence, not proof of runtime behaviour.
- **Lenses used:** OWASP Top 10:2021 / CWE Top 25 and STRIDE per trust boundary (skill `cybersecurity`, its eight dimensions worked through one after the other by one reviewer instead of eight parallel agents), the diff review rules of `security-review` for the changes on this branch, the mobile quick lens of `threat-model` (Grim Prompter), Google's `android-intent-security` and `android-permissions-security`, and the criteria of Trail of Bits' `supply-chain-risk-auditor` (its collector scripts were not run; the figures below come from `npm audit` and the lockfile).

## Summary

The code base was clearly written with security in mind, and most of the usual mobile findings do not apply. No critical or high finding was found in the app's own code. Three weaknesses around **restoring a backup file that the app did not write** and around **`intent://` player links** were fixed on this branch. A follow-up on `release-4.1.0` closed four of the open items (F-04 to F-07): hints for `http://` extension links and Nakama hosts, pinned CI actions, and encoded text in own `intent://` links. What remains open are design decisions that would change what users can do (cleartext traffic, what an extension may reach), stored passwords of other programs, and dependency advisories that only have a major-version fix.

| Severity | Count | Fixed here | Open (decision) |
| --- | --- | --- | --- |
| Critical | 0 | – | – |
| High | 0 | – | – |
| Medium | 3 | 2 | 1 |
| Low | 8 | 5 | 3 |
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
| CI | Read-only token, no secrets, no publishing, first-party actions only, pinned to commit SHAs (F-05) | `.github/workflows/native-check.yml` |
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
`parseIntentLink` read the first `#Intent;` of the finished link. An address put in for `{url}` (it comes from a provider) could bring its own `#Intent;component=…;end` and so choose the activity that is started inside the chosen player's package (intent redirection, CWE-926/CWE-940). The link's own part is the last one; the parser now takes that. In 4.0.1 the path is hardly reachable (without the server, `{url}` stays empty), so this is hardening. The rest was closed by F-07.

The four items below were open decisions (O-02, O-06, O-07, O-08) and were closed in a follow-up on `release-4.1.0`.

**F-04 · Medium · Extension code can be loaded over `http://`** (was O-02), hint added in `be126980`
`native/src/main/extensions/_lib/extensions-screen.ts:55`, `native/src/main/extensions/_screens/extensions-phone-sheets.tsx:407`
Marketplace, repository, manifest and payload addresses still accept `http://`, as upstream Seanime does, so self-hosted repositories without TLS keep working (`install.ts:76`, `manage.ts:342`, `fetch-manifest.ts:213`). On a hostile network the code of an extension could be replaced on install or update. The link fields for a marketplace, a repository and a manifest, the marketplace's install sheet, a found manifest with an `http://` payload and a repository list with such extensions now show a short hint (English and German) that the link is not encrypted and its code could be swapped. The check `isInsecureAddress` has its own test. CWE-319 / CWE-494.

**F-05 · Low · Actions in CI were pinned to a tag, not a commit** (was O-06), fixed in `dfd24714`
`.github/workflows/native-check.yml:31,33`
`actions/checkout` and `actions/setup-node` are now pinned to the commit SHAs of `v4.4.0`, each with a `# v4.4.0` comment. Both `v4` tags pointed to that release, so the workflow runs the same code. CWE-829.

**F-06 · Low · The Nakama password travels as a header, by default over `http://`** (was O-07), hint added in `ae321ab2`
`native/src/main/settings/_screens/settings-more.tsx:118`, `native/src/main/settings/_lib/nakama-host.ts`
This is the upstream protocol (`X-Seanime-Nakama-Token`, `native/src/core/nakama/guest.ts:62,259`), so it stays. When the host address is typed with `http://` or without a scheme (the core then uses `http://`), the Nakama settings now say that the passcode and the streams go over the network unencrypted and suggest `https://`. Existing setups keep working. CWE-319.

**F-07 · Low · Title and subtitle placeholders in a custom `intent://` link were not encoded** (was O-08), fixed in `a19c653c`
`native/src/lib/external-player-link/external-player-link.ts:67`
Rest of F-03: in a link the user wrote themselves, `{mediaTitle}`, `{formattedTitle}`, `{subtitleUrl}` or `{subtitleUrls}` placed after `#Intent;` could add fields (a title containing `;package=…`). For `intent://` links these values now go in with `;` as `%3B` and `#` as `%23` (Android decodes intent values). Presets and other links are unchanged. A test checks that such a title and subtitle address add no field. CWE-926 / CWE-940.

**Not a security fix:** `5cf1140c` keeps the two generated bundles LF on every checkout. With `core.autocrlf` on Windows two tests that compare the bundles byte for byte failed; found while establishing the baseline.

### Open — decisions for the maintainer

Each of these would remove something users can do today or change stored data, so none was changed.

**O-01 · Medium · Cleartext traffic is allowed for the whole app** — `native/app.json:77`
`usesCleartextTraffic: true` is needed for DLNA/UPnP TVs, the local stream address `http://127.0.0.1`, a Nakama host on the home network, and `http://` sources of extensions. The price: any request the app or an extension makes to an `http://` address can be read and changed on the network. Option: a network security config that allows cleartext only for loopback and private address ranges. That breaks `http://` extension sources and hosts on public addresses, so it needs a decision and a device test. Deferred: limiting cleartext breaks home servers and `http://` sources, so it waits for a device test.

**O-03 · Low · An extension can reach loopback and the local network** — `native/src/core/extensions/helpers/helpers.ts:100`
`fetch` inside an extension accepts every `http(s)` host, including `127.0.0.1` and private ranges (routers, NAS, other apps' local servers). The app's own stream server is protected by its token. Blocking private ranges would break custom-source extensions that talk to a server at home; blocking only loopback is the smaller step. Deferred: either block can break extensions that use a home server or an `http://` source, so it waits for a device test.

**O-04 · Low · Passwords of other programs lie in the settings table as plain text** — `native/src/core/settings/shape.ts:60,74,87,94,141`
`vlcPassword`, `qbittorrentPassword`, `transmissionPassword`, `vcTranslateApiKey` and `hostPassword` are part of the settings JSON in the app's private SQLite file (not in backups, not in Android's backup). Reading them needs root or a debuggable build. Moving them to the secured storage, as was done for the debrid key and the Nakama password, needs a tested migration of stored data. Deferred: the move needs a migration of stored settings that is tested on a device first.

**O-05 · Low · Dependency advisories without a compatible fix** — see the npm audit section. `zod` (high, direct) validates only what the user types into the settings forms; the fix is the next major version. Deferred: the fix needs a major update of zod, planned with the next dependency round.

O-02, O-06, O-07 and O-08 are closed, see F-04 to F-07.

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
| App ↔ extension code | Elevation, tampering, disclosure | Sandbox with one door; reaches the web but no files and no secrets. Hint for `http://` links: F-04. Open: O-03 |
| App ↔ marketplace / repositories | Tampering with code in transit | HTTPS by default (official marketplace); `http://` possible, with a hint in the add and install sheets (F-04) |
| App ↔ local network (DLNA, cast share, Nakama, torrents) | Spoofed devices, disclosure of streams | Cast share behind a 256-bit token per file; DLNA answers parsed as data; cleartext by nature → O-01; hint for a Nakama host without `https://` (F-06) |
| App ↔ other apps (links, share sheet, widgets, notifications, loopback server) | Spoofed entry, intent redirection | Links only navigate; no exported services; loopback server behind a token; F-03 fixed |
| App ↔ files the user picks (backup, local library) | Tampering through a prepared file | F-01 and F-02 fixed; I-01 remains by design |
| App ↔ GitHub releases (updater) | Tampered update | Digest, size, signature and version checks |
| Device storage | Disclosure on a lost or rooted device | Secrets in the Keystore; the rest in app-private storage → O-04 |

**Lifecycle checks of the lens:** account change — signing in as another account forgets the kept lists, and waiting AniList changes carry the account they were made for (`anilist/auth.ts`, `anilist/changes.ts`). Notification and widget taps — they open a page by id; the page reads with the current account. Offline queue — bound to its account as above. Sharing out — player links and logs are cut of tokens; backups hold no secrets. Recovery — a restore writes a safety copy of the state before it.

**Proposed verification (not run):** restore a prepared file that names `seanime-mobile-app-update` on a device and confirm the updater state is unchanged; open an `http://` marketplace through a proxy that rewrites the payload to confirm the risk behind F-04 (the hint warns about it, it does not prevent it).

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

Follow-up for F-04 to F-07 on `release-4.1.0`, run in `native/`:

- `npx tsc --noEmit`: 0 errors
- `npx vitest run` on the changed modules (`src/lib/external-player-link`, `src/main/extensions`, `src/main/settings/_lib/nakama-host.test.ts`): all passed, 6 tests added
- `npx eslint` on the changed files: 0 errors

Not verified: the hints on a device.

## Account & sync (4.2.0)

Scope: the optional account server (`account-server/`, a Cloudflare Worker with D1 and R2), the account core in `native/src/core/account/`, its wiring in `native/src/lib/account/`, the native module `native/modules/core-sodium/` (libsodium and the Keystore signing key) and the account pages of the website. Reviewed on 2026-11-18 by source review plus attacks against a locally running Worker, fixed in two rounds on the branch `account-sync`, reviewed again (findings NEU-1 to NEU-12, I-11 to I-15) and fixed in a third round.

### Threat model in short

The promise: nobody but the user's own devices can read the synced data. That includes the maintainer, Cloudflare, whoever runs or tampers with the server or its database, whoever takes over the user's Google account, and whoever learns the password once. Trust boundaries:

| Boundary | Attacker | What protects |
| --- | --- | --- |
| Device and server | tampered server, D1 write access, insider | Everything is encrypted on the device (XChaCha20-Poly1305 under the DEK). A device takes a DEK only on four ways: its password wrap, its recovery wrap, an approval box (`crypto_box` from the device whose number the user confirmed on both devices; the number comes from both device keys and both random values), or a key chain from the DEK it holds, boxed by the rotating device and naming it and the removed devices. Device rows carry a MAC under the DEK, wraps and boxes are bound to their dekId, the Argon2id parameters have a floor and never go down. Devices remember removed device keys and never seal to them or take their chains. |
| Session and server | stolen token, captured request | Every request is signed with a key the device keeps (Android Keystore P-256, not exportable), with time window and one-time nonce. The token alone opens nothing. |
| Account and sign-in | phished password, taken-over Google account, mailbox takeover | A session without the DEK cannot add a device, change a wrap, overwrite or read the data or rotate. A new device needs the DEK from an old device (approval v2, both devices ask) or the recovery code. A removed device key never binds again; until the rotation no device joins by DEK proof and only devices and sessions from before the removal rotate. Mails for every new or removed device, Google link, recovery change, rotation and password change. |
| Strangers | password guessing, lockout, mail flooding | Login attempts counted per IP (IPv6 per /48), per (email, IP range) and per email before the check; known devices skip the email counters; mails anybody can trigger are capped per recipient; requests without a session pass the in-memory limiter before anything is written to D1. |
| Website | script injection, other origins | CSP per page, Trusted Types on password pages, only the own origin allowed by the server, non-extractable WebCrypto key, nothing of the account kept after sign-out. |

### Findings and status

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| K-1 | Critical | A session without the DEK could add a device and force a rotation, then read and write all synced data | Fixed: DEK proof, device MACs, key chain, sealing only to verified devices, no overwriting of foreign device rows |
| H-1 | High | The server chose the Argon2 strength; the app accepted any | Fixed: floor `m = 65536, t = 3`, ceiling, highest seen parameters kept per email (app and website) |
| H-2 | High | `account/link-google` was a lasting backdoor | Fixed: needs the password, mails, shown in app and website, "Disconnect Google", removed on password reset |
| M-1 | Medium | Approve and deny needed a sign-in within 10 minutes; deny failed silently | Fixed: a device session plus the screen lock; errors are shown |
| M-2 | Medium | Five wrong logins from anywhere locked the owner out | Fixed: email counter per (email, IP range); a device whose stored signing key signs the login is never held up by it |
| M-3 | Medium | No mail for a new device, Google link, recovery change or rotation | Fixed: mails for each, and for a removed device (round 3) |
| M-4 | Medium | Rotation after removing a device did not run | Fixed: removing in the app rotates in the same step; after a removal on the website a device from before the removal finishes it ("Finish removing a device"); the removed device can't (NEU-2) |
| M-5 | Medium | A session without the DEK could overwrite the data and the recovery wrap | Fixed: only device sessions write data, wraps only by key holders |
| N-1 | Low | Wraps and sealed keys were not bound to their dekId | Fixed |
| N-2 | Low | 10 MB read and hashed before any check | Fixed: route size limit from `Content-Length` first; large bodies only on the two upload routes, only with an existing session and well-formed signature headers, and the account's upload counter is counted before the body is read (NEU-11) |
| N-3 | Low | A reset without code made every device drop the DEK | Fixed: on 401 only the token goes; DEK and device key stay until sign-in or sign-out |
| N-4 | Low | Reset mails of another account could be blocked for an hour | Fixed: counted per (email, IP range) |
| N-5 | Low | Parallel logins could pass the limit | Fixed: counted in one statement before the check, cleared after success |
| N-6 | Low | Privacy text vs behaviour (browser key, logs) | Fixed: invocation logs and traces off, privacy page lists the browser key and the KDF memory, both deleted at sign-out; the app deletes its signing key at sign-out |
| N-7 | Low | Recovery code copied without the sensitive flag | Fixed: `EXTRA_IS_SENSITIVE`, cleared after 60 seconds |
| N-8 | Low | Signing key was a software key next to the token | Fixed: P-256 in the Android Keystore (StrongBox, else TEE); libsodium Ed25519 only on a phone without Keystore |
| I-1 | Info | `aud` array accepted without `azp` | Fixed |
| I-2 | Info | JWKS URL configurable | Fixed: another URL only for a test host |
| I-3 | Info | Google's script runs on the same origin as the browser key | Accepted: `/account/` has no password field and Google is trusted for its own sign-in anyway; a separate origin is a hosting change for later |
| I-4 | Info | No SRI on the website's modules | Accepted: all modules come from the same origin under a `script-src 'self'` CSP; SRI adds protection only for other origins |
| I-5 | Info | libsodium source hash checked only at download | Accepted: needs an attacker on the build machine, who could change the build anyway |
| I-6 | Info | JVM and JNI copies of secrets live until garbage collection | Accepted: the JavaScript copies are wiped; the runtime gives no reliable way to wipe the others |
| I-7 | Info | Cleartext traffic allowed app-wide | Accepted: the app talks to Seanime servers and Nakama hosts on the local network over http; account requests are checked at run time and go only over https in the release |
| I-8 | Info | `If-Match`, `X-Dek-Id`, `Content-Type` not signed | Accepted: only the TLS endpoint could change them; the dekId is bound into the package encryption anyway and the devices check it |
| I-9 | Info | Password rule only on the client, heuristic | Accepted: the server never sees the password and cannot enforce a rule; Argon2id with a floor slows guessing |
| I-10 | Info | Someone can register an unconfirmed account with another person's email | Accepted: the account is deleted after 7 days unconfirmed; Google sign-in of the owner is refused until then (support answer) |
| NEU-1 | High | A new or signed-in-again device took any sealed DEK; the number was not confirmed on it and not bound to the key | Fixed: approval v2 (commitment v2, number from pkN, pkO, rN, rO, `crypto_box` from the approver bound to the request; the new device takes the key only after "Yes, same number" on itself); a device that keeps a matching DEK never goes to an approval; after an approval the data is imported only after asking |
| NEU-2 | High (latent) | A removed device signed in again (Google) with its kept DEK and finished the rotation itself | Fixed: removed device keys never bind again (`removed_devices`), its sessions answer `device_removed` and the app drops the key, no new device row by DEK proof while a removal waits, only devices and sessions from before the removal rotate, only devices read the snapshot |
| NEU-3 | Medium | A removed device plus a compromised server could inject a chain, and the legitimate rotation sealed to the removed row | Fixed for every removal a device knows of: chain v2 names the rotating device (whose own key boxes the new DEK) and the removed devices; devices keep a list of removed keys (own removals, chains they took, the server's list) and refuse such chains and sealing. Limit: a removal made only on the website that a compromised server hides before any device synced cannot be known to the devices; removing in the app is authentic |
| NEU-4 | Medium | No global per-email limit; IPv6 counted per /128 | Fixed: per-email counter across networks (known devices skip it), IP counters and burst limiter per /48 |
| NEU-5 | Medium | Mail flooding and D1 writes without an account | Fixed: reset and confirmation mails capped per recipient (5 per hour, 10 per day), Google nonce stateless, sign-in challenge checked before anything is written, every route without a session passes the in-memory limiter first |
| NEU-6 | Low | A device that missed two rotations shows "someone may be trying to get in" | Accepted: the chain bridges one rotation on purpose (a longer chain would need old DEKs on the device); the text now names this case too, and signing in again brings the device back |
| NEU-7 | Low | After a start fresh elsewhere the device dropped its key silently | Fixed: the sign-in says "Your account's key changed" and imports nothing |
| NEU-8 | Low | No mail on removal; website promised an automatic rotation | Fixed: mail "A device was removed"; website and docs say to finish in the app |
| NEU-9 | Low | The DEK proof is a static bearer value until the next rotation | Accepted: it is bound to account and dekId and renewed by every rotation; the server rules of NEU-2 take away what it was used for, and a compromised server could skip the check anyway |
| NEU-10 | Low | A password change kept a linked Google sign-in | Fixed: a new password unlinks Google (mailed, shown in the app) |
| NEU-11 | Low | Any token got 10 MB read and hashed | Fixed: upload counter before the body (see N-2) |
| NEU-12 | Low | An approval could bind a session to an existing device row | Fixed: requests with a registered or removed device key are refused; every approval makes a new row; requests use a new device key; signing out removes the device's own row |
| I-11 | Info | Device name and row id are not covered by the device MAC | Accepted: the server could rename a row, but it can't add or swap a key; the app shows unverified and removed rows as such |
| I-12 | Info | `sm-kdf-seen` keeps an unsalted SHA-256 of the email in the browser | Accepted: it never leaves the browser and only maps the email to the Argon2 floor; the account page shows the email anyway |
| I-13 | Info | Privacy text on known devices and the mail list | Fixed: says which counters a known device skips and lists every account mail |
| I-14 | Info | Docs claimed more than the design gave | Fixed: docs and this audit describe approval v2, chain v2 and the limit of a website-only removal |
| I-15 | Info | Every signed request writes a nonce row | Accepted: about 300 writes per active device and day; the free plan holds a few hundred devices, Workers Paid when it grows (plan 12) |

Left as known limits: a device whose session the server ended keeps its signing key until sign-out, so signing in to another account without signing out reuses it. A server can still refuse service or hold back newer data; devices notice an older version but cannot force a newer one.

### Verification

- Server: `npm run typecheck` 0 errors, `npx vitest run` all passed, with tests for each finding (lockout attempt with the known device still getting in, an unauthenticated 10 MB body refused before it is read, parallel logins not passing the limit, reset limit per IP range).
- App core: `npx tsc --noEmit` 0 errors, the account tests including the end-to-end run against the real Worker in Miniflare (a P-256 signer like the Keystore's, lockout and kept key, sign-out makes a new key), full `npm test` passed, lint without new findings.
- Device: self-test of libsodium and the Keystore key (sign in the Keystore, verify the `r || s` form outside it), then account creation, sync, copying the recovery code and deleting the account against a local Worker.
- Round 3: server tests per finding (a removed key never binds again, a session or device from after a removal can't rotate, IPv6 /48 grouping, the per-email limit spares known devices, requests without a session write nothing to D1, mail cap per recipient, upload counted before the body); the review's attacks B1, B1b, B2, B3 and B5 as end-to-end tests with the real core (each fails: no foreign key taken, nothing imported or uploaded, a visible state) and again as scripts against `wrangler dev`; on the phone the self-test with the `crypto_box_easy` / `crypto_box_open_easy` vectors.
