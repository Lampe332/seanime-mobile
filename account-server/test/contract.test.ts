// The key/device contract: device public keys, a device's own sealed key after a rotation, reset info with userId,
// start fresh, GET account, reset mail in the background, and the R2 failure path of account/rotate.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { api, b64, clientKeys, freshIp, rand, signed, signupUser, upload } from "./helpers";

const sink = env.EMAIL as unknown as { take(to: string): Promise<{ text: string }[]> };
type User = Awaited<ReturnType<typeof signupUser>>;
type Fetch = (r: Request, e: Env, c: ExecutionContext) => Promise<Response>;
const workerFetch = worker.fetch as unknown as Fetch;

async function login(email: string, authKey: string) {
  const res = await api("/v1/auth/login", { body: { email, authKey } });
  expect(res.status).toBe(200);
  return res.json<{ sessionToken: string; wrappedDek: string | null; dekId: string | null }>();
}

/** A second device of the account that holds the DEK (registered with its own key pair). */
async function addDevice(u: User, name: string) {
  const token = (await login(u.email, u.keys.authKey)).sessionToken;
  const keys = clientKeys();
  const res = await api("/v1/account/keys", {
    method: "PUT",
    token,
    body: { dekId: u.keys.dekId, device: { name, devicePub: keys.devicePub, sealedDek: keys.sealedDek } },
  });
  expect(res.status).toBe(200);
  return { token, keys, deviceId: (await res.json<{ deviceId: string }>()).deviceId };
}

function rotateRequest(token: string, meta: unknown, ifMatch: number, snapshot?: Uint8Array) {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  if (snapshot) form.append("snapshot", new Blob([snapshot]), "snapshot.bin");
  return new Request("https://api.example.com/v1/account/rotate", {
    method: "POST",
    body: form,
    headers: { Authorization: `Bearer ${token}`, "If-Match": String(ifMatch), "CF-Connecting-IP": freshIp() },
  });
}

const json = <T = Record<string, unknown>>(res: Response) => res.json<T>();

describe("devices and the device key", () => {
  it("lists each device's public key and dekId, only for the own account", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Tablet");
    const other = await signupUser();
    const { devices } = await json<{ devices: Array<{ id: string; devicePub: string; dekId: string }> }>(
      await api("/v1/devices", { token: a.token }),
    );
    expect(devices.map((d) => [d.id, d.devicePub, d.dekId]).sort()).toEqual(
      [
        [a.deviceId, a.keys.devicePub, a.keys.dekId],
        [tablet.deviceId, tablet.keys.devicePub, a.keys.dekId],
      ].sort(),
    );
    const theirs = await json<{ devices: Array<{ id: string; devicePub: string }> }>(await api("/v1/devices", { token: other.token }));
    expect(theirs.devices.map((d) => d.id)).toEqual([other.deviceId]);
    expect(JSON.stringify(theirs)).not.toContain(a.keys.devicePub);
  });

  it("hands every device only its own sealed key, also the new one after another device rotated", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Tablet");
    const other = await signupUser();
    expect(await json(await api("/v1/account/keys/device", { token: tablet.token }))).toEqual({
      deviceId: tablet.deviceId,
      dekId: a.keys.dekId,
      sealedDek: tablet.keys.sealedDek,
    });
    expect(await json(await api("/v1/account/keys/device", { token: other.token }))).toEqual({
      deviceId: other.deviceId,
      dekId: other.keys.dekId,
      sealedDek: other.keys.sealedDek,
    });
    // A session without a device (no key yet) and no session at all get nothing.
    const bare = (await login(a.email, a.keys.authKey)).sessionToken;
    expect((await api("/v1/account/keys/device", { token: bare })).status).toBe(403);
    expect((await api("/v1/account/keys/device")).status).toBe(401);

    const newDek = `dek-${b64(rand(6))}`;
    const sealedA = b64(rand(80));
    const sealedTablet = b64(rand(80));
    const meta = {
      oldDekId: a.keys.dekId,
      dekId: newDek,
      devices: [
        { deviceId: a.deviceId, sealedDek: sealedA },
        { deviceId: tablet.deviceId, sealedDek: sealedTablet },
      ],
      wrappedDek: b64(rand(72)),
    };
    expect((await exports.default.fetch(await signed(rotateRequest(a.token, meta, 0)))).status).toBe(200);
    // The tablet keeps its session and picks up its newly sealed key.
    expect(await json(await api("/v1/account/keys/device", { token: tablet.token }))).toEqual({
      deviceId: tablet.deviceId,
      dekId: newDek,
      sealedDek: sealedTablet,
    });
    expect(await json(await api("/v1/account/keys/device", { token: other.token }))).toMatchObject({ dekId: other.keys.dekId });
  });
});

