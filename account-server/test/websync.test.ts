// Edit on the website (4.2.x, Seanime_Web_Einstellungen_Plan.md package S1): opt-in from the app, web/unlock, web/key,
// and the snapshot for a website session that proved the key.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { rateKey, windowCount } from "../src/ratelimit";
import { api, b64, freshIp, ORIGIN, rand, sessionId, signupUser, upload } from "./helpers";

interface SentMail {
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
const json = <T = Record<string, unknown>>(res: Response) => res.json<T>();
type User = Awaited<ReturnType<typeof signupUser>>;
interface ListedEvent {
  kind: string;
  method?: string;
}

const UNLOCKED = "Your synced data was unlocked on the website";
const ON = "Edit on the website was turned on";
const OFF = "Edit on the website was turned off";

const web = (token: string) => ({ Origin: ORIGIN, Cookie: `__Host-sid=${token}` });
const events = async (token: string) => (await json<{ events: ListedEvent[] }>(await api("/v1/account", { token }))).events;
const subjects = async (email: string) => (await sink.take(email)).map((m) => m.subject);

async function websiteLogin(email: string, authKey: string): Promise<string> {
  const res = await api("/v1/auth/login", { headers: { Origin: ORIGIN }, body: { email, authKey } });
  expect(res.status).toBe(200);
  return /^__Host-sid=([A-Za-z0-9_-]{43});/.exec(res.headers.get("Set-Cookie") ?? "")![1]!;
}

/** The app turns Edit on the website on (device session, password again) */
async function turnOn(u: User): Promise<void> {
  const res = await api("/v1/account/web-access", { method: "PUT", token: u.token, body: { authKey: u.keys.authKey } });
  expect(res.status).toBe(204);
}

const unlock = (site: string, body: Record<string, string>, ip?: string) => api("/v1/web/unlock", { headers: web(site), body, ip });
const key = (site: string, dekId: string, dekProof: string) => api("/v1/web/key", { headers: web(site), body: { dekId, dekProof } });
const webGet = (site: string) => api("/v1/sync/snapshot", { headers: web(site) });
const webPut = (site: string, blob: Uint8Array, version: number, dekId: string) =>
  api("/v1/sync/snapshot", { method: "PUT", headers: { ...web(site), "If-Match": String(version), "X-Dek-Id": dekId }, raw: blob });

/** A user with a device, a first snapshot (version 1), Edit on the website on, and a website session holding the key */
async function unlocked(opts: { snapshot?: boolean } = {}) {
  const u = await signupUser();
  if (opts.snapshot ?? true) expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
  await turnOn(u);
  const site = await websiteLogin(u.email, u.keys.authKey);
  expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
  expect((await key(site, u.keys.dekId, u.keys.dekProof)).status).toBe(200);
  await sink.take(u.email);
  return { u, site };
}

async function expectError(res: Response, status: number, error: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(await json(res)).toMatchObject({ error });
}

describe("opt-in: only the app turns it on", () => {
  it("off by default: no unlock, no key, no snapshot for the website, nothing counted", async () => {
    const u = await signupUser();
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
    const site = await websiteLogin(u.email, u.keys.authKey);
    expect(await json(await api("/v1/account", { headers: web(site) }))).toMatchObject({ webEdit: false, session: { keyUntil: null } });
    await expectError(await unlock(site, { authKey: u.keys.authKey }), 403, "web_edit_off");
    await expectError(await key(site, u.keys.dekId, u.keys.dekProof), 403, "web_edit_off");
    await expectError(await webGet(site), 403, "web_edit_off");
    await expectError(await webPut(site, rand(64), 1, u.keys.dekId), 403, "web_edit_off");
    // even with a key proof left in the row, the flag decides
    await env.DB.prepare("UPDATE sessions SET key_proof_at = ?, key_dek_id = ? WHERE token_hash = ?")
      .bind(Math.floor(Date.now() / 1000), u.keys.dekId, await sessionId(site))
      .run();
    await expectError(await webGet(site), 403, "web_edit_off");
  });

  it("the website can't turn it on, not even a website session bound to a device row", async () => {
    const u = await signupUser();
    const site = await websiteLogin(u.email, u.keys.authKey);
    await expectError(await api("/v1/account/web-access", { method: "PUT", headers: web(site), body: { authKey: u.keys.authKey } }), 403, "device_required");
    // a tampered website registers itself as a device (password sign-in + DEK proof; mailed "New device")
    const bound = await api("/v1/account/keys", {
      method: "PUT",
      headers: web(site),
      body: { dekId: u.keys.dekId, dekProof: u.keys.dekProof, device: { name: "Browser", devicePub: b64(rand(32)), sealedDek: b64(rand(80)), mac: b64(rand(32)) } },
    });
    expect(bound.status).toBe(200);
    expect((await json<{ deviceId: string | null }>(bound)).deviceId).not.toBeNull();
    await expectError(await api("/v1/account/web-access", { method: "PUT", headers: web(site), body: { authKey: u.keys.authKey } }), 403, "app_required");
    // nor "code only" (decision 5), nor the snapshot as a "device"
    await expectError(await api("/v1/account/escrow", { method: "PUT", headers: web(site), body: { dek: b64(rand(32)), dekProof: u.keys.dekProof, authKey: u.keys.authKey } }), 403, "app_required");
    await expectError(await webGet(site), 403, "web_edit_off");
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({ webEdit: false, codeOnly: false });
  });

  it("the app turns it on with the password again: mailed and listed once", async () => {
    const u = await signupUser();
    await sink.take(u.email);
    await expectError(await api("/v1/account/web-access", { method: "PUT", token: u.token, body: { authKey: b64(rand(32)) } }), 403, "wrong_password");
    await expectError(await api("/v1/account/web-access", { method: "PUT", token: u.token, body: {} }), 400, "invalid_request");
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({ webEdit: false });
    expect(await subjects(u.email)).toEqual([]);
    await turnOn(u);
    await turnOn(u);
    expect(await subjects(u.email)).toEqual([ON]);
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({ webEdit: true });
    expect((await events(u.token)).filter((e) => e.kind === "web_edit_on")).toHaveLength(1);
    // an app session without a device row can't either
    const bare = (await json<{ sessionToken: string }>(await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } }))).sessionToken;
    await expectError(await api("/v1/account/web-access", { method: "PUT", token: bare, body: { authKey: u.keys.authKey } }), 403, "device_required");
  });

  it("any session turns it off; every website key session is locked at once", async () => {
    const { u, site } = await unlocked();
    expect((await webGet(site)).status).toBe(200);
    expect((await api("/v1/account/web-access", { method: "DELETE", headers: web(site) })).status).toBe(204);
    expect(await subjects(u.email)).toEqual([OFF]);
    expect((await events(u.token))[0]).toMatchObject({ kind: "web_edit_off" });
    await expectError(await webGet(site), 403, "web_edit_off");
    // on again: the old proof is gone, the website unlocks again
    await turnOn(u);
    await expectError(await webGet(site), 403, "unlock_required");
    // off twice: one mail
    await sink.take(u.email);
    expect((await api("/v1/account/web-access", { method: "DELETE", token: u.token })).status).toBe(204);
    expect((await api("/v1/account/web-access", { method: "DELETE", token: u.token })).status).toBe(204);
    expect(await subjects(u.email)).toEqual([OFF]);
  });
});

