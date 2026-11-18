/**
 * DEK rotation (plan 5, 6.9). A device that holds the DEK creates a new one, re-encrypts the snapshot,
 * seals the new DEK to every remaining device and sends new password / recovery wraps. One request:
 *
 *   POST /v1/account/rotate   Content-Type: multipart/form-data   If-Match: <current snapshot version>
 *     part "meta":     JSON {oldDekId, dekId, devices: [{deviceId, sealedDek}], wrappedDek?, recoveryWrappedDek?}
 *     part "snapshot": the re-encrypted package (required when the account has a snapshot)
 *
 * D1 is changed in one batch (a transaction). Every statement after the first only applies when the first
 * one switched the account to the new dekId, so the batch applies fully or not at all. The R2 blob is
 * written afterwards; if that fails, the D1 rows are put back. Afterwards wraps of the old dekId are
 * rejected everywhere (keys, snapshot upload, approval, reset).
 */
import { HttpError, json, MAX_JSON_BYTES, readLimited } from "./http";
import { sendMail } from "./mail";
import { MAX_SNAPSHOT_BYTES, proofHash, snapKey, snapshotRow, type Ctx } from "./routes";
import { RotateMeta } from "./schemas";
import { now, requireDevice, requireRecentAuth, requireSession } from "./session";

const MULTIPART_OVERHEAD = 4096;

async function readParts(request: Request): Promise<{ meta: unknown; snapshot: Uint8Array | null }> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type)) {
    throw new HttpError(415, "unsupported_media_type", "Expected multipart/form-data");
  }
  const raw = await readLimited(request, MAX_SNAPSHOT_BYTES + MAX_JSON_BYTES + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await new Response(raw, { headers: { "Content-Type": type } }).formData();
  } catch {
    throw new HttpError(400, "invalid_request", "Malformed multipart body");
  }
  const metaPart = form.get("meta");
  if (typeof metaPart !== "string" || metaPart.length > MAX_JSON_BYTES) {
    throw new HttpError(400, "invalid_request", "Missing meta part", {}, { fields: ["meta"] });
  }
  let meta: unknown;
  try {
    meta = JSON.parse(metaPart);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const snap = form.get("snapshot");
  let snapshot: Uint8Array | null = null;
  if (snap !== null) {
    if (typeof snap === "string") throw new HttpError(400, "invalid_request", "snapshot must be binary", {}, { fields: ["snapshot"] });
    snapshot = new Uint8Array(await snap.arrayBuffer());
    if (snapshot.byteLength === 0 || snapshot.byteLength > MAX_SNAPSHOT_BYTES) {
      throw new HttpError(snapshot.byteLength === 0 ? 400 : 413, snapshot.byteLength === 0 ? "invalid_request" : "payload_too_large");
    }
  }
  return { meta, snapshot };
}

