/**
 * Fix round 4 after the third security review (18.11.), server side of fix design 3: S1 one number per approval and a
 * pause after three "No", S2 key change as an allowlist, S3 only the owner joins (password, recovery proof, the device's
 * own live row), S4 sign-out leaves a trace, S5 no lockout (sign-in link by mail), NEU3-6 mail caps per network, I5 events.
 */
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LOGIN_LIMIT_EMAIL_GLOBAL } from "../src/ratelimit";
import { api, b64, DEFAULT_KDF, deviceKeys, freshEmail, freshIp, keyOf, newKey, rand, sessionId, signed, signupUser } from "./helpers";

interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
type User = Awaited<ReturnType<typeof signupUser>>;

async function loginToken(email: string, authKey: string, sign?: Awaited<ReturnType<typeof newKey>>): Promise<string> {
  const res = await api("/v1/auth/login", { body: { email, authKey }, sign });
  expect(res.status).toBe(200);
  return (await res.json<{ sessionToken: string }>()).sessionToken;
}

/** A second device of the account, joined after a password sign-in (what the app does after unwrapping the password wrap) */
async function addDevice(u: User, name: string) {
  const token = await loginToken(u.email, u.keys.authKey);
  const device = deviceKeys(name);
  const res = await api("/v1/account/keys", { method: "PUT", token, body: { dekId: u.keys.dekId, dekProof: u.keys.dekProof, device } });
  expect(res.status).toBe(200);
  return { token, device, deviceId: (await res.json<{ deviceId: string }>()).deviceId };
}

async function rotate(token: string, u: User, deviceIds: string[], removed: string[] = []) {
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

const errorOf = async (res: Response) => (await res.json<{ error: string }>()).error;
const events = async (token: string) => (await (await api("/v1/account", { token })).json<{ events: { kind: string; deviceName: string | null }[] }>()).events;
/** Mails go out after the answer (waitUntil) on the sign-in paths: wait for them */
async function mailsTo(email: string, subject: string, want = 1): Promise<SentMail[]> {
  const seen: SentMail[] = [];
  for (let i = 0; i < 40 && seen.length < want; i++) {
    seen.push(...(await sink.take(email)).filter((m) => m.subject === subject));
    if (seen.length < want) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return seen;
}
const tokenIn = (mail: SentMail | undefined) => /#token=([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "")?.[1] ?? "";

describe("S1: approvals", () => {
  it("three 'No' within an hour pause approvals for an hour; mailed and listed", async () => {
    const a = await signupUser();
    await sink.take(a.email);
    const n = await loginToken(a.email, a.keys.authKey);
    for (let i = 0; i < 3; i++) {
      const created = await api("/v1/devices/requests", { token: n, body: { deviceName: "Tablet", devicePub: b64(rand(32)), commitment: b64(rand(32)) } });
      expect(created.status).toBe(201);
      const { id } = await created.json<{ id: string }>();
      // NEU4-4: only a "No" from a device with its own row counts (the owner's phone)
      expect((await api(`/v1/devices/requests/${id}/deny`, { token: a.token, method: "POST" })).status).toBe(204);
    }
    const paused = await api("/v1/devices/requests", { token: n, body: { deviceName: "Tablet", devicePub: b64(rand(32)), commitment: b64(rand(32)) } });
    expect(paused.status).toBe(429);
    expect(await errorOf(paused)).toBe("approvals_paused");
    expect((await sink.take(a.email)).map((m) => m.subject)).toEqual(["New device sign-ins are paused"]);
    expect((await events(a.token)).map((e) => e.kind)).toContain("approvals_paused");
    // the password still works for the owner: a device joins without an approval
    expect((await api("/v1/account/keys", { method: "PUT", token: n, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: deviceKeys("Tablet") } })).status).toBe(200);
  });
});

describe("S2: a key change is an allowlist", () => {
  it("keeps only the devices the user kept; every other row is removed, named in the chain, mailed and listed", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Old Tablet");
    const phone2 = await addDevice(a, "Second Phone");
    await sink.take(a.email);
    // a device left out must be named in the chain; a kept one must be live; the rotating device keeps itself
    expect((await rotate(a.token, a, [a.deviceId!, phone2.deviceId])).status).toBe(409);
    expect((await rotate(a.token, a, [phone2.deviceId], [tablet.device.devicePub, a.keys.devicePub])).status).toBe(409);
    expect((await rotate(a.token, a, [a.deviceId!, phone2.deviceId, crypto.randomUUID()], [tablet.device.devicePub])).status).toBe(409);

    const ok = await rotate(a.token, a, [a.deviceId!, phone2.deviceId], [tablet.device.devicePub]);
    expect(ok.status).toBe(200);
    const gone = await api("/v1/sync/meta", { token: tablet.token });
    expect(gone.status).toBe(401);
    expect(await errorOf(gone)).toBe("device_removed");
    const { devices } = await (await api("/v1/devices", { token: a.token })).json<{ devices: { id: string }[] }>();
    expect(devices.map((d) => d.id).sort()).toEqual([a.deviceId, phone2.deviceId].sort());
    const key = await (await api("/v1/account/keys/device", { token: phone2.token })).json<{ rotatorPub: string; removed: string[] }>();
    expect(key).toMatchObject({ rotatorPub: a.keys.devicePub, removed: [tablet.device.devicePub] });
    expect((await sink.take(a.email)).map((m) => m.subject)).toEqual(["A device was removed", "Your account key was changed"]);
    expect((await events(a.token)).slice(0, 2).map((e) => [e.kind, e.deviceName])).toEqual([["key_rotated", null], ["device_removed", "Old Tablet"]]);
    // the removed key never binds again
    const again = await loginToken(a.email, a.keys.authKey);
    expect((await api("/v1/account/keys", { method: "PUT", token: again, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: tablet.device } })).status).toBe(403);
  });
});

