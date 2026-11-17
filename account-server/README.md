# seanime-account

Account and sync server for Seanime Mobile, a Cloudflare Worker (`seanime-account`).

The server is an encrypted mailbox. Devices encrypt everything before upload. The server never gets plaintext, a password or the data key (DEK). For email login it stores only `HMAC-SHA256(pepper, authKey)`, where `authKey` is derived on the device from the password with Argon2id, and compares it in constant time.

Storage: D1 (`DB`) for accounts, sessions, devices and wrapped keys; R2 (`SNAPSHOTS`) for one encrypted blob per account at `snap/<userId>`.

## API (`/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `auth/prelogin` | Salt + KDF parameters. Unknown emails get a stable decoy salt with the same response shape. |
| POST | `auth/signup` | With key wraps (app) or without (website). |
| POST | `auth/login` | Any failure answers `Wrong email or password`. |
| POST | `auth/logout` | |
| POST | `auth/verify` | `{token}` from the confirmation mail. One-time, 7 days. |
| POST | `auth/verify/resend` | Signed in. 3 per hour. |
| POST | `auth/reset-request` | `{email}`. Same answer for unknown emails. 3 per hour per email. Token and mail run after the answer (`waitUntil`), so both answers take the same time. |
| POST | `auth/reset/info` | `{token}`. `userId` (part of the wrap AAD), recovery wrap and dekId so the device can unwrap with the recovery code. Never the password wrap. Does not use up the token. |
| POST | `auth/reset` | `{token, salt, kdf, authKey, keys?}`. One-time, 30 min. With `keys` (recovery code): new password and recovery wraps. Without: password wrap dropped, `rewrapNeeded`. Signs out every session. |
| POST | `auth/google/nonce` | One-time nonce, 5 min. |
| POST | `auth/google` | `{idToken, nonce}`. RS256 against Google's JWKS (cached per `Cache-Control`), `iss`, `aud`, `exp`/`iat`, nonce, `email_verified`. An existing password account with the same email is never linked automatically (409 `account_exists`). |
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
| POST | `account/start-fresh` | `{dekId, wrappedDek?, recoveryWrappedDek?, device}`. Sign-in within 10 min. One transaction: snapshot, every device, open approvals and all other sessions go; the new dekId, its wraps and this device are set. Then the R2 blob is deleted. |
| POST | `account/password` | Sign-in within the last 10 min required. Signs out other sessions. Mail. |
| POST | `account/rotate` | DEK rotation, `multipart/form-data` with parts `meta` (JSON) and `snapshot`, `If-Match` required. Device session, sign-in within 10 min. Afterwards wraps of the old dekId are refused. Without a new recovery wrap the old one is dropped and `recoveryRenewalNeeded` is set until a new code is saved. If writing R2 fails, D1 is put back. |
| POST | `account/link-google` | `{idToken, nonce}`. Sign-in within the last 10 min required. |
| DELETE | `account` | Sign-in within the last 10 min required. Removes D1 rows and the R2 blob at once. |
| GET | `sync/meta` | Also `rotationRequired`, `rewrapNeeded` and `recoveryRenewalNeeded`. |
| GET/PUT | `sync/snapshot` | PUT needs `If-Match: <version>` and `X-Dek-Id`, body `application/octet-stream`, max 10 MB. |
| DELETE | `sync` | |

Sessions: 256-bit random token, only its SHA-256 is stored, 90 days idle timeout. The app sends `Authorization: Bearer <token>`. Requests from `https://seanimemobile.com` get the `__Host-sid` cookie instead. Every other `Origin` is rejected.

Device approval (plan 6.4): request -> `rO` from an old device -> `rN` revealed by the new device -> approve/deny. Out-of-order steps answer 409, a wrong commitment ends the request (422). Requests expire after 10 min; at most 3 open per account and 5 new per hour. Byte format: `commitment = SHA-256(devicePub[32] || rN[32])`, all values base64url without padding (see `src/approval.ts`).

Mail goes through the Cloudflare Email Service binding `EMAIL` from `no-reply@seanimemobile.com`: confirm email, password reset, new device, password changed, account deleted, inactivity warning. Links carry the token in the URL fragment. In tests the binding is replaced by `test/mail-sink.js`, which records mails.

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
