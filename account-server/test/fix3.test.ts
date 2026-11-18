/**
 * Fix round 3 after the second security review (18.11.): removal rules (NEU-2, R4), approval v2 server side (NEU-1,
 * NEU-12), limits (NEU-4, NEU-5, NEU-11), mails (M-3, NEU-8) and NEU-10.
 */
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ipKey, ipRange } from "../src/ratelimit";
import { api, b64, DEFAULT_KDF, deviceKeys, freshEmail, freshIp, newKey, rand, sessionId, signupUser, upload } from "./helpers";

interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };

async function login(email: string, authKey: string, opts: { ip?: string; sign?: Awaited<ReturnType<typeof newKey>> } = {}) {
  return api("/v1/auth/login", { body: { email, authKey }, ip: opts.ip, sign: opts.sign });
}

async function loginToken(email: string, authKey: string): Promise<string> {
  const res = await login(email, authKey);
  expect(res.status).toBe(200);
  return (await res.json<{ sessionToken: string }>()).sessionToken;
}

/** A second device of the account, registered with the DEK proof (what the app does after unwrapping the password wrap) */
async function addDevice(u: Awaited<ReturnType<typeof signupUser>>, name: string) {
  const token = await loginToken(u.email, u.keys.authKey);
  const device = deviceKeys(name);
  const res = await api("/v1/account/keys", { method: "PUT", token, body: { dekId: u.keys.dekId, dekProof: u.keys.dekProof, device } });
  expect(res.status).toBe(200);
  return { token, device, deviceId: (await res.json<{ deviceId: string }>()).deviceId };
}

const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("removing a device (NEU-2, R4)", () => {
  it("a removed device key never binds again, its session hears device_removed, and the removal is mailed", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Old Tablet");
    await sink.take(a.email);
    expect((await api(`/v1/devices/${tablet.deviceId}`, { method: "DELETE", token: a.token })).status).toBe(204);
    const gone = await api("/v1/sync/meta", { token: tablet.token });
    expect(gone.status).toBe(401);
    expect((await gone.json<{ error: string }>()).error).toBe("device_removed");
    expect((await sink.take(a.email)).map((m) => m.subject)).toEqual(["A device was removed"]);
    const meta = await (await api("/v1/sync/meta", { token: a.token })).json<{ rotationRequired: boolean }>();
    expect(meta).toMatchObject({ rotationRequired: true });

    // the removed phone signs in again (it still knows the DEK and its proof): no way back with its key
    const again = await loginToken(a.email, a.keys.authKey);
    const put = await api("/v1/account/keys", { method: "PUT", token: again, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: tablet.device } });
    expect(put.status).toBe(403);
    expect((await put.json<{ error: string }>()).error).toBe("device_removed");
    const req = await api("/v1/devices/requests", { token: again, body: { deviceName: "Old Tablet", devicePub: tablet.device.devicePub, commitment: b64(rand(32)) } });
    expect(req.status).toBe(403);
    const fresh = await api("/v1/account/start-fresh", { token: again, body: { dekId: `dek-${b64(rand(6))}`, dekProof: b64(rand(32)), wrappedDek: b64(rand(72)), device: tablet.device } });
    expect(fresh.status).toBe(403);
    // S3: with a Google-style session (no password) the DEK proof adds no new device row either
    await env.DB.prepare("UPDATE sessions SET password_auth = 0 WHERE token_hash = ?").bind(await sessionId(again)).run();
    const other = await api("/v1/account/keys", { method: "PUT", token: again, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: deviceKeys("Old Tablet") } });
    expect(other.status).toBe(403);
    expect((await other.json<{ error: string }>()).error).toBe("owner_required");
    // nor does a keyless session read the encrypted data
    expect((await api("/v1/sync/snapshot", { token: again })).status).toBe(403);
  });

  it("approval: a request with a registered device key is refused (NEU-12), the approver must send its own key, the new device may deny", async () => {
    const a = await signupUser();
    const n = await loginToken(a.email, a.keys.authKey);
    const taken = await api("/v1/devices/requests", { token: n, body: { deviceName: "Copy", devicePub: a.keys.devicePub, commitment: b64(rand(32)) } });
    expect(taken.status).toBe(409);
    const created = await api("/v1/devices/requests", { token: n, body: { deviceName: "Tablet", devicePub: b64(rand(32)), commitment: b64(rand(32)) } });
    const { id } = await created.json<{ id: string }>();
    expect((await api(`/v1/devices/requests/${id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)), approverPub: b64(rand(32)) } })).status).toBe(403);
    expect((await api(`/v1/devices/requests/${id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)), approverPub: a.keys.devicePub } })).status).toBe(200);
    const seen = await (await api(`/v1/devices/requests/${id}`, { token: n })).json<{ approverPub: string }>();
    expect(seen.approverPub).toBe(a.keys.devicePub);
    expect((await api(`/v1/devices/requests/${id}/deny`, { token: n, method: "POST" })).status).toBe(204);
    expect((await (await api(`/v1/devices/requests/${id}`, { token: n })).json<{ status: string }>()).status).toBe("denied");
  });

  it("a password change unlinks Google (NEU-10)", async () => {
    const a = await signupUser();
    await env.DB.prepare("UPDATE users SET google_sub = 'g-123' WHERE id = ?").bind(a.userId).run();
    const res = await api("/v1/account/password", { token: a.token, body: { salt: b64(rand(16)), kdf: DEFAULT_KDF, authKey: b64(rand(32)), wrappedDek: b64(rand(72)), dekId: a.keys.dekId } });
    expect(res.status).toBe(204);
    expect(await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(a.userId).first()).toEqual({ google_sub: null });
  });
});

