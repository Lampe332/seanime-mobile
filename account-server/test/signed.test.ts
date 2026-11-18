import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  api, b64, challengeFor, clientKeys, DEFAULT_KDF, freshEmail, freshIp, keyOf, newKey, ORIGIN, rand, sessionId, signHeaders,
  signupUser, type TestKey,
} from "./helpers";

const sink = env.EMAIL as unknown as { take(to: string): Promise<{ subject: string; text: string }[]> };

/** The same 401 for every failure: nothing tells the caller what was wrong. */
async function expectRefused(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized", message: "unauthorized" });
}

/** A GET sync/meta with the token as Bearer, signed by `key` with explicit options. */
async function meta(token: string, key: TestKey, opts: { ts?: number; nonce?: string; sid?: string } = {}) {
  const headers = await signHeaders(key, "GET", "/v1/sync/meta", new Uint8Array(0), opts.sid ?? (await sessionId(token)), opts);
  return exports.default.fetch(
    new Request("https://api.example.com/v1/sync/meta", {
      headers: { ...headers, Authorization: `Bearer ${token}`, "CF-Connecting-IP": freshIp() },
    }),
  );
}

describe("signed requests (plan 10.2b)", () => {
  it("accepts the session's own signature", async () => {
    const u = await signupUser();
    expect((await meta(u.token, keyOf(u.token)!)).status).toBe(200);
  });

  it("refuses a request without signature", async () => {
    const u = await signupUser();
    await expectRefused(await api("/v1/sync/meta", { token: u.token, sign: false }));
  });

  it("refuses a wrong signature and a body changed after signing", async () => {
    const u = await signupUser();
    const key = keyOf(u.token)!;
    const headers = await signHeaders(key, "GET", "/v1/sync/meta", new Uint8Array(0), await sessionId(u.token));
    headers["X-SM-Sig"] = b64(rand(64));
    await expectRefused(
      await exports.default.fetch(
        new Request("https://api.example.com/v1/sync/meta", { headers: { ...headers, Authorization: `Bearer ${u.token}` } }),
      ),
    );
    // Signed for one body, sent with another.
    const signedFor = new TextEncoder().encode(JSON.stringify({ dekId: u.keys.dekId, wrappedDek: b64(rand(72)) }));
    const sent = JSON.stringify({ dekId: u.keys.dekId, wrappedDek: b64(rand(72)) });
    const h = await signHeaders(key, "PUT", "/v1/account/keys", signedFor, await sessionId(u.token));
    await expectRefused(
      await exports.default.fetch(
        new Request("https://api.example.com/v1/account/keys", {
          method: "PUT",
          body: sent,
          headers: { ...h, Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" },
        }),
      ),
    );
    // Signed for another path.
    const p = await signHeaders(key, "GET", "/v1/account", new Uint8Array(0), await sessionId(u.token));
    await expectRefused(
      await exports.default.fetch(
        new Request("https://api.example.com/v1/sync/meta", { headers: { ...p, Authorization: `Bearer ${u.token}` } }),
      ),
    );
  });

  it("refuses the signature of another device's key", async () => {
    const u = await signupUser();
    await expectRefused(await meta(u.token, await newKey()));
  });

  it("refuses the token of session A signed with the key of session B", async () => {
    const a = await signupUser();
    const b = await signupUser();
    await expectRefused(await meta(a.token, keyOf(b.token)!));
    // Nor B's key with B's session id on A's token.
    await expectRefused(await meta(a.token, keyOf(b.token)!, { sid: await sessionId(b.token) }));
    // A's own key, but signed for B's session id.
    await expectRefused(await meta(a.token, keyOf(a.token)!, { sid: await sessionId(b.token) }));
  });

  it("refuses timestamps outside 5 minutes", async () => {
    const u = await signupUser();
    const key = keyOf(u.token)!;
    await expectRefused(await meta(u.token, key, { ts: Date.now() - 6 * 60 * 1000 }));
    await expectRefused(await meta(u.token, key, { ts: Date.now() + 6 * 60 * 1000 }));
    expect((await meta(u.token, key, { ts: Date.now() - 4 * 60 * 1000 })).status).toBe(200);
  });

  it("accepts every nonce once", async () => {
    const u = await signupUser();
    const key = keyOf(u.token)!;
    const nonce = b64(rand(16));
    expect((await meta(u.token, key, { nonce })).status).toBe(200);
    await expectRefused(await meta(u.token, key, { nonce }));
    // A captured request sent again unchanged.
    const headers = await signHeaders(key, "GET", "/v1/account", new Uint8Array(0), await sessionId(u.token));
    const send = () =>
      exports.default.fetch(new Request("https://api.example.com/v1/account", { headers: { ...headers, Authorization: `Bearer ${u.token}` } }));
    expect((await send()).status).toBe(200);
    await expectRefused(await send());
  });
});

describe("sign-in with a one-time challenge (plan 10.2b)", () => {
  async function loginRequest(email: string, authKey: string, key: TestKey, challenge: string) {
    const body = new TextEncoder().encode(JSON.stringify({ email, authKey, challenge, sigKey: { alg: key.alg, pub: key.pub } }));
    const headers = await signHeaders(key, "POST", "/v1/auth/login", body, "-");
    return new Request("https://api.example.com/v1/auth/login", {
      method: "POST",
      body,
      headers: { ...headers, "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
    });
  }

  it("prelogin answers a challenge, the same shape for unknown emails", async () => {
    const u = await signupUser();
    const known = await (await api("/v1/auth/prelogin", { body: { email: u.email } })).json<{ challenge: string }>();
    const unknown = await (await api("/v1/auth/prelogin", { body: { email: freshEmail("ghost") } })).json<{ challenge: string }>();
    expect(known.challenge).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(unknown.challenge).toMatch(/^[A-Za-z0-9_-]{48}$/);
  });

  it("a captured login cannot be sent again, nor its challenge used twice", async () => {
    const u = await signupUser();
    const key = await newKey();
    const challenge = await challengeFor(u.email);
    const request = await loginRequest(u.email, u.keys.authKey, key, challenge);
    const replay = request.clone();
    const first = await exports.default.fetch(request);
    expect(first.status).toBe(200);
    await expectRefused(await exports.default.fetch(replay));
    // The same challenge in a new, correctly signed request.
    await expectRefused(await exports.default.fetch(await loginRequest(u.email, u.keys.authKey, await newKey(), challenge)));
    // The new session works only with the key that signed the login.
    const { sessionToken } = await first.json<{ sessionToken: string }>();
    expect((await meta(sessionToken, key)).status).toBe(200);
    await expectRefused(await meta(sessionToken, await newKey()));
  });

  it("refuses a login without signature, with another email's challenge, or signed by a key other than sigKey", async () => {
    const u = await signupUser();
    const other = await signupUser();
    expect((await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey }, sign: false })).status).toBe(400);
    const key = await newKey();
    const body = { email: u.email, authKey: u.keys.authKey, challenge: await challengeFor(u.email), sigKey: { alg: key.alg, pub: key.pub } };
    await expectRefused(await api("/v1/auth/login", { body, sign: false }));
    await expectRefused(await exports.default.fetch(await loginRequest(u.email, u.keys.authKey, key, await challengeFor(other.email))));
    await expectRefused(await api("/v1/auth/login", { body: { ...body, challenge: await challengeFor(u.email) }, sign: await newKey() }));
    await expectRefused(await exports.default.fetch(await loginRequest(u.email, u.keys.authKey, key, b64(rand(36)))));
  });

  it("signup needs a challenge for its email and a signature", async () => {
    const k = clientKeys();
    const email = freshEmail();
    const key = await newKey();
    const body = { email, salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey, sigKey: { alg: key.alg, pub: key.pub } };
    await expectRefused(await api("/v1/auth/signup", { body: { ...body, challenge: await challengeFor(freshEmail()) }, sign: key }));
    await expectRefused(await api("/v1/auth/signup", { body: { ...body, challenge: await challengeFor(email) }, sign: false }));
    expect((await api("/v1/auth/signup", { body: { ...body, challenge: await challengeFor(email) }, sign: key })).status).toBe(201);
  });
});

