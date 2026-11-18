-- Fix round 2 after the security review (18.11.), M-2: a device keeps its request signing key across sign-ins (Android
-- Keystore, deleted when the user signs out), so the server can tell a known device at login and never locks it out
-- through the per-email counter. Every time a session is bound to a device row, that session's key is copied there.
ALTER TABLE devices ADD COLUMN sig_alg TEXT;
ALTER TABLE devices ADD COLUMN sig_pub TEXT;

CREATE TRIGGER sessions_device_key_insert AFTER INSERT ON sessions
WHEN NEW.device_id IS NOT NULL
BEGIN
  UPDATE devices SET sig_alg = NEW.sig_alg, sig_pub = NEW.sig_pub WHERE id = NEW.device_id AND user_id = NEW.user_id;
END;

CREATE TRIGGER sessions_device_key_update AFTER UPDATE OF device_id ON sessions
WHEN NEW.device_id IS NOT NULL
BEGIN
  UPDATE devices SET sig_alg = NEW.sig_alg, sig_pub = NEW.sig_pub WHERE id = NEW.device_id AND user_id = NEW.user_id;
END;

-- Counter keys changed (email counters per IP range, attempts counted before the check): old rows mean nothing now.
DELETE FROM rate_limits;
