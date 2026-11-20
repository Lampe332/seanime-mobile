-- 4.2.x: "Edit on the website". A website session that proved the key may read and write the encrypted snapshot, only
-- while the owner turned it on in the app. Additive only.

-- Opt-in, off by default. Only an app session bound to a device row turns it on (password again, or a recent Google
-- sign-in); any session turns it off, which also ends every website key session of the account.
ALTER TABLE users ADD COLUMN web_edit INTEGER NOT NULL DEFAULT 0;

-- web/unlock: the website session just showed the owner, how ('password', 'recovery' or 'code' with "code only") and when.
-- web/key uses it once, within 5 minutes.
ALTER TABLE sessions ADD COLUMN unlock_at INTEGER;
ALTER TABLE sessions ADD COLUMN unlock_via TEXT;
-- web/key: the session showed the DEK proof of key_dek_id at this time. It reads and writes the snapshot for 30 minutes,
-- and only while key_dek_id is still the account's key (a key change ends it).
ALTER TABLE sessions ADD COLUMN key_proof_at INTEGER;
ALTER TABLE sessions ADD COLUMN key_dek_id TEXT;
-- The first save of a key session (event "web_settings_changed" once per unlock).
ALTER TABLE sessions ADD COLUMN key_saved_at INTEGER;
