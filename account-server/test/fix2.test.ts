import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { jwksUrl } from "../src/google";
import { ipRange } from "../src/ratelimit";
import { api, b64, clientKeys, deviceKeys, freshEmail, keyOf, newKey, rand, signHeaders, signupUser } from "./helpers";

// Fix round 2 after the security review (18.11.): M-2, N-2, N-4, N-5, I-1/I-2.

const net = () => `10.${rand(1)[0]}.${rand(1)[0]}`;
const wrongLogin = (email: string, ip: string) => api("/v1/auth/login", { ip, body: { email, authKey: b64(rand(32)) } });

describe("ip ranges", () => {
  it("groups IPv4 by /24 and IPv6 by /48", () => {
    expect(ipRange("203.0.113.7")).toBe("203.0.113.0/24");
    expect(ipRange("::ffff:203.0.113.7")).toBe("203.0.113.0/24");
    expect(ipRange("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipRange("2001:0db8:0000:ffff::")).toBe("2001:db8:0::/48");
    expect(ipRange("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(ipRange("::1")).toBe("0:0:0::/48");
    expect(ipRange("unknown")).toBe("unknown");
  });
});

describe("lockout (M-2)", () => {
  it("a stranger cannot lock the owner out: known device and other networks still get in", async () => {
    // The owner's device: signed up without keys, then registered its device (PUT account/keys), as the app does.
    const u = await signupUser({ withKeys: false });
    const k = clientKeys();
    const put = await api("/v1/account/keys", {
      method: "PUT",
      token: u.token,
      body: { dekId: k.dekId, dekProof: k.dekProof, wrappedDek: k.wrappedDek, device: deviceKeys("Owner Phone") },
    });
    expect(put.status).toBe(200);
    const deviceKey = keyOf(u.token)!;

    // The attacker fails over and over from one network, each attempt from another address of it.
    const attackerNet = net();
    for (let i = 1; i <= 6; i++) await wrongLogin(u.email, `${attackerNet}.${i}`);
    const blocked = await api("/v1/auth/login", { ip: `${attackerNet}.50`, body: { email: u.email, authKey: u.keys.authKey } });
    expect(blocked.status).toBe(429);

    // The owner's known device (its row carries the signing key it kept) gets in, even from the attacker's network.
    const known = await api("/v1/auth/login", { ip: `${attackerNet}.51`, sign: deviceKey, body: { email: u.email, authKey: u.keys.authKey } });
    expect(known.status).toBe(200);
    // A new browser of the owner on another network gets in too.
    const elsewhere = await api("/v1/auth/login", { ip: `${net()}.1`, body: { email: u.email, authKey: u.keys.authKey } });
    expect(elsewhere.status).toBe(200);
  });

  it("a known device still counts per IP, and a removed device is no longer known", async () => {
    const u = await signupUser();
    const deviceKey = keyOf(u.token)!;
    expect(await env.DB.prepare("SELECT sig_pub FROM devices WHERE id = ?").bind(u.deviceId).first("sig_pub")).toBe(deviceKey.pub);
    await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(u.deviceId).run();
    const n = net();
    for (let i = 1; i <= 5; i++) await wrongLogin(u.email, `${n}.${i}`);
    const res = await api("/v1/auth/login", { ip: `${n}.9`, sign: deviceKey, body: { email: u.email, authKey: u.keys.authKey } });
    expect(res.status).toBe(429);
  });
});

describe("parallel logins (N-5)", () => {
  it("never let more than 5 wrong attempts per email and network through", async () => {
    const u = await signupUser();
    const n = net();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => wrongLogin(u.email, `${n}.${i + 1}`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it("a success clears the email counter", async () => {
    const u = await signupUser();
    const n = net();
    for (let i = 1; i <= 4; i++) await wrongLogin(u.email, `${n}.${i}`);
    expect((await api("/v1/auth/login", { ip: `${n}.5`, body: { email: u.email, authKey: u.keys.authKey } })).status).toBe(200);
    for (let i = 6; i <= 10; i++) expect((await wrongLogin(u.email, `${n}.${i}`)).status).toBe(401);
  });
});

describe("reset mails (N-4)", () => {
  it("counts per email and IP address (NEU5-1: not per range, the mails stay capped per range)", async () => {
    const u = await signupUser();
    const a = net();
    const reset = (ip: string) => api("/v1/auth/reset-request", { ip, body: { email: u.email } });
    for (let i = 1; i <= 3; i++) expect((await reset(`${a}.1`)).status).toBe(202);
    expect((await reset(`${a}.1`)).status).toBe(429);
    // Somebody else in the same network still gets an answer.
    expect((await reset(`${a}.2`)).status).toBe(202);
    // The owner elsewhere still gets a link.
    expect((await reset(`${net()}.1`)).status).toBe(202);
  });
});

describe("large bodies (N-2)", () => {
  const TEN_MB = 10 * 1024 * 1024;

  /** A body that announces 10 MB and never ends: if the server read it, the request would hang. */
  function endless(): ReadableStream<Uint8Array> {
    let sent = false;
    return new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array(1024));
        }
        return new Promise(() => undefined);
      },
    });
  }

  it("refuses an unauthenticated 10 MB upload before reading it", async () => {
    const key = await newKey();
    const headers = await signHeaders(key, "PUT", "/v1/sync/snapshot", new Uint8Array(0), "-");
    const started = Date.now();
    const res = await exports.default.fetch(
      new Request("https://api.example.com/v1/sync/snapshot", {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(TEN_MB),
          Authorization: `Bearer ${b64(rand(32))}`,
          "If-Match": "0",
          "X-Dek-Id": "dek-x",
          "CF-Connecting-IP": `${net()}.1`,
        },
        body: endless(),
      }),
    );
    expect(res.status).toBe(401);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses more than a JSON body on every other route by its declared size", async () => {
    for (const path of ["/v1/auth/login", "/v1/auth/reset-request", "/v1/account/keys"]) {
      const res = await exports.default.fetch(
        new Request(`https://api.example.com${path}`, {
          method: path === "/v1/account/keys" ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", "Content-Length": String(TEN_MB), "CF-Connecting-IP": `${net()}.1` },
          body: endless(),
        }),
      );
      expect(res.status).toBe(413);
    }
  });

  it("refuses a body bigger than the snapshot limit even with a real session", async () => {
    const u = await signupUser();
    const res = await api("/v1/sync/snapshot", {
      method: "PUT",
      token: u.token,
      raw: new Uint8Array(TEN_MB + 1),
      headers: { "If-Match": "0", "X-Dek-Id": u.keys.dekId },
    });
    expect(res.status).toBe(413);
  });
});

describe("Google key set (I-2)", () => {
  it("takes another JWKS URL only for test hosts", () => {
    const google = "https://www.googleapis.com/oauth2/v3/certs";
    expect(jwksUrl(undefined)).toBe(google);
    expect(jwksUrl("https://evil.example.com/certs")).toBe(google);
    expect(jwksUrl("https://jwks.test/certs")).toBe("https://jwks.test/certs");
    expect(jwksUrl("http://127.0.0.1:8799/certs")).toBe("http://127.0.0.1:8799/certs");
    expect(jwksUrl("not a url")).toBe(google);
  });
});

describe("counter keys", () => {
  it("keeps the email out of the counters", async () => {
    const email = freshEmail("counter");
    await wrongLogin(email, `${net()}.1`);
    const rows = await env.DB.prepare("SELECT key FROM rate_limits").all<{ key: string }>();
    expect(rows.results.some((r) => r.key.includes(email) || r.key.includes("10."))).toBe(false);
  });
});
