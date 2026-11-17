-- Phase 3c (plan 10.2b): every session is bound to a signing key; every request with a session is signed.

-- Sessions from before have no key and could never sign a request again.
DELETE FROM sessions;
-- 'ed25519' (app: libsodium crypto_sign; website when the browser has it) or 'p256' (website: ECDSA P-256).
ALTER TABLE sessions ADD COLUMN sig_alg TEXT NOT NULL DEFAULT '';
-- Raw public key, base64url: 32 bytes (Ed25519) or 65 bytes uncompressed point (P-256).
ALTER TABLE sessions ADD COLUMN sig_pub TEXT NOT NULL DEFAULT '';

-- Request nonces and used login challenges, each accepted once. Kept a little longer than the time window, then the
-- daily cron removes them.
CREATE TABLE used_nonces (
  nonce      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX used_nonces_expires ON used_nonces(expires_at);
