// Session list, sign-out elsewhere, device last seen, sign-ins in the timeline, the wait before Start fresh (4.2.x).
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { cleanup } from "../src/cron";
import { issueToken } from "../src/identity";
import { api, clientKeys, DEFAULT_KDF, freshIp, keyOf, newKey, ORIGIN, rand, sessionId, signupUser, upload, type TestKey } from "./helpers";

interface SentMail {
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
const json = <T = Record<string, unknown>>(res: Response) => res.json<T>();

interface ListedSession {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  method: string;
  kind: string;
  deviceName: string | null;
  current: boolean;
}
interface ListedEvent {
  kind: string;
  deviceName: string | null;
  at: number;
  method?: string;
}

const sessions = async (token: string) => (await json<{ sessions: ListedSession[] }>(await api("/v1/sessions", { token }))).sessions;
const events = async (token: string) => (await json<{ events: ListedEvent[] }>(await api("/v1/account", { token }))).events;
const login = async (email: string, authKey: string, ip?: string) =>
  (await json<{ sessionToken: string }>(await api("/v1/auth/login", { body: { email, authKey }, ip }))).sessionToken;
/** A sign-in on the website: the session comes as a cookie */
async function websiteLogin(email: string, authKey: string): Promise<string> {
  const res = await api("/v1/auth/login", { headers: { Origin: ORIGIN }, body: { email, authKey } });
  expect(res.status).toBe(200);
  return /^__Host-sid=([A-Za-z0-9_-]{43});/.exec(res.headers.get("Set-Cookie") ?? "")![1]!;
}
const web = (token: string) => ({ Origin: ORIGIN, Cookie: `__Host-sid=${token}` });
/** The sign-in was longer ago than 10 minutes */
const ageAuth = (token: string) => sessionId(token).then((hash) => env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 3600 WHERE token_hash = ?").bind(hash).run());
const ageWebAuth = async (userId: string) => env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 3600 WHERE user_id = ? AND web = 1").bind(userId).run();

/** `key`: sign in with this signing key (the same device or browser again) instead of a new one */
async function codeSignIn(email: string, key?: TestKey): Promise<string> {
  const exec = createExecutionContext();
  const req = new Request("https://api.example.com/v1/auth/code/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
    body: JSON.stringify({ email }),
  });
  expect((await (worker.fetch as unknown as (r: Request, e: Env, x: ExecutionContext) => Promise<Response>)(req, env, exec)).status).toBe(200);
  await waitOnExecutionContext(exec);
  const mail = (await sink.take(email)).findLast((m) => m.subject === "Your Seanime Mobile sign-in code");
  const code = /Sign-in code: (\d{6})/.exec(mail?.text ?? "")![1]!;
  const res = await api("/v1/auth/code/login", { body: { email, code }, ...(key ? { sign: key } : {}) });
  expect(res.status).toBe(200);
  return (await json<{ sessionToken: string }>(res)).sessionToken;
}

const freshBody = (k = clientKeys(), wrapped = true) => ({
  dekId: k.dekId,
  dekProof: k.dekProof,
  ...(wrapped ? { wrappedDek: k.wrappedDek } : {}),
  device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac },
});

describe("GET account: the current session", () => {
  it("tells how and when this session signed in, and nothing about others", async () => {
    const u = await signupUser();
    const code = await codeSignIn(u.email);
    const res = await api("/v1/account", { token: code });
    const own = (await json<{ session: { authAt: number; method: string; recentAuthUntil: number } }>(res)).session;
    expect(own.method).toBe("code");
    expect(own.recentAuthUntil).toBe(own.authAt + 600);
    expect((await json<{ session: { method: string } }>(await api("/v1/account", { token: u.token }))).session.method).toBe("password");
  });
});

