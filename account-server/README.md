# seanime-account

Account and sync server for Seanime Mobile, a Cloudflare Worker (`seanime-account`).

The server is an encrypted mailbox. Devices encrypt everything before upload. The server never gets plaintext, a password or the data key (DEK). For email login it stores only `HMAC-SHA256(pepper, authKey)`, where `authKey` is derived on the device from the password with Argon2id, and compares it in constant time.

The server is not trusted with keys either. It cannot add a device that the devices accept, hand out a key they accept, or lower the Argon2 parameters: devices check all of that themselves (see "Key trust" below). What the server can still do is refuse service or hand out stale data, which the devices notice.

Storage: D1 (`DB`) for accounts, sessions, devices and wrapped keys; R2 (`SNAPSHOTS`) for one encrypted blob per account at `snap/<userId>`.

## API (`/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `auth/prelogin` | Salt + KDF parameters and a one-time sign-in `challenge`. Unknown emails get a stable decoy salt with the same response shape. |
| POST | `auth/signup` | With key wraps (app) or without (website). Needs `challenge` + `sigKey`, signed. |
| POST | `auth/login` | Needs `challenge` + `sigKey`, signed. Any credential failure answers `Wrong email or password`. |
| POST | `auth/login/confirm` | `{token}` from the "Confirm your sign-in" mail (S5). Marks that sign-in confirmed; the same signing key then signs in once like a known device (15 min). |
| POST | `auth/logout` | A device session: its sessions end, its row stays marked `signedOutAt`, the account is asked for a key change, mail and event (S4). |
| POST | `auth/verify` | `{token}` from the confirmation mail. One-time, 7 days. |
| POST | `auth/verify/resend` | Signed in. 3 per hour. |
| POST | `auth/reset-request` | `{email}`. Same answer for unknown emails. 3 per hour per email and IP range. Token and mail run after the answer (`waitUntil`), so both answers take the same time. |
| POST | `auth/reset/info` | `{token}`. `userId` (part of the wrap AAD), recovery wrap and dekId so the device can unwrap with the recovery code. Never the password wrap. Does not use up the token. |
| POST | `auth/reset` | `{token, salt, kdf, authKey, keys?}`. One-time, 30 min. With `keys` (recovery code, plus `dekProof`): new password and recovery wraps. Without: password wrap dropped, `rewrapNeeded`. Signs out every session and removes a linked Google account. Mail. |
| POST | `auth/google/nonce` | One-time nonce, 5 min, and a `challenge` bound to it. |
| POST | `auth/google` | `{idToken, nonce, challenge, sigKey}`, signed. RS256 against Google's JWKS (cached per `Cache-Control`), `iss`, `aud`, `exp`/`iat`, nonce, `email_verified`. An existing password account with the same email is never linked automatically (409 `account_exists`). |
| GET | `devices` | Each device with its `devicePub`, the `dekId` of its sealed key and `signedOutAt`, so the user can pick who keeps a new key. |
| DELETE | `devices/:id` | The website's removal. Sign-in within the last 10 min required. Ends that device's sessions (they answer 401 `device_removed` from then on), puts its device key on the account's removed list (it never binds again), sets `rotationRequired`, mail and event. |
| POST/GET | `devices/requests` | New device creates an approval request `{deviceName, devicePub, commitment}` (a device key that is registered or removed is refused); approved devices list open ones. |
| GET | `devices/requests/:id` | State; the requesting session also gets `sealedDek`, `dekId`, `deviceId` once approved. |
| POST | `devices/requests/:id/nonce` | Old device sends `{nonce: rO, approverPub}`; `approverPub` must be its own row's device key. |
| POST | `devices/requests/:id/reveal` | New device reveals `rN`; the server checks the commitment v2. |
| POST | `devices/requests/:id/approve` | `{dekId, sealedDek, mac}`, only by the device that sent `rO` (a device session; the app asks for the screen lock first, no recent sign-in needed). `sealedDek` is a `crypto_box` from the approver's key, `mac` the approver's device MAC for the new row, which is always a new row. Mail to the account. `.../deny` works from any device and from the requesting session. |
| POST | `devices/requests/:id/deny` | Any device session. Blocks the request at once. |
| GET | `account` | Email, confirmed, Google linked, has password/recovery, dekId, created, and the flags `rewrapNeeded`, `rotationRequired`, `recoveryRenewalNeeded`. Never a key or hash. |
| PUT | `account/keys` | `{dekId, dekProof?, wrappedDek?, recoveryWrappedDek?, recoveryProof?, device?}`, sign-in within 10 min. The first DEK of an account needs `device` and `dekProof`. After that a session bound to a device row may write; a session without one needs the DEK proof AND the owner (S3): a password sign-in, the `recoveryProof` (its SHA-256 is stored with every new recovery wrap), or its own live row (same device key, same signing key, not signed out). The DEK proof alone never adds a row. Another session's row is never overwritten. Mail and event for a new device and for a new recovery wrap. |
| GET | `account/keys/device` | `{deviceId, dekId, sealedDek, chainFrom, chainMac, rotatorPub, removed}` of the session's device. After another device rotated, this device picks up its new key here and takes it only if the box opens with `rotatorPub`, that device is not on its removed list and `chainMac` (chain v2) checks out. |
| POST | `account/start-fresh` | `{dekId, dekProof, wrappedDek?, recoveryWrappedDek?, device}`. Sign-in within 10 min. One transaction: snapshot, every device, open approvals and all other sessions go; the new dekId, its wraps and this device are set. Then the R2 blob is deleted and a warning mail goes out. |
| POST | `account/password` | Sign-in within the last 10 min and the DEK proof required. Signs out other sessions. Mail. |
| POST | `account/rotate` | "Change encryption key", `multipart/form-data` with parts `meta` (JSON: `oldDekId`, `dekId`, `dekProof`, `chainMac`, `devices[{deviceId, sealedDek, mac}]`, `removed`, optional wraps and `recoveryProof`) and `snapshot`, `If-Match` required. Any device session, sign-in within 10 min. S2: `devices` is an allowlist, the rows the user kept (live, the rotating device among them); every other row is removed in the same transaction and must be named in `removed`, which the chain carries. Afterwards wraps of the old dekId are refused. Without a new recovery wrap the old one and its proof are dropped and `recoveryRenewalNeeded` is set. If writing R2 fails, the key rows are put back (left-out devices stay removed). Mail and event per removed device and for the key change. |
| POST | `account/link-google` | `{idToken, nonce, authKey}`. The password again (counted like a login). Mail. |
| POST | `account/unlink-google` | `{authKey}`. "Disconnect Google" for password accounts, the password again. Mail. |
| DELETE | `account` | Sign-in within the last 10 min required. Removes D1 rows and the R2 blob at once. |
| GET | `sync/meta` | Also `rotationRequired`, `rewrapNeeded`, `recoveryRenewalNeeded` and `removedDevices` (device keys removed from the account; the devices remember them). `GET sync/snapshot` needs a device session. |
| GET/PUT | `sync/snapshot` | PUT only from a device session, needs `If-Match: <version>`, `X-Dek-Id` and `Content-Length`, body `application/octet-stream`, max 10 MB. |
| DELETE | `sync` | |

