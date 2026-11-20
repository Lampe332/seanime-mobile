/**
 * Edit on the website (4.2.x): a website session may read and write the encrypted snapshot, but only while the owner
 * turned it on in the app (`users.web_edit`), and only after it showed the owner and the key.
 *
 * 1. `PUT account/web-access` (the app, a session bound to a device row, password again) turns it on. Any session turns
 *    it off (`DELETE`), which locks every website key session of the account at once.
 * 2. `POST web/unlock` shows the owner: the password, the recovery proof, or a code while "code only" is on. The answer is
 *    the matching wrap of the DEK; the browser unwraps it and checks it against a device MAC.
 * 3. `POST web/key` right after (5 minutes, once) shows the DEK proof. From then on the session reads and writes the
 *    snapshot for 30 minutes, while the account keeps that dekId (requireKeyHolder in session.ts). Mail every time.
 * 4. `POST web/lock` ends it early; so does signing out.
 *
 * The DEK proof alone never unlocks (I3): web/key only follows a web/unlock of the same session. A Google account without a
 * password unlocks with its recovery code only.
 */
import { clientIp, HttpError, json, noContent, readJson } from "./http";
import { checkCode, openEscrow, useCode } from "./codelogin";
import { requirePassword } from "./identity";
import { notify, type WebUnlockMethod } from "./mail";
import { fixedWindow, rateKey, reserveLoginIp, WEB_RECOVERY_LIMIT } from "./ratelimit";
import { type Ctx, HOUR, keyRequired, proofMatches } from "./routes";
import { DEFAULT_KDF, WebAccessBody, WebKeyBody, WebUnlockBody } from "./schemas";
import {
  appRequired,
  now,
  requireDevice,
  requireRecentAuth,
  requireSession,
  type Session,
  unlockRequired,
  WEB_KEY_SECONDS,
  webEditOff,
  websiteOnly,
} from "./session";

/** web/key follows web/unlock within this time, once */
export const UNLOCK_SECONDS = 5 * 60;

const dekMismatch = () => new HttpError(409, "dek_mismatch", "The account uses a different key.");

/** The website's own routes: its cookie session, called from the allowed Origin (index.ts rejects every other Origin) */
function requireWebsite(ctx: Ctx, session: Session): void {
  if (!session.web || !ctx.isBrowser) throw websiteOnly();
}

/**
 * On: only the app, from a session bound to a device row (it holds the key), never a website session, also not one bound
 * to a device row. The password again, checked and counted like Disconnect Google; an account without a password needs a
 * sign-in (Google) within the last 10 minutes. Mailed and listed when it changed.
 */
export async function putWebAccess(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireDevice(session);
  if (session.web || ctx.isBrowser) throw appRequired();
  const body = await readJson(ctx.request, WebAccessBody);
  const user = await env.DB.prepare("SELECT auth_hash FROM users WHERE id = ?").bind(session.userId).first<{ auth_hash: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.auth_hash !== null || body.authKey !== undefined) {
    if (body.authKey === undefined) throw new HttpError(400, "invalid_request", "authKey is required", {}, { fields: ["authKey"] });
    await requirePassword(env, ctx.request, session, body.authKey);
  } else {
    requireRecentAuth(session);
  }
  const row = await env.DB.prepare("UPDATE users SET web_edit = 1 WHERE id = ? AND web_edit = 0 RETURNING email")
    .bind(session.userId)
    .first<{ email: string }>();
  if (row) await notify(env, session.userId, row.email, { kind: "web_edit_on" });
  return noContent();
}

/** Off: any session of the account (the website too). Every website key session of the account is locked in the same step. */
export async function deleteWebAccess(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const [off] = await env.DB.batch<{ email: string }>([
    env.DB.prepare("UPDATE users SET web_edit = 0 WHERE id = ? AND web_edit = 1 RETURNING email").bind(session.userId),
    env.DB.prepare(
      `UPDATE sessions SET unlock_at = NULL, unlock_via = NULL, key_proof_at = NULL, key_dek_id = NULL, key_saved_at = NULL
       WHERE user_id = ?`,
    ).bind(session.userId),
  ]);
  const email = off?.results[0]?.email;
  if (email) await notify(env, session.userId, email, { kind: "web_edit_off" });
  return noContent();
}

/**
 * Shows the owner and hands out the matching wrap of the DEK. Nothing is counted while Edit on the website is off.
 * - `{authKey}`: checked and counted like a sign-in (requirePassword). The session counts as a password sign-in from now
 *   on (`auth_at`, `password_auth`), so changing the password or the recovery code needs no second sign-in. Answer
 *   `wrappedDek` (null after a reset without recovery code: `409 rewrap_needed`).
 * - `{recoveryProof}`: 5 per hour per account. Answer `recoveryWrappedDek`. The only way for an account without a password.
 * - `{code}`: only while "code only" is on, checked and counted like auth/code/login (a fresh code from auth/code/request).
 *   Answer `escrowDek`.
 */
