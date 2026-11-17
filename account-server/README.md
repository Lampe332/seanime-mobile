# seanime-account

Account and sync server for Seanime Mobile, a Cloudflare Worker (`seanime-account`).

The server is an encrypted mailbox. Devices encrypt everything before upload. The server never gets plaintext, a password or the data key (DEK). For email login it stores only `HMAC-SHA256(pepper, authKey)`, where `authKey` is derived on the device from the password with Argon2id, and compares it in constant time.

Storage: D1 (`DB`) for accounts, sessions, devices and wrapped keys; R2 (`SNAPSHOTS`) for one encrypted blob per account at `snap/<userId>`.

## API (`/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `auth/prelogin` | Salt + KDF parameters and a one-time sign-in `challenge`. Unknown emails get a stable decoy salt with the same response shape. |
| POST | `auth/signup` | With key wraps (app) or without (website). Needs `challenge` + `sigKey`, signed. |
| POST | `auth/login` | Needs `challenge` + `sigKey`, signed. Any credential failure answers `Wrong email or password`. |
| POST | `auth/logout` | |
| POST | `auth/verify` | `{token}` from the confirmation mail. One-time, 7 days. |
| POST | `auth/verify/resend` | Signed in. 3 per hour. |
| POST | `auth/reset-request` | `{email}`. Same answer for unknown emails. 3 per hour per email. Token and mail run after the answer (`waitUntil`), so both answers take the same time. |
| POST | `auth/reset/info` | `{token}`. `userId` (part of the wrap AAD), recovery wrap and dekId so the device can unwrap with the recovery code. Never the password wrap. Does not use up the token. |
| POST | `auth/reset` | `{token, salt, kdf, authKey, keys?}`. One-time, 30 min. With `keys` (recovery code): new password and recovery wraps. Without: password wrap dropped, `rewrapNeeded`. Signs out every session. |
| POST | `auth/google/nonce` | One-time nonce, 5 min, and a `challenge` bound to it. |
| POST | `auth/google` | `{idToken, nonce, challenge, sigKey}`, signed. RS256 against Google's JWKS (cached per `Cache-Control`), `iss`, `aud`, `exp`/`iat`, nonce, `email_verified`. An existing password account with the same email is never linked automatically (409 `account_exists`). |
| GET | `devices` | Each device with its `devicePub` and the `dekId` of its sealed key, so a rotation can seal to all of them. |
| DELETE | `devices/:id` | Sign-in within the last 10 min required. Sets `rotationRequired`. |
| POST/GET | `devices/requests` | New device creates an approval request `{deviceName, devicePub, commitment}`; approved devices list open ones. |
| GET | `devices/requests/:id` | State; the requesting session also gets `sealedDek`, `dekId`, `deviceId` once approved. |
| POST | `devices/requests/:id/nonce` | Old device sends `rO`. |
| POST | `devices/requests/:id/reveal` | New device reveals `rN`; the server checks `SHA-256(devicePub \|\| rN) == commitment`. |
| POST | `devices/requests/:id/approve` | `{dekId, sealedDek}`, only by the device that sent `rO`, sign-in within 10 min. Mail to the account. |
| POST | `devices/requests/:id/deny` | Blocks the request at once. |
| GET | `account` | Email, confirmed, Google linked, has password/recovery, dekId, created, and the flags `rewrapNeeded`, `rotationRequired`, `recoveryRenewalNeeded`. Never a key or hash. |
| PUT | `account/keys` | First DEK, password/recovery wraps, this device's sealed DEK. |
| GET | `account/keys/device` | `{deviceId, dekId, sealedDek}` of the session's device. After another device rotated, this device picks up its new key here. |
| POST | `account/start-fresh` | `{dekId, wrappedDek?, recoveryWrappedDek?, device}`. Sign-in within 10 min. One transaction: snapshot, every device, open approvals and all other sessions go; the new dekId, its wraps and this device are set. Then the R2 blob is deleted and a warning mail goes out. |
| POST | `account/password` | Sign-in within the last 10 min required. Signs out other sessions. Mail. |
| POST | `account/rotate` | DEK rotation, `multipart/form-data` with parts `meta` (JSON) and `snapshot`, `If-Match` required. Device session, sign-in within 10 min. Afterwards wraps of the old dekId are refused. Without a new recovery wrap the old one is dropped and `recoveryRenewalNeeded` is set until a new code is saved. If writing R2 fails, D1 is put back. |
| POST | `account/link-google` | `{idToken, nonce}`. Sign-in within the last 10 min required. |
| DELETE | `account` | Sign-in within the last 10 min required. Removes D1 rows and the R2 blob at once. |
| GET | `sync/meta` | Also `rotationRequired`, `rewrapNeeded` and `recoveryRenewalNeeded`. |
| GET/PUT | `sync/snapshot` | PUT needs `If-Match: <version>` and `X-Dek-Id`, body `application/octet-stream`, max 10 MB. |
| DELETE | `sync` | |

