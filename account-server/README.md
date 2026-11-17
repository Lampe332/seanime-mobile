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
| GET | `devices` | |
| DELETE | `devices/:id` | Sign-in within the last 10 min required. |
| PUT | `account/keys` | First DEK, password/recovery wraps, this device's sealed DEK. |
| POST | `account/password` | Sign-in within the last 10 min required. Signs out other sessions. |
| DELETE | `account` | Sign-in within the last 10 min required. Removes D1 rows and the R2 blob at once. |
| GET | `sync/meta` | |
| GET/PUT | `sync/snapshot` | PUT needs `If-Match: <version>` and `X-Dek-Id`, body `application/octet-stream`, max 10 MB. |
| DELETE | `sync` | |

Sessions: 256-bit random token, only its SHA-256 is stored, 90 days idle timeout. The app sends `Authorization: Bearer <token>`. Requests from `https://seanimemobile.com` get the `__Host-sid` cookie instead. Every other `Origin` is rejected.

Rate limits: login 5 failures per email and 20 per IP within 15 min, then a growing wait (30 s doubling up to 15 min, no permanent lock); signup 5 per hour per IP; upload 30 per hour per account. Short bursts per IP also go through the Workers Rate Limiting bindings. Counter keys are HMACs, no raw IP or email is stored.

A daily cron removes expired tokens, device requests, nonces, counters and idle sessions, and deletes unconfirmed accounts older than 7 days.

## Local commands

```sh
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest with local D1/R2 (Workers runtime)
npm run types         # regenerate worker-configuration.d.ts after changing wrangler.jsonc
cp .dev.vars.example .dev.vars && npm run migrate:local && npm run dev
```

The test run prints a warning about missing `PEPPER_V1` / `ENUM_SECRET`; the test config injects fixed test values.

## Secrets

Set with `wrangler secret put`, never committed:

- `PEPPER_V1`: HMAC pepper for stored auth hashes
- `ENUM_SECRET`: key for decoy salts and rate-limit counter keys

The D1 `database_id` and rate-limit `namespace_id` values in `wrangler.jsonc` are placeholders.