describe("sessions", () => {
  it("lists the account's own sessions without token hashes or addresses", async () => {
    const ip = "203.0.113.77";
    const u = await signupUser({ ip });
    const bare = await login(u.email, u.keys.authKey, ip);
    const site = await websiteLogin(u.email, u.keys.authKey);
    const other = await signupUser();
    const res = await api("/v1/sessions", { token: u.token });
    expect(res.status).toBe(200);
    const text = await res.text();
    const list = (JSON.parse(text) as { sessions: ListedSession[] }).sessions;
    expect(list).toHaveLength(3);
    const current = list.find((s) => s.current)!;
    expect(current).toMatchObject({ method: "password", kind: "app", deviceName: "Test Phone" });
    expect(list.filter((s) => !s.current).map((s) => [s.kind, s.deviceName]).sort()).toEqual([
      ["app", null],
      ["website", null],
    ]);
    for (const s of list) {
      expect(s.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Object.keys(s).sort()).toEqual(["createdAt", "current", "deviceName", "id", "kind", "lastUsedAt", "method"]);
    }
    // no token, no token hash (the app's signing session id), no address, nothing of the other account
    for (const secret of [u.token, bare, site, await sessionId(u.token), await sessionId(bare), await sessionId(site), ip, other.token, other.userId]) {
      expect(text).not.toContain(secret);
    }
    const rows = await env.DB.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").bind(u.userId).all<{ token_hash: string }>();
    for (const r of rows.results) expect(text).not.toContain(r.token_hash);
    // the website sees its own session as current
    const fromSite = await json<{ sessions: ListedSession[] }>(await api("/v1/sessions", { headers: web(site) }));
    expect(fromSite.sessions.find((s) => s.current)).toMatchObject({ kind: "website" });
    expect((await api("/v1/sessions")).status).toBe(401);
  });

  it("ends one session at once (401 from the next request), an event and no mail", async () => {
    const u = await signupUser();
    const site = await websiteLogin(u.email, u.keys.authKey);
    await ageAuth(u.token);
    await sink.take(u.email);
    const target = (await sessions(u.token)).find((s) => s.kind === "website")!;
    // a website session ends without a recent sign-in
    const res = await api(`/v1/sessions/${target.id}`, { method: "DELETE", token: u.token });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ signedOut: 1 });
    const after = await api("/v1/sync/meta", { headers: web(site) });
    expect(after.status).toBe(401);
    expect(await json(after)).toMatchObject({ error: "unauthorized" });
    expect(await sink.take(u.email)).toEqual([]);
    expect((await events(u.token))[0]).toMatchObject({ kind: "sessions_signed_out", deviceName: null });
    expect((await sessions(u.token)).map((s) => s.current)).toEqual([true]);
    // gone is gone
    expect((await api(`/v1/sessions/${target.id}`, { method: "DELETE", token: u.token })).status).toBe(404);
  });

  it("never ends another account's session, nor the current one", async () => {
    const u = await signupUser();
    const other = await signupUser();
    const foreign = (await sessions(other.token))[0]!;
    const res = await api(`/v1/sessions/${foreign.id}`, { method: "DELETE", token: u.token });
    expect(res.status).toBe(404);
    expect((await api("/v1/sync/meta", { token: other.token })).status).toBe(200);
    const own = (await sessions(u.token))[0]!;
    const self = await api(`/v1/sessions/${own.id}`, { method: "DELETE", token: u.token });
    expect(self.status).toBe(400);
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);
    expect((await api("/v1/sessions/not-an-id", { method: "DELETE", token: u.token })).status).toBe(404);
  });

  it("an app session that holds the key ends only after a recent sign-in", async () => {
    const u = await signupUser();
    const site = await websiteLogin(u.email, u.keys.authKey);
    await ageWebAuth(u.userId);
    const phone = (await json<{ sessions: ListedSession[] }>(await api("/v1/sessions", { headers: web(site) }))).sessions.find((s) => s.deviceName === "Test Phone")!;
    const res = await api(`/v1/sessions/${phone.id}`, { method: "DELETE", headers: web(site) });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "reauth_required" });
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);
    // signed in again just now: it goes, the device row stays (removing it is DELETE devices/:id)
    const fresh = await websiteLogin(u.email, u.keys.authKey);
    expect((await api(`/v1/sessions/${phone.id}`, { method: "DELETE", headers: web(fresh) })).status).toBe(200);
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(401);
    expect(await env.DB.prepare("SELECT name, signed_out_at FROM devices WHERE user_id = ?").bind(u.userId).first()).toEqual({
      name: "Test Phone",
      signed_out_at: null,
    });
    expect((await events(fresh))[0]).toMatchObject({ kind: "sessions_signed_out", deviceName: "Test Phone" });
  });

  it("sign out everywhere else: website sessions always, app sessions with the key only after a recent sign-in", async () => {
    const u = await signupUser();
    const bare = await login(u.email, u.keys.authKey);
    const site = await websiteLogin(u.email, u.keys.authKey);
    const second = await websiteLogin(u.email, u.keys.authKey);
    await ageWebAuth(u.userId);
    const refused = await api("/v1/sessions/others", { method: "DELETE", headers: web(site) });
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ error: "reauth_required" });
    // nothing ended
    for (const token of [u.token, bare]) expect((await api("/v1/sync/meta", { token })).status).toBe(200);
    expect((await api("/v1/sync/meta", { headers: web(second) })).status).toBe(200);

    // from the bare app session (no device) after a recent sign-in: all others go, the device too
    const res = await api("/v1/sessions/others", { method: "DELETE", token: bare });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ signedOut: 3 });
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(401);
    expect((await api("/v1/sync/meta", { headers: web(site) })).status).toBe(401);
    expect((await api("/v1/sync/meta", { headers: web(second) })).status).toBe(401);
    expect((await api("/v1/sync/meta", { token: bare })).status).toBe(200);
    expect((await events(bare)).filter((e) => e.kind === "sessions_signed_out")).toHaveLength(1);

    // only website sessions left to end: no recent sign-in needed
    const v = await signupUser({ withKeys: false });
    const vSite = await websiteLogin(v.email, v.keys.authKey);
    await ageAuth(v.token);
    expect(await json(await api("/v1/sessions/others", { method: "DELETE", token: v.token }))).toEqual({ signedOut: 1 });
    expect((await api("/v1/sync/meta", { headers: web(vSite) })).status).toBe(401);
  });
});