describe("limits (NEU-4, NEU-5, NEU-11)", () => {
  it("groups IPv6 per /48 for the IP counters and the burst limiter", async () => {
    expect(ipKey("2001:db8:1234:5678::1")).toBe("2001:db8:1234::/48");
    expect(ipKey("2001:db8:1234:ffff:1:2:3:4")).toBe("2001:db8:1234::/48");
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipRange("203.0.113.7")).toBe("203.0.113.0/24");
    const prefix = `2001:db8:${(rand(1)[0]! + 256).toString(16)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await api("/v1/auth/prelogin", { body: { email: freshEmail() }, ip: `${prefix}:${i.toString(16)}::${i + 1}`, sign: false });
      statuses.push(res.status);
    }
    // 10 per minute per /48 (LOGIN_LIMITER); a new address in the same /48 does not start over
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect((await api("/v1/auth/prelogin", { body: { email: freshEmail() }, ip: `2001:db9:${prefix.slice(9)}::1`, sign: false })).status).toBe(200);
  });

  it("requests without a session write nothing to D1 under load but the sender's one counter row (NEU3-7)", async () => {
    const before = { nonces: await count("used_nonces"), google: await count("google_nonces"), limits: await count("rate_limits") };
    const prefix = `2001:db8:${(rand(1)[0]! + 512).toString(16)}`;
    for (let i = 0; i < 30; i++) {
      await api("/v1/auth/google/nonce", { method: "POST", ip: `${prefix}::${i + 1}`, sign: false });
      // a sign-in with a made-up challenge: counted against its network first, refused before its nonce is written
      await api("/v1/auth/login", { body: { email: freshEmail(), authKey: b64(rand(32)), challenge: b64(rand(36)), sigKey: { alg: "ed25519", pub: b64(rand(32)) } }, ip: `${prefix}:1::${i + 1}`, sign: false });
    }
    expect({ nonces: await count("used_nonces"), google: await count("google_nonces"), limits: await count("rate_limits") }).toEqual({ ...before, limits: before.limits + 1 });
  });

  it("counts an upload before its body is read (NEU-11)", async () => {
    const a = await signupUser();
    for (let i = 0; i < 30; i++) await env.DB.prepare("SELECT 1").first();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      // a valid token and well-formed signature headers, but a wrong signature: counted, then refused
      const res = await exports.default.fetch(new Request("https://api.example.com/v1/sync/snapshot", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${a.token}`, "Content-Type": "application/octet-stream", "If-Match": "0", "X-Dek-Id": a.keys.dekId,
          "X-SM-Sig": b64(rand(64)), "X-SM-Ts": String(Date.now()), "X-SM-Nonce": b64(rand(16)), "CF-Connecting-IP": freshIp(),
        },
        body: rand(1024),
      }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    // the real upload of the same account now waits too
    expect((await upload(a.token, rand(64), 0, a.keys.dekId)).status).toBe(429);
  });
});