describe("start fresh", () => {
  it("swaps key, devices, snapshot and other sessions at once, and leaves other accounts alone", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Tablet");
    const recovery = b64(rand(72));
    expect((await api("/v1/account/keys", { method: "PUT", token: a.token, body: { dekId: a.keys.dekId, recoveryWrappedDek: recovery } })).status).toBe(200);
    expect((await upload(a.token, rand(64), 0, a.keys.dekId)).status).toBe(200);
    const other = await signupUser();
    const otherBlob = rand(64);
    expect((await upload(other.token, otherBlob, 0, other.keys.dekId)).status).toBe(200);

    // A new device signs in without the old key (like Google on a new phone, or after a reset without code).
    const fresh = (await login(a.email, a.keys.authKey)).sessionToken;
    const k = clientKeys();
    const body = {
      dekId: `dek-${b64(rand(6))}`,
      wrappedDek: b64(rand(72)),
      device: { name: "New phone", devicePub: k.devicePub, sealedDek: k.sealedDek },
    };
    const call = (token: string | undefined, b: unknown) => api("/v1/account/start-fresh", { token, body: b });
    expect((await call(fresh, { ...body, wrappedDek: undefined })).status).toBe(400);
    expect((await call(fresh, { ...body, dekId: a.keys.dekId })).status).toBe(400);
    expect((await call(undefined, body)).status).toBe(401);

    const res = await call(fresh, body);
    expect(res.status).toBe(200);
    const { deviceId } = await json<{ dekId: string; deviceId: string }>(res);

    expect(await json(await api("/v1/sync/meta", { token: fresh }))).toMatchObject({
      version: 0,
      dekId: null,
      rotationRequired: false,
      rewrapNeeded: false,
      recoveryRenewalNeeded: false,
    });
    expect((await api("/v1/sync/snapshot", { token: fresh })).status).toBe(404);
    // Every other session is signed out, the old devices are gone.
    expect((await api("/v1/sync/meta", { token: a.token })).status).toBe(401);
    expect((await api("/v1/sync/meta", { token: tablet.token })).status).toBe(401);
    const { devices } = await json<{ devices: Array<{ id: string; devicePub: string; dekId: string }> }>(await api("/v1/devices", { token: fresh }));
    expect(devices).toEqual([expect.objectContaining({ id: deviceId, devicePub: k.devicePub, dekId: body.dekId, current: true })]);
    expect(await json(await api("/v1/account/keys/device", { token: fresh }))).toEqual({ deviceId, dekId: body.dekId, sealedDek: k.sealedDek });
    expect(await json(await api("/v1/account", { token: fresh }))).toMatchObject({ dekId: body.dekId, hasRecovery: false });
    expect(await login(a.email, a.keys.authKey)).toMatchObject({ wrappedDek: body.wrappedDek, dekId: body.dekId });
    // Old key refused, new one works from version 0.
    expect((await upload(fresh, rand(64), 0, a.keys.dekId)).status).toBe(409);
    expect((await upload(fresh, rand(64), 0, body.dekId)).status).toBe(200);

    // The other account did not change (IDOR).
    expect(await json(await api("/v1/sync/meta", { token: other.token }))).toMatchObject({ version: 1, dekId: other.keys.dekId });
    const snap = await api("/v1/sync/snapshot", { token: other.token });
    expect(new Uint8Array(await snap.arrayBuffer())).toEqual(otherBlob);
    expect((await json<{ devices: unknown[] }>(await api("/v1/devices", { token: other.token }))).devices).toHaveLength(1);
  });

  it("needs a sign-in within the last 10 minutes", async () => {
    const a = await signupUser();
    await env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 3600 WHERE user_id = ?").bind(a.userId).run();
    const k = clientKeys();
    const res = await api("/v1/account/start-fresh", {
      token: a.token,
      body: { dekId: "dek-new", wrappedDek: b64(rand(72)), device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek } },
    });
    expect(res.status).toBe(403);
    expect(await json(await api("/v1/sync/meta", { token: a.token }))).toMatchObject({ dekId: null });
    expect(await json(await api("/v1/account", { token: a.token }))).toMatchObject({ dekId: a.keys.dekId });
  });
});

