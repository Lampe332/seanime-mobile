/**
 * Sign in with a code from an email (4.2.0) and the opt-in "sign in with an email code only" (escrow).
 *
 * A code sign-in proves the mailbox, not the password. By default it gives a session without the key: the device unlocks
 * the data like any new device (approval from another device, recovery code) or starts fresh. Only when the owner turned
 * on "code only" (password typed again, mailed) does the server keep the raw DEK, sealed with AES-GCM under the secret
 * ESCROW_KEY, and hand it to a code sign-in. Turning it off deletes that copy at once.
 */
import { fromB64url, hmacSha256, randomBytes, safeEqual, toB64url } from "./crypto";
import { clientIp, HttpError, json, noContent, readJson } from "./http";
import { requirePassword } from "./identity";
import { eventStatement, notify, sendMail } from "./mail";
import { burstLimit, fixedWindow, ipKey, ipRange, isKnownNetwork, mailAllowed, rateKey, rememberNetwork, reserveLoginIp } from "./ratelimit";
import { authHash, CODE_WINDOW_SECONDS, type Ctx, HOUR, keyRequired, PEPPER_VERSION, proofMatches, withSession } from "./routes";
import { AfterCodeBody, CodeLoginBody, CodeRequestBody, DEFAULT_KDF, EscrowBody } from "./schemas";
import { newSession, now, requireDevice, requireSession } from "./session";
import { verifySignIn } from "./signature";

export const CODE_TTL = 10 * 60;
export const CODE_MAX_ATTEMPTS = 5;
/** Codes asked for per hour per (email, IP address or IPv6 /48), like reset links */
export const CODE_LIMIT_EMAIL = 3;
/** Code tries per email per day across all networks the account never signed in from, so guessing stays far from 10^6 */
export const CODE_TRIES_EMAIL_DAY = 20;
/**
 * N2: and per week across those networks. 20 a day alone allow ~7300 tries a year (0.7 % to hit one code); 50 a week
 * allow ~2600 (0.26 %). A fixed cap, not a growing wait: it only ever holds up strangers' networks, never the owner's.
 */
export const CODE_TRIES_EMAIL_WEEK = 50;
/** M1: a network the account signed in from (NEU4-1) has its own cap per day instead, which strangers elsewhere can't use up */
export const CODE_TRIES_NETWORK_DAY = 20;
/** How long a code sign-in may set a new password without the old one */
export const AFTER_CODE_SECONDS = 15 * 60;
const DAY = 24 * 3600;
const WEEK = 7 * DAY;

const invalidCode = () => new HttpError(401, "invalid_code", "This code is wrong or expired.");

/** Six digits, uniform (rejection sampling), leading zeros kept */
export function newCode(): string {
  const limit = 4294 * 1_000_000; // largest multiple of 10^6 below 2^32
  for (;;) {
    const v = new DataView(randomBytes(4).buffer).getUint32(0);
    if (v < limit) return String(v % 1_000_000).padStart(6, "0");
  }
}

/** Only this HMAC is stored, bound to the account; without the pepper a leaked table tells nothing */
async function codeHash(env: Env, userId: string, code: string): Promise<Uint8Array> {
  return hmacSha256(env.PEPPER_V1, `sign-in-code:v1:${userId}:${code}`);
}

// ---------------------------------------------------------------- escrow

/** Every failure answers 500 and logs only this name: a missing or malformed secret */
async function escrowKey(env: Env): Promise<CryptoKey> {
  const raw = fromB64url(env.ESCROW_KEY ?? "");
  if (!raw || raw.byteLength !== 32) {
    const err = new Error("ESCROW_KEY must be 32 bytes, base64url");
    err.name = "EscrowKeyError";
    throw err;
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const escrowAad = (userId: string, dekId: string) => new TextEncoder().encode(`sm-escrow-v1\n${userId}\n${dekId}`);

/** The raw DEK sealed for the account and its dekId: base64url(iv || AES-GCM ciphertext) */
export async function sealEscrow(env: Env, userId: string, dekId: string, dek: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: escrowAad(userId, dekId) }, await escrowKey(env), fromB64url(dek)!),
  );
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(ct, iv.byteLength);
  return toB64url(out);
}

/** The raw DEK (base64url), or null when the box does not open for this account and key */
async function openEscrow(env: Env, userId: string, dekId: string, box: string): Promise<string | null> {
  const raw = fromB64url(box);
  if (!raw || raw.byteLength <= 12) return null;
  const key = await escrowKey(env);
  try {
    const dek = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: escrowAad(userId, dekId) },
      key,
      raw.slice(12),
    );
    return toB64url(dek);
  } catch {
    console.error(JSON.stringify({ msg: "escrow_open_failed" }));
    return null;
  }
}

// ---------------------------------------------------------------- code

