/**
 * New-device approval with commitment (plan 6.4), the numeric-comparison scheme of Bluetooth.
 *
 *   1. New device N:  POST devices/requests {deviceName, devicePub, commitment}
 *   2. Old device O:  GET  devices/requests, then POST devices/requests/:id/nonce {nonce = rO}
 *   3. N:             GET  devices/requests/:id (sees rO), then POST devices/requests/:id/reveal {reveal = rN}
 *   4. Server and O:  check SHA-256(devicePub || rN) == commitment. Both show SAS = 6 digits of H(pkN || rN || rO).
 *   5. O:             POST devices/requests/:id/approve {dekId, sealedDek = seal(DEK, pkN)} or .../deny
 *   6. N:             GET  devices/requests/:id -> sealedDek, dekId, deviceId
 *
 * Byte format of the commitment: devicePub is the raw 32-byte X25519 public key, rN and rO are 32 random
 * bytes each. All three travel as base64url without padding. commitment = SHA-256(pub[32] || rN[32]),
 * a plain concatenation of the decoded bytes (64 bytes in), sent as base64url of the 32-byte digest.
 *
 * The order is enforced: no reveal before rO (else N could pick rN after seeing rO and steer the SAS),
 * no approve before a valid reveal. A request expires after 10 minutes; at most 3 open per account
 * and 5 new per hour.
 */
import { fromB64url, safeEqual, sha256 } from "./crypto";
import { HttpError, json, noContent, readJson } from "./http";
import { sendMail } from "./mail";
import { fixedWindow, rateKey } from "./ratelimit";
import type { Ctx } from "./routes";
import { ApproveBody, ApproverNonceBody, DeviceRequestBody, RevealBody, Uuid } from "./schemas";
import { now, requireDevice, requireSession, type Session } from "./session";

const REQUEST_TTL = 10 * 60;
const MAX_OPEN = 3;
const NEW_PER_HOUR = 5;
const OPEN = "('pending', 'nonce', 'revealed')";

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
  device_id: string | null;
  dek_id: string | null;
}

/** Checks the commitment of the new device: SHA-256(devicePub || rN) == commitment, in constant time. */
export async function commitmentMatches(devicePub: string, reveal: string, commitment: string): Promise<boolean> {
  const pub = fromB64url(devicePub);
  const rN = fromB64url(reveal);
  const c = fromB64url(commitment);
  if (!pub || !rN || !c || pub.byteLength !== 32 || rN.byteLength !== 32 || c.byteLength !== 32) return false;
  const input = new Uint8Array(64);
  input.set(pub, 0);
  input.set(rN, 32);
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
  const t = now();
  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM device_requests WHERE user_id = ? AND status IN ${OPEN} AND expires_at > ?`,
  )
    .bind(session.userId, t)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN) {
    throw new HttpError(429, "too_many_open_requests", "Too many open requests. Wait a few minutes.");
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
  const res = await env.DB.prepare(
    `UPDATE device_requests SET approver_nonce = ?, approver_device_id = ?, status = 'nonce'
     WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(body.nonce, deviceId, row.id, session.userId, now())
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

  const t = now();
  const [claim] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE device_requests SET status = 'approved', sealed_dek = ?, dek_id = ?, device_mac = ?
       WHERE id = ? AND user_id = ? AND status = 'revealed' AND expires_at > ? AND approver_device_id = ?
         AND (SELECT dek_id FROM users WHERE id = ?) = ?`,
    ).bind(body.sealedDek, body.dekId, body.mac, row.id, session.userId, t, deviceId, session.userId, body.dekId),
    // Same device key as an existing row (re-approval of a device that kept its key) updates that row; the approver,
    // a key holder, decided that after comparing the numbers.
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at)
       SELECT ?, user_id, device_name, device_pub, sealed_dek, dek_id, device_mac, ?, ? FROM device_requests
       WHERE id = ? AND user_id = ? AND status = 'approved' AND device_id IS NULL
       ON CONFLICT(user_id, device_pub) DO UPDATE SET
         name = excluded.name, sealed_dek = excluded.sealed_dek, dek_id = excluded.dek_id, mac = excluded.mac,
         last_seen_at = excluded.last_seen_at`,
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
  ]);
  if (!claim || claim.meta.changes === 0) throw new HttpError(409, "wrong_order", "The request changed. Reload it.");
  await sendMail(env, user.email, { kind: "new_device", deviceName: row.device_name });
  return json({ id: row.id, status: "approved" });
}

/** "Deny" on any device of the account blocks the request at once, however long ago that device signed in (M-1). */
export async function denyRequest(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const session = await requireSession(ctx.request, env);
  requireDevice(session);
  const row = await loadRequest(ctx, session);
  if (row.status === "approved") throw new HttpError(409, "wrong_order", "This request was already approved.");
  await env.DB.prepare(
    `UPDATE device_requests SET status = 'denied' WHERE id = ? AND user_id = ? AND status IN ${OPEN}`,
  )
    .bind(row.id, session.userId)
    .run();
  return noContent();
}