describe("devices: last seen", () => {
  it("a device session marks its device as seen, at most every 5 minutes", async () => {
    const u = await signupUser();
    const past = Math.floor(Date.now() / 1000) - 3600;
    await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE user_id = ?").bind(past, u.userId).run();
    await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE user_id = ?").bind(past, u.userId).run();
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);
    const seen = (await json<{ devices: { lastSeenAt: number }[] }>(await api("/v1/devices", { token: u.token }))).devices[0]!.lastSeenAt;
    expect(seen).toBeGreaterThan(past + 3000);
    // within 5 minutes nothing is written again
    const earlier = seen - 60;
    await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE user_id = ?").bind(earlier, u.userId).run();
    await api("/v1/sync/meta", { token: u.token });
    expect((await json<{ devices: { lastSeenAt: number }[] }>(await api("/v1/devices", { token: u.token }))).devices[0]!.lastSeenAt).toBe(earlier);
    // a session without a device row touches no device
    const bare = await login(u.email, u.keys.authKey);
    await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE user_id = ?").bind(past, u.userId).run();
    await api("/v1/sync/meta", { token: bare });
    expect((await env.DB.prepare("SELECT last_seen_at FROM devices WHERE user_id = ?").bind(u.userId).first<{ last_seen_at: number }>())!.last_seen_at).toBe(earlier);
  });
});

