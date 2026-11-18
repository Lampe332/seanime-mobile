/**
 * Round after the fifth security review (18.11.): NEU5-1 a stranger in the owner's network can't use up the owner's reset
 * mails, the network stays capped; NEU5-2 a fresh password sign-in (the website) deletes the account and disconnects Google
 * while a stranger holds the email's counter; NEU5-4 the newest 3 events of each kind stay listed.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { LOGIN_LIMIT_EMAIL_GLOBAL, MAIL_LIMIT_DAY_ALL } from "../src/ratelimit";
import { api, b64, DEFAULT_KDF, deviceKeys, freshEmail, freshIp, newKey, rand, sessionId, signupUser } from "./helpers";

interface SentMail {
  to: string;
  subject: string;
  text: string;
}
const sink = env.EMAIL as unknown as { take(to: string): Promise<SentMail[]> };

async function mailsTo(email: string, subject: string, want = 1): Promise<SentMail[]> {
  const seen: SentMail[] = [];
  for (let i = 0; i < 40 && seen.length < want; i++) {
    seen.push(...(await sink.take(email)).filter((m) => m.subject === subject));
    if (seen.length < want) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return seen;
}
const errorOf = async (res: Response) => (await res.json<{ error: string }>()).error;
const reset = (email: string, ip: string) => api("/v1/auth/reset-request", { body: { email }, ip, sign: false });
/** Moves every hour window past its end (day windows and known networks stay) */
const nextHour = () => env.DB.prepare("UPDATE rate_limits SET expires_at = 0 WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000) + 3600).run();

async function owner(home: string) {
  const email = freshEmail("owner");
  const authKey = b64(rand(32));
  const res = await api("/v1/auth/signup", {
    sign: await newKey(),
    ip: home,
    body: { email, salt: b64(rand(16)), kdf: DEFAULT_KDF, authKey, keys: { wrappedDek: b64(rand(72)), dekId: "dek-p", dekProof: b64(rand(32)), device: deviceKeys() } },
  });
  expect(res.status).toBe(201);
  await sink.take(email);
  return { email, authKey };
}

describe("NEU5-1: a stranger in the owner's network can't silence the owner's reset mail (I4)", () => {
  it("18 resets from two other addresses of the home /24 over 3 hours: the owner's reset from home still mails him", async () => {
    const o = await owner("172.40.1.9");
    const answers: number[] = [];
    for (let hour = 0; hour < 3; hour++) {
      for (const ip of ["172.40.1.50", "172.40.1.51"]) for (let i = 0; i < 3; i++) answers.push((await reset(o.email, ip)).status);
      await nextHour();
    }
    expect(answers.every((s) => s === 202)).toBe(true);
    // before NEU5-1 the pot was per (email, /24): 10 mails, then nothing for the owner
    expect(await mailsTo(o.email, "Reset your password", 18)).toHaveLength(18);
    expect((await reset(o.email, "172.40.1.9")).status).toBe(202);
    expect(await mailsTo(o.email, "Reset your password")).toHaveLength(1);
  });

  it("no new flood: the whole known network sends at most the daily cap, other networks keep their per-/24 pot", async () => {
    const o = await owner("172.41.1.9");
    for (let hour = 0; hour < 3; hour++) {
      for (let a = 0; a < 6; a++) for (let i = 0; i < 3; i++) await reset(o.email, `172.41.1.${60 + a}`);
      await nextHour();
    }
    expect(await mailsTo(o.email, "Reset your password", MAIL_LIMIT_DAY_ALL + 4)).toHaveLength(MAIL_LIMIT_DAY_ALL);
    // a network the account never signed in from: still one pot per /24 (10 a day)
    for (let hour = 0; hour < 3; hour++) {
      for (let a = 0; a < 2; a++) for (let i = 0; i < 3; i++) await reset(o.email, `172.42.1.${60 + a}`);
      await nextHour();
    }
    expect(await mailsTo(o.email, "Reset your password", 14)).toHaveLength(10);
  });
});

describe("NEU5-2: the website deletes and disconnects Google while a stranger holds the email's counter", () => {
  const login = async (email: string, authKey: string, ip = freshIp()) => api("/v1/auth/login", { body: { email, authKey }, ip });
  const holdCounter = async (email: string) => {
    const b = rand(1)[0];
    for (let i = 0; i < LOGIN_LIMIT_EMAIL_GLOBAL; i++) expect((await login(email, b64(rand(32)), `198.${b}.${i % 5}.9`)).status).toBe(401);
  };
  const sessionOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return (await res.json<{ sessionToken: string }>()).sessionToken;
  };

  it("a password sign-in within 10 minutes: unlink Google and delete with the password work, a wrong one is still refused", async () => {
    const a = await signupUser();
    const web = await sessionOf(await login(a.email, a.keys.authKey));
    await holdCounter(a.email);
    await env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(`g-${b64(rand(6))}`, a.userId).run();
    const wrong = await api("/v1/account/unlink-google", { token: web, body: { authKey: b64(rand(32)) } });
    expect(wrong.status).toBe(403);
    expect(await errorOf(wrong)).toBe("wrong_password");
    expect((await api("/v1/account/unlink-google", { token: web, body: { authKey: a.keys.authKey } })).status).toBe(204);
    expect((await api("/v1/account", { method: "DELETE", token: web, body: { authKey: a.keys.authKey } })).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 AS k FROM users WHERE id = ?").bind(a.userId).first()).toBeNull();
  });

  it("an older password sign-in is asked to sign in again (not 429); a session without a password check still gets 429", async () => {
    const a = await signupUser();
    const old = await sessionOf(await login(a.email, a.keys.authKey));
    const keyless = await sessionOf(await login(a.email, a.keys.authKey));
    await env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 3600 WHERE token_hash = ?").bind(await sessionId(old)).run();
    await env.DB.prepare("UPDATE sessions SET password_auth = 0, auth_at = auth_at - 3600 WHERE token_hash = ?").bind(await sessionId(keyless)).run();
    await holdCounter(a.email);
    const again = await api("/v1/account", { method: "DELETE", token: old, body: { authKey: a.keys.authKey } });
    expect(again.status).toBe(403);
    expect(await errorOf(again)).toBe("reauth_required");
    const held = await api("/v1/account", { method: "DELETE", token: keyless, body: { authKey: a.keys.authKey } });
    expect(held.status).toBe(429);
    expect(await env.DB.prepare("SELECT 1 AS k FROM users WHERE id = ?").bind(a.userId).first()).not.toBeNull();
  });
});

describe("NEU5-4: the newest 3 events of each kind stay listed", () => {
  it("two devices signed out, then 21 key changes: both sign-outs are still listed", async () => {
    const a = await signupUser();
    const t = Math.floor(Date.now() / 1000);
    for (const [i, name] of ["Tablet A", "Tablet B"].entries()) {
      await env.DB.prepare("INSERT INTO account_events (user_id, kind, device_name, at) VALUES (?, 'device_signed_out', ?, ?)").bind(a.userId, name, t + i).run();
    }
    for (let i = 0; i < 21; i++) {
      await env.DB.prepare("INSERT INTO account_events (user_id, kind, device_name, at) VALUES (?, 'recovery_changed', NULL, ?)").bind(a.userId, t + 2 + i).run();
    }
    const res = await api("/v1/account", { token: a.token });
    const { events } = await res.json<{ events: { kind: string; deviceName: string | null }[] }>();
    expect(events.filter((e) => e.kind === "device_signed_out").map((e) => e.deviceName)).toEqual(["Tablet B", "Tablet A"]);
  });
});
