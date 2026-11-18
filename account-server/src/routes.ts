import { fromB64url, hmacSha256, safeEqual, sha256, toB64url } from "./crypto";
import { clientIp, HttpError, json, noContent, readJson, readLimited, requireMediaType } from "./http";
import { burstLimit, clearKey, failureWait, fixedWindow, rateKey, recordFailure } from "./ratelimit";
import { DEFAULT_KDF, DekId, KeysBody, LoginBody, PasswordBody, PreloginBody, SignupBody, StartFreshBody, Uuid } from "./schemas";
import { sendMail } from "./mail";
import { issueToken, VERIFY_TTL } from "./identity";
import { issueChallenge, verifySignIn } from "./signature";
import {
  clearSessionCookie,
  newSession,
  now,
  requireDevice,
  requireRecentAuth,
  requireSession,
  sessionCookie,
  type Session,
} from "./session";

export interface Ctx {
  request: Request;
  env: Env;
  /** True when the request comes from the website (allowed Origin): the session goes into a cookie. */
  isBrowser: boolean;
  params: Record<string, string>;
  /** Work that may finish after the answer was sent (ExecutionContext.waitUntil). */
  waitUntil: (promise: Promise<unknown>) => void;
}

export const PEPPER_VERSION = 1;
const WRONG_LOGIN = "Wrong email or password";
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const LOGIN_LIMIT_EMAIL = 5;
const LOGIN_LIMIT_IP = 20;
const SIGNUP_LIMIT_IP = 5;
const UPLOAD_LIMIT = 30;
const HOUR = 3600;

export const snapKey = (userId: string) => `snap/${userId}`;

export async function authHash(env: Env, authKey: string): Promise<Uint8Array> {
  return hmacSha256(env.PEPPER_V1, fromB64url(authKey)!);
}

export function withSession(ctx: Ctx, token: string, body: Record<string, unknown>, status = 200): Response {
  if (ctx.isBrowser) return json(body, status, { "Set-Cookie": sessionCookie(token) });
  return json({ ...body, sessionToken: token }, status);
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * The server never sees the DEK. To tell a key holder from a session without the key (a taken-over Google account, a
 * password reset by whoever controls the mailbox, a website session) it keeps SHA-256 of the client's DEK proof
 * (KDF(DEK, 2, "sm-dkey"), see native/src/core/account/crypto.ts dekProof).
 */
export async function proofHash(proof: string): Promise<string> {
  return toB64url(await sha256(fromB64url(proof)!));
}

async function proofMatches(stored: string | null, presented: string | undefined): Promise<boolean> {
  if (!stored || !presented) return false;
  const expected = fromB64url(stored);
  const given = fromB64url(presented);
  return expected !== null && given !== null && safeEqual(await sha256(given), expected);
}

/**
 * K-1, M-5: only a key holder may add a device or change a wrap. That is a session bound to a device row (rows only come
 * from key holders: first key, approval, proof, start fresh) or one that shows the DEK proof.
 */
export async function requireKeyHolder(session: Session, storedProof: string | null, presented: string | undefined): Promise<void> {
  if (session.deviceId !== null) return;
  if (await proofMatches(storedProof, presented)) return;
  throw new HttpError(403, "key_required", "Only a device that holds the account key can do this.");
}

// ---------------------------------------------------------------- auth

export async function prelogin(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.LOGIN_LIMITER, clientIp(request));
  const { email } = await readJson(request, PreloginBody);
  // Always compute the decoy so known and unknown emails cost the same.
  const decoySalt = toB64url((await hmacSha256(env.ENUM_SECRET, `prelogin:${email}`)).slice(0, 16));
  const row = await env.DB.prepare("SELECT kdf_salt, kdf_params FROM users WHERE email = ?")
    .bind(email)
    .first<{ kdf_salt: string | null; kdf_params: string | null }>();
  // One-time challenge for the following login or signup (plan 10.2b), made the same way for unknown emails.
  const challenge = await issueChallenge(env, `email:${email}`);
  if (row?.kdf_salt && row.kdf_params) {
    return json({ salt: row.kdf_salt, kdf: JSON.parse(row.kdf_params), challenge });
  }
  return json({ salt: decoySalt, kdf: DEFAULT_KDF, challenge });
}