describe("S3: only the owner joins, a copied key never does", () => {
  it("a Google-style session needs the password or the recovery proof; the DEK proof alone is refused", async () => {
    const a = await signupUser();
    const recoveryProof = b64(rand(32));
    expect((await api("/v1/account/keys", { method: "PUT", token: a.token, body: { dekId: a.keys.dekId, recoveryWrappedDek: b64(rand(72)), recoveryProof } })).status).toBe(200);
    const g = await loginToken(a.email, a.keys.authKey);
    await env.DB.prepare("UPDATE sessions SET password_auth = 0 WHERE token_hash = ?").bind(await sessionId(g)).run();
    const join = (extra: Record<string, unknown>) =>
      api("/v1/account/keys", { method: "PUT", token: g, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: deviceKeys("Thief"), ...extra } });
    const proofOnly = await join({});
    expect(proofOnly.status).toBe(403);
    expect(await errorOf(proofOnly)).toBe("owner_required");
    expect((await join({ recoveryProof: b64(rand(32)) })).status).toBe(403);
    // without the key the recovery proof is not enough either
    expect((await join({ dekProof: b64(rand(32)), recoveryProof })).status).toBe(403);
    expect((await join({ recoveryProof })).status).toBe(200);
    // a Google-style device session can't change the password
    const password = { salt: b64(rand(16)), kdf: DEFAULT_KDF, authKey: b64(rand(32)), wrappedDek: b64(rand(72)), dekId: a.keys.dekId, dekProof: a.keys.dekProof };
    expect(await errorOf(await api("/v1/account/password", { token: g, body: password }))).toBe("owner_required");
    // nor start fresh on a password account
    const fresh = await api("/v1/account/start-fresh", { token: g, body: { dekId: "dek-fresh", dekProof: b64(rand(32)), wrappedDek: b64(rand(72)), device: deviceKeys("Phone") } });
    expect(fresh.status).toBe(403);
  });

  it("NEU3-2: the only device removed on the website, a new phone with the password joins, changes the key and starts fresh", async () => {
    const a = await signupUser();
    const web = await loginToken(a.email, a.keys.authKey);
    expect((await api(`/v1/devices/${a.deviceId}`, { method: "DELETE", token: web })).status).toBe(204);
    const phone = await loginToken(a.email, a.keys.authKey);
    const device = deviceKeys("New Phone");
    const put = await api("/v1/account/keys", { method: "PUT", token: phone, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device } });
    expect(put.status).toBe(200);
    const { deviceId } = await put.json<{ deviceId: string }>();
    expect((await rotate(phone, a, [deviceId])).status).toBe(200);
    expect(await env.DB.prepare("SELECT rotation_required FROM users WHERE id = ?").bind(a.userId).first()).toEqual({ rotation_required: 0 });
    // and start fresh works for the owner too (password sign-in)
    const other = await signupUser();
    const web2 = await loginToken(other.email, other.keys.authKey);
    expect((await api(`/v1/devices/${other.deviceId}`, { method: "DELETE", token: web2 })).status).toBe(204);
    const phone2 = await loginToken(other.email, other.keys.authKey);
    const fresh = await api("/v1/account/start-fresh", { token: phone2, body: { dekId: "dek-fresh", dekProof: b64(rand(32)), wrappedDek: b64(rand(72)), device: deviceKeys("New Phone") } });
    expect(fresh.status).toBe(200);
  });

  it("a device whose session ran out takes its live row back with its own signing key; after signing out it can't", async () => {
    const a = await signupUser();
    const key = keyOf(a.token)!;
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(a.userId).run();
    const again = await loginToken(a.email, a.keys.authKey, key);
    await env.DB.prepare("UPDATE sessions SET password_auth = 0 WHERE token_hash = ?").bind(await sessionId(again)).run();
    const device = { name: "Test Phone", devicePub: a.keys.devicePub, sealedDek: a.keys.sealedDek, mac: a.keys.mac };
    const back = await api("/v1/account/keys", { method: "PUT", token: again, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device } });
    expect(back.status).toBe(200);
    expect((await back.json<{ deviceId: string }>()).deviceId).toBe(a.deviceId);
    expect((await api("/v1/auth/logout", { token: again, method: "POST" })).status).toBe(204);
    const third = await loginToken(a.email, a.keys.authKey, key);
    await env.DB.prepare("UPDATE sessions SET password_auth = 0 WHERE token_hash = ?").bind(await sessionId(third)).run();
    const signedOut = await api("/v1/account/keys", { method: "PUT", token: third, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device } });
    expect(await errorOf(signedOut)).toBe("owner_required");
  });
});

