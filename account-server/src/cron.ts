import { CODE_MAX_ATTEMPTS } from "./codelogin";
import { sendMail } from "./mail";
import { deleteUserData } from "./routes";
import { now, SESSION_IDLE_SECONDS } from "./session";

const DAY = 24 * 3600;
export const UNVERIFIED_MAX_AGE = 7 * DAY;
export const INACTIVE_WARN_AFTER = 180 * DAY;
export const INACTIVE_DELETE_AFTER_WARNING = 14 * DAY;
const BATCH = 200;

/** Still unconfirmed: never verified, no Google login. Checked again inside the delete transaction. */
const STILL_UNVERIFIED = "email_verified = 0 AND google_sub IS NULL";

export interface CleanupResult {
  deletedUnverified: number;
  warnedInactive: number;
  deletedInactive: number;
}

/**
 * Daily cleanup: expired tokens, requests, nonces, counters and sessions; unconfirmed accounts after 7 days;
 * 180 days inactive -> warning mail; still inactive 14 days after the warning -> account deleted (D1 + R2).
 */
export async function cleanup(env: Env): Promise<CleanupResult> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE expires_at <= ? OR used_at IS NOT NULL").bind(t),
    env.DB.prepare("DELETE FROM device_requests WHERE expires_at <= ? AND status != 'approved'").bind(t),
    env.DB.prepare("DELETE FROM device_requests WHERE expires_at <= ?").bind(t - DAY),
    env.DB.prepare("DELETE FROM google_nonces WHERE expires_at <= ? OR used_at IS NOT NULL").bind(t),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM used_nonces WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM removed_sessions WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM login_links WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM sign_in_codes WHERE expires_at <= ? OR attempts >= ?").bind(t, CODE_MAX_ATTEMPTS),
    // I5: the account keeps its security events for 180 days
    env.DB.prepare("DELETE FROM account_events WHERE at < ?").bind(t - 180 * DAY),
    env.DB.prepare("DELETE FROM sessions WHERE last_used_at < ?").bind(t - SESSION_IDLE_SECONDS),
  ]);

  const result: CleanupResult = { deletedUnverified: 0, warnedInactive: 0, deletedInactive: 0 };

  // 1. Unconfirmed accounts older than 7 days.
  const unverifiedBefore = t - UNVERIFIED_MAX_AGE;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE ${STILL_UNVERIFIED} AND created_at < ? LIMIT ?`,
    )
      .bind(unverifiedBefore, BATCH)
      .all<{ id: string }>();
    for (const { id } of results) {
      if (await deleteUserData(env, id, `${STILL_UNVERIFIED} AND created_at < ${unverifiedBefore}`)) {
        result.deletedUnverified++;
      }
    }
    if (results.length < BATCH) break;
  }

  // 2. Inactive and warned at least 14 days ago, with no activity since the warning: delete.
  const warnedBefore = t - INACTIVE_DELETE_AFTER_WARNING;
  const stillInactive = `inactivity_warned_at IS NOT NULL AND inactivity_warned_at < ${warnedBefore} AND last_active_at <= inactivity_warned_at`;
  for (;;) {
    const { results } = await env.DB.prepare(`SELECT id, email FROM users WHERE ${stillInactive} LIMIT ?`)
      .bind(BATCH)
      .all<{ id: string; email: string }>();
    for (const { id, email } of results) {
      if (await deleteUserData(env, id, stillInactive)) {
        result.deletedInactive++;
        await sendMail(env, email, { kind: "account_deleted" });
      }
    }
    if (results.length < BATCH) break;
  }

  // 3. 180 days inactive and not warned since the last activity: warning mail.
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id, email FROM users
       WHERE last_active_at < ? AND (inactivity_warned_at IS NULL OR inactivity_warned_at < last_active_at)
       LIMIT ?`,
    )
      .bind(t - INACTIVE_WARN_AFTER, BATCH)
      .all<{ id: string; email: string }>();
    for (const { id, email } of results) {
      // Mark first so a mail problem never leads to a loop of warnings within one run.
      await env.DB.prepare("UPDATE users SET inactivity_warned_at = ? WHERE id = ?").bind(t, id).run();
      await sendMail(env, email, { kind: "inactivity", deleteAt: t + INACTIVE_DELETE_AFTER_WARNING });
      result.warnedInactive++;
    }
    if (results.length < BATCH) break;
  }

  console.log(JSON.stringify({ msg: "cleanup", ...result }));
  return result;
}