export async function signup(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const ip = clientIp(request);
  await burstLimit(env.SIGNUP_LIMITER, ip);
  await fixedWindow(env, await rateKey(env, "signup-ip", ip), SIGNUP_LIMIT_IP, HOUR);
  const body = await readJson(request, SignupBody);
  await verifySignIn(env, request, body.sigKey, body.challenge, `email:${body.email}`);

  const userId = crypto.randomUUID();
  const t = now();
  const hash = toB64url(await authHash(env, body.authKey));
  const deviceId = body.keys ? crypto.randomUUID() : null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO users (id, email, kdf_salt, kdf_params, auth_hash, pepper_version, wrapped_dek, dek_id, dek_proof, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      body.email,
      body.salt,
      JSON.stringify(body.kdf),
      hash,
      PEPPER_VERSION,
      body.keys?.wrappedDek ?? null,
      body.keys?.dekId ?? null,
      body.keys ? await proofHash(body.keys.dekProof) : null,
      t,
      t,
    ),
  ];
  if (body.keys && deviceId) {
    const d = body.keys.device;
    statements.push(
      env.DB.prepare(
        `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(deviceId, userId, d.name, d.devicePub, d.sealedDek, body.keys.dekId, d.mac, t, t),
    );
  }
  const session = await newSession(env, userId, deviceId, body.sigKey);
  const verify = await issueToken(env, userId, "verify", VERIFY_TTL);
  statements.push(session.statement, verify.statement);
  try {
    await env.DB.batch(statements);
  } catch (err) {
    // Deliberate (plan 7): signup reveals an existing email so the user can sign in right away.
    if (isUniqueViolation(err)) throw new HttpError(409, "email_taken", "An account with this email already exists.");
    throw err;
  }
  await sendMail(env, body.email, { kind: "verify", token: verify.token });
  return withSession(ctx, session.token, { userId, deviceId, emailVerified: false }, 201);
}

export async function login(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const ip = clientIp(request);
  await burstLimit(env.LOGIN_LIMITER, ip);
  const body = await readJson(request, LoginBody);

  const emailKey = await rateKey(env, "login-email", body.email);
  const ipKey = await rateKey(env, "login-ip", ip);
  const wait = Math.max(
    await failureWait(env, emailKey, LOGIN_LIMIT_EMAIL),
    await failureWait(env, ipKey, LOGIN_LIMIT_IP),
  );
  if (wait > 0) throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.", {
    "Retry-After": String(wait),
  }, { retryAfter: wait });
  // Signed with the new key and carrying an unused challenge: a captured login cannot be sent again.
  await verifySignIn(env, request, body.sigKey, body.challenge, `email:${body.email}`);

  const user = await env.DB.prepare(
    `SELECT id, auth_hash, pepper_version, kdf_params, wrapped_dek, dek_id, email_verified, rewrap_needed
     FROM users WHERE email = ?`,
  )
    .bind(body.email)
    .first<{
      id: string;
      auth_hash: string | null;
      pepper_version: number | null;
      kdf_params: string | null;
      wrapped_dek: string | null;
      dek_id: string | null;
      email_verified: number;
      rewrap_needed: number;
    }>();
  const presented = await authHash(env, body.authKey);
  const stored = user?.auth_hash ? fromB64url(user.auth_hash) : null;
  // Compare against a zero buffer for unknown users so both paths do the same work.
  const match = safeEqual(presented, stored ?? new Uint8Array(32));
  if (!user || !stored || !match || user.pepper_version !== PEPPER_VERSION) {
    await env.DB.batch([recordFailure(env, emailKey), recordFailure(env, ipKey)]);
    throw new HttpError(401, "wrong_credentials", WRONG_LOGIN);
  }

  const session = await newSession(env, user.id, null, body.sigKey);
  await env.DB.batch([
    session.statement,
    clearKey(env, emailKey),
    env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(now(), user.id),
  ]);
  return withSession(ctx, session.token, {
    userId: user.id,
    emailVerified: user.email_verified === 1,
    kdf: user.kdf_params ? JSON.parse(user.kdf_params) : DEFAULT_KDF,
    wrappedDek: user.wrapped_dek,
    dekId: user.dek_id,
    // After a reset without recovery code: wrappedDek is null until a device that holds the DEK sends a new wrap.
    rewrapNeeded: user.rewrap_needed === 1,
  });
}

export async function logout(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  await ctx.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
  return noContent(ctx.isBrowser ? { "Set-Cookie": clearSessionCookie() } : {});
}

// ---------------------------------------------------------------- devices

export async function listDevices(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, name, device_pub, dek_id, mac, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at",
  )
    .bind(session.userId)
    .all<{ id: string; name: string; device_pub: string; dek_id: string | null; mac: string | null; created_at: number; last_seen_at: number }>();
  return json({
    devices: results.map((d) => ({
      id: d.id,
      name: d.name,
      // Public keys only: a rotating device seals the new DEK to each of them (plan 5).
      devicePub: d.device_pub,
      dekId: d.dek_id,
      // A key holder's MAC over the row: the devices seal only to rows with a valid one (K-1). The server can't check it.
      mac: d.mac,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      current: d.id === session.deviceId,
    })),
  });
}

export async function deleteDevice(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireRecentAuth(session);
  const id = Uuid.safeParse(ctx.params.id);
  if (!id.success) throw new HttpError(404, "not_found");
  const [, del] = await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE device_id = ? AND user_id = ?").bind(id.data, session.userId),
    env.DB.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?").bind(id.data, session.userId),
  ]);
  if (!del || del.meta.changes === 0) throw new HttpError(404, "not_found");
  // The removed device may still know the DEK: the remaining devices should rotate it (plan 6.9).
  await env.DB.prepare("UPDATE users SET rotation_required = 1 WHERE id = ?").bind(session.userId).run();
  return noContent();
}

// ---------------------------------------------------------------- account

export async function putKeys(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireRecentAuth(session);
  const body = await readJson(ctx.request, KeysBody);
  const user = await env.DB.prepare("SELECT email, dek_id, auth_hash, dek_proof FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null; auth_hash: string | null; dek_proof: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");

  const first = user.dek_id === null;
  if (first) {
    // First DEK of the account (e.g. account created on the website or with Google): it comes with its first device,
    // its proof, and for password accounts the password wrap.
    if (!body.device || body.dekProof === undefined) {
      throw new HttpError(400, "invalid_request", "The first key needs its device and proof", {}, { fields: ["device", "dekProof"] });
    }
    if (user.auth_hash !== null && body.wrappedDek === undefined) {
      throw new HttpError(400, "invalid_request", "wrappedDek is required for the first key", {}, { fields: ["wrappedDek"] });
    }
  } else {
    if (user.dek_id !== body.dekId) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
    // K-1, M-5: a session without the key can neither add a device nor overwrite a wrap.
    await requireKeyHolder(session, user.dek_proof, body.dekProof);
  }

  const t = now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE users SET dek_id = ?, dek_proof = COALESCE(?, dek_proof),
         wrapped_dek = COALESCE(?, wrapped_dek),
         recovery_wrapped_dek = COALESCE(?, recovery_wrapped_dek),
         rewrap_needed = CASE WHEN ? IS NULL THEN rewrap_needed ELSE 0 END,
         recovery_renewal_needed = CASE WHEN ? IS NULL THEN recovery_renewal_needed ELSE 0 END
       WHERE id = ? AND ${first ? "dek_id IS NULL" : "dek_id = ?"}`,
    ).bind(
      body.dekId,
      first ? await proofHash(body.dekProof!) : null,
      body.wrappedDek ?? null,
      body.recoveryWrappedDek ?? null,
      body.wrappedDek ?? null,
      body.recoveryWrappedDek ?? null,
      session.userId,
      ...(first ? [] : [body.dekId]),
    ),
  ];
  let deviceId = session.deviceId;
  let newRow = false;
  if (body.device) {
    const d = body.device;
    if (deviceId) {
      // The session's own row only, with its own key: never another device's row (K-1).
      statements.push(
        env.DB.prepare(
          `UPDATE devices SET name = ?, sealed_dek = ?, dek_id = ?, mac = ?, last_seen_at = ?
           WHERE id = ? AND user_id = ? AND device_pub = ?`,
        ).bind(d.name, d.sealedDek, body.dekId, d.mac, t, deviceId, session.userId, d.devicePub),
      );
    } else {
      // Only a key holder gets here (first key or DEK proof). A device that signs in again with the same key takes its
      // old row back; any other session that still used that row is signed out.
      newRow = true;
      statements.push(
        env.DB.prepare(
          `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, device_pub) DO UPDATE SET
             name = excluded.name, sealed_dek = excluded.sealed_dek, dek_id = excluded.dek_id, mac = excluded.mac,
             last_seen_at = excluded.last_seen_at
           RETURNING id`,
        ).bind(crypto.randomUUID(), session.userId, d.name, d.devicePub, d.sealedDek, body.dekId, d.mac, t, t),
        env.DB.prepare(
          `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?
             AND device_id = (SELECT id FROM devices WHERE user_id = ? AND device_pub = ?)`,
        ).bind(session.userId, session.tokenHash, session.userId, d.devicePub),
        env.DB.prepare(
          "UPDATE sessions SET device_id = (SELECT id FROM devices WHERE user_id = ? AND device_pub = ?) WHERE token_hash = ?",
        ).bind(session.userId, d.devicePub, session.tokenHash),
      );
    }
  }
  const [update, deviceWrite] = await env.DB.batch(statements);
  if (!update || update.meta.changes === 0) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  if (body.device && session.deviceId && deviceWrite?.meta.changes === 0) {
    throw new HttpError(409, "device_mismatch", "This session belongs to another device key.");
  }
  if (newRow) deviceId = (deviceWrite?.results[0] as { id: string } | undefined)?.id ?? null;
  // M-3: every device that joins and every new recovery wrap is mailed to the account's address.
  if (newRow) await sendMail(env, user.email, { kind: "new_device", deviceName: body.device!.name });
  if (body.recoveryWrappedDek !== undefined) await sendMail(env, user.email, { kind: "recovery_changed" });
  return json({ dekId: body.dekId, deviceId });
}

