import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { renderMail, type Mail } from "../src/mail";
import { api, b64, clientKeys, DEFAULT_KDF, freshEmail, freshIp, rand, signupUser, upload } from "./helpers";

// ---------------------------------------------------------------- helpers

interface SentMail {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
}
/** The test config swaps the EMAIL binding for test/mail-sink.js, which records mails instead of sending. */
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };
const takeMails = (to: string) => sink.take(to);

function tokenIn(mail: SentMail | undefined, path: string): string {
  const m = new RegExp(`${path}#token=([A-Za-z0-9_-]{43})`).exec(mail?.text ?? "");
  if (!m) throw new Error(`no token link in mail: ${mail?.text}`);
  return m[1]!;
}

const nowS = () => Math.floor(Date.now() / 1000);
const makeOld = (userId: string) =>
  env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 3600 WHERE user_id = ?").bind(userId).run();

async function login(email: string, authKey: string) {
  const res = await api("/v1/auth/login", { body: { email, authKey } });
  expect(res.status).toBe(200);
  return res.json<{ sessionToken: string; wrappedDek: string | null; dekId: string | null; rewrapNeeded: boolean }>();
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------- mail layer

describe("mail", () => {
  it("renders every mail in English without dashes, from no-reply", async () => {
    const kinds: Mail[] = [
      { kind: "verify", token: "t".repeat(43) },
      { kind: "reset", token: "t".repeat(43) },
      { kind: "new_device", deviceName: "Pixel <script>" },
      { kind: "password_changed" },
      { kind: "account_deleted" },
      { kind: "inactivity", deleteAt: nowS() + 14 * 86400 },
    ];
    for (const m of kinds) {
      const r = renderMail(env, m);
      expect(r.subject.length).toBeGreaterThan(5);
      for (const part of [r.subject, r.text, r.html]) {
        expect(part).not.toMatch(/[–—]| - /);
      }
      expect(r.html).not.toContain("<script>");
    }
    const u = await signupUser();
    const [mail] = await takeMails(u.email);
    expect(mail?.from).toEqual({ email: "no-reply@seanimemobile.com", name: "Seanime Mobile" });
  });
});

// ---------------------------------------------------------------- email verification

describe("email verification", () => {
  it("sends a 256-bit one-time link at signup, stores only its hash", async () => {
    const u = await signupUser();
    const mails = await takeMails(u.email);
    expect(mails).toHaveLength(1);
    const token = tokenIn(mails[0], "/account/verify/");
    expect(fromB64(token).byteLength).toBe(32);
    const row = await env.DB.prepare("SELECT token_hash, expires_at, created_at FROM tokens WHERE user_id = ? AND purpose = 'verify'")
      .bind(u.userId)
      .first<{ token_hash: string; expires_at: number; created_at: number }>();
    expect(row?.token_hash).not.toBe(token);
    expect(row!.expires_at - row!.created_at).toBe(7 * 86400);

    const ok = await api("/v1/auth/verify", { body: { token } });
    expect(ok.status).toBe(200);
    const user = await env.DB.prepare("SELECT email_verified FROM users WHERE id = ?").bind(u.userId).first<{ email_verified: number }>();
    expect(user?.email_verified).toBe(1);
    expect((await api("/v1/auth/verify", { body: { token } })).status).toBe(400);
    expect((await api("/v1/auth/verify", { body: { token: b64(rand(32)) } })).status).toBe(400);
  });

  it("rejects an expired link and limits resends to 3 per hour", async () => {
    const u = await signupUser();
    const token = tokenIn((await takeMails(u.email))[0], "/account/verify/");
    await env.DB.prepare("UPDATE tokens SET expires_at = ? WHERE user_id = ?").bind(nowS() - 1, u.userId).run();
    expect((await api("/v1/auth/verify", { body: { token } })).status).toBe(400);

    for (let i = 0; i < 3; i++) {
      expect((await api("/v1/auth/verify/resend", { method: "POST", token: u.token })).status).toBe(204);
    }
    expect((await api("/v1/auth/verify/resend", { method: "POST", token: u.token })).status).toBe(429);
    const mails = await takeMails(u.email);
    expect(mails).toHaveLength(3);
    // Only the newest link works; older unused ones were replaced.
    expect((await api("/v1/auth/verify", { body: { token: tokenIn(mails[0], "/account/verify/") } })).status).toBe(400);
    expect((await api("/v1/auth/verify", { body: { token: tokenIn(mails[2], "/account/verify/") } })).status).toBe(200);
  });
});

// ---------------------------------------------------------------- Google sign-in

const CLIENT_ID = "test-client.apps.googleusercontent.com";
let googleKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let jwksFetches = 0;

async function rsaPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

beforeAll(async () => {
  googleKey = await rsaPair();
  otherKey = await rsaPair();
  const jwk = (await crypto.subtle.exportKey("jwk", googleKey.publicKey)) as JsonWebKey;
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://jwks.test/certs") {
      jwksFetches++;
      return Response.json(
        { keys: [{ kty: "RSA", kid: "test-kid", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] },
        { headers: { "Cache-Control": "public, max-age=21600" } },
      );
    }
    return realFetch(input, init);
  });
});