/**
 * Same answer and time for known and unknown emails: the code and its mail run after the answer (waitUntil), like a
 * reset link. 3 per hour per (email, sender), and the mail counts against its own pot (NEU4-1).
 */
export async function codeRequest(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const ip = clientIp(request);
  await burstLimit(env.LOGIN_LIMITER, ip);
  const { email } = await readJson(request, CodeRequestBody);
  await fixedWindow(env, await rateKey(env, "code-email", `${email}|${ipKey(ip)}`), CODE_LIMIT_EMAIL, HOUR);
  // M2: only accounts with a password get a code (like a reset link); a Google-only account answers like an unknown one,
  // or its mailbox alone would own it
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND auth_hash IS NOT NULL").bind(email).first<{ id: string }>();
  if (user) ctx.waitUntil(sendCode(env, user.id, email, ip));
  return json({ sent: true });
}

async function sendCode(env: Env, userId: string, email: string, ip: string): Promise<void> {
  try {
    if (!(await mailAllowed(env, "code", email, ip, await isKnownNetwork(env, userId, ip)))) return;
    const code = newCode();
    // one code per account: a new one replaces the old one and its tries
    await env.DB.prepare(
      `INSERT INTO sign_in_codes (user_id, code_hash, attempts, expires_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at`,
    )
      .bind(userId, toB64url(await codeHash(env, userId, code)), now() + CODE_TTL)
      .run();
    await sendMail(env, email, { kind: "sign_in_code", code });
  } catch (err) {
    // Never log the email or the code.
    console.error(JSON.stringify({ msg: "sign_in_code_failed", error: (err as Error)?.name ?? "unknown" }));
  }
}

/**
 * Signed like auth/login. Every failure (wrong, expired, used up, unknown email, no code) is the same 401. The try is
 * counted on the code in one statement before the check, so parallel tries never pass 5; a right code is deleted before
 * the session is made, so it works once.
 */
export async function codeLogin(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const ip = clientIp(request);
  await burstLimit(env.LOGIN_LIMITER, ip);
  const body = await readJson(request, CodeLoginBody);
  // the login counter per IP first, like auth/login (NEU3-7)
  const ipBack = await reserveLoginIp(env, ip);
  await verifySignIn(env, request, body.sigKey, body.challenge, `email:${body.email}`);
  // M2: never for an account without a password, even with a code from before
  const account = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND auth_hash IS NOT NULL")
    .bind(body.email)
    .first<{ id: string }>();
  // M1 (like NEU4-1): a network the account signed in from has its own cap; every other one counts per email across
  // networks, per day and per week (N2), so strangers there are held up and the owner's network never is. The same work
  // for unknown emails, which always count across networks.
  if (await isKnownNetwork(env, account?.id ?? "-", ip)) {
    await fixedWindow(env, await rateKey(env, "code-try-net", `${body.email}|${ipRange(ip)}`), CODE_TRIES_NETWORK_DAY, DAY);
  } else {
    await fixedWindow(env, await rateKey(env, "code-try-all", body.email), CODE_TRIES_EMAIL_DAY, DAY);
    await fixedWindow(env, await rateKey(env, "code-try-week", body.email), CODE_TRIES_EMAIL_WEEK, WEEK);
  }

  const row = await env.DB.prepare(
    `UPDATE sign_in_codes SET attempts = attempts + 1
     WHERE user_id = ? AND expires_at > ? AND attempts < ?
     RETURNING user_id, code_hash`,
  )
    .bind(account?.id ?? "", now(), CODE_MAX_ATTEMPTS)
    .first<{ user_id: string; code_hash: string }>();
  // the same work without a code: an HMAC and a compare against zeros
  const presented = await codeHash(env, row?.user_id ?? "-", body.code);
  const stored = row ? fromB64url(row.code_hash) : null;
  const match = safeEqual(presented, stored ?? new Uint8Array(32));
  if (!row || !stored || !match) throw invalidCode();

  const user = await env.DB.prepare(
    "SELECT id, kdf_params, wrapped_dek, dek_id, rewrap_needed, escrow_dek, recovery_wrapped_dek FROM users WHERE id = ?",
  )
    .bind(row.user_id)
    .first<{
      id: string;
      kdf_params: string | null;
      wrapped_dek: string | null;
      dek_id: string | null;
      rewrap_needed: number;
      escrow_dek: string | null;
      recovery_wrapped_dek: string | null;
    }>();
  if (!user) throw invalidCode();
  // N4: opened before the code is used up, so a missing or broken ESCROW_KEY (500) leaves the code and no session.
  // Only when the owner turned on "code only"; otherwise the device unlocks like any new one.
  const escrowDek = user.escrow_dek && user.dek_id ? await openEscrow(env, user.id, user.dek_id, user.escrow_dek) : null;
  const used = await env.DB.prepare("DELETE FROM sign_in_codes WHERE user_id = ? AND code_hash = ? RETURNING user_id")
    .bind(row.user_id, row.code_hash)
    .first();
  if (!used) throw invalidCode();
  const session = await newSession(env, user.id, null, body.sigKey, false, true, ctx.isBrowser);
  const t = now();
  await env.DB.batch([
    session.statement,
    ipBack,
    // the code came to this address, so it is confirmed now (like a reset). The first code of a window starts the wait
    // before Start fresh (routes.ts startFreshWait); later codes in the same 7 days don't move it.
    env.DB.prepare(
      `UPDATE users SET last_active_at = ?1, email_verified = 1,
         code_since = CASE WHEN code_since IS NULL OR code_since < ?2 THEN ?1 ELSE code_since END
       WHERE id = ?3`,
    ).bind(t, t - CODE_WINDOW_SECONDS, user.id),
    eventStatement(env, user.id, { kind: "signed_in", method: "code", sigKey: body.sigKey }),
    // M1: this network is the owner's from now on (NEU4-1)
    await rememberNetwork(env, user.id, ip),
  ]);
  return withSession(ctx, session.token, {
    userId: user.id,
    emailVerified: true,
    kdf: user.kdf_params ? JSON.parse(user.kdf_params) : DEFAULT_KDF,
    wrappedDek: user.wrapped_dek,
    dekId: user.dek_id,
    rewrapNeeded: user.rewrap_needed === 1,
    codeLogin: true,
    // like auth/google: the device may unlock with the recovery code
    recoveryWrappedDek: user.recovery_wrapped_dek,
    escrowDek,
  });
}

