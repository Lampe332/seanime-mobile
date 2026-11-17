-- A DEK rotation without the recovery code drops the recovery wrap: the old code stops working and the user should
-- save a new one. Cleared when a new recovery wrap arrives (account/keys, reset with code, rotation with code).
ALTER TABLE users ADD COLUMN recovery_renewal_needed INTEGER NOT NULL DEFAULT 0;
