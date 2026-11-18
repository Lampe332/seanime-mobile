/**
 * New-device approval v2 with commitment (plan 6.4), the numeric-comparison scheme of Bluetooth / ZRTP.
 *
 *   1. New device N:  POST devices/requests {deviceName, devicePub = pkN, commitment}
 *   2. Old device O:  GET  devices/requests, then POST devices/requests/:id/nonce {nonce = rO, approverPub = pkO}
 *   3. N:             GET  devices/requests/:id (sees rO, pkO), then POST devices/requests/:id/reveal {reveal = rN}
 *   4. Server and O:  check the commitment. Both devices show SAS = 6 digits of SHA-256("sm-approve-v2\n" || pkN || pkO
 *                     || rN || rO) and ask their user whether the other device shows the same number (NEU-1).
 *   5. O:             POST devices/requests/:id/approve {dekId, sealedDek = crypto_box(DEK, pkN, skO), mac} or .../deny
 *   6. N:             GET  devices/requests/:id -> sealedDek, dekId, deviceId; opens the box only with the pkO of the
 *                     number its user confirmed. Either side may deny.
 *
 * Byte format of the commitment: devicePub is the raw 32-byte X25519 public key, rN and rO are 32 random bytes each.
 * All travel as base64url without padding. commitment = SHA-256("sm-commit-v2\n" || pub[32] || rN[32]), sent as
 * base64url of the 32-byte digest. A v1 commitment (without the prefix) never matches.
 *
 * The order is enforced: no reveal before rO (else N could pick rN after seeing rO and steer the SAS),
 * no approve before a valid reveal. A request expires after 10 minutes; at most 3 open per account
 * and 5 new per hour.
 */
import { fromB64url, safeEqual, sha256 } from "./crypto";
import { HttpError, json, noContent, readJson } from "./http";
import { notify } from "./mail";
import { fixedWindow, rateKey, windowCount } from "./ratelimit";
import { isUniqueViolation, removedError, wasRemoved, type Ctx } from "./routes";
import { ApproveBody, ApproverNonceBody, DeviceRequestBody, RevealBody, Uuid } from "./schemas";
import { copyDeviceKey, now, requireDevice, requireSession, type Session } from "./session";

const REQUEST_TTL = 10 * 60;
const MAX_OPEN = 3;
const NEW_PER_HOUR = 5;
const OPEN = "('pending', 'nonce', 'revealed')";
/** S1: after this many "No" answers (or failed commitments) within an hour, approvals pause for an hour, mailed */
const NO_LIMIT = 3;
const PAUSE_SECONDS = 3600;

const noKey = (env: Env, userId: string) => rateKey(env, "approval-no", userId);

/** S1: counts a "No" (a number that did not match); the third within an hour pauses approvals for an hour and mails */
async function countNo(env: Env, userId: string): Promise<void> {
  const key = await noKey(env, userId);
  await fixedWindow(env, key, Number.MAX_SAFE_INTEGER, PAUSE_SECONDS);
  if ((await windowCount(env, key)) !== NO_LIMIT) return;
  await env.DB.prepare("UPDATE rate_limits SET expires_at = ? WHERE key = ?").bind(now() + PAUSE_SECONDS, key).run();
  await env.DB.prepare("UPDATE device_requests SET status = 'denied' WHERE user_id = ? AND status IN " + OPEN).bind(userId).run();
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  if (user) await notify(env, userId, user.email, { kind: "approvals_paused" });
}

type Status = "pending" | "nonce" | "revealed" | "approved" | "denied";

interface RequestRow {
  id: string;
  user_id: string;
  device_name: string;
  device_pub: string;
  commitment: string;
  approver_nonce: string | null;
  reveal: string | null;
  sealed_dek: string | null;
  status: Status;
  created_at: number;
  expires_at: number;
  session_hash: string | null;
  approver_device_id: string | null;
  approver_pub: string | null;
  device_id: string | null;
  dek_id: string | null;
}

/** Checks the commitment of the new device: SHA-256(devicePub || rN) == commitment, in constant time. */
const COMMIT_PREFIX = new TextEncoder().encode("sm-commit-v2\n");

export async function commitmentMatches(devicePub: string, reveal: string, commitment: string): Promise<boolean> {
  const pub = fromB64url(devicePub);
  const rN = fromB64url(reveal);
  const c = fromB64url(commitment);
  if (!pub || !rN || !c || pub.byteLength !== 32 || rN.byteLength !== 32 || c.byteLength !== 32) return false;
  const input = new Uint8Array(COMMIT_PREFIX.length + 64);
  input.set(COMMIT_PREFIX, 0);
  input.set(pub, COMMIT_PREFIX.length);
  input.set(rN, COMMIT_PREFIX.length + 32);
  return safeEqual(await sha256(input), c);
}