describe("S4: signing out leaves a trace", () => {
  it("the row stays as signed out, the account asks for a key change, mailed and listed", async () => {
    const a = await signupUser();
    const tablet = await addDevice(a, "Tablet");
    await sink.take(a.email);
    expect((await api("/v1/auth/logout", { token: tablet.token, method: "POST" })).status).toBe(204);
    const { devices } = await (await api("/v1/devices", { token: a.token })).json<{ devices: { id: string; signedOutAt: number | null }[] }>();
    expect(devices.find((d) => d.id === tablet.deviceId)?.signedOutAt).toEqual(expect.any(Number));
    expect(devices.find((d) => d.id === a.deviceId)?.signedOutAt).toBeNull();
    expect(await (await api("/v1/sync/meta", { token: a.token })).json()).toMatchObject({ rotationRequired: true });
    expect((await sink.take(a.email)).map((m) => m.subject)).toEqual(["A device signed out"]);
    expect((await events(a.token))[0]).toMatchObject({ kind: "device_signed_out", deviceName: "Tablet" });
    // a signed-out device is never kept by a key change
    expect((await rotate(a.token, a, [a.deviceId!, tablet.deviceId])).status).toBe(409);
    expect((await rotate(a.token, a, [a.deviceId!], [tablet.device.devicePub])).status).toBe(200);
  });
});

describe("S5: nobody is locked out by the email's counter", () => {
  it("over the limit a right and a wrong password get the same answer; the right one mails a link; the confirmed key signs in once", async () => {
    const owner = await newKey();
    const email = freshEmail();
    const authKey = b64(rand(32));
    const signup = await api("/v1/auth/signup", {
      sign: owner,
      body: { email, salt: b64(rand(16)), kdf: DEFAULT_KDF, authKey, keys: { wrappedDek: b64(rand(72)), dekId: "dek-g", dekProof: b64(rand(32)), device: deviceKeys() } },
    });
    expect(signup.status).toBe(201);
    await sink.take(email);
    const login = (key: string, sign?: Awaited<ReturnType<typeof newKey>>, ip = freshIp()) => api("/v1/auth/login", { body: { email, authKey: key }, sign, ip });
    for (let i = 0; i < LOGIN_LIMIT_EMAIL_GLOBAL; i++) expect((await login(b64(rand(32)), undefined, `198.${i}.${rand(1)[0]}.9`)).status).toBe(401);

    const newPhone = await newKey();
    const wrong = await login(b64(rand(32)), await newKey());
    const right = await login(authKey, newPhone);
    expect([wrong.status, right.status]).toEqual([202, 202]);
    expect(await wrong.text()).toBe(await right.text());
    const [mail] = await mailsTo(email, "Confirm your sign-in");
    expect(await sink.take(email)).toEqual([]);
    // the link confirms this key's sign-in: it signs in once, like a known device
    expect((await api("/v1/auth/login/confirm", { body: { token: tokenIn(mail) }, sign: false })).status).toBe(200);
    expect((await api("/v1/auth/login/confirm", { body: { token: tokenIn(mail) }, sign: false })).status).toBe(400);
    expect((await login(authKey, newPhone)).status).toBe(200);
    expect((await login(authKey, newPhone)).status).toBe(202);
    // the device that signed up keeps its key and is never held up
    expect((await login(authKey, owner)).status).toBe(200);
  });

  it("NEU3-6: a stranger uses up only his own network's reset mails, never the owner's", async () => {
    const a = await signupUser();
    await sink.take(a.email);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await api("/v1/auth/reset-request", { body: { email: a.email }, ip: `203.0.113.${i + 1}`, sign: false })).status);
    // NEU5-1: the request limit is per address now; the mails from one network stay capped (5 an hour)
    expect(statuses.every((s) => s === 202)).toBe(true);
    expect(await mailsTo(a.email, "Reset your password", 8)).toHaveLength(5);
    expect((await api("/v1/auth/reset-request", { body: { email: a.email }, ip: "198.51.100.7", sign: false })).status).toBe(202);
    expect(await mailsTo(a.email, "Reset your password")).toHaveLength(1);
  });
});