describe("unlock and key proof", () => {
  it("with the opt-in but without the key proof the website gets nothing", async () => {
    const u = await signupUser();
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    await expectError(await webGet(site), 403, "unlock_required");
    await expectError(await webPut(site, rand(64), 1, u.keys.dekId), 403, "unlock_required");
    // the DEK proof alone never unlocks (I3): web/key only right after web/unlock
    await expectError(await key(site, u.keys.dekId, u.keys.dekProof), 403, "unlock_required");
    // unlocked, but no key proof yet
    expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
    await expectError(await webGet(site), 403, "unlock_required");
    // without a session at all
    expect((await api("/v1/web/unlock", { headers: { Origin: ORIGIN }, body: { authKey: u.keys.authKey } })).status).toBe(401);
  });

  it("unlocks with the password: the wrap, then the key proof, a mail and an event", async () => {
    const u = await signupUser();
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    await sink.take(u.email);
    await expectError(await unlock(site, { authKey: b64(rand(32)) }), 403, "wrong_password");
    const res = await unlock(site, { authKey: u.keys.authKey });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      userId: u.userId,
      dekId: u.keys.dekId,
      kdf: { alg: "argon2id", m: 65536, t: 3, p: 1 },
      method: "password",
      wrappedDek: u.keys.wrappedDek,
    });
    // unlocking alone mails nothing
    expect(await subjects(u.email)).toEqual([]);
    const t = Math.floor(Date.now() / 1000);
    const k = await key(site, u.keys.dekId, u.keys.dekProof);
    expect(k.status).toBe(200);
    const { keyUntil } = await json<{ keyUntil: number }>(k);
    expect(keyUntil).toBeGreaterThanOrEqual(t + 1800);
    expect(keyUntil).toBeLessThanOrEqual(t + 1802);
    const mails = await sink.take(u.email);
    expect(mails.map((m) => m.subject)).toEqual([UNLOCKED]);
    expect(mails[0]!.text).toContain("Unlocked with: Password");
    expect(mails[0]!.text).not.toMatch(/[–—]/);
    expect((await events(u.token))[0]).toMatchObject({ kind: "web_unlocked", method: "password" });
    expect(await json(await api("/v1/account", { headers: web(site) }))).toMatchObject({ webEdit: true, session: { keyUntil } });
    expect((await webGet(site)).status).toBe(200);
  });

  it("a wrong DEK proof or another key is refused, and the unlock is used up", async () => {
    const u = await signupUser();
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
    await expectError(await key(site, u.keys.dekId, b64(rand(32))), 403, "key_required");
    // the right proof now needs a new unlock
    await expectError(await key(site, u.keys.dekId, u.keys.dekProof), 403, "unlock_required");
    expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
    await expectError(await key(site, "dek-other", u.keys.dekProof), 409, "dek_mismatch");
    await expectError(await webGet(site), 403, "unlock_required");
    expect((await events(u.token)).some((e) => e.kind === "web_unlocked")).toBe(false);
  });

  it("the unlock waits 5 minutes for the key proof", async () => {
    const u = await signupUser();
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET unlock_at = unlock_at - 301 WHERE token_hash = ?").bind(await sessionId(site)).run();
    await expectError(await key(site, u.keys.dekId, u.keys.dekProof), 403, "unlock_required");
  });

  it("only the website: no app session, no cookie without the website's Origin", async () => {
    const { u, site } = await unlocked();
    await expectError(await api("/v1/web/unlock", { token: u.token, body: { authKey: u.keys.authKey } }), 403, "website_only");
    await expectError(await api("/v1/web/key", { token: u.token, body: { dekId: u.keys.dekId, dekProof: u.keys.dekProof } }), 403, "website_only");
    const noOrigin = { Cookie: `__Host-sid=${site}` };
    await expectError(await api("/v1/web/unlock", { headers: noOrigin, body: { authKey: u.keys.authKey } }), 403, "website_only");
    await expectError(await api("/v1/sync/snapshot", { headers: noOrigin }), 403, "website_only");
    // another Origin never gets in
    expect((await api("/v1/sync/snapshot", { headers: { ...web(site), Origin: "https://evil.example" } })).status).toBe(403);
    expect((await webGet(site)).status).toBe(200);
  });

  it("the key proof ends after 30 minutes, with a key change, with Lock and with sign-out", async () => {
    const { u, site } = await unlocked();
    const hash = await sessionId(site);
    await env.DB.prepare("UPDATE sessions SET key_proof_at = key_proof_at - 1801 WHERE token_hash = ?").bind(hash).run();
    await expectError(await webGet(site), 403, "unlock_required");
    expect(await json(await api("/v1/account", { headers: web(site) }))).toMatchObject({ session: { keyUntil: null } });

    const second = await unlocked();
    // a key change (rotation, Start fresh) gives the account a new dekId: the old proof is worth nothing
    await env.DB.prepare("UPDATE users SET dek_id = 'dek-rotated' WHERE id = ?").bind(second.u.userId).run();
    await expectError(await webGet(second.site), 403, "unlock_required");

    const third = await unlocked();
    expect((await api("/v1/web/lock", { method: "POST", headers: web(third.site) })).status).toBe(204);
    await expectError(await webGet(third.site), 403, "unlock_required");

    const fourth = await unlocked();
    expect((await api("/v1/auth/logout", { method: "POST", headers: web(fourth.site) })).status).toBe(204);
    expect((await webGet(fourth.site)).status).toBe(401);
    expect(u.userId).not.toBe(second.u.userId);
  });

  it("never another account's data or key", async () => {
    const a = await unlocked();
    const b = await unlocked({ snapshot: false });
    // b's website session reads its own account only (none stored)
    expect((await webGet(b.site)).status).toBe(404);
    // a's key proof doesn't fit b's account
    expect((await unlock(b.site, { authKey: b.u.keys.authKey })).status).toBe(200);
    await expectError(await key(b.site, a.u.keys.dekId, a.u.keys.dekProof), 409, "dek_mismatch");
    expect((await unlock(b.site, { authKey: b.u.keys.authKey })).status).toBe(200);
    await expectError(await key(b.site, b.u.keys.dekId, a.u.keys.dekProof), 403, "key_required");
    // a's password doesn't unlock b
    await expectError(await unlock(b.site, { authKey: a.u.keys.authKey }), 403, "wrong_password");
    // b writes into its own account only, and only after a device uploaded there
    await expectError(await webPut(b.site, rand(64), 1, a.u.keys.dekId), 403, "unlock_required");
    expect(await json(await api("/v1/sync/meta", { token: a.u.token }))).toMatchObject({ version: 1 });
  });
});