describe("GET account", () => {
  it("shows the own account without keys or hashes", async () => {
    const a = await signupUser();
    const other = await signupUser();
    const res = await api("/v1/account", { token: a.token });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      userId: a.userId,
      email: a.email,
      emailVerified: false,
      googleLinked: false,
      hasPassword: true,
      hasRecovery: false,
      dekId: a.keys.dekId,
      createdAt: expect.any(Number),
      rewrapNeeded: false,
      rotationRequired: false,
      recoveryRenewalNeeded: false,
    });
    for (const secret of [a.keys.wrappedDek, a.keys.authKey, a.keys.salt, a.keys.sealedDek]) expect(text).not.toContain(secret);
    expect(await json(await api("/v1/account", { token: other.token }))).toMatchObject({ userId: other.userId, email: other.email });
    expect((await api("/v1/account")).status).toBe(401);
  });

  it("works for the website with the session cookie", async () => {
    const a = await signupUser();
    const res = await exports.default.fetch(
      await signed(
        new Request("https://api.example.com/v1/account", {
          headers: { Origin: "https://seanimemobile.com", Cookie: `__Host-sid=${a.token}`, "CF-Connecting-IP": freshIp() },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://seanimemobile.com");
    expect(await json(res)).toMatchObject({ email: a.email });
  });
});

describe("reset request", () => {
  it("answers before the mail goes out, the same for known and unknown emails", async () => {
    const u = await signupUser();
    await sink.take(u.email);
    const ask = async (email: string) => {
      const exec = createExecutionContext();
      const res = await workerFetch(
        new Request("https://api.example.com/v1/auth/reset-request", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
          body: JSON.stringify({ email }),
        }),
        env,
        exec,
      );
      // The answer is there while token and mail are still pending.
      const before = await sink.take(email);
      await waitOnExecutionContext(exec);
      return { status: res.status, body: await res.text(), before, after: await sink.take(email) };
    };
    const known = await ask(u.email);
    const unknown = await ask(`ghost-${crypto.randomUUID()}@example.com`);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(known.before).toHaveLength(0);
    expect(known.after).toHaveLength(1);
    expect(unknown.after).toHaveLength(0);
  });
});

describe("rotation", () => {
  it("puts D1 back when R2 fails, then rotates; without the recovery code it asks to renew it", async () => {
    const a = await signupUser();
    const recovery = b64(rand(72));
    expect((await api("/v1/account/keys", { method: "PUT", token: a.token, body: { dekId: a.keys.dekId, recoveryWrappedDek: recovery } })).status).toBe(200);
    const blob = rand(96);
    expect((await upload(a.token, blob, 0, a.keys.dekId)).status).toBe(200);
    const state = async () => ({
      user: await env.DB.prepare(
        "SELECT dek_id, wrapped_dek, recovery_wrapped_dek, rewrap_needed, rotation_required, recovery_renewal_needed FROM users WHERE id = ?",
      ).bind(a.userId).first(),
      devices: (await env.DB.prepare("SELECT id, sealed_dek, dek_id FROM devices WHERE user_id = ?").bind(a.userId).all()).results,
      snapshot: await env.DB.prepare("SELECT version, size, dek_id, updated_at FROM snapshots WHERE user_id = ?").bind(a.userId).first(),
    });
    const before = await state();

    const newDek = `dek-${b64(rand(6))}`;
    const meta = { oldDekId: a.keys.dekId, dekId: newDek, devices: [{ deviceId: a.deviceId, sealedDek: b64(rand(80)) }], wrappedDek: b64(rand(72)) };
    const brokenR2 = {
      put: async () => {
        throw new Error("R2 unavailable");
      },
      get: (key: string) => env.SNAPSHOTS.get(key),
      delete: (key: string) => env.SNAPSHOTS.delete(key),
    };
    const brokenEnv = new Proxy(env, { get: (target, key) => (key === "SNAPSHOTS" ? brokenR2 : Reflect.get(target, key)) });
    const failed = await workerFetch(await signed(rotateRequest(a.token, meta, 1, rand(128))), brokenEnv, createExecutionContext());
    expect(failed.status).toBe(500);
    expect(await state()).toEqual(before);
    const kept = await api("/v1/sync/snapshot", { token: a.token });
    expect(kept.headers.get("X-Dek-Id")).toBe(a.keys.dekId);
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(blob);

    const ok = await exports.default.fetch(await signed(rotateRequest(a.token, meta, 1, rand(128))));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ dekId: newDek, version: 2, recoveryRenewalNeeded: true });
    expect(await json(await api("/v1/sync/meta", { token: a.token }))).toMatchObject({ dekId: newDek, recoveryRenewalNeeded: true });
    expect(await json(await api("/v1/account", { token: a.token }))).toMatchObject({ hasRecovery: false, recoveryRenewalNeeded: true });
    // A new recovery code for the new key clears the flag.
    expect((await api("/v1/account/keys", { method: "PUT", token: a.token, body: { dekId: newDek, recoveryWrappedDek: b64(rand(72)) } })).status).toBe(200);
    expect(await json(await api("/v1/account", { token: a.token }))).toMatchObject({ hasRecovery: true, recoveryRenewalNeeded: false });
  });
});