export async function rotate(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const session = await requireSession(request, env);
  requireDevice(session);
  requireRecentAuth(session);

  const ifMatch = (request.headers.get("If-Match") ?? "").replace(/^"(.*)"$/, "$1");
  if (!/^\d{1,15}$/.test(ifMatch)) throw new HttpError(428, "precondition_required", "If-Match is required.");
  const parts = await readParts(request);
  const parsed = RotateMeta.safeParse(parts.meta);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))];
    throw new HttpError(400, "invalid_request", "Invalid meta", {}, { fields });
  }
  const meta = parsed.data;
  if (meta.dekId === meta.oldDekId) throw new HttpError(400, "invalid_request", "dekId must be new", {}, { fields: ["dekId"] });

  const userId = session.userId;
  const user = await env.DB.prepare(
    `SELECT email, dek_id, auth_hash, wrapped_dek, recovery_wrapped_dek, rewrap_needed, rotation_required, recovery_renewal_needed,
       dek_proof, chain_from, chain_mac
     FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{
      email: string;
      dek_id: string | null;
      auth_hash: string | null;
      wrapped_dek: string | null;
      recovery_wrapped_dek: string | null;
      rewrap_needed: number;
      rotation_required: number;
      recovery_renewal_needed: number;
      dek_proof: string | null;
      chain_from: string | null;
      chain_mac: string | null;
    }>();
  if (!user) throw new HttpError(401, "unauthorized");
  if (user.dek_id !== meta.oldDekId) throw new HttpError(409, "dek_mismatch", "The account uses a different key.");
  if (user.auth_hash !== null && meta.wrappedDek === undefined) {
    throw new HttpError(400, "invalid_request", "wrappedDek is required for password accounts", {}, { fields: ["wrappedDek"] });
  }

  // The new DEK must reach every remaining device, no more and no less.
  const { results: devices } = await env.DB.prepare("SELECT id, sealed_dek, dek_id, mac FROM devices WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; sealed_dek: string | null; dek_id: string | null; mac: string | null }>();
  const sent = new Set(meta.devices.map((d) => d.deviceId));
  if (sent.size !== meta.devices.length || sent.size !== devices.length || devices.some((d) => !sent.has(d.id))) {
    throw new HttpError(409, "device_set_mismatch", "Seal the new key for every device of the account.", {}, {
      deviceIds: devices.map((d) => d.id),
    });
  }

  const previous = await snapshotRow(env, userId);
  const current = previous?.version ?? 0;
  if (Number(ifMatch) !== current) {
    throw new HttpError(409, "version_conflict", "The snapshot changed. Download, merge and retry.", {}, { version: current });
  }
  if (previous && !parts.snapshot) {
    throw new HttpError(400, "invalid_request", "The re-encrypted snapshot is required", {}, { fields: ["snapshot"] });
  }

  // Without the recovery code the old recovery wrap cannot follow the new key: it is dropped and the user is told
  // to save a new code (sync/meta, GET account). With it, the flag clears.
  const renewal = meta.recoveryWrappedDek !== undefined ? 0 : user.recovery_wrapped_dek !== null || user.recovery_renewal_needed === 1 ? 1 : 0;
  const t = now();
  const next = current + 1;
  const switched = "(SELECT dek_id FROM users WHERE id = ?) = ?";
  const statements: D1PreparedStatement[] = [
    // chain_from / chain_mac: the old DEK vouches for the new one; devices refuse a new key without it (K-1).
    env.DB.prepare(
      `UPDATE users SET dek_id = ?, dek_proof = ?, chain_from = ?, chain_mac = ?, wrapped_dek = ?, recovery_wrapped_dek = ?,
         rewrap_needed = CASE WHEN ? IS NULL THEN rewrap_needed ELSE 0 END, rotation_required = 0,
         recovery_renewal_needed = ?
       WHERE id = ? AND dek_id = ?
         AND COALESCE((SELECT version FROM snapshots WHERE user_id = ?), 0) = ?
         AND (SELECT COUNT(*) FROM devices WHERE user_id = ?) = ?`,
    ).bind(
      meta.dekId,
      await proofHash(meta.dekProof),
      meta.oldDekId,
      meta.chainMac,
      meta.wrappedDek ?? null,
      meta.recoveryWrappedDek ?? null,
      meta.wrappedDek ?? null,
      renewal,
      userId,
      meta.oldDekId,
      userId,
      current,
      userId,
      devices.length,
    ),
    ...meta.devices.map((d) =>
      env.DB.prepare(
        `UPDATE devices SET sealed_dek = ?, dek_id = ?, mac = ? WHERE id = ? AND user_id = ? AND ${switched}`,
      ).bind(d.sealedDek, meta.dekId, d.mac, d.deviceId, userId, userId, meta.dekId),
    ),
  ];
  if (parts.snapshot) {
    statements.push(
      previous
        ? env.DB.prepare(
            `UPDATE snapshots SET version = ?, size = ?, dek_id = ?, updated_at = ? WHERE user_id = ? AND version = ? AND ${switched}`,
          ).bind(next, parts.snapshot.byteLength, meta.dekId, t, userId, current, userId, meta.dekId)
        : env.DB.prepare(
            `INSERT INTO snapshots (user_id, version, size, dek_id, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${switched}`,
          ).bind(userId, next, parts.snapshot.byteLength, meta.dekId, t, userId, meta.dekId),
    );
  }
  const [claim] = await env.DB.batch(statements);
  if (!claim || claim.meta.changes === 0) {
    throw new HttpError(409, "rotation_conflict", "The account changed during rotation. Reload and retry.");
  }

  if (parts.snapshot) {
    try {
      await env.SNAPSHOTS.put(snapKey(userId), parts.snapshot, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { version: String(next), dekId: meta.dekId },
      });
    } catch (err) {
      // Put D1 back so the account never points at a key the stored blob does not use.
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE users SET dek_id = ?, dek_proof = ?, chain_from = ?, chain_mac = ?, wrapped_dek = ?, recovery_wrapped_dek = ?,
             rewrap_needed = ?, rotation_required = ?, recovery_renewal_needed = ?
           WHERE id = ? AND dek_id = ?`,
        ).bind(
          user.dek_id,
          user.dek_proof,
          user.chain_from,
          user.chain_mac,
          user.wrapped_dek,
          user.recovery_wrapped_dek,
          user.rewrap_needed,
          user.rotation_required,
          user.recovery_renewal_needed,
          userId,
          meta.dekId,
        ),
        ...devices.map((d) =>
          env.DB.prepare("UPDATE devices SET sealed_dek = ?, dek_id = ?, mac = ? WHERE id = ? AND user_id = ?").bind(
            d.sealed_dek,
            d.dek_id,
            d.mac,
            d.id,
            userId,
          ),
        ),
        previous
          ? env.DB.prepare(
              "UPDATE snapshots SET version = ?, size = ?, dek_id = ?, updated_at = ? WHERE user_id = ? AND version = ?",
            ).bind(previous.version, previous.size, previous.dek_id, previous.updated_at, userId, next)
          : env.DB.prepare("DELETE FROM snapshots WHERE user_id = ? AND version = ?").bind(userId, next),
      ]);
      throw err;
    }
  }
  await sendMail(env, user.email, { kind: "key_rotated" });
  return json({ dekId: meta.dekId, version: parts.snapshot ? next : current, recoveryRenewalNeeded: renewal === 1 });
}
