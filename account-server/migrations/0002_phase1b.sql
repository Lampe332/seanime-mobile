-- Phase 1b: Google sign-in, device approval, password reset, key rotation.

-- Set by a password reset without recovery code: the password wrap is gone until a device sends a new one.
ALTER TABLE users ADD COLUMN rewrap_needed INTEGER NOT NULL DEFAULT 0;
-- Set when a device was removed or the password was reset without code: devices should rotate the DEK.
ALTER TABLE users ADD COLUMN rotation_required INTEGER NOT NULL DEFAULT 0;

-- One row per device key: a re-login of the same device updates its row instead of adding another.
CREATE UNIQUE INDEX devices_user_pub ON devices(user_id, device_pub);

-- Device approval (plan 6.4).
-- session_hash: the session of the new device that created the request (only it may reveal and fetch the result).
ALTER TABLE device_requests ADD COLUMN session_hash TEXT;
-- approver_device_id: the old device that sent its nonce; only that device may approve.
ALTER TABLE device_requests ADD COLUMN approver_device_id TEXT;
-- Result of an approval: the new devices row and the DEK id the sealed key belongs to.
ALTER TABLE device_requests ADD COLUMN device_id TEXT;
ALTER TABLE device_requests ADD COLUMN dek_id TEXT;
