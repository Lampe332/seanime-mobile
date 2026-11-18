/** Email verification, password reset (plan 6.8) and Google sign-in (plan 6.3). */
import { fromB64url, hmacSha256, randomBytes, safeEqual, sha256, toB64url } from "./crypto";
import { verifyGoogleIdToken } from "./google";
import { clientIp, HttpError, json, noContent, readJson } from "./http";
import { notify, sendMail } from "./mail";
import { burstLimit, fixedWindow, ipKey, isKnownNetwork, mailAllowed, rateKey, reserveLoginEmail, reserveLoginIp } from "./ratelimit";
import { authHash, type Ctx, isUniqueViolation, PEPPER_VERSION, withSession } from "./routes";
import { GoogleLoginBody, LinkGoogleBody, ResetBody, ResetRequestBody, TokenBody, UnlinkGoogleBody } from "./schemas";
import { issueChallenge, useOnce, verifySignIn } from "./signature";
import { newSession, now, RECENT_AUTH_SECONDS, requireSession, type Session } from "./session";

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

/**
 * S5: the link from the "Confirm your sign-in" mail (/account/confirm/#token=...), sent when the owner presses the button
 * on that page. Marks that sign-in as confirmed; the device or page that typed the password then presses Continue and
 * signs in with the same key and the same password once within 15 minutes (NEU4-2: nothing else skips the counters).
 */
export async function confirmLogin(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const { token } = await readJson(request, TokenBody);
  const t = now();
  const res = await env.DB.prepare(
    "UPDATE login_links SET confirmed_at = ? WHERE token_hash = ? AND confirmed_at IS NULL AND expires_at > ?",
  )
    .bind(t, await tokenHash(token), t)
    .run();
  if (res.meta.changes === 0) throw invalidToken();
  return json({ confirmed: true });
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
  // NEU-5: also counted per address, across accounts and senders
  if (!(await mailAllowed(env, "verify", user.email, clientIp(ctx.request)))) {
    throw new HttpError(429, "rate_limited", "Too many emails to this address. Try again later.");
  }
  const issued = await issueToken(env, session.userId, "verify", VERIFY_TTL);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL").bind(session.userId),
    issued.statement,
  ]);
  await sendMail(env, user.email, { kind: "verify", token: issued.token });
  return noContent();
}

// ---------------------------------------------------------------- password reset

/**
 * Same answer for known and unknown emails. 3 per hour per email and IP range (the counter exists for unknown ones too).
 * Token and mail for a known email run after the answer (waitUntil), so both answers take the same time.
 */
export async function resetRequest(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const ip = clientIp(request);
  await burstLimit(env.LOGIN_LIMITER, ip);
  const { email } = await readJson(request, ResetRequestBody);
  // N-4: per (email, sender), so somebody elsewhere cannot use up the owner's reset mails. NEU5-1: per address (IPv6 /48),
  // not per /24, so a stranger in the owner's network can't either; the mails stay capped per network (mailAllowed).
  await fixedWindow(env, await rateKey(env, "reset-email", `${email}|${ipKey(ip)}`), RESET_LIMIT_EMAIL, HOUR);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND auth_hash IS NOT NULL")
    .bind(email)
    .first<{ id: string }>();
  if (user) ctx.waitUntil(sendResetLink(env, user.id, email, ip));
  return json({ ok: true, message: "If an account exists for this email, we sent a reset link." }, 202);
}

async function sendResetLink(env: Env, userId: string, email: string, ip: string): Promise<void> {
  try {
    // NEU-5, NEU3-6: a few reset mails per address and sender network, so a stranger never uses up the owner's
    // (checked after the answer, which stays the same). NEU4-1: their own pot; from a network the account signed in
    // from with its password, the cap across networks does not apply, so strangers elsewhere can't silence the owner.
    if (!(await mailAllowed(env, "reset", email, ip, await isKnownNetwork(env, userId, ip)))) return;
    const issued = await issueToken(env, userId, "reset", RESET_TTL);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL").bind(userId),
      issued.statement,
    ]);
    await sendMail(env, email, { kind: "reset", token: issued.token });
  } catch (err) {
    // Never log the email or the token.
    console.error(JSON.stringify({ msg: "reset_link_failed", error: (err as Error)?.name ?? "unknown" }));
  }
}

interface ResetTarget {
  user_id: string;
  email: string;
  dek_id: string | null;
  dek_proof: string | null;
  recovery_wrapped_dek: string | null;
}

