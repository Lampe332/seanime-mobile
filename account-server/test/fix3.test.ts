/**
 * Fix round 3 after the second security review (18.11.): removal rules (NEU-2, R4), approval v2 server side (NEU-1,
 * NEU-12), limits (NEU-4, NEU-5, NEU-11), mails (M-3, NEU-8) and NEU-10.
 */
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ipKey, ipRange, LOGIN_LIMIT_EMAIL_GLOBAL, MAIL_LIMIT_HOUR } from "../src/ratelimit";
import { api, b64, DEFAULT_KDF, deviceKeys, freshEmail, freshIp, keyOf, newKey, rand, sessionId, signed, signupUser, upload } from "./helpers";

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

async function rotate(token: string, u: Awaited<ReturnType<typeof signupUser>>, deviceIds: string[], removed: string[] = []) {
  const meta = {
    oldDekId: u.keys.dekId,
    dekId: `dek-${b64(rand(6))}`,
    dekProof: b64(rand(32)),
    chainMac: b64(rand(32)),
    devices: deviceIds.map((deviceId) => ({ deviceId, sealedDek: b64(rand(120)), mac: b64(rand(32)) })),
    wrappedDek: b64(rand(72)),
    removed,
  };
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  const request = new Request("https://api.example.com/v1/account/rotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "If-Match": "0", "CF-Connecting-IP": freshIp() },
    body: form,
  });
  return exports.default.fetch(await signed(request, keyOf(token)));
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
    const meta = await (await api("/v1/sync/meta", { token: a.token })).json<{ rotationRequired: boolean; removedDevices: string[] }>();
    expect(meta).toMatchObject({ rotationRequired: true, removedDevices: [tablet.device.devicePub] });

    // the removed phone signs in again (it still knows the DEK and its proof): no way back with its key
    const again = await loginToken(a.email, a.keys.authKey);
    const put = await api("/v1/account/keys", { method: "PUT", token: again, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: tablet.device } });
    expect(put.status).toBe(403);
    expect((await put.json<{ error: string }>()).error).toBe("device_removed");
    const req = await api("/v1/devices/requests", { token: again, body: { deviceName: "Old Tablet", devicePub: tablet.device.devicePub, commitment: b64(rand(32)) } });
    expect(req.status).toBe(403);
    const fresh = await api("/v1/account/start-fresh", { token: again, body: { dekId: `dek-${b64(rand(6))}`, dekProof: b64(rand(32)), wrappedDek: b64(rand(72)), device: tablet.device } });
    expect(fresh.status).toBe(403);
    // and while the rotation is pending, the DEK proof adds no new device row either
    const other = await api("/v1/account/keys", { method: "PUT", token: again, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: deviceKeys("Old Tablet") } });
    expect(other.status).toBe(403);
    expect((await other.json<{ error: string }>()).error).toBe("rotation_pending");
    // nor does a keyless session read the encrypted data
    expect((await api("/v1/sync/snapshot", { token: again })).status).toBe(403);
  });

  it("a session made after the removal cannot finish the rotation; a device from before it can", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Old Tablet");
    const phone2 = await addDevice(a, "Second Phone");
    expect((await api(`/v1/devices/${tablet.deviceId}`, { method: "DELETE", token: a.token })).status).toBe(204);
    // a Google-style session (no password check) made after the removal, bound to a row from before it with another key
    const late = await loginToken(a.email, a.keys.authKey);
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET password_auth = 0, device_id = ?, created_at = created_at + 5 WHERE token_hash = ?").bind(phone2.deviceId, await sessionId(late)),
    ]);
    const lateRes = await rotate(late, a, [a.deviceId!, phone2.deviceId]);
    expect(lateRes.status).toBe(403);
    expect((await lateRes.json<{ error: string }>()).error).toBe("rotation_not_allowed");
    // a device added after the removal (here by D1, as an approval would) cannot either
    const newcomer = await api("/v1/account/keys", { method: "PUT", token: phone2.token, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: { ...phone2.device } } });
    expect(newcomer.status).toBe(200);
    await env.DB.prepare("UPDATE devices SET created_at = created_at + 100 WHERE id = ?").bind(phone2.deviceId).run();
    expect((await (await rotate(phone2.token, a, [a.deviceId!, phone2.deviceId])).json<{ error: string }>()).error).toBe("rotation_not_allowed");
    await env.DB.prepare("UPDATE devices SET created_at = created_at - 100 WHERE id = ?").bind(phone2.deviceId).run();
    // the phone that was signed in before the removal finishes it; the chain names it and the removed key
    const ok = await rotate(a.token, a, [a.deviceId!, phone2.deviceId], [tablet.device.devicePub]);
    expect(ok.status).toBe(200);
    const key = await (await api("/v1/account/keys/device", { token: phone2.token })).json<{ rotatorPub: string; removed: string[] }>();
    expect(key).toMatchObject({ rotatorPub: a.keys.devicePub, removed: [tablet.device.devicePub] });
    expect(await env.DB.prepare("SELECT removed_at, rotation_required FROM users WHERE id = ?").bind(a.userId).first()).toEqual({ removed_at: null, rotation_required: 0 });
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

  it("signing out removes the device's own row without asking for a rotation; a password change unlinks Google (NEU-10)", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Tablet");
    expect((await api("/v1/auth/logout", { token: tablet.token, method: "POST" })).status).toBe(204);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE id = ?").bind(tablet.deviceId).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT rotation_required FROM users WHERE id = ?").bind(a.userId).first()).toEqual({ rotation_required: 0 });
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

  it("a global per-email limit stops guesses from many networks, but never a known device of the account", async () => {
    const key = await newKey();
    const email = freshEmail();
    const authKey = b64(rand(32));
    const signup = await api("/v1/auth/signup", {
      sign: key,
      body: { email, salt: b64(rand(16)), kdf: DEFAULT_KDF, authKey, keys: { wrappedDek: b64(rand(72)), dekId: "dek-g", dekProof: b64(rand(32)), device: deviceKeys() } },
    });
    expect(signup.status).toBe(201);
    for (let i = 0; i < LOGIN_LIMIT_EMAIL_GLOBAL; i++) {
      // every guess from another /24: neither the IP nor the (email, range) counter ever fills up
      expect((await login(email, b64(rand(32)), { ip: `198.${i}.${rand(1)[0]}.9` })).status).toBe(401);
    }
    expect((await login(email, authKey, { ip: "192.0.2.50" })).status).toBe(429);
    // the phone that signed up keeps its signing key: it signs in right away
    expect((await login(email, authKey, { ip: "192.0.2.51", sign: key })).status).toBe(200);
  });

  it("requests without a session write nothing to D1 under load (stateless Google nonce, challenge checked first)", async () => {
    const before = { nonces: await count("used_nonces"), google: await count("google_nonces"), limits: await count("rate_limits") };
    const prefix = `2001:db8:${(rand(1)[0]! + 512).toString(16)}`;
    for (let i = 0; i < 30; i++) {
      await api("/v1/auth/google/nonce", { method: "POST", ip: `${prefix}::${i + 1}`, sign: false });
      // a sign-in with a made-up challenge: refused before its nonce or any counter is written
      await api("/v1/auth/login", { body: { email: freshEmail(), authKey: b64(rand(32)), challenge: b64(rand(36)), sigKey: { alg: "ed25519", pub: b64(rand(32)) } }, ip: `${prefix}:1::${i + 1}`, sign: false });
    }
    expect({ nonces: await count("used_nonces"), google: await count("google_nonces"), limits: await count("rate_limits") }).toEqual(before);
  });

  it("caps the mails anybody can trigger per recipient, whoever asks from wherever", async () => {
    const a = await signupUser();
    await sink.take(a.email);
    for (let i = 0; i < MAIL_LIMIT_HOUR + 4; i++) {
      expect((await api("/v1/auth/reset-request", { body: { email: a.email }, ip: `203.${i}.${rand(1)[0]}.1`, sign: false })).status).toBe(202);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const resets = (await sink.take(a.email)).filter((m) => m.subject.toLowerCase().includes("reset"));
    // the confirmation mail of the sign-up counted too: together they stop at the cap
    expect(resets.length + 1).toBe(MAIL_LIMIT_HOUR);
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