describe("unlock with the recovery code or an email code", () => {
  it("the recovery proof: 5 tries per hour, the recovery wrap, mailed as Recovery code", async () => {
    const u = await signupUser();
    const recoveryProof = b64(rand(32));
    const recoveryWrappedDek = b64(rand(72));
    expect((await api("/v1/account/keys", { method: "PUT", token: u.token, body: { dekId: u.keys.dekId, recoveryWrappedDek, recoveryProof } })).status).toBe(200);
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    await expectError(await unlock(site, { recoveryProof: b64(rand(32)) }), 403, "wrong_recovery_code");
    const res = await unlock(site, { recoveryProof });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ method: "recovery", recoveryWrappedDek, dekId: u.keys.dekId });
    expect(body).not.toHaveProperty("wrappedDek");
    await sink.take(u.email);
    expect((await key(site, u.keys.dekId, u.keys.dekProof)).status).toBe(200);
    expect((await sink.take(u.email))[0]!.text).toContain("Unlocked with: Recovery code");
    // 2 used of 5: three more, then 429 for the hour (also for the right proof)
    for (let i = 0; i < 3; i++) expect((await unlock(site, { recoveryProof })).status).toBe(200);
    await expectError(await unlock(site, { recoveryProof }), 429, "rate_limited");
    // without a recovery code there is nothing to unlock with
    const v = await signupUser();
    await turnOn(v);
    await expectError(await unlock(await websiteLogin(v.email, v.keys.authKey), { recoveryProof }), 409, "no_recovery");
  });

  it("an email code only while code only is on; checked like a code sign-in", async () => {
    const u = await signupUser();
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    await expectError(await unlock(site, { code: "123456" }), 403, "code_only_required");
    const dek = b64(rand(32));
    expect((await api("/v1/account/escrow", { method: "PUT", token: u.token, body: { dek, dekProof: u.keys.dekProof, authKey: u.keys.authKey } })).status).toBe(204);
    const code = await mailedCode(u.email);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    await expectError(await unlock(site, { code: wrong }), 401, "invalid_code");
    const res = await unlock(site, { code });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ method: "code", escrowDek: dek, dekId: u.keys.dekId });
    // a code works once
    await expectError(await unlock(site, { code }), 401, "invalid_code");
    await sink.take(u.email);
    expect((await key(site, u.keys.dekId, u.keys.dekProof)).status).toBe(200);
    expect((await sink.take(u.email))[0]!.text).toContain("Unlocked with: Email code");
    // exactly one way at a time
    await expectError(await unlock(site, { code, authKey: u.keys.authKey }), 400, "invalid_request");
  });
});

