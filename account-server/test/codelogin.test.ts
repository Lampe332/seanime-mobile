// Sign in with a code from an email and the opt-in "code only" escrow (4.2.0, Seanime_CodeLogin_Vertrag.md 1-4).
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { newCode } from "../src/codelogin";
import { cleanup } from "../src/cron";
import { rateKey } from "../src/ratelimit";
import { api, b64, challengeFor, clientKeys, DEFAULT_KDF, freshEmail, freshIp, newKey, rand, signed, signupUser } from "./helpers";

interface SentMail {
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
type Fetch = (r: Request, e: Env, c: ExecutionContext) => Promise<Response>;
const workerFetch = worker.fetch as unknown as Fetch;
type User = Awaited<ReturnType<typeof signupUser>>;
const json = <T = Record<string, unknown>>(res: Response) => res.json<T>();
const CODE_SUBJECT = "Your Seanime Mobile sign-in code";

/** auth/code/request, waiting for the work after the answer (code and mail) */
async function requestCode(email: string, ip = freshIp()) {
  const exec = createExecutionContext();
  const res = await workerFetch(
    new Request("https://api.example.com/v1/auth/code/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ email }),
    }),
    env,
    exec,
  );
  const before = await sink.take(email);
  await waitOnExecutionContext(exec);
  return { res, before };
}

async function mailedCode(email: string): Promise<string> {
  const mail = (await sink.take(email)).findLast((m) => m.subject === CODE_SUBJECT);
  const m = /Sign-in code: (\d{6})/.exec(mail?.text ?? "");
  if (!m) throw new Error("no sign-in code mailed");
  return m[1]!;
}

async function freshCode(email: string): Promise<string> {
  expect((await requestCode(email)).res.status).toBe(200);
  return mailedCode(email);
}

const codeLogin = (email: string, code: string, ip?: string) => api("/v1/auth/code/login", { body: { email, code }, ip });
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

interface CodeSession {
  sessionToken: string;
  userId: string;
  dekId: string | null;
  wrappedDek: string | null;
  rewrapNeeded: boolean;
  codeLogin: boolean;
  escrowDek: string | null;
}

async function signInWithCode(email: string): Promise<CodeSession> {
  const res = await codeLogin(email, await freshCode(email));
  expect(res.status).toBe(200);
  return json<CodeSession>(res);
}

async function turnOn(u: User, dek = b64(rand(32))) {
  const res = await api("/v1/account/escrow", { method: "PUT", token: u.token, body: { dek, dekProof: u.keys.dekProof, authKey: u.keys.authKey } });
  expect(res.status).toBe(204);
  return dek;
}

function rotateRequest(token: string, meta: unknown, ifMatch: number) {
  const form = new FormData();
  form.append("meta", JSON.stringify({ removed: [], ...(meta as object) }));
  return new Request("https://api.example.com/v1/account/rotate", {
    method: "POST",
    body: form,
    headers: { Authorization: `Bearer ${token}`, "If-Match": String(ifMatch), "CF-Connecting-IP": freshIp() },
  });
}

const escrowRow = (userId: string) =>
  env.DB.prepare("SELECT escrow_dek FROM users WHERE id = ?").bind(userId).first<{ escrow_dek: string | null }>();

