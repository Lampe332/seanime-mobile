-- 4.2.0: sign in with a code from an email, and the opt-in "sign in with an email code only" (escrow). Additive only.

-- One code per account at a time: a new one replaces the old. Only HMAC(PEPPER_V1, userId || code) is stored, never the
-- code. 10 minutes, at most 5 tries; a right code is deleted when it is used.
CREATE TABLE sign_in_codes (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sign_in_codes_expires ON sign_in_codes (expires_at);

-- "Code only" (opt-in): the raw DEK sealed with AES-GCM under the secret ESCROW_KEY, AAD bound to the user and the
-- account's dekId (base64url of iv || ciphertext). NULL = off, the default: the server can't read anything.
ALTER TABLE users ADD COLUMN escrow_dek TEXT;

-- The session came from auth/code/login (the mailbox, not the password).
ALTER TABLE sessions ADD COLUMN code_auth INTEGER NOT NULL DEFAULT 0;