Sessions: 256-bit random token, only its SHA-256 is stored, 90 days idle timeout. The app sends `Authorization: Bearer <token>`. Requests from `https://seanimemobile.com` get the `__Host-sid` cookie instead. Every other `Origin` is rejected.

### Signed requests (plan 10.2b, `src/signature.ts`)

Every session is bound to a signing key whose private half never leaves the device: the app uses Ed25519 from libsodium (`crypto_sign_detached`, private key in the Android Keystore through expo-secure-store), the website a non-extractable WebCrypto key in IndexedDB (Ed25519 when the browser has it, otherwise ECDSA P-256 with SHA-256). The session row stores `sig_alg` (`ed25519` or `p256`) and `sig_pub` (raw public key, base64url: 32 bytes, or the 65-byte uncompressed P-256 point). The token alone is not enough for any endpoint.

Every request with a session carries three headers:

| Header | Value |
| --- | --- |
| `X-SM-Sig` | base64url signature, 64 bytes (Ed25519, or ECDSA P-256 as `r \|\| s`) |
| `X-SM-Ts` | unix time in milliseconds, 13 digits |
| `X-SM-Nonce` | 16 random bytes, base64url (22 characters) |

The signature covers the UTF-8 bytes of

```
v1\n{METHOD}\n{path+query}\n{hex SHA-256 of the raw body}\n{X-SM-Ts}\n{X-SM-Nonce}\n{session id}
```

`path+query` as sent (`/v1/sync/snapshot`), the body hash over the exact bytes (an empty body hashes the empty string). The session id is `base64url(SHA-256(token))` when the token goes as Bearer (the app), and `-` for the website's HttpOnly cookie (the page cannot read it) and for sign-ins. The server checks the signature against the session's key, the time within 5 minutes of its clock and the nonce (once ever; table `used_nonces`, cleaned by the daily cron). Missing or wrong: `401 unauthorized`, the same answer for every cause.

Sign-in: `auth/prelogin` answers a one-time `challenge` (36 bytes base64url: time, random, HMAC bound to the email; unknown emails get one made the same way). `auth/google/nonce` answers one bound to the nonce. `auth/login`, `auth/signup` and `auth/google` must carry `challenge` and the new key `sigKey: {alg, pub}` in the body and be signed with that key (session id `-`). A challenge works for 5 minutes and once, so a captured sign-in cannot be sent again. The new session is bound to `sigKey`.

Device approval (plan 6.4): request -> `rO` from an old device -> `rN` revealed by the new device -> approve/deny. Out-of-order steps answer 409, a wrong commitment ends the request (422). Requests expire after 10 min; at most 3 open per account and 5 new per hour. Byte format: `commitment = SHA-256(devicePub[32] || rN[32])`, all values base64url without padding (see `src/approval.ts`).

Mail goes through the Cloudflare Email Service binding `EMAIL` from `no-reply@seanimemobile.com`: confirm email, password reset, new device, password changed, start fresh, account deleted, inactivity warning. Links carry the token in the URL fragment. In tests the binding is replaced by `test/mail-sink.js`, which records mails.

Rate limits: login 5 failures per email and 20 per IP within 15 min, then a growing wait (30 s doubling up to 15 min, no permanent lock); signup 5 per hour per IP; upload 30 per hour per account; reset 3 per hour per email; verification resend 3 per hour per account; device approvals 5 per hour per account. Short bursts per IP also go through the Workers Rate Limiting bindings. Counter keys are HMACs, no raw IP or email is stored.

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

Vars in `wrangler.jsonc`: `ALLOWED_ORIGIN`, `WEB_BASE_URL` (links in mails), `GOOGLE_JWKS_URL` (Google's key set; only tests point it elsewhere). Binding `EMAIL` (`send_email`, sender restricted to `no-reply@seanimemobile.com`); the domain must be onboarded to Email Sending before the first deploy.

The D1 `database_id` and rate-limit `namespace_id` values in `wrangler.jsonc` are placeholders.
