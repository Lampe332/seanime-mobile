-- Seanime Mobile account server, initial schema.
-- The server only stores ciphertext, wrapped keys and an HMAC of the client's authKey.
-- All times are Unix seconds.

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  email_verified       INTEGER NOT NULL DEFAULT 0,
  google_sub           TEXT UNIQUE,
  kdf_salt             TEXT,
  kdf_params           TEXT,
  auth_hash            TEXT,
  pepper_version       INTEGER,
  wrapped_dek          TEXT,
  recovery_wrapped_dek TEXT,
  dek_id               TEXT,
  created_at           INTEGER NOT NULL,
  last_active_at       INTEGER NOT NULL,
  inactivity_warned_at INTEGER
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  device_pub   TEXT NOT NULL,
  sealed_dek   TEXT,
  dek_id       TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    TEXT REFERENCES devices(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  auth_at      INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_last_used ON sessions(last_used_at);

-- Email verification and password reset tokens (phase 1b). Only the SHA-256 is stored.
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX tokens_user ON tokens(user_id);
CREATE INDEX tokens_expires ON tokens(expires_at);

-- New-device approval with commitment (phase 1b, plan 6.4).
CREATE TABLE device_requests (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name  TEXT NOT NULL,
  device_pub   TEXT NOT NULL,
  commitment   TEXT NOT NULL,
  approver_nonce TEXT,
  reveal       TEXT,
  sealed_dek   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'nonce', 'revealed', 'approved', 'denied')),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX device_requests_user ON device_requests(user_id);
CREATE INDEX device_requests_expires ON device_requests(expires_at);

-- One-time nonces for Google sign-in (phase 1b, plan 6.3).
CREATE TABLE google_nonces (
  nonce_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX google_nonces_expires ON google_nonces(expires_at);

-- Metadata of the single encrypted blob per account. The blob lives in R2 at snap/<user_id>.
CREATE TABLE snapshots (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  dek_id     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Rate-limit counters. Keys are HMACs, so no raw IP or email is stored.
CREATE TABLE rate_limits (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expires ON rate_limits(expires_at);