async function signJwt(claims: Record<string, unknown>, key = googleKey.privateKey, kid = "test-kid"): Promise<string> {
  const enc = (o: unknown) => b64(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64(new Uint8Array(sig))}`;
}

async function googleNonce(): Promise<string> {
  const res = await api("/v1/auth/google/nonce", { method: "POST" });
  expect(res.status).toBe(200);
  return (await res.json<{ nonce: string }>()).nonce;
}

function claims(nonce: string, over: Record<string, unknown> = {}) {
  const t = nowS();
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: `1${Math.floor(Math.random() * 1e15)}`,
    email: freshEmail("g"),
    email_verified: true,
    iat: t,
    exp: t + 3600,
    nonce,
    ...over,
  };
}

describe("google sign-in", () => {
  it("creates an account, signs in again with the same sub, and uses a nonce only once", async () => {
    const nonce = await googleNonce();
    const c = claims(nonce, { iss: "accounts.google.com" });
    const idToken = await signJwt(c);
    const first = await api("/v1/auth/google", { body: { idToken, nonce } });
    expect(first.status).toBe(201);
    const data = await first.json<{ userId: string; created: boolean; sessionToken: string; emailVerified: boolean; dekId: null }>();
    expect(data.created).toBe(true);
    expect(data.emailVerified).toBe(true);
    expect(data.dekId).toBeNull();
    expect((await api("/v1/sync/meta", { token: data.sessionToken })).status).toBe(200);

    const row = await env.DB.prepare("SELECT email, google_sub, auth_hash, email_verified FROM users WHERE id = ?")
      .bind(data.userId)
      .first<{ email: string; google_sub: string; auth_hash: string | null; email_verified: number }>();
    expect(row).toEqual({ email: c.email, google_sub: c.sub, auth_hash: null, email_verified: 1 });

    // Same nonce again: rejected.
    expect((await api("/v1/auth/google", { body: { idToken, nonce } })).status).toBe(401);

    const nonce2 = await googleNonce();
    const again = await api("/v1/auth/google", { body: { idToken: await signJwt({ ...c, nonce: nonce2 }), nonce: nonce2 } });
    expect(again.status).toBe(200);
    expect((await again.json<{ userId: string; created: boolean }>()).userId).toBe(data.userId);
    // The JWKS was fetched once and then served from the cache.
    expect(jwksFetches).toBe(1);
  });

  it("rejects wrong aud, iss, nonce, expired, unverified email and a wrong signature", async () => {
    const cases: Array<(n: string) => Promise<string>> = [
      (n) => signJwt(claims(n, { aud: "someone-else.apps.googleusercontent.com" })),
      (n) => signJwt(claims(n, { iss: "https://evil.example.com" })),
      (n) => signJwt(claims(n, { nonce: b64(rand(32)) })),
      (n) => signJwt(claims(n, { exp: nowS() - 600, iat: nowS() - 4200 })),
      (n) => signJwt(claims(n, { iat: nowS() + 3600, exp: nowS() + 7200 })),
      (n) => signJwt(claims(n, { email_verified: false })),
      (n) => signJwt(claims(n), otherKey.privateKey),
      (n) => signJwt(claims(n), googleKey.privateKey, "unknown-kid"),
    ];
    for (const make of cases) {
      const nonce = await googleNonce();
      const res = await api("/v1/auth/google", { body: { idToken: await make(nonce), nonce } });
      expect(res.status).toBe(401);
      expect((await res.json<{ error: string }>()).error).toBe("invalid_google_token");
    }
    // A nonce that was never issued or has expired.
    const unknown = b64(rand(32));
    const res = await api("/v1/auth/google", { body: { idToken: await signJwt(claims(unknown)), nonce: unknown } });
    expect((await res.json<{ error: string }>()).error).toBe("invalid_nonce");
    const nonce = await googleNonce();
    await env.DB.prepare("UPDATE google_nonces SET expires_at = ? WHERE used_at IS NULL").bind(nowS() - 1).run();
    expect((await api("/v1/auth/google", { body: { idToken: await signJwt(claims(nonce)), nonce } })).status).toBe(401);
  });

  it("never links an existing password account automatically, only via account/link-google", async () => {
    const u = await signupUser();
    const sub = "109876543210";
    let nonce = await googleNonce();
    const blocked = await api("/v1/auth/google", { body: { idToken: await signJwt(claims(nonce, { sub, email: u.email })), nonce } });
    expect(blocked.status).toBe(409);
    expect((await blocked.json<{ error: string }>()).error).toBe("account_exists");

    nonce = await googleNonce();
    const link = await api("/v1/account/link-google", { token: u.token, body: { idToken: await signJwt(claims(nonce, { sub, email: u.email })), nonce } });
    expect(link.status).toBe(204);

    nonce = await googleNonce();
    const viaGoogle = await api("/v1/auth/google", { body: { idToken: await signJwt(claims(nonce, { sub, email: u.email })), nonce } });
    expect(viaGoogle.status).toBe(200);
    const d = await viaGoogle.json<{ userId: string; dekId: string }>();
    expect(d.userId).toBe(u.userId);
    expect(d.dekId).toBe(u.keys.dekId);

    // Linking needs a recent sign-in, and a Google account can belong to one account only.
    const other = await signupUser();
    await makeOld(other.userId);
    nonce = await googleNonce();
    expect((await api("/v1/account/link-google", { token: other.token, body: { idToken: await signJwt(claims(nonce, { sub })), nonce } })).status).toBe(403);
    const fresh = await login(other.email, other.keys.authKey);
    nonce = await googleNonce();
    expect((await api("/v1/account/link-google", { token: fresh.sessionToken, body: { idToken: await signJwt(claims(nonce, { sub })), nonce } })).status).toBe(409);
  });
});

// ---------------------------------------------------------------- device approval

async function newDeviceSession(u: { email: string; keys: { authKey: string } }) {
  return (await login(u.email, u.keys.authKey)).sessionToken;
}

async function createRequest(token: string) {
  const devicePub = b64(rand(32));
  const rN = rand(32);
  const input = new Uint8Array(64);
  input.set(fromB64(devicePub));
  input.set(rN, 32);
  const commitment = b64(await sha256(input));
  const res = await api("/v1/devices/requests", { token, body: { deviceName: "New Tablet", devicePub, commitment } });
  return { res, devicePub, reveal: b64(rN), commitment };
}

async function openRequest(token: string) {
  const r = await createRequest(token);
  expect(r.res.status).toBe(201);
  return { ...r, id: (await r.res.json<{ id: string }>()).id };
}

describe("device approval", () => {
  it("runs nonce, reveal, approve in order and hands the sealed key to the new device", async () => {
    const a = await signupUser();
    await takeMails(a.email);
    const n = await newDeviceSession(a);
    const req = await openRequest(n);

    const list = await (await api("/v1/devices/requests", { token: a.token })).json<{ requests: Array<{ id: string; commitment: string; status: string }> }>();
    expect(list.requests.map((r) => r.id)).toEqual([req.id]);
    expect(list.requests[0]!.commitment).toBe(req.commitment);

    const rO = b64(rand(32));
    expect((await api(`/v1/devices/requests/${req.id}/nonce`, { token: a.token, body: { nonce: rO } })).status).toBe(200);
    const seen = await (await api(`/v1/devices/requests/${req.id}`, { token: n })).json<{ approverNonce: string; status: string }>();
    expect(seen).toMatchObject({ approverNonce: rO, status: "nonce" });

    expect((await api(`/v1/devices/requests/${req.id}/reveal`, { token: n, body: { reveal: req.reveal } })).status).toBe(200);
    const sealedDek = b64(rand(80));
    const ok = await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: a.keys.dekId, sealedDek } });
    expect(ok.status).toBe(200);

    const result = await (await api(`/v1/devices/requests/${req.id}`, { token: n })).json<{ status: string; sealedDek: string; dekId: string; deviceId: string }>();
    expect(result).toMatchObject({ status: "approved", sealedDek, dekId: a.keys.dekId });
    // The old device sees the state but never the sealed key of the new device.
    const viaOld = await (await api(`/v1/devices/requests/${req.id}`, { token: a.token })).json<Record<string, unknown>>();
    expect(viaOld.sealedDek).toBeUndefined();

    const devices = await (await api("/v1/devices", { token: n })).json<{ devices: Array<{ id: string; current: boolean }> }>();
    expect(devices.devices).toHaveLength(2);
    expect(devices.devices.find((d) => d.current)?.id).toBe(result.deviceId);
    const mails = await takeMails(a.email);
    expect(mails.map((m) => m.subject)).toEqual(["New device signed in"]);
    expect(mails[0]!.text).toContain("New Tablet");
  });

  it("aborts on a wrong commitment and enforces the order with 409", async () => {
    const a = await signupUser();
    const n = await newDeviceSession(a);
    const req = await openRequest(n);
    // reveal before rO, approve before reveal
    expect((await api(`/v1/devices/requests/${req.id}/reveal`, { token: n, body: { reveal: req.reveal } })).status).toBe(409);
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: a.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(409);
    expect((await api(`/v1/devices/requests/${req.id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)) } })).status).toBe(200);
    expect((await api(`/v1/devices/requests/${req.id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)) } })).status).toBe(409);
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: a.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(409);

    // A different rN than committed to: the request is dead.
    const wrong = await api(`/v1/devices/requests/${req.id}/reveal`, { token: n, body: { reveal: b64(rand(32)) } });
    expect(wrong.status).toBe(422);
    expect((await api(`/v1/devices/requests/${req.id}/reveal`, { token: n, body: { reveal: req.reveal } })).status).toBe(409);
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: a.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(409);
    const st = await (await api(`/v1/devices/requests/${req.id}`, { token: n })).json<{ status: string; sealedDek?: string }>();
    expect(st.status).toBe("denied");
    expect(st.sealedDek).toBeUndefined();
  });

  it("keeps requests inside the account (IDOR) and lets only the nonce device approve", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const n = await newDeviceSession(a);
    const req = await openRequest(n);

    const bList = await (await api("/v1/devices/requests", { token: b.token })).json<{ requests: unknown[] }>();
    expect(bList.requests).toEqual([]);
    expect((await api(`/v1/devices/requests/${req.id}`, { token: b.token })).status).toBe(404);
    expect((await api(`/v1/devices/requests/${req.id}/nonce`, { token: b.token, body: { nonce: b64(rand(32)) } })).status).toBe(404);
    expect((await api(`/v1/devices/requests/${req.id}/deny`, { method: "POST", token: b.token })).status).toBe(404);

    // The new device cannot act as approver, and a session without device cannot list.
    expect((await api("/v1/devices/requests", { token: n })).status).toBe(403);
    expect((await api(`/v1/devices/requests/${req.id}/nonce`, { token: n, body: { nonce: b64(rand(32)) } })).status).toBe(403);

    await api(`/v1/devices/requests/${req.id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)) } });
    await api(`/v1/devices/requests/${req.id}/reveal`, { token: n, body: { reveal: req.reveal } });
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: b.token, body: { dekId: b.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(404);

    // Another device of account A that did not send rO cannot approve.
    const second = await newDeviceSession(a);
    const k = clientKeys();
    await api("/v1/account/keys", { method: "PUT", token: second, body: { dekId: a.keys.dekId, device: { name: "Laptop", devicePub: k.devicePub, sealedDek: k.sealedDek } } });
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: second, body: { dekId: a.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(403);
    // Wrong dekId and an old sign-in are refused too.
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: "dek-other", sealedDek: b64(rand(80)) } })).status).toBe(409);
    await makeOld(a.userId);
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: a.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(403);
  });

  it("expires after 10 minutes, allows 3 open and 5 per hour, and deny blocks at once", async () => {
    const a = await signupUser();
    const n = await newDeviceSession(a);
    const r1 = await openRequest(n);
    const r2 = await openRequest(n);
    const r3 = await openRequest(n);
    const fourth = await createRequest(n);
    expect(fourth.res.status).toBe(429);
    expect((await fourth.res.json<{ error: string }>()).error).toBe("too_many_open_requests");

    expect((await api(`/v1/devices/requests/${r1.id}/deny`, { method: "POST", token: a.token })).status).toBe(204);
    expect((await api(`/v1/devices/requests/${r1.id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)) } })).status).toBe(409);

    await env.DB.prepare("UPDATE device_requests SET expires_at = ? WHERE id = ?").bind(nowS() - 1, r2.id).run();
    expect((await api(`/v1/devices/requests/${r2.id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)) } })).status).toBe(410);
    const list = await (await api("/v1/devices/requests", { token: a.token })).json<{ requests: Array<{ id: string }> }>();
    expect(list.requests.map((r) => r.id)).toEqual([r3.id]);

    await openRequest(n); // 4th of the hour
    await api(`/v1/devices/requests/${r3.id}/deny`, { method: "POST", token: a.token });
    await openRequest(n); // 5th
    const sixth = await createRequest(n);
    expect(sixth.res.status).toBe(429);
    expect((await sixth.res.json<{ error: string }>()).error).toBe("rate_limited");
  });
});