/** auth/code/request, then the code from its mail */
async function mailedCode(email: string): Promise<string> {
  const exec = createExecutionContext();
  const req = new Request("https://api.example.com/v1/auth/code/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
    body: JSON.stringify({ email }),
  });
  expect((await (worker.fetch as unknown as (r: Request, e: Env, x: ExecutionContext) => Promise<Response>)(req, env, exec)).status).toBe(200);
  await waitOnExecutionContext(exec);
  const mail = (await sink.take(email)).findLast((m) => m.subject === "Your Seanime Mobile sign-in code");
  return /Sign-in code: (\d{6})/.exec(mail?.text ?? "")![1]!;
}

describe("the snapshot for a website key session", () => {
  it("reads and writes like a device: If-Match, an event on the first save and no mail", async () => {
    const { u, site } = await unlocked();
    const got = await webGet(site);
    expect(got.status).toBe(200);
    expect(got.headers.get("X-Snapshot-Version")).toBe("1");
    expect(got.headers.get("X-Dek-Id")).toBe(u.keys.dekId);
    expect(got.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(got.headers.get("Access-Control-Expose-Headers")).toContain("X-Snapshot-Version");
    expect((await got.arrayBuffer()).byteLength).toBe(64);

    const blob = rand(80);
    const put = await webPut(site, blob, 1, u.keys.dekId);
    expect(put.status).toBe(200);
    expect(await json(put)).toMatchObject({ version: 2, size: 80 });
    expect((await webPut(site, rand(81), 2, u.keys.dekId)).status).toBe(200);
    // one event per unlock, no mail
    const list = await events(u.token);
    expect(list.filter((e) => e.kind === "web_settings_changed")).toHaveLength(1);
    expect(await subjects(u.email)).toEqual([]);
    // the device gets the website's version
    const dev = await api("/v1/sync/snapshot", { token: u.token });
    expect(dev.headers.get("X-Snapshot-Version")).toBe("3");
    // a new unlock lists the next first save again
    expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
    expect((await key(site, u.keys.dekId, u.keys.dekProof)).status).toBe(200);
    expect((await webPut(site, rand(64), 3, u.keys.dekId)).status).toBe(200);
    expect((await events(u.token)).filter((e) => e.kind === "web_settings_changed")).toHaveLength(2);
  });

  it("a stale version gets 409 version_conflict with the current one", async () => {
    const { u, site } = await unlocked();
    // a device synced while the website was editing
    expect((await upload(u.token, rand(64), 1, u.keys.dekId)).status).toBe(200);
    const res = await webPut(site, rand(64), 1, u.keys.dekId);
    await expectError(res.clone(), 409, "version_conflict");
    expect(await json(res)).toMatchObject({ version: 2 });
    await expectError(await webPut(site, rand(64), 3, u.keys.dekId), 409, "version_conflict");
    expect((await webPut(site, rand(64), 2, u.keys.dekId)).status).toBe(200);
  });

  it("never the first package, nor one after DELETE sync; never empty, never under another key", async () => {
    const { u, site } = await unlocked({ snapshot: false });
    await expectError(await webPut(site, rand(64), 0, u.keys.dekId), 409, "no_snapshot");
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
    await expectError(await webPut(site, new Uint8Array(0), 1, u.keys.dekId), 400, "invalid_request");
    await expectError(await webPut(site, rand(64), 1, "dek-other"), 409, "dek_mismatch");
    expect((await api("/v1/sync", { method: "DELETE", token: u.token })).status).toBe(204);
    // size 0, version 2: the website waits for a device
    await expectError(await webPut(site, rand(64), 2, u.keys.dekId), 409, "no_snapshot");
    expect(await json(await api("/v1/sync/meta", { token: u.token }))).toMatchObject({ version: 2, size: 0 });
    expect((await upload(u.token, rand(64), 2, u.keys.dekId)).status).toBe(200);
    expect((await webPut(site, rand(64), 3, u.keys.dekId)).status).toBe(200);
  });

  it("10 website uploads per hour, counted before the account's counter; 60 reads", async () => {
    const { u, site } = await unlocked();
    const uploadKey = await rateKey(env, "upload", u.userId);
    const before = await windowCount(env, uploadKey);
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?, 10, ?, ?)")
      .bind(await rateKey(env, "web-upload", u.userId), t, t + 3600)
      .run();
    await expectError(await webPut(site, rand(64), 1, u.keys.dekId), 429, "rate_limited");
    // the devices' counter was not touched, and a device still uploads
    expect(await windowCount(env, uploadKey)).toBe(before);
    expect((await upload(u.token, rand(64), 1, u.keys.dekId)).status).toBe(200);

    await env.DB.prepare("INSERT INTO rate_limits (key, count, last_at, expires_at) VALUES (?, 60, ?, ?)")
      .bind(await rateKey(env, "web-read", u.userId), t, t + 3600)
      .run();
    await expectError(await webGet(site), 429, "rate_limited");
    expect((await api("/v1/sync/snapshot", { token: u.token })).status).toBe(200);
  });

  it("app sessions keep their rules: a device reads and writes, a session without one doesn't", async () => {
    const u = await signupUser();
    await turnOn(u);
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
    const bare = (await json<{ sessionToken: string }>(await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } }))).sessionToken;
    await expectError(await api("/v1/sync/snapshot", { token: bare }), 403, "device_required");
    await expectError(await upload(bare, rand(64), 1, u.keys.dekId), 403, "device_required");
    expect((await api("/v1/sync/snapshot", { token: u.token })).status).toBe(200);
  });
});
