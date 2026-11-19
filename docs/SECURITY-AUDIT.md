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
| M-2 | Medium | Five wrong logins from anywhere locked the owner out | Fixed: email counter per (email, IP range); a device whose stored signing key signs the login is never held up by it; round 4: over the counter across networks a right password signs in through a mailed link (NEU3-5) |
| M-3 | Medium | No mail for a new device, Google link, recovery change or rotation | Fixed: mails for each, and for a removed device (round 3) |
| M-4 | Medium | Rotation after removing a device did not run | Fixed: removing in the app is a key change that leaves the device out; after a removal on the website or a sign-out the app asks for "Change encryption key" (round 4: any device of the owner, never automatic, the user picks who keeps the key); the removed device can't (NEU-2) |
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
| NEU-1 | High | A new or signed-in-again device took any sealed DEK; the number was not confirmed on it and not bound to the key | Fixed in round 4 (round 3 was bypassed, NEU3-1): approval v2 (commitment v2, number from pkN, pkO, rN, rO, `crypto_box` from the approver bound to the request; the new device takes the key only after "Yes, same number" on itself) and one number per request: "No", a timeout or a swapped value ends it for good; a device that keeps a matching DEK never goes to an approval; after an approval the data is imported only after asking |
| NEU-2 | High (latent) | A removed device signed in again (Google) with its kept DEK and finished the rotation itself | Fixed: removed device keys never bind again (`removed_devices`), its sessions answer `device_removed` and the app drops the key, only devices read the snapshot. Round 4 replaces the "devices from before the removal" rule (it locked owners out, NEU3-2): a session without a device row joins only as the owner (password or recovery proof), so a kept DEK alone never gets a row |
| NEU-3 | Medium | A removed device plus a compromised server could inject a chain, and the legitimate rotation sealed to the removed row | Fixed for the key change (round 4): it seals only to the devices the user keeps, every other row is removed (S2). A chain is refused when its rotating device is one this device knows as removed (own removals and chains, never pushed out; the server's list apart and bounded). Limit, corrected after NEU3-8: a compromised server can keep any device that did not make the removal itself on a branch the removed device controls, as long as that device has not taken the key change that names the removal (see round 4) |
| NEU-4 | Medium | No global per-email limit; IPv6 counted per /128 | Fixed: per-email counter across networks (known devices skip it), IP counters and burst limiter per /48. Round 4: over it nobody is locked out, a right password signs in through a mailed link (NEU3-5) |
| NEU-5 | Medium | Mail flooding and D1 writes without an account | Fixed: reset and confirmation mails capped per (recipient, sender network) and 50 per day per recipient (round 4, NEU3-6), Google nonce stateless, the sign-in's IP counter before its nonce and challenge are written (NEU3-7), every route without a session passes the in-memory limiter first |
| NEU-6 | Low | A device that missed two rotations shows "someone may be trying to get in" | Accepted: the chain bridges one rotation on purpose (a longer chain would need old DEKs on the device); the text now names this case too, and signing in again brings the device back |
| NEU-7 | Low | After a start fresh elsewhere the device dropped its key silently | Fixed: the sign-in says "Your account's key changed" and imports nothing |
| NEU-8 | Low | No mail on removal; website promised an automatic rotation | Fixed: mail "A device was removed"; website and docs say to finish in the app |
| NEU-9 | Low | The DEK proof is a static bearer value until the next rotation | Fixed in round 4 (the round 3 acceptance was refuted, NEU3-4): the DEK proof alone never signs in, joins or changes the key; it only adds to a password sign-in, the recovery proof or the device's own live row |
| NEU-10 | Low | A password change kept a linked Google sign-in | Fixed: a new password unlinks Google (mailed, shown in the app) |
| NEU-11 | Low | Any token got 10 MB read and hashed | Fixed: upload counter before the body (see N-2) |
| NEU-12 | Low | An approval could bind a session to an existing device row | Fixed: requests with a registered or removed device key are refused; every approval makes a new row; requests use a new device key; signing out marks the device's row "signed out" (round 4, S4) |
| I-11 | Info | Device name and row id are not covered by the device MAC | Accepted: the server could rename a row, but it can't add or swap a key; the app shows unverified and removed rows as such |
| I-12 | Info | `sm-kdf-seen` keeps an unsalted SHA-256 of the email in the browser | Accepted: it never leaves the browser and only maps the email to the Argon2 floor; the account page shows the email anyway |
| I-13 | Info | Privacy text on known devices and the mail list | Fixed: says which counters a known device skips and lists every account mail |
| I-14 | Info | Docs claimed more than the design gave | Fixed: docs and this audit describe approval v2, chain v2 and the limit of a website-only removal |
| I-15 | Info | Every signed request writes a nonce row | Accepted: about 300 writes per active device and day; the free plan holds a few hundred devices, Workers Paid when it grows (plan 12) |

Left as known limits: a device whose session the server ended keeps its signing key until sign-out, so signing in to another account without signing out reuses it. A server can still refuse service or hold back newer data; devices notice an older version but cannot force a newer one.

### Round 4 (fix design 3, S1 to S6)

The third review (`security-review-3`) failed round 3. The fixes take rules away instead of adding exceptions: one number per approval, an allowlist for the key change, the owner (password or recovery code) as the only way back in, no lockout. The invariants are a comment at the top of `native/src/core/account/devices.ts`, each with an end-to-end test against the real Worker:

- I1 A device takes a DEK only through the password wrap, the recovery wrap, ONE approval confirmed on both devices, or a chain from the DEK it holds by a device it does not know as removed.
- I2 A device hands out the real DEK only to the device whose number its user confirmed with "Yes", or by a key change to the devices the user kept.
- I3 The password or the recovery code always allows joining, the key change and Start fresh. The DEK proof alone never does.
- I4 The owner is never locked out for good. (Broken in round 4 by the shared mail cap, NEU4-1; holds since round Polish; a stranger in the same network since NEU5-1.)
- I5 Every security change (new device, sign-out, removal, key change, recovery code, Google link, Start fresh) sends a mail and leaves an event the app and the website list. (In round 4 the website showed none and the app list could be flooded, NEU4-5; holds since round Polish.)

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| NEU3-1 | High | After "No" the new device forgot the shown number and kept polling, so the server could pick a matching second number and pass its own key or get the real one | Fixed (S1): a request shows exactly one number; "No", a timeout, a denial or a swapped value end it on both sides and nothing is taken from it again; the screen stops polling and warns "This could be an attack"; a new attempt is a new request with new keys. Three "No" within an hour pause approvals for an hour, with a mail. The old device sends its random value only after "Show number" (NEU3-10) |
| NEU3-2 | High | With no device from before a removal nobody could join, not with the password, not with the recovery code; email Start fresh failed | Fixed (S3): a session with a fresh password check or the recovery proof (a KDF of the recovery key, the server keeps its SHA-256) joins at any time and may change the key or start fresh; the removal-time rule is gone. App texts no longer send the user to "sign out and in" as a dead end |
| NEU3-3 | Medium | The removed list held 200 entries and took any server entry, so the server could push a removal out | Fixed (S2): the key change is an allowlist the user ticks (pre-ticked: verified and still signed in); own removals and chains are never pushed out; the server's list is kept apart, only well-formed keys, at most 50 per answer and 200 in all, new server entries dropped when full |
| NEU3-4 | Medium | Signing out deleted the device row without a trace | Fixed (S4): the row stays "signed out" with its date, the account asks for a key change, mail and event; a signed-out device comes back only by password, recovery code or approval |
| NEU3-5 | Medium | The global email counter locked the owner out | Fixed (S5): over the counter a right and a wrong password get the same answer (202), the right one mails a 15-minute link; after opening it the same signing key signs in once. Known devices skip the counter as before |
| NEU3-6 | Low | Strangers used up the owner's reset mails | Fixed: mail caps per (recipient, sender network), 50 per day per recipient across networks |
| NEU3-7 | Low | Two D1 writes before the IP counter | Fixed: the IP counter comes before the sign-in's nonce and challenge; a waiting sender writes nothing more |
| NEU3-8 | Low | Docs claimed more than the design gave | Fixed: NEU-1, NEU-3, M-2 and the README now say what holds; the website texts too |
| NEU3-9 | Info | `removed_devices.sig_pub` was stored but never checked | Fixed: the column is gone; nothing depends on a removed signing key any more |
| NEU3-10 | Info | The old device sent its random value when the popup appeared | Fixed: only after "Show number" |
| NEU3-11 | Info | IPv6 /48 shared by mobile customers | Accepted: per /48 is the smallest unit an attacker can't multiply; at a larger user count a Cloudflare rate-limit rule per /64 can replace it |

Accepted limits, said plainly:

- A compromised server can hold a key change back from devices that did not make it. Until such a device takes the change (whose chain names the removed devices), a removed device that still knows the old key can, together with that server, hand it a chain of its own; the device then syncs under a key the removed device knows. Without a transparency log no device can tell. What helps: change the key on every device you still use after removing one (the screen shows the devices it reaches), and the mails come from the server's mail binding, which a compromised server can skip too (end-to-end test c5 shows the part that holds). The same server can also hide a sign-out or a website removal from the device that changes the key: that device then still pre-ticks the signed-out device, and it gets the new key (review 4, d4).
- A Google-only account has no password: its Google sign-in is the owner for Start fresh (deletes the synced data, mailed), not for the data (Nick's decision 18.11.: Google without a password stays).
- Over the email's counter a stranger can make the owner open a mailed link once per sign-in from a new device or browser; devices of the account skip it. Round 4 also said 50 mails per day could be used up "from 10 or more networks": 5 networks over about 4 hours were enough, and the result was a lockout (NEU4-1). Corrected in round Polish below.
- The sign-in link is only as safe as the mailbox: who has the password and the mailbox owns the account anyway (I3). In round 4 an opened link also made the signing key that triggered it "known" for 15 minutes (NEU4-2); corrected in round Polish.

### Round Polish (after the fourth review)

The fourth review (`security-review-4`) passed: no critical or high finding, I1 to I3 held. It broke I4 and half of I5. The key protocol (I1 to I3) is unchanged in this round.

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| NEU4-1 | Medium | Reset mails and sign-in links shared one cap of 50 per recipient and day; a stranger used it up (54 resets from 18 networks) and held the email counter, so the owner's right password got "open the link" but no link, and no reset mail either (I4) | Fixed: each mail kind has its own pot (`mailAllowed(pot, ...)`). Sign-in links go out only after the right password, so a stranger can't touch that pot. A reset asked for from a network the account signed in from with its password (90 days, keyed hash in `rate_limits`) skips the reset cap across networks. Tests: server `polish.test.ts` "the sec8 attack ...", e2e "NEU4-1 / I4", sec8 d1 against `wrangler dev`. Chosen over "reset from a known device": the app has no reset screen, and the network rule needs no client change |
| NEU4-2 | Low | An opened link made the signing key that triggered it "known" for 15 minutes (no email counter, rate oracle back); the page confirmed on load | Fixed: the link counts only for the same signing key with the right password, once; a wrong guess from that key still counts and gets 202. The confirm page sends nothing until "Yes, confirm this sign-in" is pressed. Binding to the right password does what a stored attempt hash would, without a new column |
| NEU4-3 | Low | A linked Google sign-in could delete a password account | Fixed: same rule as Start fresh. A password account goes only with the password: typed again (website, checked and counted like a sign-in) or a password sign-in within 10 minutes (the app signs in again first) |
| NEU4-4 | Low | Any session without the key could pause approvals with three own "No" and fill the account's request quota | Fixed: only a "No" from a device with its own row counts; open requests (3) and new ones per hour (5) count per session |
| NEU4-5 | Low | The website showed no security events; the app showed 6 and a member device could push others out; the R2 failure path of a key change removed devices without mail or event | Fixed: `GET /account` returns the newest 20 plus the newest of each kind; the app shows all of them, the website lists them (text only); the R2 failure path mails and records each removed device |
| NEU4-6 | Low | Docs claimed "never locked out", "a guesser learns nothing", "shown on your account page", "from 10 or more networks"; limit c5 missed the hidden sign-out | Fixed: this audit, the server README, the I4/I5 comment in `devices.ts` and the website's privacy text say what holds now; c5 names the hidden sign-out |
| NEU4-7 | Info | More than 50 rows to leave out make the app's key change fail | Open (Info): remove signed-out rows on the website one by one |
| NEU4-8 | Info | Device names land in security mails as they are | Open (Info): HTML is escaped |
| NEU4-9 | Info | Every normal sign-out mails "Change encryption key"; the confirm page allowed `wasm-unsafe-eval` | CSP fixed (the confirm page no longer allows it); the sign-out mail stays (a trace is the point of S4) |

Earlier findings that were partly fixed in round 4: N-4, NEU3-5 and NEU3-6 are done with NEU4-1 (mail pots, known networks, the sec8 attack fails), NEU3-8 is done with NEU4-6.

Still accepted, said plainly: someone who floods the reset pot daily can delay a reset asked for from a network the account never signed in from with its password. The owner who knows the password signs in through the link (its own pot); the owner at home or on a network he used before gets the reset mail.

### Round NEU5 (after the fifth review)

The fifth review passed the Polish round (no Critical, High or Medium) and found two Low and two Info items.

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| NEU5-1 | Low | A stranger in the owner's /24 (public Wi-Fi, carrier NAT) used up the reset pot of the owner's known network (10 a day per (email, /24)) and the request limit (3 an hour per (email, /24)); the owner's reset from home sent nothing (I4) | Fixed: from a known network the reset pot counts per address (IPv4 address, IPv6 /48: 5 an hour, 10 a day), and the whole network is capped at 50 a day per recipient instead of the cap across networks, so a mailbox flood is no bigger than before. The request limit (3 an hour) is per (email, address) everywhere; mails from unknown networks keep their pot per /24. Tests: server `neu5.test.ts` (18 resets from two other addresses of the home /24, then the owner's mail; 54 resets from 6 addresses: 50 mails), sec9 e1 against `wrangler dev`: owner mails 1. Still accepted: a stranger behind the same public address (the same Wi-Fi) or with 5 or more addresses in the owner's /24 can still delay the owner's reset for a day; the owner who knows the password is not affected |
| NEU5-2 | Low | Website "Delete account" and "Disconnect Google" answered 429 while a stranger held the email's counter, though the owner had just signed in with the password | Fixed: `requirePassword` treats a password sign-in within the last 10 minutes like a device of the account (only the IP counter applies, a wrong password is still refused and counted per IP); an older password sign-in gets `403 reauth_required` instead of 429, and the website shows "Sign in again" for both actions. A session without a password check (Google) still gets 429. Tests: `neu5.test.ts`, sec9 e1: `DELETE with authKey: 204` |
| NEU5-3 | Info | The approval quota per session (NEU4-4) lets a keyless session open many requests through new sessions | Accepted: the cap sits in the approval code (`approval.ts`), which this round leaves untouched; more noise on the owner's devices, no key at risk (I1, I2), and three "No" from a device still pause approvals |
| NEU5-4 | Info | Older events of the same kind fell out of the list (only the newest of each kind was kept beside the newest 20) | Fixed: `GET /account` returns the newest 20 plus the newest 3 of each kind. Test: `neu5.test.ts` (two sign-outs, then 21 key changes: both listed) |

### Round sync data (state and data-loss fixes, no change to the key protocol)

Found by a code review of the sync core, not on a device. I1 to I5, the approval, the key chain and the request signatures are unchanged.

| Finding | Severity | Status |
|---|---|---|
| The changes waiting for AniList travelled in the package: a second device could send the same change again or an older progress | High | Fixed: they stay on the device that made them (`package.ts` `DEVICE_TABLES`), are never put into a package and never taken from one, also not from an older build's. The file backup still carries them |
| A merge kept everything the device had ("local always wins"), so a change from one device was undone by the next device that merged; deleted playlists and uninstalled extensions came back | High | Fixed: per part (table row, preference, extension file, secret) the newer change wins, a removal is a tombstone (`package.ts` `mergePackages`). Each device keeps the change times in a ledger. Packages without times are still read. (This row first claimed that no hash of a password lies in the app's store; that held only for the secured storage's own values and is corrected in the next round, F5) |
| "Delete synced data" set the server's version to 0; every other device then refused it as a rollback for good | High | Fixed: the server counts the version on and keeps it with size 0 (`routes.ts` `deleteSync`). A device that meets a version without data takes nothing and uploads its own. The rollback check itself is unchanged: a version below the highest one seen is refused, with or without data |
| A connection that dropped between "session made" and "device registered" left an email user signed in without the key, where Start fresh is offered | Medium | Fixed: the sign-in is taken back (`flows.ts` `startSession`), signing in again works. A removed device stays as it was (NEU-2) |
| Preferences written by a sync stayed invisible until the atom was mounted again | Medium | Fixed: `lib/storage.ts` `writeStoredValues` |
| A sync still running wrote its state back after a sign-out cleared it | Low | Fixed: sign-out, a removed device's clean-up and deleting the account run through the sync queue (`SyncEngine.exclusive`) |
| After the server ended a session (password change elsewhere, account deleted) the key, the sync state and the device keys stay | Low | Not changed, on purpose: this is N-3. A reset without the recovery code ends every session, and the key each device kept is then the only way to the data; the device cannot tell that 401 from the one after an account deletion. Removing the key here would lose the data in exactly that case |

Accepted limits: a change counts from the moment the device notices it (its next sync) unless the row carries its own time, and the order across devices follows their clocks; a device whose clock runs ahead wins conflicts until the others pass it. The local lists of an account without AniList are taken as a whole (the newer list of each kind), not entry by entry.

### Round sync data 2 (after the independent check of that round)

The check found that the round above had left one blind path: a device that had changed nothing since its last sync took a newer package as it was ("replace"), without a backup. Together with "a version without data: upload your own" that let a package from a device that never held the account's data empty every other device. I1 to I5, the approval, the key chain, the request signatures and the allowlist are unchanged; the server is unchanged.

| Finding | Severity | Status |
|---|---|---|
| F1: after "Delete synced data" (on the website: for good) a freshly signed-in device synced first and uploaded its own state; every device that had changed nothing replaced its data with it. Playlists gone on all devices | High | Fixed: a downloaded package is never taken as it is. It always goes through the merge by change times (`sync.ts` `run`, `package.ts` `mergePackages`), also on a device that changed nothing; a part the package does not know (no part, no removal) stays and goes up with the next version. Only the import the user asks for replaces the device's state, after a local backup. Tests: `sync.test.ts` F1, end to end `server.e2e.test.ts` F1 |
| F1b: a compromised server told only a fresh device "no data" (`size 0`), got a validly sealed package for version n+1 from it and emptied the unchanged devices with it. Not possible before the round above | High | Fixed, by the same merge and by how such a device joins (`LocalData.startOver`, `package.ts` `joiningLedger`): a device that signs in and does not import forgets the change times it kept, all it holds counts as older than anything in the account, and it names no removal. Its package can add a part to the other devices and never replaces or removes one of theirs, whichever device the server lets merge first. Its own state goes into the local backup before, as before an import. Tests: `sync.test.ts` F1b (two), "a device that signs in again starts over", end to end `server.e2e.test.ts` F1b |
| F2: a secret removed on one device (AniList token) came back there when another device merged and the first one then replaced | Medium | Fixed: no replace path is left, and a secret that two devices hold differently (removed here, kept there) is no reason to upload for either (`mergePackages` `ahead`), so they do not send it back and forth. A secret set again later is a newer change and reaches every device. Test: `sync.test.ts` F2 |
| F3: a package without change times (a pre-release build of 4.2.0) overwrote a newer change in the replace path | Low | Fixed with F1: its rows count by their own time, the rest as oldest, in every path. Test: `sync.test.ts` F3 |
| F4: a device in "key-untrusted" with a live session gave its password again, registering failed, and it was left signed in without the key (where Start fresh is offered) | Low | Fixed: a failed sign-in is taken back as a whole, with the key and the sync state it dropped (`flows.ts` `startSession` `undo`); the device stays "key-untrusted". Test: `server.e2e.test.ts` F4 |
| F5: the ledger held cyrb53 hashes of preferences with secret names or fields and of the rows of `settings`, `extensionConfigs` and `torrentKept` in the app's store, although the row above said no hash of a password lies there | Info | Fixed: the ledger entries of every part that may hold a password, key or token (`package.ts` `mayHoldSecret`: the secured storage's values, every row of the three tables with secret columns, every preference the file backup would strip or drop) live in the secured storage; the app's store keeps the rest. The first sync of a build with this fix rewrites both parts. The values themselves lie where they lay before (settings in the core database, preferences in the app's store). Test: `sync.test.ts` F5 |
| F6: sign-out and "Delete account" waited for a running sync, and no request had a time limit | Info | Fixed: every request to the account server fails like a dropped connection after 30 s (the package itself 120 s, the sign-out's own call 5 s; `client.ts`). Sign-out, a removed device's clean-up and deleting the account wait at most 5 s for a running sync and then give it up (`SyncEngine.exclusive`): from then on that sync, and every sync asked for before, can read or write neither the account's state nor the device's data (`SyncEngine.parts`). Tests: `sync.test.ts` F6, `client.test.ts` |

What the server can still do to the data by lying or leaving out (it could before, too): keep devices from syncing (wrong version, no answer, a package withheld), and pick which device merges first. The order decides only an exact tie between two devices that both hold an account's part with the same change time and different content: the device that merges keeps its own and the other takes it over. It cannot roll back (AAD and highest version), cannot make a device drop a part without a removal one of the user's devices made, and cannot make an established device give way to a device that joined without importing.

Accepted limits of this round: a device that joins without importing (the account is empty, or the server says so) keeps the parts the account lacks and gives way wherever the account holds the same part, also to a removal; its state before is in the local backup ("Undo last restore"). A package from a build without change times no longer removes anything on a device that holds more (only pre-release builds made such packages).

Found by the second independent check (N2) and fixed: a merge cut short between writing the parts and writing their ledger (app killed during the "leave" sync, an error) made the device stamp the taken parts as its own change of now at the next sync, so an older extension file, preference or secret could undo a newer change on every device; now the package's change times lie in the secured storage (part names and times only, no value or hash) from before the first write until the ledger has them, and a sync that finds them counts what differs from the ledger as brought by that package, never as a change of the device (`sync.ts` `coreLocalData`, `package.ts` `stampChanges`; test: `sync.test.ts` N2, cut at every write).

Found in the device test and fixed: two devices that changed different fields of one row (a switch each on the same settings page) lost the older change, because the whole row was one part; now each field of a settings section, of the look, of an extension's config and of the listed object and map preferences is a part with its own change time (the entries of the tables with secret columns stay in the secured storage, ledgers and packages of the row-wide form are still read), and the app's language is no longer synced, only kept in the file backup (`package.ts` `FIELD_COLUMNS`, `FIELD_PREFERENCES`, `app-backup-keys.ts` `isSyncDeviceKey`; tests: `sync.test.ts` C1 and C3, `package.test.ts` C1, end to end `server.e2e.test.ts` C1).
Found in the check of that fix (B1) and fixed: the extension config row the app makes empty on first use (`values: null`, `manage.ts` `savedUserConfig`) was newer than another device's saved config and so removed it on every device; now a row whose field column is null removes no fields and gives way to the other device's row that holds some, whatever their times, and only fields a device removed count as removals; settings sections, the look and the object and map preferences made empty on first use keep the other device's fields as before (`package.ts` `isEmptyRow`; tests: `sync.test.ts` C1 "B1").

### Verification

- Server: `npm run typecheck` 0 errors, `npx vitest run` all passed, with tests for each finding (lockout attempt with the known device still getting in, an unauthenticated 10 MB body refused before it is read, parallel logins not passing the limit, reset limit per IP range).
- App core: `npx tsc --noEmit` 0 errors, the account tests including the end-to-end run against the real Worker in Miniflare (a P-256 signer like the Keystore's, lockout and kept key, sign-out makes a new key), full `npm test` passed, lint without new findings.
- Device: self-test of libsodium and the Keystore key (sign in the Keystore, verify the `r || s` form outside it), then account creation, sync, copying the recovery code and deleting the account against a local Worker.
- Round 3: server tests per finding (a removed key never binds again, a session or device from after a removal can't rotate, IPv6 /48 grouping, the per-email limit spares known devices, requests without a session write nothing to D1, mail cap per recipient, upload counted before the body); the review's attacks B1, B1b, B2, B3 and B5 as end-to-end tests with the real core (each fails: no foreign key taken, nothing imported or uploaded, a visible state) and again as scripts against `wrangler dev`; on the phone the self-test with the `crypto_box_easy` / `crypto_box_open_easy` vectors.