export async function changePassword(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireRecentAuth(session);
  const body = await readJson(ctx.request, PasswordBody);
  const user = await env.DB.prepare("SELECT email, dek_id, auth_hash, dek_proof FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null; auth_hash: string | null; dek_proof: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.auth_hash === null) throw new HttpError(409, "no_password", "This account has no password.");
  if (user.dek_id !== body.dekId) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  // M-5: the new password wrap must come from a key holder, not from a Google sign-in that wants the password.
  await requireKeyHolder(session, user.dek_proof, body.dekProof);
  const hash = toB64url(await authHash(env, body.authKey));
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, pepper_version = ?, wrapped_dek = ?
       WHERE id = ?`,
    ).bind(body.salt, JSON.stringify(body.kdf), hash, PEPPER_VERSION, body.wrappedDek, session.userId),
    // Every other session is signed out (plan 6.7).
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(session.userId, session.tokenHash),
  ]);
  await sendMail(env, user.email, { kind: "password_changed" });
  return noContent();
}

/**
 * Removes every trace of an account: all D1 rows in one transaction, then the R2 blob.
 * `onlyIf` is an extra SQL condition on the users row (e.g. "still unconfirmed"), checked inside the same
 * transaction, so the cron never deletes an account that changed in the meantime. Returns whether it was deleted.
 */
export async function deleteUserData(env: Env, userId: string, onlyIf = "1 = 1"): Promise<boolean> {
  const guard = `EXISTS (SELECT 1 FROM users WHERE id = ? AND ${onlyIf})`;
  const results = await env.DB.batch(
    ["sessions", "devices", "tokens", "device_requests", "snapshots"]
      .map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ? AND ${guard}`).bind(userId, userId))
      .concat(env.DB.prepare(`DELETE FROM users WHERE id = ? AND ${onlyIf}`).bind(userId)),
  );
  const deleted = (results.at(-1)?.meta.changes ?? 0) > 0;
  if (deleted) await env.SNAPSHOTS.delete(snapKey(userId));
  return deleted;
}