/** Loads a request of the session's own account. Foreign or unknown ids are 404 (IDOR). */
async function loadRequest(ctx: Ctx, session: Session): Promise<RequestRow> {
  const id = Uuid.safeParse(ctx.params.id);
  if (!id.success) throw new HttpError(404, "not_found");
  const row = await ctx.env.DB.prepare("SELECT * FROM device_requests WHERE id = ? AND user_id = ?")
    .bind(id.data, session.userId)
    .first<RequestRow>();
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

function requireOpen(row: RequestRow, expected: Status): void {
  if (row.status === "denied") throw new HttpError(409, "request_denied", "This request was denied.");
  if (row.status !== "approved" && row.expires_at <= now()) throw new HttpError(410, "request_expired", "This request expired.");
  if (row.status !== expected) throw new HttpError(409, "wrong_order", `Request is ${row.status}, expected ${expected}.`);
}

function isRequester(row: RequestRow, session: Session): boolean {
  return row.session_hash !== null && row.session_hash === session.tokenHash;
}

function publicView(row: RequestRow) {
  return {
    id: row.id,
    deviceName: row.device_name,
    devicePub: row.device_pub,
    commitment: row.commitment,
    approverNonce: row.approver_nonce,
    approverPub: row.approver_pub,
    reveal: row.reveal,
    status: row.status !== "approved" && row.status !== "denied" && row.expires_at <= now() ? "expired" : row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Step 1, new device. Needs a session (password or Google login) but no DEK yet. */
export async function createRequest(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  if (session.deviceId !== null) throw new HttpError(409, "already_approved", "This device is already approved.");
  const body = await readJson(ctx.request, DeviceRequestBody);
  // NEU-12: a request never takes over a device row; a removed device key never comes back (NEU-2)
  if (await wasRemoved(env, session.userId, body.devicePub)) throw removedError();
  const taken = await env.DB.prepare("SELECT 1 AS k FROM devices WHERE user_id = ? AND device_pub = ?")
    .bind(session.userId, body.devicePub)
    .first<{ k: number }>();
  if (taken) throw new HttpError(409, "device_registered", "This device key already belongs to a device of the account.");
  const t = now();
  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM device_requests WHERE user_id = ? AND status IN ${OPEN} AND expires_at > ?`,
  )
    .bind(session.userId, t)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN) {
    throw new HttpError(429, "too_many_open_requests", "Too many open requests. Wait a few minutes.");
  }
  if ((await windowCount(env, await noKey(env, session.userId))) >= NO_LIMIT) {
    throw new HttpError(429, "approvals_paused", "The numbers didn't match three times. Approving devices is paused for an hour.");
  }
  await fixedWindow(env, await rateKey(env, "approval", session.userId), NEW_PER_HOUR, 3600);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO device_requests (id, user_id, device_name, device_pub, commitment, status, created_at, expires_at, session_hash)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(id, session.userId, body.deviceName, body.devicePub, body.commitment, t, t + REQUEST_TTL, session.tokenHash)
    .run();
  return json({ id, status: "pending", expiresAt: t + REQUEST_TTL }, 201);
}

/** Step 2a, old device: open requests of its own account. */
export async function listRequests(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  requireDevice(session);
  const { results } = await ctx.env.DB.prepare(
    `SELECT * FROM device_requests WHERE user_id = ? AND status IN ${OPEN} AND expires_at > ? ORDER BY created_at`,
  )
    .bind(session.userId, now())
    .all<RequestRow>();
  return json({ requests: results.map(publicView) });
}

/** Step 3a / 6, new device (or an approved device of the same account, without the sealed key). */
export async function getRequest(ctx: Ctx): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const row = await loadRequest(ctx, session);
  const requester = isRequester(row, session);
  if (!requester) requireDevice(session);
  const view: Record<string, unknown> = publicView(row);
  if (requester && row.status === "approved") {
    view.sealedDek = row.sealed_dek;
    view.dekId = row.dek_id;
    view.deviceId = row.device_id;
  }
  return json(view);
}

/** Step 2b, old device sends rO. */
export async function postNonce(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const deviceId = requireDevice(session);
  const body = await readJson(ctx.request, ApproverNonceBody);
  const row = await loadRequest(ctx, session);
  if (isRequester(row, session)) throw new HttpError(403, "forbidden");
  requireOpen(row, "pending");
  // The approver's own device key: it goes into the number and seals the DEK (crypto_box), so it must be its row's key.
  const own = await env.DB.prepare("SELECT device_pub FROM devices WHERE id = ? AND user_id = ?")
    .bind(deviceId, session.userId)
    .first<{ device_pub: string }>();
  if (!own || own.device_pub !== body.approverPub) throw new HttpError(403, "wrong_approver", "Send this device's own key.");
  const res = await env.DB.prepare(
    `UPDATE device_requests SET approver_nonce = ?, approver_pub = ?, approver_device_id = ?, status = 'nonce'
     WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(body.nonce, body.approverPub, deviceId, row.id, session.userId, now())
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "wrong_order", "The request changed. Reload it.");
  return json({ id: row.id, status: "nonce" });
}

/** Step 3b, new device reveals rN after it got rO. A wrong commitment ends the request for good. */
export async function postReveal(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const body = await readJson(ctx.request, RevealBody);
  const row = await loadRequest(ctx, session);
  if (!isRequester(row, session)) throw new HttpError(403, "forbidden");
  requireOpen(row, "nonce");
  if (!(await commitmentMatches(row.device_pub, body.reveal, row.commitment))) {
    await env.DB.prepare("UPDATE device_requests SET status = 'denied' WHERE id = ? AND user_id = ?")
      .bind(row.id, session.userId)
      .run();
    await countNo(env, session.userId);
    throw new HttpError(422, "commitment_mismatch", "The device check failed. Start again.");
  }
  const res = await env.DB.prepare(
    `UPDATE device_requests SET reveal = ?, status = 'revealed'
     WHERE id = ? AND user_id = ? AND status = 'nonce' AND expires_at > ?`,
  )
    .bind(body.reveal, row.id, session.userId, now())
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "wrong_order", "The request changed. Reload it.");
  return json({ id: row.id, status: "revealed" });
}

/**
 * Step 5, the old device that sent rO approves with the DEK sealed to the new device key and its MAC for the new row.
 * M-1: no recent sign-in needed; the approver is a session bound to a device row (only key holders have one), and the
 * app asks for the device's screen lock before it sends this.
 */
export async function approveRequest(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const deviceId = requireDevice(session);
  const body = await readJson(ctx.request, ApproveBody);
  const row = await loadRequest(ctx, session);
  requireOpen(row, "revealed");
  if (row.approver_device_id !== deviceId) {
    throw new HttpError(403, "wrong_approver", "Approve on the device that shows the number.");
  }
  // The server repeats the commitment check so a stored reveal can never be approved without it.
  if (!row.reveal || !(await commitmentMatches(row.device_pub, row.reveal, row.commitment))) {
    throw new HttpError(422, "commitment_mismatch");
  }
  const user = await env.DB.prepare("SELECT email, dek_id FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ email: string; dek_id: string | null }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.dek_id === null || user.dek_id !== body.dekId) {
    throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  }
  if (await wasRemoved(env, session.userId, row.device_pub)) throw removedError();

  const t = now();
  let batch: D1Result[];
  try {
    batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE device_requests SET status = 'approved', sealed_dek = ?, dek_id = ?, device_mac = ?
       WHERE id = ? AND user_id = ? AND status = 'revealed' AND expires_at > ? AND approver_device_id = ?
         AND (SELECT dek_id FROM users WHERE id = ?) = ?`,
    ).bind(body.sealedDek, body.dekId, body.mac, row.id, session.userId, t, deviceId, session.userId, body.dekId),
    // NEU-12: always a new row; a device key that already has one fails here (UNIQUE) and the whole batch with it.
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at)
       SELECT ?, user_id, device_name, device_pub, sealed_dek, dek_id, device_mac, ?, ? FROM device_requests
       WHERE id = ? AND user_id = ? AND status = 'approved' AND device_id IS NULL`,
    ).bind(crypto.randomUUID(), t, t, row.id, session.userId),
    env.DB.prepare(
      `UPDATE device_requests SET device_id =
         (SELECT d.id FROM devices d WHERE d.user_id = device_requests.user_id AND d.device_pub = device_requests.device_pub)
       WHERE id = ? AND user_id = ? AND status = 'approved' AND device_id IS NULL`,
    ).bind(row.id, session.userId),
    env.DB.prepare(
      `UPDATE sessions SET device_id = (SELECT device_id FROM device_requests WHERE id = ?1 AND status = 'approved')
       WHERE user_id = ?2 AND token_hash = (SELECT session_hash FROM device_requests WHERE id = ?1 AND status = 'approved')`,
    ).bind(row.id, session.userId),
    ...(row.session_hash ? [copyDeviceKey(env, row.session_hash)] : []),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "device_registered", "This device key already belongs to a device of the account.");
    throw err;
  }
  const claim = batch[0];
  if (!claim || claim.meta.changes === 0) throw new HttpError(409, "wrong_order", "The request changed. Reload it.");
  await notify(env, session.userId, user.email, { kind: "new_device", deviceName: row.device_name });
  return json({ id: row.id, status: "approved" });
}

/**
 * "Deny" on any device of the account blocks the request at once, however long ago that device signed in (M-1). The new
 * device may deny its own request too: its user saw a number the other device does not show (approval v2).
 */
export async function denyRequest(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  const row = await loadRequest(ctx, session);
  if (!isRequester(row, session)) requireDevice(session);
  if (row.status === "approved") throw new HttpError(409, "wrong_order", "This request was already approved.");
  const res = await env.DB.prepare(
    `UPDATE device_requests SET status = 'denied' WHERE id = ? AND user_id = ? AND status IN ${OPEN}`,
  )
    .bind(row.id, session.userId)
    .run();
  if (res.meta.changes > 0) await countNo(env, session.userId);
  return noContent();
}
