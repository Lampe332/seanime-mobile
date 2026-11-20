-- 4.2.x: the wait before Start fresh after a code sign-in belongs to the signing key, not to the account. Additive only.

-- The first code sign-in of a 7-day window, per account and signing key (the device's key or the browser's request key).
-- A code session starts fresh only when its own key signed in with a code 24 hours to 7 days ago, so a brand-new key of
-- whoever holds only the mailbox always waits a day, even when the owner used a code earlier in the week. The daily
-- cleanup removes rows older than 7 days. users.code_since (0010) is no longer read.
CREATE TABLE code_anchors (
  user_id TEXT NOT NULL,
  sig_pub TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (user_id, sig_pub)
);
CREATE INDEX code_anchors_since ON code_anchors (since);