describe("timeline: sign-ins, reset, confirmed email", () => {
  it("lists sign-ins with their method and the device that signed in, without a mail", async () => {
    const u = await signupUser();
    await sink.take(u.email);
    // the app keeps its signing key: a sign-in with the key of its live row names the device
    const again = await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey }, sign: keyOf(u.token) });
    expect(again.status).toBe(200);
    await websiteLogin(u.email, u.keys.authKey);
    expect(await sink.take(u.email)).toEqual([]);
    await codeSignIn(u.email);
    const list = await events(u.token);
    expect(list.slice(0, 3)).toEqual([
      { kind: "signed_in", method: "code", deviceName: null, at: expect.any(Number) },
      { kind: "signed_in", method: "password", deviceName: null, at: expect.any(Number) },
      { kind: "signed_in", method: "password", deviceName: "Test Phone", at: expect.any(Number) },
    ]);
  });

  it("frequent sign-ins never push security events out", async () => {
    const u = await signupUser();
    const t = Math.floor(Date.now() / 1000);
    const insert = (kind: string, at: number) =>
      env.DB.prepare("INSERT INTO account_events (user_id, kind, method, device_name, at) VALUES (?, ?, ?, ?, ?)").bind(
        u.userId,
        kind,
        kind === "signed_in" ? "password" : null,
        kind === "device_removed" ? "Old Phone" : null,
        at,
      );
    await env.DB.batch([
      ...Array.from({ length: 5 }, (_, i) => insert("device_removed", t - 1000 + i)),
      insert("key_rotated", t - 900),
      ...Array.from({ length: 30 }, (_, i) => insert("signed_in", t - 500 + i)),
    ]);
    const list = await events(u.token);
    expect(list.filter((e) => e.kind === "device_removed")).toHaveLength(5);
    expect(list.filter((e) => e.kind === "key_rotated")).toHaveLength(1);
    expect(list.filter((e) => e.kind === "signed_in")).toHaveLength(10);
    // newest first, and the newest sign-ins are the ones shown
    expect(list[0]).toMatchObject({ kind: "signed_in", at: t - 500 + 29 });
  });

  it("a password reset and a confirmed email are listed; Start fresh waits a day after the reset", async () => {
    const u = await signupUser();
    const verify = await issueToken(env, u.userId, "verify", 3600);
    await verify.statement.run();
    expect((await api("/v1/auth/verify", { body: { token: verify.token } })).status).toBe(200);
    // a used link lists nothing more
    expect((await api("/v1/auth/verify", { body: { token: verify.token } })).status).toBe(400);
    expect((await events(u.token)).filter((e) => e.kind === "email_verified")).toHaveLength(1);

    const reset = await issueToken(env, u.userId, "reset", 1800);
    await reset.statement.run();
    const k = clientKeys();
    await sink.take(u.email);
    expect((await api("/v1/auth/reset", { body: { token: reset.token, salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey } })).status).toBe(200);
    // one mail, the one a reset always sent
    expect((await sink.take(u.email)).map((m) => m.subject)).toHaveLength(1);
    const s = await login(u.email, k.authKey);
    const list = await events(s);
    expect(list.slice(0, 3).map((e) => e.kind)).toEqual(["signed_in", "password_reset", "email_verified"]);
    expect(list.some((e) => e.kind === "password_changed")).toBe(false);

    // the password sign-in right after the reset doesn't start fresh yet
    const wait = await api("/v1/account/start-fresh", { token: s, body: freshBody() });
    expect(wait.status).toBe(403);
    const body = await json<{ error: string; retryAfter: number }>(wait);
    expect(body.error).toBe("start_fresh_wait");
    expect(body.retryAfter).toBeGreaterThan(23 * 3600);
    expect(body.retryAfter).toBeLessThanOrEqual(24 * 3600);
    await env.DB.prepare("UPDATE users SET reset_at = reset_at - 24 * 3600 - 1 WHERE id = ?").bind(u.userId).run();
    expect((await api("/v1/account/start-fresh", { token: s, body: freshBody() })).status).toBe(200);
  });

  it("the 180-day cleanup removes old sign-ins too", async () => {
    const u = await signupUser();
    const old = Math.floor(Date.now() / 1000) - 181 * 24 * 3600;
    await env.DB.prepare("INSERT INTO account_events (user_id, kind, method, at) VALUES (?, 'signed_in', 'password', ?)").bind(u.userId, old).run();
    await cleanup(env);
    expect((await events(u.token)).some((e) => e.at === old)).toBe(false);
  });
});