describe("website keys", () => {
  for (const alg of ["p256", "ed25519"] as const) {
    it(`verifies ${alg} signatures for a cookie session`, async () => {
      const k = clientKeys();
      const key = await newKey(alg);
      const res = await api("/v1/auth/signup", {
        headers: { Origin: ORIGIN },
        sign: key,
        body: { email: freshEmail(), salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey },
      });
      expect(res.status).toBe(201);
      const cookie = res.headers.get("Set-Cookie")!.split(";")[0]!;
      const token = cookie.split("=")[1]!;
      const row = await env.DB.prepare("SELECT sig_alg, sig_pub FROM sessions WHERE token_hash = ?").bind(await sessionId(token)).first();
      expect(row).toEqual({ sig_alg: alg, sig_pub: key.pub });

      const headers = { Origin: ORIGIN, Cookie: cookie };
      expect((await api("/v1/account", { headers })).status).toBe(200);
      // The browser cannot read its HttpOnly cookie: it signs "-" as session id, never the hash.
      const sig = await signHeaders(key, "GET", "/v1/account", new Uint8Array(0), await sessionId(token));
      await expectRefused(
        await exports.default.fetch(new Request("https://api.example.com/v1/account", { headers: { ...headers, ...sig } })),
      );
      await expectRefused(await api("/v1/account", { headers, sign: await newKey(alg) }));
      await expectRefused(await api("/v1/account", { headers, sign: false }));
    });
  }
});

describe("start fresh", () => {
  it("sends a warning mail", async () => {
    const u = await signupUser();
    await sink.take(u.email);
    const k = clientKeys();
    const res = await api("/v1/account/start-fresh", {
      token: u.token,
      body: { dekId: k.dekId, dekProof: k.dekProof, wrappedDek: k.wrappedDek, device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: b64(rand(32)) } },
    });
    expect(res.status).toBe(200);
    const mails = await sink.take(u.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("Your synced data was reset");
    expect(mails[0]!.text).toContain("Start fresh");
    expect(mails[0]!.text).not.toMatch(/[–—]/);
  });
});
