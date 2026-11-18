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

/**
 * N-5: counts an attempt before it is checked, in one statement. The row only changes when the key is not waiting
 * (no earlier row, the window is over, or the growing wait has passed); a waiting key returns no row and nothing is
 * counted. D1 runs statements one after another, so parallel attempts can never all see a free counter. A success
 * clears the key again (clearKey). Returns the seconds to wait, 0 when this attempt may go ahead.
 */
export async function reserveAttempt(env: Env, key: string, limit: number): Promise<number> {
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?1, 1, ?2, ?2 + ?3)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.expires_at <= ?2 THEN 1 ELSE rate_limits.count + 1 END,
       last_at = ?2,
       expires_at = ?2 + ?3
     WHERE rate_limits.expires_at <= ?2
        OR rate_limits.count < ?4
        OR rate_limits.last_at + MIN(?5, ?6 * (1 << MIN(rate_limits.count - ?4, 10))) <= ?2
     RETURNING count`,
  )
    .bind(key, t, FAILURE_WINDOW, limit, PENALTY_MAX, PENALTY_BASE)
    .first<{ count: number }>();
  if (row) return 0;
  return Math.max(1, await failureWait(env, key, limit));
}

export function clearKey(env: Env, key: string): D1PreparedStatement {
  return env.DB.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key);
}

/**
 * The network an address belongs to: IPv4 /24, IPv6 /48 (IPv4-mapped IPv6 counts as IPv4). Email counters are kept
 * per (email, range), so somebody elsewhere cannot use up the counter of a victim's email (M-2, N-4).
 */
export function ipRange(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("::", 2) as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length < 3 || groups.slice(0, 3).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/48`;
}

export const LOGIN_LIMIT_EMAIL = 5;
export const LOGIN_LIMIT_IP = 20;

/**
 * Login-style password check (login, and the password asked again for Google link/unlink): counts the attempt per IP
 * and, unless the request comes from a known device, per (email, IP range) before the check (N-5, M-2). Throws 429
 * while a key waits. Returns the statements to run after a success: the email counter is cleared, the IP counter only
 * gives this attempt back (clearing it would let somebody reset it with a login to an own account between guesses).
 */
export async function reserveLogin(env: Env, ip: string, email: string, knownDevice: boolean): Promise<D1PreparedStatement[]> {
  const ipKey = await rateKey(env, "login-ip", ip);
  let wait = await reserveAttempt(env, ipKey, LOGIN_LIMIT_IP);
  const onSuccess = [env.DB.prepare("UPDATE rate_limits SET count = MAX(count - 1, 0) WHERE key = ?").bind(ipKey)];
  if (wait === 0 && !knownDevice) {
    const emailKey = await rateKey(env, "login-email", `${email}|${ipRange(ip)}`);
    onSuccess.push(clearKey(env, emailKey));
    wait = await reserveAttempt(env, emailKey, LOGIN_LIMIT_EMAIL);
  }
  if (wait > 0) {
    throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.", { "Retry-After": String(wait) }, { retryAfter: wait });
  }
  return onSuccess;
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