// ---------------------------------------------------------------- password reset

/** The mail goes out in waitUntil after the answer: wait for it like the runtime does. */
async function requestReset(email: string) {
  const exec = createExecutionContext();
  const request = new Request("https://api.example.com/v1/auth/reset-request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
    body: JSON.stringify({ email }),
  });
  const res = await (worker.fetch as unknown as (r: Request, e: Env, c: ExecutionContext) => Promise<Response>)(request, env, exec);
  await waitOnExecutionContext(exec);
  return res;
}

describe("password reset", () => {
  it("answers known and unknown emails the same and limits to 3 per hour", async () => {
    const u = await signupUser();
    await takeMails(u.email);
    const known = await requestReset(u.email);
    const ghost = freshEmail("ghost");
    const unknown = await requestReset(ghost);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
    expect(await takeMails(ghost)).toHaveLength(0);
    expect(await takeMails(u.email)).toHaveLength(1);
    await requestReset(u.email);
    await requestReset(u.email);
    expect((await requestReset(u.email)).status).toBe(429);
    await requestReset(ghost);
    await requestReset(ghost);
    expect((await requestReset(ghost)).status).toBe(429);
  });

  it("without recovery code: new login, no password wrap, all sessions out, token once", async () => {
    const u = await signupUser();
    await takeMails(u.email);
    await requestReset(u.email);
    const mail = (await takeMails(u.email))[0];
    const token = tokenIn(mail, "/account/reset/");
    const row = await env.DB.prepare("SELECT expires_at - created_at AS ttl FROM tokens WHERE user_id = ? AND purpose = 'reset'")
      .bind(u.userId)
      .first<{ ttl: number }>();
    expect(row?.ttl).toBe(30 * 60);

    const info = await (await api("/v1/auth/reset/info", { body: { token } })).json<Record<string, unknown>>();
    expect(info).toEqual({ userId: u.userId, dekId: u.keys.dekId, hasRecovery: false, recoveryWrappedDek: null });

    const k = clientKeys();
    const res = await api("/v1/auth/reset", { body: { token, salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey } });
    expect(res.status).toBe(200);
    const resetText = await res.text();
    expect(JSON.parse(resetText)).toEqual({ rewrapNeeded: true });
    expect(resetText).not.toContain(u.keys.wrappedDek);
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(401);
    expect((await takeMails(u.email)).map((m) => m.subject)).toEqual(["Your password was changed"]);

    // Token used up.
    expect((await api("/v1/auth/reset", { body: { token, salt: k.salt, kdf: DEFAULT_KDF, authKey: b64(rand(32)) } })).status).toBe(400);
    expect((await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } })).status).toBe(401);
    const fresh = await login(u.email, k.authKey);
    expect(fresh.wrappedDek).toBeNull();
    expect(fresh.rewrapNeeded).toBe(true);
    const meta = await (await api("/v1/sync/meta", { token: fresh.sessionToken })).json<{ rewrapNeeded: boolean; rotationRequired: boolean }>();
    expect(meta).toMatchObject({ rewrapNeeded: true, rotationRequired: true });

    // A signed-in device that still holds the DEK delivers the new wrap.
    const newWrap = b64(rand(72));
    expect((await api("/v1/account/keys", { method: "PUT", token: fresh.sessionToken, body: { dekId: u.keys.dekId, wrappedDek: newWrap } })).status).toBe(200);
    const after = await login(u.email, k.authKey);
    expect(after.wrappedDek).toBe(newWrap);
    expect(after.rewrapNeeded).toBe(false);
  });

  it("with recovery code: both wraps replaced, data key unchanged; expired token refused", async () => {
    const u = await signupUser();
    const recovery = b64(rand(72));
    expect((await api("/v1/account/keys", { method: "PUT", token: u.token, body: { dekId: u.keys.dekId, recoveryWrappedDek: recovery } })).status).toBe(200);
    await takeMails(u.email);
    await requestReset(u.email);
    const token = tokenIn((await takeMails(u.email))[0], "/account/reset/");
    const info = await (await api("/v1/auth/reset/info", { body: { token } })).json<Record<string, unknown>>();
    expect(info).toEqual({ userId: u.userId, dekId: u.keys.dekId, hasRecovery: true, recoveryWrappedDek: recovery });
    expect(JSON.stringify(info)).not.toContain(u.keys.wrappedDek);

    const k = clientKeys();
    const keys = { dekId: u.keys.dekId, wrappedDek: b64(rand(72)), recoveryWrappedDek: b64(rand(72)) };
    const bad = await api("/v1/auth/reset", { body: { token, salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey, keys: { ...keys, dekId: "dek-wrong" } } });
    expect(bad.status).toBe(409);
    const ok = await api("/v1/auth/reset", { body: { token, salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey, keys } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ rewrapNeeded: false });
    const fresh = await login(u.email, k.authKey);
    expect(fresh).toMatchObject({ wrappedDek: keys.wrappedDek, dekId: u.keys.dekId, rewrapNeeded: false });

    await requestReset(u.email);
    const token2 = tokenIn((await takeMails(u.email)).at(-1), "/account/reset/");
    await env.DB.prepare("UPDATE tokens SET expires_at = ? WHERE user_id = ? AND purpose = 'reset'").bind(nowS() - 1, u.userId).run();
    expect((await api("/v1/auth/reset", { body: { token: token2, salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey } })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- DEK rotation

function rotateRequest(token: string, meta: unknown, ifMatch: number, snapshot?: Uint8Array) {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  if (snapshot) form.append("snapshot", new Blob([snapshot]), "snapshot.bin");
  return exports.default.fetch(
    new Request("https://api.example.com/v1/account/rotate", {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${token}`, "If-Match": String(ifMatch), "CF-Connecting-IP": freshIp() },
    }),
  );
}

describe("DEK rotation", () => {
  it("removing a device flags rotation; rotate switches keys atomically and old wraps stop working", async () => {
    const a = await signupUser();
    const second = await newDeviceSession(a);
    const k2 = clientKeys();
    const put = await api("/v1/account/keys", {
      method: "PUT",
      token: second,
      body: { dekId: a.keys.dekId, device: { name: "Tablet", devicePub: k2.devicePub, sealedDek: k2.sealedDek } },
    });
    const secondId = (await put.json<{ deviceId: string }>()).deviceId;
    const third = await newDeviceSession(a);
    const k3 = clientKeys();
    const put3 = await api("/v1/account/keys", {
      method: "PUT",
      token: third,
      body: { dekId: a.keys.dekId, device: { name: "Old phone", devicePub: k3.devicePub, sealedDek: k3.sealedDek } },
    });
    const thirdId = (await put3.json<{ deviceId: string }>()).deviceId;
    expect((await upload(a.token, rand(64), 0, a.keys.dekId)).status).toBe(200);

    expect((await api(`/v1/devices/${thirdId}`, { method: "DELETE", token: a.token })).status).toBe(204);
    const meta1 = await (await api("/v1/sync/meta", { token: a.token })).json<{ rotationRequired: boolean; version: number }>();
    expect(meta1.rotationRequired).toBe(true);

    const newDek = `dek-${b64(rand(6))}`;
    const sealedA = b64(rand(80));
    const sealed2 = b64(rand(80));
    const base = {
      oldDekId: a.keys.dekId,
      dekId: newDek,
      devices: [
        { deviceId: a.deviceId, sealedDek: sealedA },
        { deviceId: secondId, sealedDek: sealed2 },
      ],
      wrappedDek: b64(rand(72)),
      recoveryWrappedDek: b64(rand(72)),
    };
    const blob = rand(128);
    // Missing device, removed device, stale version, missing snapshot.
    expect((await rotateRequest(a.token, { ...base, devices: base.devices.slice(0, 1) }, 1, blob)).status).toBe(409);
    expect((await rotateRequest(a.token, { ...base, devices: [...base.devices, { deviceId: thirdId, sealedDek: sealed2 }] }, 1, blob)).status).toBe(409);
    expect((await rotateRequest(a.token, base, 0, blob)).status).toBe(409);
    expect((await rotateRequest(a.token, base, 1)).status).toBe(400);
    expect((await rotateRequest(a.token, { ...base, wrappedDek: undefined }, 1, blob)).status).toBe(400);

    const ok = await rotateRequest(a.token, base, 1, blob);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ dekId: newDek, version: 2, recoveryRenewalNeeded: false });

    const meta2 = await (await api("/v1/sync/meta", { token: a.token })).json<{ rotationRequired: boolean; dekId: string; version: number }>();
    expect(meta2).toMatchObject({ rotationRequired: false, dekId: newDek, version: 2 });
    const snap = await api("/v1/sync/snapshot", { token: a.token });
    expect(snap.headers.get("X-Dek-Id")).toBe(newDek);
    expect(new Uint8Array(await snap.arrayBuffer())).toEqual(blob);
    const rows = await env.DB.prepare("SELECT id, sealed_dek, dek_id FROM devices WHERE user_id = ? ORDER BY id")
      .bind(a.userId)
      .all<{ id: string; sealed_dek: string; dek_id: string }>();
    expect(rows.results.every((d) => d.dek_id === newDek)).toBe(true);
    expect(rows.results.map((d) => d.sealed_dek).sort()).toEqual([sealedA, sealed2].sort());
    expect((await login(a.email, a.keys.authKey)).wrappedDek).toBe(base.wrappedDek);

    // Old dekId wraps are refused everywhere.
    expect((await api("/v1/account/keys", { method: "PUT", token: a.token, body: { dekId: a.keys.dekId, wrappedDek: b64(rand(72)) } })).status).toBe(409);
    expect((await upload(a.token, rand(64), 2, a.keys.dekId)).status).toBe(409);
    expect((await rotateRequest(a.token, base, 2, blob)).status).toBe(409);
    const n = await newDeviceSession(a);
    const req = await openRequest(n);
    await api(`/v1/devices/requests/${req.id}/nonce`, { token: a.token, body: { nonce: b64(rand(32)) } });
    await api(`/v1/devices/requests/${req.id}/reveal`, { token: n, body: { reveal: req.reveal } });
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: a.keys.dekId, sealedDek: b64(rand(80)) } })).status).toBe(409);
    expect((await api(`/v1/devices/requests/${req.id}/approve`, { token: a.token, body: { dekId: newDek, sealedDek: b64(rand(80)) } })).status).toBe(200);
  });

  it("needs a device session with a recent sign-in", async () => {
    const a = await signupUser();
    const meta = { oldDekId: a.keys.dekId, dekId: "dek-new", devices: [{ deviceId: a.deviceId, sealedDek: b64(rand(80)) }], wrappedDek: b64(rand(72)) };
    const noDevice = await newDeviceSession(a);
    expect((await rotateRequest(noDevice, meta, 0)).status).toBe(403);
    await makeOld(a.userId);
    expect((await rotateRequest(a.token, meta, 0)).status).toBe(403);
  });
});

// ---------------------------------------------------------------- re-login without duplicates

describe("devices", () => {
  it("recognises a re-login of the same device by its key", async () => {
    const a = await signupUser();
    for (let i = 0; i < 2; i++) {
      const s = await newDeviceSession(a);
      const res = await api("/v1/account/keys", {
        method: "PUT",
        token: s,
        body: { dekId: a.keys.dekId, device: { name: `Phone ${i}`, devicePub: a.keys.devicePub, sealedDek: b64(rand(80)) } },
      });
      expect(res.status).toBe(200);
      expect((await res.json<{ deviceId: string }>()).deviceId).toBe(a.deviceId);
      const list = await (await api("/v1/devices", { token: s })).json<{ devices: Array<{ id: string; name: string; current: boolean }> }>();
      expect(list.devices).toHaveLength(1);
      expect(list.devices[0]).toMatchObject({ id: a.deviceId, name: `Phone ${i}`, current: true });
    }
  });
});

// ---------------------------------------------------------------- cron

async function runCron() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "17 3 * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
}
const userExists = async (id: string) => (await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first()) !== null;

describe("cron phase 1b", () => {
  afterEach(async () => {
    // Keep other cron cases from seeing these accounts as candidates.
    await env.DB.prepare("UPDATE users SET last_active_at = ?, inactivity_warned_at = NULL").bind(nowS()).run();
  });

  it("deletes only accounts that are really unconfirmed after 7 days", async () => {
    const unverified = await signupUser();
    const verified = await signupUser();
    const token = tokenIn((await takeMails(verified.email))[0], "/account/verify/");
    expect((await api("/v1/auth/verify", { body: { token } })).status).toBe(200);
    for (const u of [unverified, verified]) {
      await env.DB.prepare("UPDATE users SET created_at = created_at - 8 * 86400 WHERE id = ?").bind(u.userId).run();
    }
    await runCron();
    expect(await userExists(unverified.userId)).toBe(false);
    expect(await userExists(verified.userId)).toBe(true);
  });

  it("warns after 180 days inactive and deletes 14 days later unless used again", async () => {
    const idle = await signupUser();
    const back = await signupUser();
    await env.DB.prepare("UPDATE users SET email_verified = 1").run();
    expect((await upload(idle.token, rand(64), 0, idle.keys.dekId)).status).toBe(200);
    await takeMails(idle.email);
    await takeMails(back.email);
    const t = nowS();
    for (const u of [idle, back]) {
      await env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(t - 181 * 86400, u.userId).run();
    }

    await runCron();
    for (const u of [idle, back]) {
      const mails = await takeMails(u.email);
      expect(mails.map((m) => m.subject)).toEqual(["Your account will be deleted soon"]);
    }
    // A second run sends no second warning.
    await runCron();
    expect(await takeMails(idle.email)).toHaveLength(0);

    // 15 days later: idle stayed away, back signed in after the warning.
    await env.DB.prepare("UPDATE users SET inactivity_warned_at = ? WHERE id IN (?, ?)").bind(t - 15 * 86400, idle.userId, back.userId).run();
    await env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(t - 196 * 86400, idle.userId).run();
    await env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(t - 86400, back.userId).run();
    await runCron();

    expect(await userExists(idle.userId)).toBe(false);
    expect(await env.SNAPSHOTS.head(`snap/${idle.userId}`)).toBeNull();
    expect((await takeMails(idle.email)).map((m) => m.subject)).toEqual(["Your account was deleted"]);
    expect(await userExists(back.userId)).toBe(true);
    expect(await takeMails(back.email)).toHaveLength(0);
  });
});
