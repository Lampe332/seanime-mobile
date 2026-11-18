-- Fix round 2 after the security review (18.11.), M-2: a device keeps its request signing key across sign-ins (Android
-- Keystore, deleted when the user signs out), so the server can tell a known device at login and never locks it out
-- through the per-email counter. Every time a session is bound to a device row, that session's key is copied there
-- (src/session.ts copyDeviceKey).
ALTER TABLE devices ADD COLUMN sig_alg TEXT;
ALTER TABLE devices ADD COLUMN sig_pub TEXT;

-- Counter keys changed (email counters per IP range, attempts counted before the check): old rows mean nothing now.
DELETE FROM rate_limits;