export async function deleteAccount(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  requireRecentAuth(session);
  const user = await ctx.env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string }>();
  if (await deleteUserData(ctx.env, session.userId)) {
    if (user) await sendMail(ctx.env, user.email, { kind: "account_deleted" });
  }
  return noContent(ctx.isBrowser ? { "Set-Cookie": clearSessionCookie() } : {});
}

/** What the account page shows: never a key, a hash or a wrap, only whether they exist. */
export async function getAccount(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const user = await ctx.env.DB.prepare(
    `SELECT email, email_verified, google_sub, auth_hash, recovery_wrapped_dek, dek_id, created_at,
       rewrap_needed, rotation_required, recovery_renewal_needed
     FROM users WHERE id = ?`,
  )
    .bind(session.userId)
    .first<{
      email: string;
      email_verified: number;
      google_sub: string | null;
      auth_hash: string | null;
      recovery_wrapped_dek: string | null;
      dek_id: string | null;
      created_at: number;
      rewrap_needed: number;
      rotation_required: number;
      recovery_renewal_needed: number;
    }>();
  if (!user) throw new HttpError(401, "unauthorized");
  return json({
    userId: session.userId,
    email: user.email,
    emailVerified: user.email_verified === 1,
    googleLinked: user.google_sub !== null,
    hasPassword: user.auth_hash !== null,
    hasRecovery: user.recovery_wrapped_dek !== null,
    dekId: user.dek_id,
    createdAt: user.created_at,
    rewrapNeeded: user.rewrap_needed === 1,
    rotationRequired: user.rotation_required === 1,
    recoveryRenewalNeeded: user.recovery_renewal_needed === 1,
  });
}

