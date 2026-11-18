import { fromB64url, randomBytes, sha256, toB64url } from "./crypto";
import { HttpError } from "./http";
import { hasSignatureHeaders, verifyRequest, type SigKey } from "./signature";

export const SESSION_IDLE_SECONDS = 90 * 24 * 3600;
export const RECENT_AUTH_SECONDS = 10 * 60;
const TOUCH_AFTER_SECONDS = 5 * 60;
const COOKIE_NAME = "__Host-sid";

export interface Session {
  tokenHash: string;
  userId: string;
  deviceId: string | null;
  authAt: number;
  createdAt: number;
  sigPub: string;
  /** The sign-in checked the password (login, signup); Google sessions did not */
  passwordAuth: boolean;
}

export const now = (): number => Math.floor(Date.now() / 1000);

async function hashToken(token: string): Promise<string> {
  return toB64url(await sha256(token));
}

/** Creates a session and returns the raw token. Only its SHA-256 is stored. */
export async function newSession(
  env: Env,
  userId: string,
  deviceId: string | null,
  key: SigKey,
  passwordAuth = false,
): Promise<{ token: string; tokenHash: string; statement: D1PreparedStatement }> {
  const token = toB64url(randomBytes(32));
  const t = now();
  // The session is bound to the signing key that signed the sign-in (plan 10.2b).
  const statement = env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, device_id, created_at, auth_at, last_used_at, sig_alg, sig_pub, password_auth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await hashToken(token), userId, deviceId, t, t, t, key.alg, key.pub, passwordAuth ? 1 : 0);
  return { token, tokenHash: await hashToken(token), statement };
}

/**
 * M-2: after a session was bound to a device row (in the same batch, right before), the row keeps that session's signing
 * key. The device keeps the key across sign-ins, so a later login signed with it is known and never locked out.
 */
export function copyDeviceKey(env: Env, tokenHash: string): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE devices SET
       sig_alg = (SELECT sig_alg FROM sessions WHERE token_hash = ?1),
       sig_pub = (SELECT sig_pub FROM sessions WHERE token_hash = ?1)
     WHERE id = (SELECT device_id FROM sessions WHERE token_hash = ?1)
       AND user_id = (SELECT user_id FROM sessions WHERE token_hash = ?1)`,
  ).bind(tokenHash);
}

/** The token and how it came: Bearer (the app) or the website's HttpOnly cookie. */
function tokenFromRequest(request: Request): { token: string; bearer: boolean } | null {
  const auth = request.headers.get("Authorization");
  if (auth !== null) {
    const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth);
    return m ? { token: m[1]!, bearer: true } : null;
  }
  const cookie = request.headers.get("Cookie");
  if (cookie === null) return null;
  for (const part of cookie.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name === COOKIE_NAME && value && /^[A-Za-z0-9_-]{43}$/.test(value)) return { token: value, bearer: false };
  }
  return null;
}

/**
 * N-2: the cheap part of requireSession, before a large body is read: a token of a session that exists and signature
 * headers of the right form. The signature itself covers the body hash and is checked later by requireSession.
 */
export async function precheckSession(request: Request, env: Env): Promise<{ userId: string }> {
  const presented = tokenFromRequest(request);
  if (presented === null || !hasSignatureHeaders(request)) throw new HttpError(401, "unauthorized");
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND last_used_at >= ?")
    .bind(await hashToken(presented.token), now() - SESSION_IDLE_SECONDS)
    .first<{ user_id: string }>();
  if (!row) throw new HttpError(401, "unauthorized");
  return { userId: row.user_id };
}

/**
 * NEU-2: a session that ended because its device was removed answers "device_removed", so the device drops its key. Only
 * looked up when the session is gone; a server that says it falsely can only make a device forget its key.
 */
async function missingSession(env: Env, tokenHash: string): Promise<HttpError> {
  const removed = await env.DB.prepare("SELECT 1 AS k FROM removed_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, now())
    .first<{ k: number }>();
  return removed
    ? new HttpError(401, "device_removed", "This device was removed from the account.")
    : new HttpError(401, "unauthorized");
}

/**
 * The session of a signed request. The token alone is not enough: the request must be signed with the session's key
 * (signature.ts), within the time window and with a new nonce. Every failure is the same 401.
 */
export async function requireSession(request: Request, env: Env): Promise<Session> {
  const presented = tokenFromRequest(request);
  if (presented === null || fromB64url(presented.token)?.byteLength !== 32) throw new HttpError(401, "unauthorized");
  const tokenHash = await hashToken(presented.token);
  const row = await env.DB.prepare(
    "SELECT user_id, device_id, created_at, auth_at, last_used_at, sig_alg, sig_pub, password_auth FROM sessions WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<{
      user_id: string;
      device_id: string | null;
      created_at: number;
      auth_at: number;
      last_used_at: number;
      sig_alg: string;
      sig_pub: string;
      password_auth: number;
    }>();
  if (!row) throw await missingSession(env, tokenHash);
  const t = now();
  if (row.last_used_at < t - SESSION_IDLE_SECONDS) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    throw new HttpError(401, "unauthorized");
  }
  if (row.sig_alg !== "ed25519" && row.sig_alg !== "p256") throw new HttpError(401, "unauthorized");
  // The app knows its token and signs its hash; the website cannot read its HttpOnly cookie and signs "-".
  await verifyRequest(env, request, { alg: row.sig_alg, pub: row.sig_pub }, presented.bearer ? tokenHash : "-");
  if (row.last_used_at < t - TOUCH_AFTER_SECONDS) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?").bind(t, tokenHash),
      env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(t, row.user_id),
    ]);
  }
  return {
    tokenHash,
    userId: row.user_id,
    deviceId: row.device_id,
    authAt: row.auth_at,
    createdAt: row.created_at,
    sigPub: row.sig_pub,
    passwordAuth: row.password_auth === 1,
  };
}

/** Sensitive actions need a credential check within the last 10 minutes. */
export function requireRecentAuth(session: Session): void {
  if (now() - session.authAt > RECENT_AUTH_SECONDS) {
    throw new HttpError(403, "reauth_required", "Sign in again to continue.");
  }
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Endpoints for approved devices only (the session belongs to a device that holds the DEK). */
export function requireDevice(session: Session): string {
  if (session.deviceId === null) throw new HttpError(403, "device_required", "Only a signed-in device can do this.");
  return session.deviceId;
}