Sessions: 256-bit random token, only its SHA-256 is stored, 90 days idle timeout. The app sends `Authorization: Bearer <token>`. Requests from `https://seanimemobile.com` get the `__Host-sid` cookie instead. Every other `Origin` is rejected.

### Signed requests (plan 10.2b, `src/signature.ts`)

Every session is bound to a signing key whose private half never leaves the device: the app uses an ECDSA P-256 key made inside the Android Keystore (StrongBox when the phone has one, else the TEE; not exportable; `native/modules/core-sodium`), and only on a phone without Keystore Ed25519 from libsodium in expo-secure-store. The website uses a non-extractable WebCrypto key in IndexedDB (Ed25519 when the browser has it, otherwise ECDSA P-256 with SHA-256). The app keeps its key across sign-ins of the account and deletes it when the user signs out; the website deletes its key at sign-out too. The session row stores `sig_alg` (`ed25519` or `p256`) and `sig_pub` (raw public key, base64url: 32 bytes, or the 65-byte uncompressed P-256 point). The token alone is not enough for any endpoint.

Every request with a session carries three headers:

| Header | Value |
| --- | --- |
| `X-SM-Sig` | base64url signature, 64 bytes (Ed25519, or ECDSA P-256 as `r \|\| s`, 32 bytes each; the phone unpacks the Keystore's DER signature into this form) |
| `X-SM-Ts` | unix time in milliseconds, 13 digits |
| `X-SM-Nonce` | 16 random bytes, base64url (22 characters) |

The signature covers the UTF-8 bytes of

```
v1\n{METHOD}\n{path+query}\n{hex SHA-256 of the raw body}\n{X-SM-Ts}\n{X-SM-Nonce}\n{session id}
```

`path+query` as sent (`/v1/sync/snapshot`), the body hash over the exact bytes (an empty body hashes the empty string). The session id is `base64url(SHA-256(token))` when the token goes as Bearer (the app), and `-` for the website's HttpOnly cookie (the page cannot read it) and for sign-ins. The server checks the signature against the session's key, the time within 5 minutes of its clock and the nonce (once ever; table `used_nonces`, cleaned by the daily cron). Missing or wrong: `401 unauthorized`, the same answer for every cause.

Sign-in: `auth/prelogin` answers a one-time `challenge` (36 bytes base64url: time, random, HMAC bound to the email; unknown emails get one made the same way). `auth/google/nonce` answers one bound to the nonce. `auth/login`, `auth/signup` and `auth/google` must carry `challenge` and the new key `sigKey: {alg, pub}` in the body and be signed with that key (session id `-`). A challenge works for 5 minutes and once, so a captured sign-in cannot be sent again. The new session is bound to `sigKey`.

Order of checks (N-2): the route's size limit comes first, from `Content-Length`, before a byte is read: 16 KB on every route except `PUT sync/snapshot` (10 MB) and `POST account/rotate` (10 MB plus meta). On those two the session must exist, the signature headers must have the right form and the account's upload counter (30 per hour) is counted before the body is read. Then the body is read once, hashed and the signature checked.

### Key trust (`native/src/core/account`)

- `dekProof` = `KDF(DEK, 2, "sm-dkey")`; the server stores its SHA-256. Only a session that shows it, or one bound to a device row, can change wraps, add a device or start over.
- Every device row carries `mac`, a keyed BLAKE2b under a key derived from the DEK over `userId || dekId || devicePub`. Devices list and seal only to rows whose MAC checks out and show the others as unverified.
- Wraps and boxed keys carry their `dekId` in the AAD or the boxed plaintext, so an old key cannot be served under a new id. Keys go from device to device only as `crypto_box` (the receiver checks the sender's key), never as an anonymous sealed box.
- Key chain v2: a rotation stores `chainFrom` (the old dekId), the rotating device's key and the removed device keys, and `chainMac` (the old DEK's MAC over all of them and the new DEK). A device takes a new key from `account/keys/device` only with a matching chain, a box from that device and a rotating device it does not know as removed.
- Approval v2: `commitment = SHA-256("sm-commit-v2\n" || pkN || rN)`, number = 6 digits of `SHA-256("sm-approve-v2\n" || pkN || pkO || rN || rO)`; both devices ask whether the other one shows the same number before they approve or take the key. One number per request: "No", a timeout or a swapped value end it for good (S1).
- Key change (S2): only the devices the user keeps get the new DEK; the server removes every other row in the same step. The app never changes the key on its own.
- Owner (S3): `recoveryProof` = `KDF(recoveryKey, 1, "sm-rcvr")`, the server keeps its SHA-256. A password sign-in or this proof lets a device join; the DEK proof alone never does. Invariants I1 to I5: `docs/SECURITY-AUDIT.md`, round 4.
- KDF floor: the app and the website refuse Argon2id below `m = 65536, t = 3` and below what they saw for the email before.

Device approval (plan 6.4): request -> `rO` from an old device -> `rN` revealed by the new device -> approve/deny. Out-of-order steps answer 409, a wrong commitment ends the request (422). Requests expire after 10 min; at most 3 open and 5 new per hour per session, so one sign-in can't use up the owner's (NEU4-4). Byte format: `commitment = SHA-256("sm-commit-v2\n" || devicePub[32] || rN[32])`, all values base64url without padding (see `src/approval.ts`).

Mail goes through the Cloudflare Email Service binding `EMAIL` from `no-reply@seanimemobile.com`: confirm email, password reset, new device, removed device, password changed (a linked Google sign-in is removed with it), start fresh, account deleted, Google linked, Google disconnected, recovery code changed, key rotated, inactivity warning. Links carry the token in the URL fragment. In tests the binding is replaced by `test/mail-sink.js`, which records mails.

Rate limits:

- Login (and the password asked again for Google link/unlink): first 20 per IP (IPv6 per /48), counted before the sign-in's nonce and challenge are written; then 5 attempts per (email, IP range), with a growing wait (30 s doubling up to 15 min) that only holds up that network. IP range = IPv4 /24, IPv6 /48. Every attempt is counted in one statement before the password is checked (`INSERT ... ON CONFLICT DO UPDATE ... WHERE <not waiting> RETURNING`), so parallel attempts cannot pass the limit.
- Across all networks 20 per email within 15 min: over that nobody waits; a right and a wrong password get the same `202 {confirm: "email"}`, and only the right one mails a sign-in link (S5). After the owner pressed the button on the link's page, the same signing key with the right password signs in once within 15 minutes; a wrong password from that key still counts and gets 202 (NEU4-2). Under the counter a guesser gets real 401s per network, over it the same 202 for every answer.
- A known device skips the email counters: when the login is signed with the key stored on one of the account's live device rows (not signed out), only the IP counter applies.
- Signup 5 per hour per IP; upload 30 per hour per account; reset 3 per hour per (email, IP range); verification resend 3 per hour per account; device approvals 5 per hour per session, paused for an hour after three "No" from devices of the account (mail; a session without the key never counts). Reset, confirmation and sign-in link mails at most 5 per hour and 10 per day per (recipient, sender network), and 50 per day per recipient across networks, each kind in its own pot (NEU4-1): only the right password fills the sign-in link pot, and a reset from a network the account signed in from with its password (kept 90 days as a keyed hash) skips the cap across networks.
- Short bursts per IP (IPv6 per /48) go through the Workers Rate Limiting bindings, in memory, before any route without a session writes to D1. The Google nonce is stateless and the sign-in challenge is checked before its use is written. Counter keys are HMACs, no raw IP or email is stored.

Logs (`wrangler.jsonc` `observability`): invocation logs and traces are off, query strings are redacted. The Worker writes one line for an unexpected error (route and error type) and one for a failed mail (kind and code), never a body, token, email or IP. Cloudflare keeps these lines for a few days.

A daily cron removes expired tokens, device requests, nonces, counters and idle sessions, and deletes accounts that are still unconfirmed after 7 days (checked again inside the delete transaction). After 180 days without activity it sends a warning; an account still unused 14 days after the warning is deleted (D1 and R2) with a mail.

## Local commands

```sh
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest with local D1/R2 (Workers runtime)
npm run types         # regenerate worker-configuration.d.ts after changing wrangler.jsonc
cp .dev.vars.example .dev.vars && npm run migrate:local && npm run dev
```

The test run prints a warning about missing secrets; the test config injects fixed test values.

## Secrets

Set with `wrangler secret put`, never committed:

- `PEPPER_V1`: HMAC pepper for stored auth hashes
- `ENUM_SECRET`: key for decoy salts and rate-limit counter keys
- `GOOGLE_WEB_CLIENT_ID`: Google OAuth web client ID, the expected `aud` of ID tokens

Vars in `wrangler.jsonc`: `ALLOWED_ORIGIN`, `WEB_BASE_URL` (links in mails), `GOOGLE_JWKS_URL` (Google's key set; another URL is taken only for a test host, `*.test` or localhost). ID tokens with several audiences need `azp` naming the client. Binding `EMAIL` (`send_email`, sender restricted to `no-reply@seanimemobile.com`); the domain must be onboarded to Email Sending before the first deploy.

The D1 `database_id` and rate-limit `namespace_id` values in `wrangler.jsonc` are placeholders.