/**
 * The DEK sealed to this session's device. After another device rotated the key, this device fetches the new one
 * here and opens it with its private key; no new sign-in needed.
 */
export async function getDeviceKey(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const deviceId = requireDevice(session);
  const row = await ctx.env.DB.prepare(
    `SELECT d.dek_id, d.sealed_dek, u.chain_from, u.chain_mac FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.id = ? AND d.user_id = ? AND d.sealed_dek IS NOT NULL AND d.dek_id IS NOT NULL`,
  )
    .bind(deviceId, session.userId)
    .first<{ dek_id: string; sealed_dek: string; chain_from: string | null; chain_mac: string | null }>();
  if (!row) throw new HttpError(404, "not_found", "This device has no key on the server.");
  // The device takes the new key only if the old one vouches for it (chainMac over the new DEK, K-1).
  return json({ deviceId, dekId: row.dek_id, sealedDek: row.sealed_dek, chainFrom: row.chain_from, chainMac: row.chain_mac });
}

/**
 * Start fresh (plan 2, 6.3, 6.8): the old DEK is lost (no device, no recovery code). In one transaction the synced
 * snapshot, every device and its key, open approval requests and all other sessions go; the account gets the new
 * dekId, its wraps and this device sealed to the new key. The R2 blob is deleted afterwards.
 */
export async function startFresh(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireRecentAuth(session);
  const body = await readJson(ctx.request, StartFreshBody);
  const user = await env.DB.prepare("SELECT email, dek_id, auth_hash FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null; auth_hash: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.auth_hash !== null && body.wrappedDek === undefined) {
    throw new HttpError(400, "invalid_request", "wrappedDek is required for password accounts", {}, { fields: ["wrappedDek"] });
  }
  if (user.dek_id === body.dekId) throw new HttpError(400, "invalid_request", "dekId must be new", {}, { fields: ["dekId"] });

  const userId = session.userId;
  const deviceId = crypto.randomUUID();
  const t = now();
  const d = body.device;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM snapshots WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM device_requests WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(userId, session.tokenHash),
    // this session may belong to an old device row: detach it first, or the row's ON DELETE CASCADE ends it
    env.DB.prepare("UPDATE sessions SET device_id = NULL WHERE token_hash = ?").bind(session.tokenHash),
    env.DB.prepare("DELETE FROM devices WHERE user_id = ?").bind(userId),
    // A new key chain starts: no chain MAC, so the account's other devices refuse the new key and ask their user.
    env.DB.prepare(
      `UPDATE users SET dek_id = ?, dek_proof = ?, wrapped_dek = ?, recovery_wrapped_dek = ?, chain_from = NULL, chain_mac = NULL,
         rewrap_needed = 0, rotation_required = 0, recovery_renewal_needed = 0
       WHERE id = ?`,
    ).bind(body.dekId, await proofHash(body.dekProof), body.wrappedDek ?? null, body.recoveryWrappedDek ?? null, userId),
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(deviceId, userId, d.name, d.devicePub, d.sealedDek, body.dekId, d.mac, t, t),
    env.DB.prepare("UPDATE sessions SET device_id = ? WHERE token_hash = ?").bind(deviceId, session.tokenHash),
  ]);
  await env.SNAPSHOTS.delete(snapKey(userId));
  await sendMail(env, user.email, { kind: "start_fresh" });
  return json({ dekId: body.dekId, deviceId });
}

// ---------------------------------------------------------------- sync

interface SnapshotRow {
  version: number;
  size: number;
  dek_id: string;
  updated_at: number;
}

export function snapshotRow(env: Env, userId: string): Promise<SnapshotRow | null> {
  return env.DB.prepare("SELECT version, size, dek_id, updated_at FROM snapshots WHERE user_id = ?")
    .bind(userId)
    .first<SnapshotRow>();
}