describe("code", () => {
  it("has six digits, keeps leading zeros and is stored only as an HMAC", async () => {
    const codes = Array.from({ length: 4000 }, () => newCode());
    for (const c of codes) expect(c).toMatch(/^[0-9]{6}$/);
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(3900);

    const u = await signupUser();
    await sink.take(u.email);
    const { res, before } = await requestCode(u.email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    // the answer comes before the code and its mail
    expect(before).toHaveLength(0);
    const [mail] = await sink.take(u.email);
    expect(mail?.subject).toBe(CODE_SUBJECT);
    expect(mail?.text).toContain("10 minutes");
    expect(mail?.text).toContain("Your password stays the same.");
    const code = /Sign-in code: (\d{6})/.exec(mail!.text)![1]!;
    const row = await env.DB.prepare("SELECT code_hash, attempts, expires_at FROM sign_in_codes WHERE user_id = ?")
      .bind(u.userId)
      .first<{ code_hash: string; attempts: number; expires_at: number }>();
    expect(row?.code_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row?.code_hash).not.toContain(code);
    expect(row?.attempts).toBe(0);
    expect(row!.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(590);
    expect(row!.expires_at - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
  });

  it("answers the same for an unknown address and mails nothing", async () => {
    const u = await signupUser();
    await sink.take(u.email);
    const ghost = `ghost-${crypto.randomUUID()}@example.com`;
    const known = await requestCode(u.email);
    const unknown = await requestCode(ghost);
    expect(known.res.status).toBe(unknown.res.status);
    expect(await known.res.text()).toBe(await unknown.res.text());
    expect(await sink.take(u.email)).toHaveLength(1);
    expect(await sink.take(ghost)).toHaveLength(0);
  });

  it("allows 3 codes per hour per address and network, also for unknown addresses", async () => {
    const u = await signupUser();
    const ip = freshIp();
    for (let i = 0; i < 3; i++) expect((await requestCode(u.email, ip)).res.status).toBe(200);
    const over = (await requestCode(u.email, ip)).res;
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).not.toBeNull();
    // another network still gets one
    expect((await requestCode(u.email)).res.status).toBe(200);
    const ghost = freshEmail("ghost");
    for (let i = 0; i < 3; i++) expect((await requestCode(ghost, ip)).res.status).toBe(200);
    expect((await requestCode(ghost, ip)).res.status).toBe(429);
  });

  it("works for 10 minutes", async () => {
    const u = await signupUser();
    const code = await freshCode(u.email);
    await env.DB.prepare("UPDATE sign_in_codes SET expires_at = ? WHERE user_id = ?").bind(Math.floor(Date.now() / 1000) - 1, u.userId).run();
    const res = await codeLogin(u.email, code);
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: "invalid_code" });
  });

  it("is replaced by a new one", async () => {
    const u = await signupUser();
    const first = await freshCode(u.email);
    const second = await freshCode(u.email);
    if (first !== second) expect((await codeLogin(u.email, first)).status).toBe(401);
    expect((await codeLogin(u.email, second)).status).toBe(200);
  });

  it("works once", async () => {
    const u = await signupUser();
    const code = await freshCode(u.email);
    expect((await codeLogin(u.email, code)).status).toBe(200);
    const again = await codeLogin(u.email, code);
    expect(again.status).toBe(401);
    expect(await json(again)).toMatchObject({ error: "invalid_code" });
  });

  it("is used up after 5 wrong tries; 4 wrong tries still leave it", async () => {
    const a = await signupUser();
    const codeA = await freshCode(a.email);
    for (let i = 0; i < 4; i++) expect((await codeLogin(a.email, wrong(codeA))).status).toBe(401);
    expect((await codeLogin(a.email, codeA)).status).toBe(200);

    const b = await signupUser();
    const codeB = await freshCode(b.email);
    for (let i = 0; i < 5; i++) expect((await codeLogin(b.email, wrong(codeB))).status).toBe(401);
    const late = await codeLogin(b.email, codeB);
    expect(late.status).toBe(401);
    expect(await json(late)).toMatchObject({ error: "invalid_code" });
  });

  it("answers an unknown address like a wrong code", async () => {
    const u = await signupUser();
    const code = await freshCode(u.email);
    const bad = await codeLogin(u.email, wrong(code));
    const ghost = await codeLogin(freshEmail("ghost"), code);
    const none = await codeLogin((await signupUser()).email, code);
    expect([bad.status, ghost.status, none.status]).toEqual([401, 401, 401]);
    const body = await bad.text();
    expect(await ghost.text()).toBe(body);
    expect(await none.text()).toBe(body);
  });

  it("counts the login counter per IP and at most 20 tries per address a day", async () => {
    const u = await signupUser();
    const ip = freshIp();
    const code = await freshCode(u.email);
    // the IP's login counter (shared with auth/login) is at its limit: the right code waits too
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?, 20, ?, ?)")
      .bind(await rateKey(env, "login-ip", ip), t, t + 900)
      .run();
    expect((await codeLogin(u.email, code, ip)).status).toBe(429);
    expect((await codeLogin(u.email, code)).status).toBe(200);

    // 20 tries per address a day across networks, whatever the code
    const v = await signupUser();
    const first = await freshCode(v.email);
    for (let i = 0; i < 20; i++) expect((await codeLogin(v.email, wrong(first))).status).toBe(401);
    const next = await freshCode(v.email);
    expect((await codeLogin(v.email, next)).status).toBe(429);
  });

  it("is signed like a login: no challenge or no signature, no session", async () => {
    const u = await signupUser();
    const code = await freshCode(u.email);
    expect((await api("/v1/auth/code/login", { body: { email: u.email, code }, sign: false })).status).toBe(400);
    expect(
      (await api("/v1/auth/code/login", { body: { email: u.email, code, challenge: b64(rand(36)), sigKey: { alg: "ed25519", pub: b64(rand(32)) } } }))
        .status,
    ).toBe(401);
    // the right code still works afterwards: a bad signature never reached it
    expect((await codeLogin(u.email, code)).status).toBe(200);
  });
});

