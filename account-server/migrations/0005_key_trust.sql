-- Fix round 1 after the security review (18.11.): the server is not trusted with the key list any more.
-- New key formats (wraps v2, sealed DEKs carry their dekId, device MACs, key chain): the old test data can never be
-- read again and goes. There are no real users yet.
DELETE FROM used_nonces;
DELETE FROM rate_limits;
DELETE FROM google_nonces;
DELETE FROM sessions;
DELETE FROM device_requests;
DELETE FROM tokens;
DELETE FROM snapshots;
DELETE FROM devices;
DELETE FROM users;

-- SHA-256 (base64url) of the DEK proof (KDF(DEK, 2, "sm-dkey")): only a session that shows the proof, or one bound to
-- a device row, may add a device or change a wrap (K-1, M-5).
ALTER TABLE users ADD COLUMN dek_proof TEXT;
-- The last rotation: the dekId it replaced and the old DEK's MAC over the new one. Devices take a new DEK only with it.
ALTER TABLE users ADD COLUMN chain_from TEXT;
ALTER TABLE users ADD COLUMN chain_mac TEXT;
-- MAC of a DEK holder over userId, dekId and devicePub; the server stores it, only the devices can check it.
ALTER TABLE devices ADD COLUMN mac TEXT;
-- The approver's MAC for the new device's row, copied into devices on approval.
ALTER TABLE device_requests ADD COLUMN device_mac TEXT;