async function resetTarget(env: Env, hash: string): Promise<ResetTarget> {
  const row = await env.DB.prepare(
    `SELECT t.user_id, u.email, u.dek_id, u.dek_proof, u.recovery_wrapped_dek FROM tokens t JOIN users u ON u.id = t.user_id
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
    // The recovery wrap's AAD contains the userId; the device needs it to unwrap with the recovery code.
    userId: target.user_id,
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
    // M-5: the recovery code must really have opened the key; a mailbox alone must not overwrite the wraps.
    const expected = target.dek_proof ? fromB64url(target.dek_proof) : null;
    const given = fromB64url(body.keys.dekProof);
    if (!expected || !given || !safeEqual(await sha256(given), expected)) {
      throw new HttpError(403, "key_required", "The recovery code did not open the account key.");
    }
  }

  const t = now();
  const auth = toB64url(await authHash(env, body.authKey));
  const owner = "(SELECT user_id FROM tokens WHERE token_hash = ? AND purpose = 'reset' AND used_at = ?)";
  // H-2: a reset removes a linked Google sign-in; whoever linked one with a stolen password loses it here.
  const update = body.keys
    ? env.DB.prepare(
        `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, pepper_version = ?, email_verified = 1, google_sub = NULL,
           wrapped_dek = ?, recovery_wrapped_dek = ?, rewrap_needed = 0, recovery_renewal_needed = 0
         WHERE id = ${owner} AND dek_id = ?`,
      ).bind(body.salt, JSON.stringify(body.kdf), auth, PEPPER_VERSION, body.keys.wrappedDek, body.keys.recoveryWrappedDek, hash, t, body.keys.dekId)
    : // Without recovery code no DEK is handed out: the password wrap is dropped (plan 6.8, 10.2).
      env.DB.prepare(
        `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, pepper_version = ?, email_verified = 1, google_sub = NULL,
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
  await notify(env, target.user_id, target.email, { kind: "password_changed" });
  return json({ rewrapNeeded: !body.keys && target.dek_id !== null });
}

// ---------------------------------------------------------------- Google

/**
 * NEU-5: the nonce is stateless, time (4 bytes) || random (16) || HMAC (12), so asking for one writes nothing to D1.
 * It is remembered as used only when a valid Google ID token comes with it.
 */
async function nonceMac(env: Env, head: Uint8Array): Promise<Uint8Array> {
  return (await hmacSha256(env.ENUM_SECRET, `google-nonce:v1:${toB64url(head)}`)).slice(0, 12);
}

export async function googleNonce(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const t = now();
  const head = new Uint8Array(20);
  new DataView(head.buffer).setUint32(0, t);
  head.set(randomBytes(16), 4);
  const raw = new Uint8Array(32);
  raw.set(head, 0);
  raw.set(await nonceMac(env, head), 20);
  const nonce = toB64url(raw);
  // The sign-in with this nonce must also carry this one-time challenge, signed with the new key (plan 10.2b).
  return json({ nonce, expiresAt: t + GOOGLE_NONCE_TTL, challenge: await issueChallenge(env, `google:${nonce}`) });
}

/** Verifies the token and the nonce (made here, not expired), then uses up the nonce. A nonce works exactly once. */
async function googleIdentity(env: Env, body: { idToken: string; nonce: string }) {
  const raw = fromB64url(body.nonce);
  const expired = () => new HttpError(401, "invalid_nonce", "Google sign-in expired. Try again.");
  if (!raw || raw.byteLength !== 32 || !safeEqual(raw.slice(20), await nonceMac(env, raw.slice(0, 20)))) throw expired();
  const issued = new DataView(raw.buffer, raw.byteOffset).getUint32(0);
  const t = now();
  if (issued > t + 60 || t - issued > GOOGLE_NONCE_TTL) throw expired();
  const identity = await verifyGoogleIdToken(env, body.idToken, body.nonce);
  if (!(await useOnce(env, `g:${toB64url(await sha256(body.nonce))}`, issued + GOOGLE_NONCE_TTL + 60))) throw expired();
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
  const body = await readJson(request, GoogleLoginBody);
  await verifySignIn(env, request, body.sigKey, body.challenge, `google:${body.nonce}`);
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

  const session = await newSession(env, user.id, null, body.sigKey);
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

/**
 * H-2: the password again (authKey), checked like a login and counted against the same limits, so a session alone (a
 * stolen token, a website session) can neither add nor remove a Google sign-in. Returns the account's email.
 */
export async function requirePassword(env: Env, request: Request, session: Session, authKey: string): Promise<string> {
  const user = await env.DB.prepare("SELECT email, auth_hash, pepper_version FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; auth_hash: string | null; pepper_version: number | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.auth_hash === null) throw new HttpError(409, "no_password", "This account has no password.");
  // Counted before the check (N-5); the session is signed in already, but a stolen one must not guess freely. A device
  // of the account counts only per IP, like a known device at sign-in. NEU5-2: so does a password sign-in within the last
  // 10 minutes (the website's), which proved the password already; a stranger holding the email's counter can't block it.
  const ip = clientIp(request);
  const ipBack = await reserveLoginIp(env, ip);
  const freshPassword = session.passwordAuth && now() - session.authAt <= RECENT_AUTH_SECONDS;
  const { onSuccess, confirmByMail } = await reserveLoginEmail(env, ip, user.email, session.deviceId !== null || freshPassword);
  // NEU5-2: an older password sign-in only needs a new one (through the mailed link if need be), then the above applies
  if (confirmByMail && session.passwordAuth) throw new HttpError(403, "reauth_required", "Sign in again to continue.");
  if (confirmByMail) throw new HttpError(429, "rate_limited", "Too many attempts for this email. Use the app on one of your devices.");
  const stored = fromB64url(user.auth_hash);
  const ok = stored !== null && safeEqual(await authHash(env, authKey), stored) && user.pepper_version === PEPPER_VERSION;
  if (!ok) throw new HttpError(403, "wrong_password", "Wrong password.");
  await env.DB.batch([ipBack, ...onSuccess]);
  return user.email;
}

/** H-2: linking Google to a password account needs the password and is mailed to the account's address. */
export async function linkGoogle(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const body = await readJson(ctx.request, LinkGoogleBody);
  const email = await requirePassword(env, ctx.request, session, body.authKey);
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
  await notify(env, session.userId, email, { kind: "google_linked" });
  return noContent();
}

/** H-2: "Disconnect Google". Only password accounts (else nothing would be left to sign in with); needs the password. */
export async function unlinkGoogle(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const body = await readJson(ctx.request, UnlinkGoogleBody);
  const email = await requirePassword(env, ctx.request, session, body.authKey);
  const res = await env.DB.prepare("UPDATE users SET google_sub = NULL WHERE id = ? AND google_sub IS NOT NULL")
    .bind(session.userId)
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "not_linked", "No Google account is linked.");
  await notify(env, session.userId, email, { kind: "google_unlinked" });
  return noContent();
}