export async function syncMeta(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const [row, flags] = await Promise.all([
    snapshotRow(ctx.env, session.userId),
    ctx.env.DB.prepare("SELECT rotation_required, rewrap_needed, recovery_renewal_needed FROM users WHERE id = ?")
      .bind(session.userId)
      .first<{ rotation_required: number; rewrap_needed: number; recovery_renewal_needed: number }>(),
  ]);
  return json({
    version: row?.version ?? 0,
    size: row?.size ?? 0,
    dekId: row?.dek_id ?? null,
    updatedAt: row?.updated_at ?? null,
    // A device was removed (or the password reset without code): rotate the DEK via account/rotate.
    rotationRequired: flags?.rotation_required === 1,
    rewrapNeeded: flags?.rewrap_needed === 1,
    // A rotation without the recovery code dropped the recovery wrap: the user should save a new code.
    recoveryRenewalNeeded: flags?.recovery_renewal_needed === 1,
  });
}

export async function getSnapshot(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const obj = await ctx.env.SNAPSHOTS.get(snapKey(session.userId));
  if (!obj) throw new HttpError(404, "not_found", "No snapshot stored.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(obj.size),
      "X-Snapshot-Version": obj.customMetadata?.version ?? "0",
      "X-Dek-Id": obj.customMetadata?.dekId ?? "",
    },
  });
}

export async function putSnapshot(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const session = await requireSession(request, env);
  // M-5: only a device that holds the key writes the synced data (no website or keyless session).
  requireDevice(session);
  requireMediaType(request, "application/octet-stream");

  const ifMatch = (request.headers.get("If-Match") ?? "").replace(/^"(.*)"$/, "$1");
  const dekId = DekId.safeParse(request.headers.get("X-Dek-Id") ?? "");
  if (!dekId.success) throw new HttpError(400, "invalid_request", "Missing or invalid X-Dek-Id", {}, { fields: ["X-Dek-Id"] });
  const length = request.headers.get("Content-Length");
  if (length === null) throw new HttpError(411, "length_required");

  await fixedWindow(env, await rateKey(env, "upload", session.userId), UPLOAD_LIMIT, HOUR);
  const blob = await readLimited(request, MAX_SNAPSHOT_BYTES);
  if (blob.byteLength === 0) throw new HttpError(400, "invalid_request", "Empty snapshot");

  const user = await env.DB.prepare("SELECT dek_id FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ dek_id: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.dek_id !== dekId.data) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");

  const previous = await snapshotRow(env, session.userId);
  const current = previous?.version ?? 0;
  if (!/^\d{1,15}$/.test(ifMatch) || Number(ifMatch) !== current) {
    throw new HttpError(409, "version_conflict", "The snapshot changed. Download, merge and retry.", {}, { version: current });
  }
  const next = current + 1;
  const t = now();

  // Claim the version in D1 first; a concurrent upload loses here with 409.
  const claim = previous
    ? env.DB.prepare(
        "UPDATE snapshots SET version = ?, size = ?, dek_id = ?, updated_at = ? WHERE user_id = ? AND version = ?",
      ).bind(next, blob.byteLength, dekId.data, t, session.userId, current)
    : env.DB.prepare(
        "INSERT INTO snapshots (user_id, version, size, dek_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING",
      ).bind(session.userId, next, blob.byteLength, dekId.data, t);
  const claimed = await claim.run();
  if (claimed.meta.changes === 0) {
    throw new HttpError(409, "version_conflict", "The snapshot changed. Download, merge and retry.", {}, { version: current });
  }

  try {
    await env.SNAPSHOTS.put(snapKey(session.userId), blob, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { version: String(next), dekId: dekId.data },
    });
  } catch (err) {
    // Roll the metadata back so it never points at a blob that was not written.
    await (previous
      ? env.DB.prepare(
          "UPDATE snapshots SET version = ?, size = ?, dek_id = ?, updated_at = ? WHERE user_id = ? AND version = ?",
        ).bind(previous.version, previous.size, previous.dek_id, previous.updated_at, session.userId, next)
      : env.DB.prepare("DELETE FROM snapshots WHERE user_id = ? AND version = ?").bind(session.userId, next)
    ).run();
    throw err;
  }
  return json({ version: next, size: blob.byteLength, updatedAt: t });
}

export async function deleteSync(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  requireDevice(session);
  await ctx.env.SNAPSHOTS.delete(snapKey(session.userId));
  await ctx.env.DB.prepare("DELETE FROM snapshots WHERE user_id = ?").bind(session.userId).run();
  return noContent();
}
