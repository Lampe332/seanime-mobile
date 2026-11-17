/** Email verification, password reset (plan 6.8) and Google sign-in (plan 6.3). */
import { randomBytes, sha256, toB64url } from "./crypto";
import { verifyGoogleIdToken } from "./google";
import { clientIp, HttpError, json, noContent, readJson } from "./http";
import { sendMail } from "./mail";
import { burstLimit, fixedWindow, rateKey } from "./ratelimit";
import { authHash, type Ctx, isUniqueViolation, PEPPER_VERSION, withSession } from "./routes";
import { GoogleBody, ResetBody, ResetRequestBody, TokenBody } from "./schemas";
import { newSession, now, requireRecentAuth, requireSession } from "./session";

export const VERIFY_TTL = 7 * 24 * 3600;
export const RESET_TTL = 30 * 60;
const GOOGLE_NONCE_TTL = 5 * 60;
const RESEND_LIMIT = 3;
const RESET_LIMIT_EMAIL = 3;
const HOUR = 3600;

const tokenHash = async (token: string) => toB64url(await sha256(token));

/** New one-time token (256 bit). Only its SHA-256 is stored; the raw value goes into the mail. */
export async function issueToken(
  env: Env,
  userId: string,
  purpose: "verify" | "reset",
  ttl: number,
): Promise<{ token: string; statement: D1PreparedStatement }> {
  const token = toB64url(randomBytes(32));
  const t = now();
  const statement = env.DB.prepare(
    "INSERT INTO tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(await tokenHash(token), userId, purpose, t, t + ttl);
  return { token, statement };
}

const invalidToken = () => new HttpError(400, "invalid_token", "This link is invalid or expired.");

// ---------------------------------------------------------------- email verification

export async function verifyEmail(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const { token } = await readJson(request, TokenBody);
  const hash = await tokenHash(token);
  const t = now();
  // Lookup by SHA-256 of a 256-bit token: the stored value is not secret, so no timing leak helps.
  const [used] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE tokens SET used_at = ? WHERE token_hash = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > ?",
    ).bind(t, hash, t),
    env.DB.prepare(
      "UPDATE users SET email_verified = 1 WHERE id = (SELECT user_id FROM tokens WHERE token_hash = ? AND purpose = 'verify' AND used_at = ?)",
    ).bind(hash, t),
  ]);
  if (!used || used.meta.changes === 0) throw invalidToken();
  return json({ emailVerified: true });
}

export async function resendVerification(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const user = await env.DB.prepare("SELECT email, email_verified FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; email_verified: number }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.email_verified === 1) throw new HttpError(409, "already_verified", "Your email is already confirmed.");
  await fixedWindow(env, await rateKey(env, "verify-resend", session.userId), RESEND_LIMIT, HOUR);
  const issued = await issueToken(env, session.userId, "verify", VERIFY_TTL);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(session.userId),
    issued.statement,
  ]);
  await sendMail(env, user.email, { kind: "verify", token: issued.token });
  return noContent();
}

// ---------------------------------------------------------------- password reset

/** Same answer for known and unknown emails. 3 per hour per email (the counter exists for unknown ones too). */
export async function resetRequest(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const { email } = await readJson(request, ResetRequestBody);
  await fixedWindow(env, await rateKey(env, "reset-email", email), RESET_LIMIT_EMAIL, HOUR);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND auth_hash IS NOT NULL")
    .bind(email)
    .first<{ id: string }>();
  if (user) {
    const issued = await issueToken(env, user.id, "reset", RESET_TTL);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL").bind(user.id),
      issued.statement,
    ]);
    await sendMail(env, email, { kind: "reset", token: issued.token });
  }
  return json({ ok: true, message: "If an account exists for this email, we sent a reset link." }, 202);
}

interface ResetTarget {
  user_id: string;
  email: string;
  dek_id: string | null;
  recovery_wrapped_dek: string | null;
}

async function resetTarget(env: Env, hash: string): Promise<ResetTarget> {
  const row = await env.DB.prepare(
    `SELECT t.user_id, u.email, u.dek_id, u.recovery_wrapped_dek FROM tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.purpose = 'reset' AND t.used_at IS NULL AND t.expires_at > ?`,
  )
    .bind(hash, now())
    .first<ResetTarget>();
  if (!row) throw invalidToken();
  return row;
}

/**
 * Before the reset the device needs the recovery wrap (if any) to unwrap the DEK with the recovery code.
 * Does not use up the token. Never returns the password wrap.
 */
export async function resetInfo(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const { token } = await readJson(request, TokenBody);
  const target = await resetTarget(env, await tokenHash(token));
  return json({
    dekId: target.dek_id,
    hasRecovery: target.recovery_wrapped_dek !== null,
    recoveryWrappedDek: target.recovery_wrapped_dek,
  });
}