describe("Start fresh waits after a code sign-in (per signing key)", () => {
  /** Moves every code anchor of the account back by `seconds` */
  const ageAnchors = (userId: string, seconds: number) =>
    env.DB.prepare("UPDATE code_anchors SET since = since - ? WHERE user_id = ?").bind(seconds, userId).run();
  const startFresh = (token: string) => api("/v1/account/start-fresh", { token, body: freshBody(clientKeys(), false) });
  async function expectWait(res: Response, min: number) {
    expect(res.status).toBe(403);
    const body = await json<{ error: string; retryAfter: number }>(res);
    expect(body.error).toBe("start_fresh_wait");
    expect(body.retryAfter).toBeGreaterThan(min);
    expect(body.retryAfter).toBeLessThanOrEqual(24 * 3600);
  }

  it("a code session waits 24 hours after the first code of the window with its key, a password session doesn't", async () => {
    const u = await signupUser();
    const key = await newKey();
    await expectWait(await startFresh(await codeSignIn(u.email, key)), 23 * 3600);
    // nothing changed
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);

    // the same key a day later (a later code in the window doesn't start the wait again)
    await ageAnchors(u.userId, 25 * 3600);
    expect((await startFresh(await codeSignIn(u.email, key))).status).toBe(200);

    // with the password: at once
    const v = await signupUser();
    expect((await api("/v1/account/start-fresh", { token: v.token, body: freshBody() })).status).toBe(200);
  });

  it("S2-F2: the owner's code two days ago never lets a brand-new key of the mailbox holder start fresh", async () => {
    const u = await signupUser();
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
    await codeSignIn(u.email, await newKey()); // the owner, two days ago
    await ageAnchors(u.userId, 48 * 3600);
    await env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 48 * 3600, created_at = created_at - 48 * 3600 WHERE user_id = ? AND code_auth = 1")
      .bind(u.userId)
      .run();
    const attacker = await codeSignIn(u.email); // a new key, seconds old, mailbox only
    // unknown key: the full 24 hours
    await expectWait(await startFresh(attacker), 24 * 3600 - 60);
    // the snapshot and the owner's session are still there
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);
    expect(await json(await api("/v1/sync/meta", { token: attacker }))).toMatchObject({ size: 64 });
  });

  it("another key waits although the owner's key could start fresh", async () => {
    const u = await signupUser();
    const owner = await newKey();
    await codeSignIn(u.email, owner);
    await ageAnchors(u.userId, 25 * 3600);
    await expectWait(await startFresh(await codeSignIn(u.email)), 24 * 3600 - 60);
    expect((await startFresh(await codeSignIn(u.email, owner))).status).toBe(200);
  });

  it("after the 7-day window the same key waits again, and the cleanup removes the old anchor", async () => {
    const u = await signupUser();
    const key = await newKey();
    await codeSignIn(u.email, key);
    await ageAnchors(u.userId, 8 * 24 * 3600);
    await cleanup(env);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM code_anchors WHERE user_id = ?").bind(u.userId).first<{ n: number }>();
    expect(left!.n).toBe(0);
    await expectWait(await startFresh(await codeSignIn(u.email, key)), 23 * 3600);

    // also without the cleanup: an anchor older than 7 days doesn't count, the next code starts a new one
    const v = await signupUser();
    const vKey = await newKey();
    await codeSignIn(v.email, vKey);
    await ageAnchors(v.userId, 8 * 24 * 3600);
    await expectWait(await startFresh(await codeSignIn(v.email, vKey)), 23 * 3600);
  });
});