describe("code sign-in", () => {
  it("answers like a password sign-in plus codeLogin and escrowDek (null by default)", async () => {
    const u = await signupUser();
    const password = await json(await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } }));
    const code = await signInWithCode(u.email);
    expect(Object.keys(code).sort()).toEqual([...Object.keys(password), "codeLogin", "escrowDek", "recoveryWrappedDek"].sort());
    expect(code).toMatchObject({
      userId: u.userId,
      emailVerified: true,
      kdf: DEFAULT_KDF,
      wrappedDek: u.keys.wrappedDek,
      dekId: u.keys.dekId,
      rewrapNeeded: false,
      codeLogin: true,
      escrowDek: null,
    });
    // a session without the key, bound to its signing key like any sign-in
    expect(await json(await api("/v1/account", { token: code.sessionToken }))).toMatchObject({ codeOnly: false, emailVerified: true });
    expect((await api("/v1/sync/snapshot", { token: code.sessionToken })).status).toBe(403);
    expect((await api("/v1/account", { token: code.sessionToken, sign: false })).status).toBe(401);
  });

  it("without code only: the DEK proof alone brings no device in", async () => {
    const u = await signupUser();
    const s = await signInWithCode(u.email);
    const k = clientKeys();
    const res = await api("/v1/account/keys", {
      method: "PUT",
      token: s.sessionToken,
      body: { dekId: u.keys.dekId, dekProof: u.keys.dekProof, device: { name: "New phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac } },
    });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "owner_required" });
  });
});

