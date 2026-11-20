-- 4.2.x: the session list, sign-ins in the timeline and the wait before Start fresh after a code or a reset. Additive only.

-- The session came from the website (cookie) instead of the app (Bearer). Older rows start as app (0), the stricter kind,
-- and are corrected the next time the website uses them.
ALTER TABLE sessions ADD COLUMN web INTEGER NOT NULL DEFAULT 0;

-- How a "signed_in" event signed in: password, code or google. NULL for every other kind.
ALTER TABLE account_events ADD COLUMN method TEXT;

-- Start fresh waits 24 hours after a password reset (any session) and after the first code sign-in of a window (code
-- sessions), so whoever holds only the mailbox can't wipe the encrypted data at once.
ALTER TABLE users ADD COLUMN reset_at INTEGER;
ALTER TABLE users ADD COLUMN code_since INTEGER;
