import { deleteUserData } from "./routes";
import { now, SESSION_IDLE_SECONDS } from "./session";

const UNVERIFIED_MAX_AGE = 7 * 24 * 3600;
const BATCH = 200;

/** Daily cleanup: expired tokens, requests, nonces, counters and sessions; unconfirmed accounts after 7 days. */
export async function cleanup(env: Env): Promise<{ deletedUsers: number }> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE expires_at <= ? OR used_at IS NOT NULL").bind(t),
    env.DB.prepare("DELETE FROM device_requests WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM google_nonces WHERE expires_at <= ? OR used_at IS NOT NULL").bind(t),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM sessions WHERE last_used_at < ?").bind(t - SESSION_IDLE_SECONDS),
  ]);

  let deletedUsers = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      "SELECT id FROM users WHERE email_verified = 0 AND google_sub IS NULL AND created_at < ? LIMIT ?",
    )
      .bind(t - UNVERIFIED_MAX_AGE, BATCH)
      .all<{ id: string }>();
    for (const { id } of results) await deleteUserData(env, id);
    deletedUsers += results.length;
    if (results.length < BATCH) break;
  }
  console.log(JSON.stringify({ msg: "cleanup", deletedUsers }));
  return { deletedUsers };
}
