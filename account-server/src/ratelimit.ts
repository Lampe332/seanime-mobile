import { hmacSha256, toB64url } from "./crypto";
import { HttpError, tooMany } from "./http";
import { now } from "./session";

/** D1 counter key. The value (IP, email, user id) is HMACed so no raw identifier is stored. */
export async function rateKey(env: Env, kind: string, value: string): Promise<string> {
  return `${kind}:${toB64url(await hmacSha256(env.ENUM_SECRET, `rl:${kind}:${value}`))}`;
}

/**
 * Short burst limiter from the Workers Rate Limiting binding: counted in memory at the edge, never in D1. Every route
 * without a session calls it first, before anything is written to D1 (NEU-5). Keyed per ipKey (IPv6 per /48, NEU-4).
 */
export async function burstLimit(limiter: RateLimit, ip: string): Promise<void> {
  const { success } = await limiter.limit({ key: ipKey(ip) });
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

/**
 * The key per sender for IP counters and the burst limiter: an IPv4 address as it is, IPv6 per /48 (NEU-4: one
 * connection gets a whole /64 or /48, so per address would be no limit at all).
 */
export function ipKey(ip: string): string {
  const range = ipRange(ip);
  return range.endsWith("/48") ? range : ip;
}

export const LOGIN_LIMIT_EMAIL = 5;
export const LOGIN_LIMIT_IP = 20;
/** NEU-4: per email across all networks; above it a right password needs the link in a mail (S5), from its own pot (NEU4-1) */
export const LOGIN_LIMIT_EMAIL_GLOBAL = 20;

const waiting = (wait: number) =>
  new HttpError(429, "rate_limited", "Too many attempts. Try again later.", { "Retry-After": String(wait) }, { retryAfter: wait });
const giveBack = (env: Env, key: string) => env.DB.prepare("UPDATE rate_limits SET count = MAX(count - 1, 0) WHERE key = ?").bind(key);

/**
 * Step 1 of a password check, before anything else of the sign-in is written to D1 (NEU3-7): the attempt counts against
 * the sender's IP (IPv6 /48). Throws 429 while it waits. Returns the statement that gives this attempt back after a
 * success (clearing the counter would let somebody reset it with a login to an own account between guesses).
 */
export async function reserveLoginIp(env: Env, ip: string): Promise<D1PreparedStatement> {
  const key = await rateKey(env, "login-ip", ipKey(ip));
  const wait = await reserveAttempt(env, key, LOGIN_LIMIT_IP);
  if (wait > 0) throw waiting(wait);
  return giveBack(env, key);
}

/**
 * Step 2 (N-5, M-2, NEU-4, S5): unless a known device asks, the attempt counts per (email, IP range), which only ever
 * holds up the sender's own network (429), and per email across all networks. Over that one nobody is held up: the
 * answer turns into "confirm by mail" for a right and a wrong password alike, so a guesser learns nothing, and the owner
 * signs in through the link the right password triggers (I4). Returns what a success runs and whether the mail is needed.
 */
export async function reserveLoginEmail(
  env: Env,
  ip: string,
  email: string,
  known: boolean,
): Promise<{ onSuccess: D1PreparedStatement[]; confirmByMail: boolean }> {
  if (known) return { onSuccess: [], confirmByMail: false };
  const rangeKey = await rateKey(env, "login-email", `${email}|${ipRange(ip)}`);
  const wait = await reserveAttempt(env, rangeKey, LOGIN_LIMIT_EMAIL);
  if (wait > 0) throw waiting(wait);
  const globalKey = await rateKey(env, "login-email-all", email);
  const confirmByMail = (await reserveAttempt(env, globalKey, LOGIN_LIMIT_EMAIL_GLOBAL)) > 0;
  // A success clears the range counter and gives back this one attempt of the email's counter, so the owner never
  // resets it for the guesser.
  return { onSuccess: [clearKey(env, rangeKey), ...(confirmByMail ? [] : [giveBack(env, globalKey)])], confirmByMail };
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

/**
 * NEU-5, NEU3-6: mails sent to an address on request (reset links, sign-in links, confirmation links). Per (recipient,
 * sender's IP range), so a stranger uses up only the mails his own network may trigger, never the owner's; plus a cap per
 * recipient across all networks against using the service to flood a mailbox.
 *
 * NEU4-1: every kind has its own pot. Sign-in links only go out after the right password, so a stranger can't touch that
 * pot; using up the reset pot no longer silences the sign-in link. A reset from a network the account signed in from with
 * its password (knownNetwork) skips the reset pot's cap across networks.
 */
export const MAIL_LIMIT_HOUR = 5;
export const MAIL_LIMIT_DAY = 10;
export const MAIL_LIMIT_DAY_ALL = 50;
export type MailPot = "link" | "reset" | "verify";

/** NEU4-1: how long a network the password signed in from counts as the owner's */
const KNOWN_NETWORK_SECONDS = 90 * 24 * 3600;
const knownNetworkKey = (env: Env, userId: string, ip: string) => rateKey(env, "known-net", `${userId}|${ipRange(ip)}`);

/** NEU4-1: remembers the network of a sign-in with the right password (run with the sign-in) */
export async function rememberNetwork(env: Env, userId: string, ip: string): Promise<D1PreparedStatement> {
  const t = now();
  return env.DB.prepare(
    `INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?1, 1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET last_at = ?2, expires_at = ?3`,
  ).bind(await knownNetworkKey(env, userId, ip), t, t + KNOWN_NETWORK_SECONDS);
}

export async function isKnownNetwork(env: Env, userId: string, ip: string): Promise<boolean> {
  return (await windowCount(env, await knownNetworkKey(env, userId, ip))) > 0;
}

/**
 * Counts one mail of `pot` to `email` from `ip` and says whether it may go. Never throws, so the answer to the sender
 * stays the same either way (no hint whether the address has an account). `knownNetwork` counts per address and caps the
 * whole network per day instead of the cap across networks (NEU5-1).
 */
export async function mailAllowed(env: Env, pot: MailPot, email: string, ip: string, knownNetwork = false): Promise<boolean> {
  // NEU5-1: in a known network the pot is per address (IPv6 /48), so a stranger in the same /24 (public WLAN, carrier NAT)
  // uses up only his own; the whole network stays capped per day (below) instead of the cap across networks.
  const range = `${email}|${ipRange(ip)}`;
  const sender = knownNetwork ? `${email}|${ipKey(ip)}` : range;
  const count = async (window: string, seconds: number, value = sender) => {
    const t = now();
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?1, 1, ?2, ?2 + ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.expires_at <= ?2 THEN 1 ELSE rate_limits.count + 1 END,
         last_at = ?2,
         expires_at = CASE WHEN rate_limits.expires_at <= ?2 THEN ?2 + ?3 ELSE rate_limits.expires_at END
       RETURNING count`,
    )
      .bind(await rateKey(env, `mail-${pot}-${window}`, value), t, seconds)
      .first<{ count: number }>();
    return row?.count ?? Number.MAX_SAFE_INTEGER;
  };
  if ((await count("hour", 3600)) > MAIL_LIMIT_HOUR) return false;
  if ((await count("day", 24 * 3600)) > MAIL_LIMIT_DAY) return false;
  if (knownNetwork) return (await count("day-net", 24 * 3600, range)) <= MAIL_LIMIT_DAY_ALL;
  return (await count("day-all", 24 * 3600, email)) <= MAIL_LIMIT_DAY_ALL;
}

/** Hits of a fixedWindow key in its current window (0 when none or over) */
export async function windowCount(env: Env, key: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE key = ? AND expires_at > ?")
    .bind(key, now())
    .first<{ count: number }>();
  return row?.count ?? 0;
}
