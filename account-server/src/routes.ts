import { fromB64url, hmacSha256, safeEqual, toB64url } from "./crypto";
import { clientIp, HttpError, json, noContent, readJson, readLimited, requireMediaType } from "./http";
import { burstLimit, clearKey, failureWait, fixedWindow, rateKey, recordFailure } from "./ratelimit";
import { DEFAULT_KDF, DekId, KeysBody, LoginBody, PasswordBody, PreloginBody, SignupBody, Uuid } from "./schemas";
import { sendMail } from "./mail";
import { issueToken, VERIFY_TTL } from "./identity";
import { clearSessionCookie, newSession, now, requireRecentAuth, requireSession, sessionCookie } from "./session";

export interface Ctx {
  request: Request;
  env: Env;
  /** True when the request comes from the website (allowed Origin): the session goes into a cookie. */
  isBrowser: boolean;
  params: Record<string, string>;
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
  if (row?.kdf_salt && row.kdf_params) {
    return json({ salt: row.kdf_salt, kdf: JSON.parse(row.kdf_params) });
  }
  return json({ salt: decoySalt, kdf: DEFAULT_KDF });
}

export async function signup(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const ip = clientIp(request);
  await burstLimit(env.SIGNUP_LIMITER, ip);
  await fixedWindow(env, await rateKey(env, "signup-ip", ip), SIGNUP_LIMIT_IP, HOUR);
  const body = await readJson(request, SignupBody);

  const userId = crypto.randomUUID();
  const t = now();
  const hash = toB64url(await authHash(env, body.authKey));
  const deviceId = body.keys ? crypto.randomUUID() : null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO users (id, email, kdf_salt, kdf_params, auth_hash, pepper_version, wrapped_dek, dek_id, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      body.email,
      body.salt,
      JSON.stringify(body.kdf),
      hash,
      PEPPER_VERSION,
      body.keys?.wrappedDek ?? null,
      body.keys?.dekId ?? null,
      t,
      t,
    ),
  ];
  if (body.keys && deviceId) {
    const d = body.keys.device;
    statements.push(
      env.DB.prepare(
        `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(deviceId, userId, d.name, d.devicePub, d.sealedDek, body.keys.dekId, t, t),
    );
  }
  const session = await newSession(env, userId, deviceId);
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

  const session = await newSession(env, user.id, null);
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
    "SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at",
  )
    .bind(session.userId)
    .all<{ id: string; name: string; created_at: number; last_seen_at: number }>();
  return json({
    devices: results.map((d) => ({
      id: d.id,
      name: d.name,
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
  const user = await env.DB.prepare("SELECT dek_id, auth_hash FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ dek_id: string | null; auth_hash: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");

  if (user.dek_id === null) {
    // First DEK of the account (e.g. account created on the website). Password accounts need the password wrap.
    if (user.auth_hash !== null && body.wrappedDek === undefined) {
      throw new HttpError(400, "invalid_request", "wrappedDek is required for the first key", {}, { fields: ["wrappedDek"] });
    }
  } else if (user.dek_id !== body.dekId) {
    throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  }

  const t = now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE users SET dek_id = ?,
         wrapped_dek = COALESCE(?, wrapped_dek),
         recovery_wrapped_dek = COALESCE(?, recovery_wrapped_dek),
         rewrap_needed = CASE WHEN ? IS NULL THEN rewrap_needed ELSE 0 END
       WHERE id = ? AND (dek_id IS NULL OR dek_id = ?)`,
    ).bind(
      body.dekId,
      body.wrappedDek ?? null,
      body.recoveryWrappedDek ?? null,
      body.wrappedDek ?? null,
      session.userId,
      body.dekId,
    ),
  ];
  let deviceId = session.deviceId;
  if (body.device) {
    const d = body.device;
    if (deviceId) {
      statements.push(
        env.DB.prepare(
          `UPDATE devices SET name = ?, device_pub = ?, sealed_dek = ?, dek_id = ?, last_seen_at = ?
           WHERE id = ? AND user_id = ?`,
        ).bind(d.name, d.devicePub, d.sealedDek, body.dekId, t, deviceId, session.userId),
      );
    } else {
      // A device is recognised by its key: a re-login of the same device updates its row, no duplicate.
      statements.push(
        env.DB.prepare(
          `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, device_pub) DO UPDATE SET
             name = excluded.name, sealed_dek = excluded.sealed_dek, dek_id = excluded.dek_id, last_seen_at = excluded.last_seen_at
           RETURNING id`,
        ).bind(crypto.randomUUID(), session.userId, d.name, d.devicePub, d.sealedDek, body.dekId, t, t),
        env.DB.prepare(
          "UPDATE sessions SET device_id = (SELECT id FROM devices WHERE user_id = ? AND device_pub = ?) WHERE token_hash = ?",
        ).bind(session.userId, d.devicePub, session.tokenHash),
      );
    }
  }
  const [update, upsert] = await env.DB.batch(statements);
  if (!update || update.meta.changes === 0) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  if (body.device && !session.deviceId) deviceId = (upsert?.results[0] as { id: string } | undefined)?.id ?? null;
  return json({ dekId: body.dekId, deviceId });
}

export async function changePassword(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireRecentAuth(session);
  const body = await readJson(ctx.request, PasswordBody);
  const user = await env.DB.prepare("SELECT email, dek_id, auth_hash FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null; auth_hash: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.auth_hash === null) throw new HttpError(409, "no_password", "This account has no password.");
  if (user.dek_id !== body.dekId) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
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
    ctx.env.DB.prepare("SELECT rotation_required, rewrap_needed FROM users WHERE id = ?")
      .bind(session.userId)
      .first<{ rotation_required: number; rewrap_needed: number }>(),
  ]);
  return json({
    version: row?.version ?? 0,
    size: row?.size ?? 0,
    dekId: row?.dek_id ?? null,
    updatedAt: row?.updated_at ?? null,
    // A device was removed (or the password reset without code): rotate the DEK via account/rotate.
    rotationRequired: flags?.rotation_required === 1,
    rewrapNeeded: flags?.rewrap_needed === 1,
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
  await ctx.env.SNAPSHOTS.delete(snapKey(session.userId));
  await ctx.env.DB.prepare("DELETE FROM snapshots WHERE user_id = ?").bind(session.userId).run();
  return noContent();
}
