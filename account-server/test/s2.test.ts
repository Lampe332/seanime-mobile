// S2 security review: website upload budget, unlock mail, Edit on the website after Start fresh and a reset
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { issueToken } from "../src/identity";
import { api, b64, clientKeys, freshIp, ORIGIN, rand, signupUser, upload } from "./helpers";

interface SentMail {
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
const json = <T = Record<string, unknown>>(res: Response) => res.json<T>();
type User = Awaited<ReturnType<typeof signupUser>>;
const UNLOCKED = "Your synced data was unlocked on the website";

const web = (token: string) => ({ Origin: ORIGIN, Cookie: `__Host-sid=${token}` });
const events = async (token: string) =>
  (await json<{ events: { kind: string; method?: string }[] }>(await api("/v1/account", { token }))).events;
const unlockEvents = async (token: string) => (await events(token)).filter((e) => e.kind === "web_unlocked");

async function websiteLogin(email: string, authKey: string): Promise<string> {
  const res = await api("/v1/auth/login", { headers: { Origin: ORIGIN }, body: { email, authKey } });
  expect(res.status).toBe(200);
  return /^__Host-sid=([A-Za-z0-9_-]{43});/.exec(res.headers.get("Set-Cookie") ?? "")![1]!;
}
async function turnOn(u: User): Promise<void> {
  expect((await api("/v1/account/web-access", { method: "PUT", token: u.token, body: { authKey: u.keys.authKey } })).status).toBe(204);
}
const unlock = (site: string, body: Record<string, string>) => api("/v1/web/unlock", { headers: web(site), body });
const key = (site: string, dekId: string, dekProof: string) => api("/v1/web/key", { headers: web(site), body: { dekId, dekProof } });

async function requestCode(email: string): Promise<string> {
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
const freshBody = (k = clientKeys()) => ({
  dekId: k.dekId,
  dekProof: k.dekProof,
  wrappedDek: k.wrappedDek,
  device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: k.mac },
});

describe("S2-F1: a website session can't use up the devices' upload counter", () => {
  it("POST account/rotate from the website counts on the website's own counter", async () => {
    const u = await signupUser();
    const site = await websiteLogin(u.email, u.keys.authKey);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await api("/v1/account/rotate", { method: "POST", headers: web(site), raw: rand(8) })).status);
    // only 10 reach the account's counter, the other 20 stop at the website's
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);
    expect((await upload(u.token, rand(64), 0, u.keys.dekId)).status).toBe(200);
  });
});

describe("S2-F3: web/unlock mails and lists at once, web/key mails no more", () => {
  it("a code unlock hands out the escrow DEK: event and mail without web/key", async () => {
    const u = await signupUser();
    const dek = b64(rand(32));
    expect((await api("/v1/account/escrow", { method: "PUT", token: u.token, body: { dek, dekProof: u.keys.dekProof, authKey: u.keys.authKey } })).status).toBe(204);
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    await sink.take(u.email);
    const res = await unlock(site, { code: await requestCode(u.email) });
    expect(res.status).toBe(200);
    expect((await json<{ escrowDek?: string }>(res)).escrowDek).toBe(dek);
    expect(await unlockEvents(u.token)).toMatchObject([{ kind: "web_unlocked", method: "code" }]);
    const mails = await sink.take(u.email);
    expect(mails.map((m) => m.subject)).toEqual([UNLOCKED]);
    expect(mails[0]!.text).toContain("Unlocked with:");
  });

  it("password and recovery unlocks too; web/key afterwards adds no mail or event", async () => {
    const u = await signupUser();
    await turnOn(u);
    const site = await websiteLogin(u.email, u.keys.authKey);
    await sink.take(u.email);
    expect((await unlock(site, { authKey: u.keys.authKey })).status).toBe(200);
    expect(await unlockEvents(u.token)).toMatchObject([{ method: "password" }]);
    expect((await sink.take(u.email)).map((m) => m.subject)).toEqual([UNLOCKED]);
    expect((await key(site, u.keys.dekId, u.keys.dekProof)).status).toBe(200);
    expect(await sink.take(u.email)).toEqual([]);
    expect(await unlockEvents(u.token)).toHaveLength(1);

    const recoveryProof = b64(rand(32));
    const recoveryWrappedDek = b64(rand(72));
    expect((await api("/v1/account/keys", { method: "PUT", token: u.token, body: { dekId: u.keys.dekId, recoveryWrappedDek, recoveryProof } })).status).toBe(200);
    await sink.take(u.email);
    const rec = await unlock(site, { recoveryProof });
    expect(rec.status).toBe(200);
    expect((await unlockEvents(u.token)).map((e) => e.method)).toContain("recovery");
    expect((await sink.take(u.email)).map((m) => m.subject)).toEqual([UNLOCKED]);
  });
});

describe("S2-F4: Edit on the website goes off with Start fresh and a password reset", () => {
  it("Start fresh turns it off and ends the website key sessions", async () => {
    const u = await signupUser();
    await turnOn(u);
    expect((await api("/v1/account/start-fresh", { token: u.token, body: freshBody() })).status).toBe(200);
    expect(await json(await api("/v1/account", { token: u.token }))).toMatchObject({ webEdit: false });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND (unlock_at IS NOT NULL OR key_proof_at IS NOT NULL)")
      .bind(u.userId)
      .first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("a password reset turns it off: the website can't unlock afterwards", async () => {
    const u = await signupUser();
    await turnOn(u);
    const reset = await issueToken(env, u.userId, "reset", 1800);
    await reset.statement.run();
    const k = clientKeys();
    expect((await api("/v1/auth/reset", { body: { token: reset.token, salt: k.salt, kdf: { alg: "argon2id", m: 65536, t: 3, p: 1 }, authKey: k.authKey } })).status).toBe(200);
    const site = await websiteLogin(u.email, k.authKey);
    expect(await json(await api("/v1/account", { headers: web(site) }))).toMatchObject({ webEdit: false });
    expect(await json(await unlock(site, { authKey: k.authKey }))).toMatchObject({ error: "web_edit_off" });
  });
});