// ---------------------------------------------------------------- "code only" on / off

/**
 * On: a device of the account (it holds the key) sends the raw DEK and the password again, checked and counted like
 * Disconnect Google. The server seals the DEK for this account and its current dekId. Mailed and listed (I5).
 */
export async function putEscrow(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireDevice(session);
  const body = await readJson(ctx.request, EscrowBody);
  const email = await requirePassword(env, ctx.request, session, body.authKey);
  const user = await env.DB.prepare("SELECT dek_id, dek_proof FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ dek_id: string | null; dek_proof: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.dek_id === null) throw new HttpError(409, "no_key", "This account has no key yet.");
  // N3: the proof of the key the device holds must be the account's, so a device with an older key never seals that one
  if (!(await proofMatches(user.dek_proof, body.dekProof))) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  const box = await sealEscrow(env, session.userId, user.dek_id, body.dek);
  const res = await env.DB.prepare("UPDATE users SET escrow_dek = ? WHERE id = ? AND dek_id = ?")
    .bind(box, session.userId, user.dek_id)
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  await notify(env, session.userId, email, { kind: "code_only_on" });
  return noContent();
}

/** Off: any session of the account; the server's copy of the key is gone at once. */
export async function deleteEscrow(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const row = await env.DB.prepare("UPDATE users SET escrow_dek = NULL WHERE id = ? AND escrow_dek IS NOT NULL RETURNING email")
    .bind(session.userId)
    .first<{ email: string }>();
  if (row) await notify(env, session.userId, row.email, { kind: "code_only_off" });
  return noContent();
}

// ---------------------------------------------------------------- new password after a code sign-in

/**
 * A code sign-in within the last 15 minutes sets a new password for the current key (forgot the password, data unlocked
 * by "code only", another device or the recovery code). The wrap must come from a key holder: a device row of this
 * session or the DEK proof, like account/password. Other sessions stay; a linked Google sign-in goes (NEU-10). Mailed.
 */
export async function passwordAfterCode(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  if (!session.codeAuth || now() - session.authAt > AFTER_CODE_SECONDS) {
    throw new HttpError(403, "reauth_required", "Sign in with a code again to continue.");
  }
  const body = await readJson(ctx.request, AfterCodeBody);
  const user = await env.DB.prepare("SELECT email, dek_id, dek_proof, auth_hash FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null; dek_proof: string | null; auth_hash: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  // M2: a mailbox never gives a Google-only account a password (it would own the account then)
  if (user.auth_hash === null) throw new HttpError(409, "no_password", "This account has no password.");
  if (user.dek_id === null || user.dek_id !== body.dekId) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  if (session.deviceId === null && !(await proofMatches(user.dek_proof, body.dekProof))) throw keyRequired();
  const hash = toB64url(await authHash(env, body.authKey));
  const res = await env.DB.prepare(
    `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, pepper_version = ?, wrapped_dek = ?, rewrap_needed = 0,
       google_sub = NULL
     WHERE id = ? AND dek_id = ? AND auth_hash IS NOT NULL`,
  )
    .bind(body.salt, JSON.stringify(body.kdf), hash, PEPPER_VERSION, body.wrappedDek, session.userId, body.dekId)
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  await notify(env, session.userId, user.email, { kind: "password_changed", afterCode: true });
  return noContent();
}
