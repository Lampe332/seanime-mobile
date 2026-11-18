-- Fix round 3 after the second security review (18.11.). New formats (approval v2 with crypto_box from the approving
-- device, key chain v2 that names the rotating device and the removed ones): the test data can never be read again and
-- goes. There are no real users yet.
DELETE FROM used_nonces;
DELETE FROM rate_limits;
DELETE FROM google_nonces;
DELETE FROM sessions;
DELETE FROM device_requests;
DELETE FROM tokens;
DELETE FROM snapshots;
DELETE FROM devices;
DELETE FROM users;

-- Approval v2: the approving device's own public key; it goes into the number both devices show (src/approval.ts).
ALTER TABLE device_requests ADD COLUMN approver_pub TEXT;

-- Key chain v2: the device that rotated and the devices it left out as removed (JSON array of public keys).
ALTER TABLE users ADD COLUMN chain_rotator TEXT;
ALTER TABLE users ADD COLUMN chain_removed TEXT;
-- Set when a device is removed, cleared by the rotation: until then only sessions and devices from before this time may
-- rotate, and no session may add a new device row with the DEK proof (NEU-2).
ALTER TABLE users ADD COLUMN removed_at INTEGER;

-- 1 when the session's sign-in checked the password (login, signup). Google sessions stay 0.
ALTER TABLE sessions ADD COLUMN password_auth INTEGER NOT NULL DEFAULT 0;

-- Removed devices of an account: their device key and signing key can never be bound to the account again.
CREATE TABLE removed_devices (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_pub TEXT NOT NULL,
  sig_pub    TEXT,
  removed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_pub)
);

-- Sessions that ended because their device was removed: the device hears "device_removed" and drops its key.
CREATE TABLE removed_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX removed_sessions_expiry ON removed_sessions (expires_at);