export async function webUnlock(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const session = await requireSession(request, env);
  requireWebsite(ctx, session);
  const body = await readJson(request, WebUnlockBody);
  const user = await env.DB.prepare(
    `SELECT email, auth_hash, kdf_params, wrapped_dek, recovery_wrapped_dek, recovery_proof, dek_id, escrow_dek, web_edit
     FROM users WHERE id = ?`,
  )
    .bind(session.userId)
    .first<{
      email: string;
      auth_hash: string | null;
      kdf_params: string | null;
      wrapped_dek: string | null;
      recovery_wrapped_dek: string | null;
      recovery_proof: string | null;
      dek_id: string | null;
      escrow_dek: string | null;
      web_edit: number;
    }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.web_edit !== 1) throw webEditOff();
  if (user.dek_id === null) throw new HttpError(409, "no_key", "This account has no key yet.");
  const t = now();
  let method: WebUnlockMethod;
  let wrap: Record<string, string>;
  const after: D1PreparedStatement[] = [];

  if ("authKey" in body) {
    if (user.auth_hash !== null && user.wrapped_dek === null) {
      throw new HttpError(409, "rewrap_needed", "Open the app on one of your devices first, then unlock here.");
    }
    await requirePassword(env, request, session, body.authKey);
    method = "password";
    wrap = { wrappedDek: user.wrapped_dek! };
    after.push(env.DB.prepare("UPDATE sessions SET auth_at = ?, password_auth = 1 WHERE token_hash = ?").bind(t, session.tokenHash));
  } else if ("recoveryProof" in body) {
    if (user.recovery_wrapped_dek === null || user.recovery_proof === null) {
      throw new HttpError(409, "no_recovery", "This account has no recovery code.");
    }
    await fixedWindow(env, await rateKey(env, "web-recovery", session.userId), WEB_RECOVERY_LIMIT, HOUR);
    if (!(await proofMatches(user.recovery_proof, body.recoveryProof))) {
      throw new HttpError(403, "wrong_recovery_code", "Wrong recovery code.");
    }
    method = "recovery";
    wrap = { recoveryWrappedDek: user.recovery_wrapped_dek };
  } else {
    // M2: never for an account without a password; and only when the owner chose that a code brings the key
    if (user.auth_hash === null || user.escrow_dek === null) {
      throw new HttpError(403, "code_only_required", "Unlock with your password or your recovery code.");
    }
    const ip = clientIp(request);
    const ipBack = await reserveLoginIp(env, ip);
    const row = await checkCode(env, ip, user.email, session.userId, body.code);
    // opened before the code is used up (N4): a box that does not open leaves the code
    const escrowDek = await openEscrow(env, session.userId, user.dek_id, user.escrow_dek);
    if (escrowDek === null) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
    await useCode(env, row);
    method = "code";
    wrap = { escrowDek };
    after.push(ipBack);
  }

  // a new unlock starts over: a key proof from before ends here, web/key sets the next one
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions SET unlock_at = ?, unlock_via = ?, key_proof_at = NULL, key_dek_id = NULL, key_saved_at = NULL
       WHERE token_hash = ?`,
    ).bind(t, method, session.tokenHash),
    ...after,
  ]);
  return json({
    userId: session.userId,
    dekId: user.dek_id,
    kdf: user.kdf_params ? JSON.parse(user.kdf_params) : DEFAULT_KDF,
    method,
    ...wrap,
  });
}

/**
 * Right after web/unlock (5 minutes, once, also when it fails): the DEK proof of the account's current key. Then the session
 * reads and writes the snapshot for 30 minutes. Mail and event "web_unlocked" every time.
 */
export async function webKey(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireWebsite(ctx, session);
  const body = await readJson(ctx.request, WebKeyBody);
  const user = await env.DB.prepare("SELECT email, dek_id, dek_proof, web_edit FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null; dek_proof: string | null; web_edit: number }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.web_edit !== 1) throw webEditOff();
  const t = now();
  // used up here, before the proof is checked: a wrong proof needs a new web/unlock (counted there)
  // (unlock_via stays: RETURNING reads the row after the update, and without unlock_at it counts for nothing)
  const unlocked = await env.DB.prepare("UPDATE sessions SET unlock_at = NULL WHERE token_hash = ? AND unlock_at >= ? RETURNING unlock_via")
    .bind(session.tokenHash, t - UNLOCK_SECONDS)
    .first<{ unlock_via: WebUnlockMethod }>();
  if (!unlocked) throw unlockRequired();
  if (user.dek_id === null || user.dek_id !== body.dekId) throw dekMismatch();
  if (!(await proofMatches(user.dek_proof, body.dekProof))) throw keyRequired();
  // only while Edit on the website is still on and the key is still this one (a parallel off or key change wins)
  const set = await env.DB.prepare(
    `UPDATE sessions SET key_proof_at = ?1, key_dek_id = ?2, key_saved_at = NULL
     WHERE token_hash = ?3 AND EXISTS (SELECT 1 FROM users WHERE id = ?4 AND web_edit = 1 AND dek_id = ?2)`,
  )
    .bind(t, body.dekId, session.tokenHash, session.userId)
    .run();
  if ((set.meta.changes ?? 0) === 0) throw unlockRequired();
  await notify(env, session.userId, user.email, { kind: "web_unlocked", method: unlocked.unlock_via });
  return json({ dekId: body.dekId, keyUntil: t + WEB_KEY_SECONDS });
}

/** Locks this session at once (the page's "Lock now", auto-lock, leaving the page). Any session, always 204. */
export async function webLock(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  await env.DB.prepare(
    `UPDATE sessions SET unlock_at = NULL, unlock_via = NULL, key_proof_at = NULL, key_dek_id = NULL, key_saved_at = NULL
     WHERE token_hash = ?`,
  )
    .bind(session.tokenHash)
    .run();
  return noContent();
}
