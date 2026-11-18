-- Fix round 4 after the third security review (18.11.). A recovery wrap now comes with a recovery proof, so the test data
-- of round 3 can't use its recovery code any more and goes. There are no real users yet.
DELETE FROM used_nonces;
DELETE FROM rate_limits;
DELETE FROM sessions;
DELETE FROM device_requests;
DELETE FROM tokens;
DELETE FROM snapshots;
DELETE FROM removed_sessions;
DELETE FROM removed_devices;
DELETE FROM devices;
DELETE FROM users;

-- S3: SHA-256 of the recovery proof (KDF of the recovery key). A session that shows it owns the account, like one that
-- checked the password. The DEK proof alone never does.
ALTER TABLE users ADD COLUMN recovery_proof TEXT;
-- S3 replaces the "devices from before the removal" rule: nothing reads the removal time or the removed signing key.
ALTER TABLE users DROP COLUMN removed_at;
ALTER TABLE removed_devices DROP COLUMN sig_pub;

-- S4: a device that signed out keeps its row, marked with the time, until a key change leaves it out.
ALTER TABLE devices ADD COLUMN signed_out_at INTEGER;

-- S5: a sign-in with the right password while the email's counter is over its limit waits for the link in a mail. Once
-- confirmed, the signing key that typed the password signs in like a known device (15 minutes, once).
CREATE TABLE login_links (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sig_pub      TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX login_links_user ON login_links (user_id, sig_pub);

-- I5: every security event of an account, shown in the app and on the website next to the mail it sent.
CREATE TABLE account_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  device_name TEXT,
  at          INTEGER NOT NULL
);
CREATE INDEX account_events_user ON account_events (user_id, at);
