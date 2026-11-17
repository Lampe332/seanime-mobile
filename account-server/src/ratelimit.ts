import { hmacSha256, toB64url } from "./crypto";
import { HttpError, tooMany } from "./http";
import { now } from "./session";

/** D1 counter key. The value (IP, email, user id) is HMACed so no raw identifier is stored. */
export async function rateKey(env: Env, kind: string, value: string): Promise<string> {
  return `${kind}:${toB64url(await hmacSha256(env.ENUM_SECRET, `rl:${kind}:${value}`))}`;
}

/** Short burst limiter from the Workers Rate Limiting binding. */
export async function burstLimit(limiter: RateLimit, key: string): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) throw tooMany(60);
}

// Growing wait after repeated failures: 30 s, 60 s, 120 s ... capped at 15 min.
// The counter expires 15 min after the last failure, so nobody is locked out for good.
const PENALTY_BASE = 30;
const PENALTY_MAX = 15 * 60;
export const FAILURE_WINDOW = 15 * 60;

function penaltySeconds(count: number, limit: number): number {
  if (count < limit) return 0;
  return Math.min(PENALTY_MAX, PENALTY_BASE * 2 ** Math.min(count - limit, 10));
}

/** Seconds the caller still has to wait for this key (0 = allowed). */
export async function failureWait(env: Env, key: string, limit: number): Promise<number> {
  const row = await env.DB.prepare("SELECT count, last_at, expires_at FROM rate_limits WHERE key = ?")
    .bind(key)
    .first<{ count: number; last_at: number; expires_at: number }>();
  const t = now();
  if (!row || row.expires_at <= t) return 0;
  return Math.max(0, row.last_at + penaltySeconds(row.count, limit) - t);
}

export function recordFailure(env: Env, key: string): D1PreparedStatement {
  const t = now();
  return env.DB.prepare(
    `INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?1, 1, ?2, ?2 + ?3)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.expires_at <= ?2 THEN 1 ELSE rate_limits.count + 1 END,
       last_at = ?2,
       expires_at = ?2 + ?3`,
  ).bind(key, t, FAILURE_WINDOW);
}

export function clearKey(env: Env, key: string): D1PreparedStatement {
  return env.DB.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key);
}

/** Fixed window: at most `limit` hits per `windowSeconds`. Throws 429 when exceeded. */
export async function fixedWindow(env: Env, key: string, limit: number, windowSeconds: number): Promise<void> {
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?1, 1, ?2, ?2 + ?3)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.expires_at <= ?2 THEN 1 ELSE rate_limits.count + 1 END,
       last_at = ?2,
       expires_at = CASE WHEN rate_limits.expires_at <= ?2 THEN ?2 + ?3 ELSE rate_limits.expires_at END
     RETURNING count, expires_at`,
  )
    .bind(key, t, windowSeconds)
    .first<{ count: number; expires_at: number }>();
  if (!row) throw new HttpError(500, "internal_error");
  if (row.count > limit) throw tooMany(row.expires_at - t);
}
