/**
 * Round "Polish" after the fourth security review (18.11.): NEU4-1 separate mail pots and known networks (I4), NEU4-2 the
 * sign-in link confirms only the attempt that triggered it, NEU4-3 deleting a password account needs the password,
 * NEU4-4 only devices count for the approval pause and the quota is per session, NEU4-5 events can't be pushed out and the
 * R2 failure path still reports the removed devices (I5).
 */
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_LIMIT_EMAIL_GLOBAL } from "../src/ratelimit";
import { api, b64, DEFAULT_KDF, deviceKeys, freshEmail, freshIp, keyOf, newKey, rand, sessionId, signed, signupUser, upload } from "./helpers";

interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
type Key = Awaited<ReturnType<typeof newKey>>;

const errorOf = async (res: Response) => (await res.json<{ error: string }>()).error;
const events = async (token: string) =>
  (await (await api("/v1/account", { token })).json<{ events: { kind: string; deviceName: string | null }[] }>()).events;
async function mailsTo(email: string, subject: string, want = 1): Promise<SentMail[]> {
  const seen: SentMail[] = [];
  for (let i = 0; i < 40 && seen.length < want; i++) {
    seen.push(...(await sink.take(email)).filter((m) => m.subject === subject));
    if (seen.length < want) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return seen;
}
const tokenIn = (mail: SentMail | undefined) => /#token=([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "")?.[1] ?? "";
const net = (a: number, b: number) => `172.${16 + a}.${b}.9`;

async function loginToken(email: string, authKey: string): Promise<string> {
  const res = await api("/v1/auth/login", { body: { email, authKey } });
  expect(res.status).toBe(200);
  return (await res.json<{ sessionToken: string }>()).sessionToken;
}

/** An owner who signed up with his phone from `home` */
async function owner(home: string) {
  const email = freshEmail("owner");
  const authKey = b64(rand(32));
  const phone = await newKey();
  const res = await api("/v1/auth/signup", {
    sign: phone,
    ip: home,
    body: { email, salt: b64(rand(16)), kdf: DEFAULT_KDF, authKey, keys: { wrappedDek: b64(rand(72)), dekId: "dek-p", dekProof: b64(rand(32)), device: deviceKeys() } },
  });
  expect(res.status).toBe(201);
  await sink.take(email);
  const login = (key: string, sign?: Key, ip = freshIp()) => api("/v1/auth/login", { body: { email, authKey: key }, sign, ip });
  return { email, authKey, login };
}

const reset = (email: string, ip: string) => api("/v1/auth/reset-request", { body: { email }, ip, sign: false });

describe("NEU4-1: a stranger can't silence the owner's mails (I4)", () => {
  it("the sec8 attack (54 resets from 18 networks, 20 wrong passwords): the owner still gets the sign-in link and signs in", async () => {
    const home = net(0, 1);
    const o = await owner(home);
    // 1) the reset pot used up from 18 /24
    const answers: number[] = [];
    for (let n = 0; n < 18; n++) for (let i = 0; i < 3; i++) answers.push((await reset(o.email, net(3, n))).status);
    expect(answers.every((s) => s === 202)).toBe(true);
    expect(await mailsTo(o.email, "Reset your password", 50)).toHaveLength(50);
    // 2) the email's counter over its limit
    for (let i = 0; i < LOGIN_LIMIT_EMAIL_GLOBAL; i++) expect((await o.login(b64(rand(32)), undefined, net(4, i % 5))).status).toBe(401);
    // 3) the owner on a new phone in a new network: the link comes from its own pot
    const newPhone = await newKey();
    const elsewhere = net(5, 1);
    expect((await o.login(o.authKey, newPhone, elsewhere)).status).toBe(202);
    const [link] = await mailsTo(o.email, "Confirm your sign-in");
    expect(link).toBeDefined();
    expect((await api("/v1/auth/login/confirm", { body: { token: tokenIn(link) }, sign: false })).status).toBe(200);
    expect((await o.login(o.authKey, newPhone, elsewhere)).status).toBe(200);
    // the website (another key, another network) gets its own link too
    const browser = await newKey();
    expect((await o.login(o.authKey, browser, net(5, 2))).status).toBe(202);
    expect(await mailsTo(o.email, "Confirm your sign-in")).toHaveLength(1);
  });

  it("a forgotten password: the owner's reset from a network he signed in from still mails him, a stranger's from elsewhere doesn't", async () => {
    const home = net(6, 1);
    const o = await owner(home);
    for (let n = 0; n < 18; n++) for (let i = 0; i < 3; i++) await reset(o.email, net(7, n));
    expect(await mailsTo(o.email, "Reset your password", 50)).toHaveLength(50);
    expect((await reset(o.email, net(8, 1))).status).toBe(202);
    expect(await mailsTo(o.email, "Reset your password")).toHaveLength(0);
    expect((await reset(o.email, net(6, 1).replace(/\.9$/, ".77"))).status).toBe(202);
    expect(await mailsTo(o.email, "Reset your password")).toHaveLength(1);
  });
});

describe("NEU4-2: an opened link confirms one attempt, it makes no key 'known'", () => {
  it("after the link the same key with a wrong password still gets 202 (no oracle); only the right password signs in, once", async () => {
    const o = await owner(freshIp());
    for (let i = 0; i < LOGIN_LIMIT_EMAIL_GLOBAL; i++) expect((await o.login(b64(rand(32)), undefined, `198.${i}.${rand(1)[0]}.9`)).status).toBe(401);
    const guesser = await newKey();
    expect((await o.login(o.authKey, guesser)).status).toBe(202);
    const [link] = await mailsTo(o.email, "Confirm your sign-in");
    expect((await api("/v1/auth/login/confirm", { body: { token: tokenIn(link) }, sign: false })).status).toBe(200);
    const guesses = [];
    for (let i = 0; i < 4; i++) guesses.push((await o.login(b64(rand(32)), guesser)).status);
    expect(guesses).toEqual([202, 202, 202, 202]);
    expect((await o.login(o.authKey, guesser)).status).toBe(200);
    expect((await o.login(o.authKey, guesser)).status).toBe(202);
  });
});

describe("NEU4-3: deleting a password account needs the password", () => {
  it("a Google-style session (no password check) is refused; a fresh password sign-in deletes", async () => {
    const a = await signupUser();
    const g = await loginToken(a.email, a.keys.authKey);
    await env.DB.prepare("UPDATE sessions SET password_auth = 0 WHERE token_hash = ?").bind(await sessionId(g)).run();
    const refused = await api("/v1/account", { method: "DELETE", token: g });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("owner_required");
    expect(await env.DB.prepare("SELECT 1 AS k FROM users WHERE id = ?").bind(a.userId).first()).not.toBeNull();
    const p = await loginToken(a.email, a.keys.authKey);
    expect((await api("/v1/account", { method: "DELETE", token: p })).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 AS k FROM users WHERE id = ?").bind(a.userId).first()).toBeNull();
  });

  it("the website types the password again: a wrong one is refused, the right one deletes, even from a Google-style session", async () => {
    const a = await signupUser();
    const g = await loginToken(a.email, a.keys.authKey);
    await env.DB.prepare("UPDATE sessions SET password_auth = 0, auth_at = auth_at - 3600 WHERE token_hash = ?").bind(await sessionId(g)).run();
    const wrong = await api("/v1/account", { method: "DELETE", token: g, body: { authKey: b64(rand(32)) } });
    expect(wrong.status).toBe(403);
    expect(await errorOf(wrong)).toBe("wrong_password");
    expect((await api("/v1/account", { method: "DELETE", token: g, body: { authKey: a.keys.authKey } })).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 AS k FROM users WHERE id = ?").bind(a.userId).first()).toBeNull();
  });
});

describe("NEU4-4: a session without the key can't pause the owner's approvals", () => {
  const request = (token: string) =>
    api("/v1/devices/requests", { token, body: { deviceName: "Tablet", devicePub: b64(rand(32)), commitment: b64(rand(32)) } });

  it("three 'No' of its own requests don't pause; its open requests don't use up the owner's", async () => {
    const a = await signupUser();
    await sink.take(a.email);
    const thief = await loginToken(a.email, a.keys.authKey);
    for (let i = 0; i < 3; i++) {
      const created = await request(thief);
      expect(created.status).toBe(201);
      const { id } = await created.json<{ id: string }>();
      expect((await api(`/v1/devices/requests/${id}/deny`, { token: thief, method: "POST" })).status).toBe(204);
    }
    // not paused: the thief's own "No" never counted
    expect((await request(thief)).status).toBe(201);
    // a second keyless sign-in fills its own open requests, not the account's
    const thief2 = await loginToken(a.email, a.keys.authKey);
    for (let i = 0; i < 3; i++) expect((await request(thief2)).status).toBe(201);
    const full = await request(thief2);
    expect(full.status).toBe(429);
    expect(await errorOf(full)).toBe("too_many_open_requests");
    // the owner's new phone (its own sign-in) still asks for approval
    const newPhone = await loginToken(a.email, a.keys.authKey);
    expect((await request(newPhone)).status).toBe(201);
    expect((await sink.take(a.email)).map((m) => m.subject)).not.toContain("New device sign-ins are paused");
  });
});

describe("NEU4-5: security events stay visible (I5)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a flood of one kind never pushes the newest of another kind out of the list", async () => {
    const a = await signupUser();
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO account_events (user_id, kind, device_name, at) VALUES (?, 'device_signed_out', 'Old phone', ?)").bind(a.userId, t).run();
    for (let i = 0; i < 30; i++) {
      await env.DB.prepare("INSERT INTO account_events (user_id, kind, device_name, at) VALUES (?, 'recovery_changed', NULL, ?)").bind(a.userId, t + 1 + i).run();
    }
    const list = await events(a.token);
    expect(list.filter((e) => e.kind === "recovery_changed")).toHaveLength(20);
    expect(list.at(-1)).toEqual(expect.objectContaining({ kind: "device_signed_out", deviceName: "Old phone" }));
  });

  it("when R2 fails during a key change, the left-out devices stay removed and are mailed and listed", async () => {
    const a = await signupUser();
    const tabletToken = await loginToken(a.email, a.keys.authKey);
    const tablet = deviceKeys("Old Tablet");
    expect((await api("/v1/account/keys", { method: "PUT", token: tabletToken, body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: tablet } })).status).toBe(200);
    expect((await upload(a.token, rand(64), 0, a.keys.dekId)).status).toBe(200);
    await sink.take(a.email);
    vi.spyOn(env.SNAPSHOTS, "put").mockRejectedValueOnce(new Error("R2 down"));
    const meta = {
      oldDekId: a.keys.dekId,
      dekId: `dek-${b64(rand(6))}`,
      dekProof: b64(rand(32)),
      chainMac: b64(rand(32)),
      devices: [{ deviceId: a.deviceId, sealedDek: b64(rand(120)), mac: b64(rand(32)) }],
      wrappedDek: b64(rand(72)),
      removed: [tablet.devicePub],
    };
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    form.append("snapshot", new Blob([rand(64)]));
    const request = new Request("https://api.example.com/v1/account/rotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${a.token}`, "If-Match": "1", "CF-Connecting-IP": freshIp() },
      body: form,
    });
    const res = await exports.default.fetch(await signed(request, keyOf(a.token)));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect((await api("/v1/sync/meta", { token: tabletToken })).status).toBe(401);
    expect((await mailsTo(a.email, "A device was removed")).length).toBe(1);
    expect((await events(a.token)).map((e) => e.kind)).toContain("device_removed");
  });
});