export async function resetPassword(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const body = await readJson(request, ResetBody);
  const hash = await tokenHash(body.token);
  const target = await resetTarget(env, hash);
  if (body.keys) {
    if (target.dek_id === null || target.recovery_wrapped_dek === null) {
      throw new HttpError(409, "no_recovery", "This account has no recovery code.");
    }
    if (body.keys.dekId !== target.dek_id) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  }

  const t = now();
  const auth = toB64url(await authHash(env, body.authKey));
  const owner = "(SELECT user_id FROM tokens WHERE token_hash = ? AND purpose = 'reset' AND used_at = ?)";
  const update = body.keys
    ? env.DB.prepare(
        `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, pepper_version = ?, email_verified = 1,
           wrapped_dek = ?, recovery_wrapped_dek = ?, rewrap_needed = 0
         WHERE id = ${owner} AND dek_id = ?`,
      ).bind(body.salt, JSON.stringify(body.kdf), auth, PEPPER_VERSION, body.keys.wrappedDek, body.keys.recoveryWrappedDek, hash, t, body.keys.dekId)
    : // Without recovery code no DEK is handed out: the password wrap is dropped (plan 6.8, 10.2).
      env.DB.prepare(
        `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, pepper_version = ?, email_verified = 1,
           wrapped_dek = NULL,
           rewrap_needed = CASE WHEN dek_id IS NULL THEN 0 ELSE 1 END,
           rotation_required = CASE WHEN dek_id IS NULL THEN rotation_required ELSE 1 END
         WHERE id = ${owner}`,
      ).bind(body.salt, JSON.stringify(body.kdf), auth, PEPPER_VERSION, hash, t);

  const [used, changed] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE tokens SET used_at = ? WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?",
    ).bind(t, hash, t),
    update,
    // Every session of the account is signed out.
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ${owner}`).bind(hash, t),
  ]);
  if (!used || used.meta.changes === 0) throw invalidToken();
  if (!changed || changed.meta.changes === 0) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  await sendMail(env, target.email, { kind: "password_changed" });
  return json({ rewrapNeeded: !body.keys && target.dek_id !== null });
}

// ---------------------------------------------------------------- Google

export async function googleNonce(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const nonce = toB64url(randomBytes(32));
  const t = now();
  await env.DB.prepare("INSERT INTO google_nonces (nonce_hash, expires_at) VALUES (?, ?)")
    .bind(toB64url(await sha256(nonce)), t + GOOGLE_NONCE_TTL)
    .run();
  return json({ nonce, expiresAt: t + GOOGLE_NONCE_TTL });
}

/** Verifies the token, then uses up the nonce. A nonce works exactly once. */
async function googleIdentity(env: Env, body: { idToken: string; nonce: string }) {
  const identity = await verifyGoogleIdToken(env, body.idToken, body.nonce);
  const t = now();
  const used = await env.DB.prepare(
    "UPDATE google_nonces SET used_at = ? WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(t, toB64url(await sha256(body.nonce)), t)
    .run();
  if (used.meta.changes === 0) throw new HttpError(401, "invalid_nonce", "Google sign-in expired. Try again.");
  return identity;
}

interface GoogleUser {
  id: string;
  dek_id: string | null;
  recovery_wrapped_dek: string | null;
}

export async function googleLogin(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const body = await readJson(request, GoogleBody);
  const identity = await googleIdentity(env, body);
  const t = now();

  let user = await env.DB.prepare("SELECT id, dek_id, recovery_wrapped_dek FROM users WHERE google_sub = ?")
    .bind(identity.sub)
    .first<GoogleUser>();
  let created = false;
  if (!user) {
    const byEmail = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(identity.email).first();
    if (byEmail) {
      // Never link automatically: whoever controls the Google account must first prove the password.
      throw new HttpError(
        409,
        "account_exists",
        "An account with this email already exists. Sign in with your password, then link Google in your account settings.",
      );
    }
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO users (id, email, email_verified, google_sub, created_at, last_active_at) VALUES (?, ?, 1, ?, ?, ?)`,
      )
        .bind(id, identity.email, identity.sub, t, t)
        .run();
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "account_exists", "An account with this email already exists.");
      throw err;
    }
    user = { id, dek_id: null, recovery_wrapped_dek: null };
    created = true;
  }

  const session = await newSession(env, user.id, null);
  await env.DB.batch([
    session.statement,
    env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(t, user.id),
  ]);
  // New account: this device creates the DEK. Existing account: approval (6.4) or recovery code.
  return withSession(ctx, session.token, {
    userId: user.id,
    created,
    emailVerified: true,
    dekId: user.dek_id,
    recoveryWrappedDek: user.recovery_wrapped_dek,
  }, created ? 201 : 200);
}

/** Linking Google to a password account, only from a recent sign-in. */
export async function linkGoogle(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireRecentAuth(session);
  const body = await readJson(ctx.request, GoogleBody);
  const identity = await googleIdentity(env, body);
  let res: D1Result;
  try {
    res = await env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL")
      .bind(identity.sub, session.userId)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "google_taken", "This Google account belongs to another account.");
    throw err;
  }
  if (res.meta.changes === 0) throw new HttpError(409, "already_linked", "A Google account is already linked.");
  return noContent();
}