describe("code only (escrow)", () => {
  it("turns on only with the right password from a device, and hands the key to a code sign-in", async () => {
    const u = await signupUser();
    const dek = b64(rand(32));
    const bad = await api("/v1/account/escrow", { method: "PUT", token: u.token, body: { dek, dekProof: u.keys.dekProof, authKey: b64(rand(32)) } });
    expect(bad.status).toBe(403);
    expect(await json(bad)).toMatchObject({ error: "wrong_password" });
    expect((await escrowRow(u.userId))?.escrow_dek).toBeNull();
    // a session without a device row (no key) can't
    const bare = (await json<{ sessionToken: string }>(await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } }))).sessionToken;
    expect((await api("/v1/account/escrow", { method: "PUT", token: bare, body: { dek, authKey: u.keys.authKey } })).status).toBe(403);
    expect((await api("/v1/account/escrow", { method: "PUT", body: { dek, authKey: u.keys.authKey } })).status).toBe(401);
    await sink.take(u.email);

    await turnOn(u, dek);
    expect((await sink.take(u.email)).map((m) => m.subject)).toEqual(["Sign-in with an email code only was turned on"]);
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({
      codeOnly: true,
      events: [expect.objectContaining({ kind: "code_only_on" })],
    });
    // stored sealed, never the raw key, and never shown by GET account
    const stored = (await escrowRow(u.userId))!.escrow_dek!;
    expect(stored).not.toContain(dek);
    expect(await (await api("/v1/account", { token: u.token })).text()).not.toContain(stored);

    const s = await signInWithCode(u.email);
    expect(s.escrowDek).toBe(dek);
    // the code session joins with the key like a password sign-in: new row, "new device" mail
    const k = clientKeys();
    const join = await api("/v1/account/keys", {
      method: "PUT",
      token: s.sessionToken,
      body: { dekId: u.keys.dekId, dekProof: u.keys.dekProof, device: { name: "New phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac } },
    });
    expect(join.status).toBe(200);
    expect((await sink.take(u.email)).map((m) => m.subject)).toContain("New device signed in");
  });

  it("is deleted at once when turned off", async () => {
    const u = await signupUser();
    await turnOn(u);
    await sink.take(u.email);
    expect((await api("/v1/account/escrow", { method: "DELETE", token: u.token })).status).toBe(204);
    expect((await escrowRow(u.userId))?.escrow_dek).toBeNull();
    expect((await sink.take(u.email)).map((m) => m.subject)).toEqual(["Sign-in with an email code only was turned off"]);
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({ codeOnly: false });
    expect((await signInWithCode(u.email)).escrowDek).toBeNull();
    // off again: nothing to delete, no mail
    expect((await api("/v1/account/escrow", { method: "DELETE", token: u.token })).status).toBe(204);
    expect((await sink.take(u.email)).filter((m) => m.subject.includes("code only"))).toHaveLength(0);
    expect((await api("/v1/account/escrow", { method: "DELETE" })).status).toBe(401);
  });

  it("a key change needs escrowDek while it is on and replaces the copy", async () => {
    const u = await signupUser();
    await turnOn(u);
    const newDek = `dek-${b64(rand(6))}`;
    const meta = {
      oldDekId: u.keys.dekId,
      dekId: newDek,
      dekProof: b64(rand(32)),
      chainMac: b64(rand(32)),
      devices: [{ deviceId: u.deviceId, sealedDek: b64(rand(80)), mac: b64(rand(32)) }],
      wrappedDek: b64(rand(72)),
    };
    const missing = await exports.default.fetch(await signed(rotateRequest(u.token, meta, 0)));
    expect(missing.status).toBe(409);
    expect(await json(missing)).toMatchObject({ error: "escrow_required" });
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({ dekId: u.keys.dekId, codeOnly: true });

    const next = b64(rand(32));
    const ok = await exports.default.fetch(await signed(rotateRequest(u.token, { ...meta, escrowDek: next }, 0)));
    expect(ok.status).toBe(200);
    const s = await signInWithCode(u.email);
    expect(s).toMatchObject({ dekId: newDek, escrowDek: next });

    // without code only a sent escrowDek is ignored: rotating never turns it on
    const v = await signupUser();
    const vMeta = { ...meta, oldDekId: v.keys.dekId, devices: [{ deviceId: v.deviceId, sealedDek: b64(rand(80)), mac: b64(rand(32)) }], escrowDek: next };
    expect((await exports.default.fetch(await signed(rotateRequest(v.token, vMeta, 0)))).status).toBe(200);
    expect((await escrowRow(v.userId))?.escrow_dek).toBeNull();
  });

  it("Start fresh removes it", async () => {
    const u = await signupUser();
    await turnOn(u);
    const k = clientKeys();
    const res = await api("/v1/account/start-fresh", {
      token: u.token,
      body: { dekId: k.dekId, dekProof: k.dekProof, wrappedDek: k.wrappedDek, device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac } },
    });
    expect(res.status).toBe(200);
    expect((await escrowRow(u.userId))?.escrow_dek).toBeNull();
    expect((await signInWithCode(u.email)).escrowDek).toBeNull();
  });

  it("deleting the account removes it and open codes", async () => {
    const u = await signupUser();
    await turnOn(u);
    expect((await requestCode(u.email)).res.status).toBe(200);
    const count = (table: string) =>
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "users" ? "id" : "user_id"} = ?`).bind(u.userId).first<{ n: number }>();
    expect((await count("sign_in_codes"))?.n).toBe(1);
    expect((await api("/v1/account", { method: "DELETE", token: u.token })).status).toBe(204);
    expect((await count("users"))?.n).toBe(0);
    expect((await count("sign_in_codes"))?.n).toBe(0);
  });
});

describe("new password after a code sign-in", () => {
  const newPassword = (dekId: string, extra: Record<string, unknown> = {}) => ({
    authKey: b64(rand(32)),
    salt: b64(rand(16)),
    kdf: DEFAULT_KDF,
    wrappedDek: b64(rand(72)),
    dekId,
    ...extra,
  });

  it("sets a new password for the current key; other sessions stay; mailed", async () => {
    const u = await signupUser();
    const s = await signInWithCode(u.email);
    await sink.take(u.email);
    const call = (token: string, body: unknown) => api("/v1/account/password/after-code", { token, body });

    // a password session can't use it
    expect((await call(u.token, newPassword(u.keys.dekId))).status).toBe(403);
    // another key
    expect((await call(s.sessionToken, newPassword("dek-other", { dekProof: u.keys.dekProof }))).status).toBe(409);
    // no device row and no DEK proof: not from a key holder
    const noProof = await call(s.sessionToken, newPassword(u.keys.dekId));
    expect(noProof.status).toBe(403);
    expect(await json(noProof)).toMatchObject({ error: "key_required" });

    const body = newPassword(u.keys.dekId, { dekProof: u.keys.dekProof });
    expect((await call(s.sessionToken, body)).status).toBe(204);
    const mails = await sink.take(u.email);
    expect(mails.map((m) => m.subject)).toEqual(["Your password was changed"]);
    expect(mails[0]!.text).toContain("after a sign-in with an email code");
    // the old device stays signed in
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);
    // the old password is gone, the new one opens the new wrap
    expect((await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } })).status).toBe(401);
    const login = await api("/v1/auth/login", { body: { email: u.email, authKey: body.authKey } });
    expect(login.status).toBe(200);
    expect(await json(login)).toMatchObject({ wrappedDek: body.wrappedDek, dekId: u.keys.dekId, rewrapNeeded: false });
  });

  it("only within 15 minutes of the code sign-in", async () => {
    const u = await signupUser();
    const s = await signInWithCode(u.email);
    await env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 16 * 60 WHERE user_id = ? AND code_auth = 1").bind(u.userId).run();
    const res = await api("/v1/account/password/after-code", { token: s.sessionToken, body: newPassword(u.keys.dekId, { dekProof: u.keys.dekProof }) });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "reauth_required" });
  });

  it("forgot the password: code, Start fresh without a password wrap, then a new password", async () => {
    const u = await signupUser();
    const s = await signInWithCode(u.email);
    const k = clientKeys();
    const fresh = await api("/v1/account/start-fresh", {
      token: s.sessionToken,
      body: { dekId: k.dekId, dekProof: k.dekProof, device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac } },
    });
    expect(fresh.status).toBe(200);
    expect(await json(await api("/v1/account", { token: s.sessionToken }))).toMatchObject({ dekId: k.dekId, rewrapNeeded: true });
    // the session is now bound to the new device row, so no DEK proof is needed
    const body = newPassword(k.dekId);
    expect((await api("/v1/account/password/after-code", { token: s.sessionToken, body })).status).toBe(204);
    expect(await json(await api("/v1/auth/login", { body: { email: u.email, authKey: body.authKey } }))).toMatchObject({
      wrappedDek: body.wrappedDek,
      dekId: k.dekId,
      rewrapNeeded: false,
    });
  });
});

describe("cron", () => {
  it("removes expired and used up codes", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const c = await signupUser();
    for (const u of [a, b, c]) expect((await requestCode(u.email)).res.status).toBe(200);
    await env.DB.prepare("UPDATE sign_in_codes SET expires_at = 1 WHERE user_id = ?").bind(a.userId).run();
    await env.DB.prepare("UPDATE sign_in_codes SET attempts = 5 WHERE user_id = ?").bind(b.userId).run();
    await cleanup(env);
    const left = await env.DB.prepare("SELECT user_id FROM sign_in_codes WHERE user_id IN (?, ?, ?)").bind(a.userId, b.userId, c.userId).all<{ user_id: string }>();
    expect(left.results.map((r) => r.user_id)).toEqual([c.userId]);
  });
});

describe("review 4.2.0 (M1 to N4)", () => {
  /** A network of its own, distinct /24 from freshIp's 10.x */
  const net = () => `172.${16 + (rand(1)[0]! % 16)}.${rand(1)[0]}.${1 + (rand(1)[0]! % 200)}`;
  const t = () => Math.floor(Date.now() / 1000);
  /** The owner signs in with a code once from `ip`: that network is the owner's from then on */
  async function ownerAt(ip: string) {
    const u = await signupUser();
    expect((await requestCode(u.email, ip)).res.status).toBe(200);
    expect((await codeLogin(u.email, await mailedCode(u.email), ip)).status).toBe(200);
    return u;
  }
  const toGoogleOnly = (userId: string) =>
    env.DB.prepare("UPDATE users SET auth_hash = NULL, pepper_version = NULL, google_sub = ? WHERE id = ?").bind(`g-${b64(rand(6))}`, userId).run();

  it("M1: 20 wrong tries from strangers' networks never hold up the owner's network", async () => {
    const home = net();
    const u = await ownerAt(home);
    // the owner's first sign-in came from a network not known yet and counted as one of the 20
    for (let i = 0; i < 19; i++) expect((await codeLogin(u.email, "000000", net())).status).toBe(401);
    expect((await codeLogin(u.email, "000000", net())).status).toBe(429);
    expect((await requestCode(u.email, home)).res.status).toBe(200);
    expect((await codeLogin(u.email, await mailedCode(u.email), home)).status).toBe(200);
  });

  it("M1: 60 code requests from 20 strangers' networks never silence the owner's code mail", async () => {
    const home = net();
    const u = await ownerAt(home);
    for (let n = 0; n < 20; n++) {
      const stranger = net();
      for (let i = 0; i < 3; i++) await requestCode(u.email, stranger);
    }
    await sink.take(u.email);
    expect((await requestCode(u.email, home)).res.status).toBe(200);
    expect((await codeLogin(u.email, await mailedCode(u.email), home)).status).toBe(200);
  });

  it("N2: 50 tries a week from strangers' networks, the owner's network is not counted", async () => {
    const home = net();
    const u = await ownerAt(home);
    // the owner's first code sign-in came from a network not known yet: it counted
    const week = async () => env.DB.prepare("SELECT count FROM rate_limits WHERE key = ?").bind(await rateKey(env, "code-try-week", u.email)).first();
    expect(await week()).toEqual({ count: 1 });
    await codeLogin(u.email, "000000", net());
    expect(await week()).toEqual({ count: 2 });
    expect((await requestCode(u.email, home)).res.status).toBe(200);
    expect((await codeLogin(u.email, await mailedCode(u.email), home)).status).toBe(200);
    expect(await week()).toEqual({ count: 2 });
    await env.DB.prepare("UPDATE rate_limits SET count = 50, expires_at = ? WHERE key = ?")
      .bind(t() + 6 * 24 * 3600, await rateKey(env, "code-try-week", u.email))
      .run();
    expect((await requestCode(u.email, home)).res.status).toBe(200);
    const code = await mailedCode(u.email);
    const stranger = await codeLogin(u.email, code, net());
    expect(stranger.status).toBe(429);
    expect(stranger.headers.get("Retry-After")).not.toBeNull();
    expect((await codeLogin(u.email, code, home)).status).toBe(200);
  });

  it("N2: the owner's network has its own cap of 20 tries a day", async () => {
    const home = net();
    const u = await ownerAt(home);
    await env.DB.prepare("INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?, 20, ?, ?)")
      .bind(await rateKey(env, "code-try-net", `${u.email}|${home.split(".").slice(0, 3).join(".")}.0/24`), t(), t() + 3600)
      .run();
    expect((await codeLogin(u.email, "000000", home)).status).toBe(429);
    // strangers elsewhere are not held up by it, and neither is the owner on another network
    expect((await codeLogin(u.email, "000000", net())).status).toBe(401);
  });

  it("M2: a Google-only account gets no code, the same answer as an unknown address", async () => {
    const u = await signupUser();
    await toGoogleOnly(u.userId);
    await sink.take(u.email);
    const ghost = await requestCode(freshEmail("ghost"));
    const google = await requestCode(u.email);
    expect(google.res.status).toBe(200);
    expect(await google.res.text()).toBe(await ghost.res.text());
    expect(await sink.take(u.email)).toHaveLength(0);
    expect(await env.DB.prepare("SELECT 1 FROM sign_in_codes WHERE user_id = ?").bind(u.userId).first()).toBeNull();
  });

  it("M2: a code from before the password went never signs in", async () => {
    const u = await signupUser();
    const code = await freshCode(u.email);
    await toGoogleOnly(u.userId);
    const res = await codeLogin(u.email, code);
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: "invalid_code" });
  });

  it("M2: a code session of a Google-only account owns nothing", async () => {
    const u = await signupUser();
    const s = await signInWithCode(u.email);
    await toGoogleOnly(u.userId);
    const k = clientKeys();
    const fresh = await api("/v1/account/start-fresh", {
      token: s.sessionToken,
      body: { dekId: k.dekId, dekProof: k.dekProof, device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac } },
    });
    expect(fresh.status).toBe(403);
    expect(await json(fresh)).toMatchObject({ error: "owner_required" });
    const after = await api("/v1/account/password/after-code", {
      token: s.sessionToken,
      body: { authKey: b64(rand(32)), salt: b64(rand(16)), kdf: DEFAULT_KDF, wrappedDek: b64(rand(72)), dekId: u.keys.dekId, dekProof: u.keys.dekProof },
    });
    expect(after.status).toBe(409);
    expect(await json(after)).toMatchObject({ error: "no_password" });
    const del = await api("/v1/account", { method: "DELETE", token: s.sessionToken });
    expect(del.status).toBe(403);
    expect(await json(del)).toMatchObject({ error: "owner_required" });
    expect(await env.DB.prepare("SELECT auth_hash, google_sub IS NOT NULL AS g FROM users WHERE id = ?").bind(u.userId).first()).toEqual({
      auth_hash: null,
      g: 1,
    });
  });

  it("N1: a code session removes devices only with code only on", async () => {
    const u = await signupUser();
    const s = await signInWithCode(u.email);
    const res = await api(`/v1/devices/${u.deviceId}`, { method: "DELETE", token: s.sessionToken });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "owner_required" });
    expect(await env.DB.prepare("SELECT 1 AS k FROM devices WHERE id = ?").bind(u.deviceId).first()).toEqual({ k: 1 });

    const v = await signupUser();
    await turnOn(v);
    const sv = await signInWithCode(v.email);
    expect((await api(`/v1/devices/${v.deviceId}`, { method: "DELETE", token: sv.sessionToken })).status).toBe(204);
  });

  it("N3: code only needs the DEK proof of the account's current key", async () => {
    const u = await signupUser();
    const dek = b64(rand(32));
    const put = (body: Record<string, unknown>) => api("/v1/account/escrow", { method: "PUT", token: u.token, body });
    expect((await put({ dek, authKey: u.keys.authKey })).status).toBe(400);
    const stale = await put({ dek, dekProof: b64(rand(32)), authKey: u.keys.authKey });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ error: "dek_mismatch" });
    expect((await escrowRow(u.userId))?.escrow_dek).toBeNull();
    expect((await put({ dek, dekProof: u.keys.dekProof, authKey: u.keys.authKey })).status).toBe(204);
  });

  it("N4: a broken ESCROW_KEY neither uses up the code nor leaves a session", async () => {
    const u = await signupUser();
    const dek = await turnOn(u);
    const code = await freshCode(u.email);
    const key = await newKey();
    const request = await signed(
      new Request("https://api.example.com/v1/auth/code/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
        body: JSON.stringify({ email: u.email, code, challenge: await challengeFor(u.email), sigKey: { alg: key.alg, pub: key.pub } }),
      }),
      key,
    );
    // a view of env with the secret missing (env itself stays untouched for the other tests)
    const broken = new Proxy(env, { get: (target, name) => (name === "ESCROW_KEY" ? "" : Reflect.get(target, name)) });
    const res = await workerFetch(request, broken, createExecutionContext());
    expect(res.status).toBe(500);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND code_auth = 1").bind(u.userId).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT 1 AS k FROM sign_in_codes WHERE user_id = ?").bind(u.userId).first()).toEqual({ k: 1 });
    const ok = await codeLogin(u.email, code);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ escrowDek: dek });
  });

  it("answers recoveryWrappedDek like auth/google", async () => {
    const u = await signupUser();
    const wrap = b64(rand(72));
    await env.DB.prepare("UPDATE users SET recovery_wrapped_dek = ? WHERE id = ?").bind(wrap, u.userId).run();
    expect(await signInWithCode(u.email)).toMatchObject({ recoveryWrappedDek: wrap });
    expect(await signInWithCode((await signupUser()).email)).toMatchObject({ recoveryWrappedDek: null });
  });
});
