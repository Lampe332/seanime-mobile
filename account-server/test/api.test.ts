import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { api, b64, clientKeys, DEFAULT_KDF, freshEmail, freshIp, ORIGIN, rand, signupUser, upload } from "./helpers";

const makeOld = (userId: string) =>
  env.DB.prepare("UPDATE sessions SET auth_at = auth_at - 3600 WHERE user_id = ?").bind(userId).run();

describe("auth", () => {
  it("signs up, logs in and logs out", async () => {
    const u = await signupUser();
    expect(u.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.deviceId).toBeTruthy();

    const login = await api("/v1/auth/login", { body: { email: u.email, authKey: u.keys.authKey } });
    expect(login.status).toBe(200);
    const data = await login.json<{ sessionToken: string; wrappedDek: string; dekId: string; kdf: unknown }>();
    expect(data.wrappedDek).toBe(u.keys.wrappedDek);
    expect(data.dekId).toBe(u.keys.dekId);
    expect(data.kdf).toEqual(DEFAULT_KDF);

    expect((await api("/v1/sync/meta", { token: data.sessionToken })).status).toBe(200);
    expect((await api("/v1/auth/logout", { method: "POST", token: data.sessionToken })).status).toBe(204);
    expect((await api("/v1/sync/meta", { token: data.sessionToken })).status).toBe(401);
    // The first session is untouched.
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(200);
  });

  it("signs up on the website without keys and stores only the HMAC of authKey", async () => {
    const u = await signupUser({ withKeys: false });
    expect(u.deviceId).toBeNull();
    const row = await env.DB.prepare("SELECT auth_hash, wrapped_dek, dek_id FROM users WHERE id = ?")
      .bind(u.userId)
      .first<{ auth_hash: string; wrapped_dek: string | null; dek_id: string | null }>();
    expect(row?.auth_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row?.auth_hash).not.toBe(u.keys.authKey);
    expect(row?.wrapped_dek).toBeNull();
    expect(row?.dek_id).toBeNull();
  });

  it("rejects a duplicate email and invalid bodies", async () => {
    const u = await signupUser();
    const k = clientKeys();
    const dup = await api("/v1/auth/signup", {
      body: { email: u.email.toUpperCase(), salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey },
    });
    expect(dup.status).toBe(409);

    const bad = await api("/v1/auth/signup", {
      body: { email: "not-an-email", salt: "x", kdf: DEFAULT_KDF, authKey: k.authKey, extra: 1 },
    });
    expect(bad.status).toBe(400);
    const notJson = await api("/v1/auth/login", { raw: new TextEncoder().encode("{}"), headers: { "Content-Type": "text/plain" } });
    expect(notJson.status).toBe(415);
    const huge = await api("/v1/auth/prelogin", { body: { email: "a".repeat(20_000) } });
    expect(huge.status).toBe(413);
  });

  it("answers a wrong password and an unknown email with the same error", async () => {
    const u = await signupUser();
    const wrong = await api("/v1/auth/login", { body: { email: u.email, authKey: b64(rand(32)) } });
    const unknown = await api("/v1/auth/login", { body: { email: freshEmail("ghost"), authKey: b64(rand(32)) } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = await wrong.json<Record<string, unknown>>();
    const b = await unknown.json<Record<string, unknown>>();
    expect(a).toEqual(b);
    expect(a.message).toBe("Wrong email or password");
  });

  it("prelogin returns the same shape for unknown emails, with a stable decoy salt", async () => {
    const u = await signupUser();
    const known = await (await api("/v1/auth/prelogin", { body: { email: u.email } })).json<Record<string, unknown>>();
    const ghost = freshEmail("ghost");
    const unknown1 = await (await api("/v1/auth/prelogin", { body: { email: ghost } })).json<Record<string, unknown>>();
    const unknown2 = await (await api("/v1/auth/prelogin", { body: { email: ghost } })).json<Record<string, unknown>>();
    expect(known.salt).toBe(u.keys.salt);
    expect(Object.keys(unknown1).sort()).toEqual(Object.keys(known).sort());
    expect(unknown1.kdf).toEqual(known.kdf);
    expect(typeof unknown1.salt).toBe("string");
    expect((unknown1.salt as string).length).toBe((known.salt as string).length);
    expect(unknown1.salt).toBe(unknown2.salt);
  });

  it("expires sessions after 90 days idle", async () => {
    const u = await signupUser();
    await env.DB.prepare("UPDATE sessions SET last_used_at = last_used_at - 91 * 86400 WHERE user_id = ?")
      .bind(u.userId)
      .run();
    expect((await api("/v1/sync/meta", { token: u.token })).status).toBe(401);
    expect((await api("/v1/sync/meta", { token: "x".repeat(43) })).status).toBe(401);
  });
});

describe("website cookie + CORS", () => {
  it("sets a __Host- cookie for the website and accepts it", async () => {
    const k = clientKeys();
    const res = await api("/v1/auth/signup", {
      headers: { Origin: ORIGIN },
      body: { email: freshEmail(), salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey },
    });
    expect(res.status).toBe(201);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43}; Secure; HttpOnly; SameSite=Strict; Path=\//);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const body = await res.json<Record<string, unknown>>();
    expect(body.sessionToken).toBeUndefined();

    const sid = cookie.split(";")[0]!;
    const meta = await api("/v1/sync/meta", { headers: { Origin: ORIGIN, Cookie: sid } });
    expect(meta.status).toBe(200);
  });

  it("rejects foreign origins and answers preflight only for the website", async () => {
    const evil = await api("/v1/auth/prelogin", { headers: { Origin: "https://evil.example.com" }, body: { email: freshEmail() } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const pre = await api("/v1/auth/login", { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("sends security headers on every response", async () => {
    const res = await api("/v1/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("IDOR", () => {
  it("session A never reaches data or devices of B", async () => {
    const a = await signupUser();
    const b = await signupUser();
    expect((await upload(b.token, rand(64), 0, b.keys.dekId)).status).toBe(200);

    // A sees only its own (empty) snapshot and its own device.
    const metaA = await (await api("/v1/sync/meta", { token: a.token })).json<{ version: number }>();
    expect(metaA.version).toBe(0);
    expect((await api("/v1/sync/snapshot", { token: a.token })).status).toBe(404);
    const devs = await (await api("/v1/devices", { token: a.token })).json<{ devices: Array<{ id: string }> }>();
    expect(devs.devices.map((d) => d.id)).toEqual([a.deviceId]);

    // A cannot delete B's device; B's device and data survive.
    expect((await api(`/v1/devices/${b.deviceId}`, { method: "DELETE", token: a.token })).status).toBe(404);
    // A deleting its sync data or account does not touch B.
    expect((await api("/v1/sync", { method: "DELETE", token: a.token })).status).toBe(204);
    expect((await api("/v1/account", { method: "DELETE", token: a.token })).status).toBe(204);
    const devsB = await (await api("/v1/devices", { token: b.token })).json<{ devices: Array<{ id: string }> }>();
    expect(devsB.devices.map((d) => d.id)).toEqual([b.deviceId]);
    expect((await api("/v1/sync/snapshot", { token: b.token })).status).toBe(200);

    // A userId in the body is rejected, never used.
    const k = clientKeys();
    const keys = await api("/v1/account/keys", {
      method: "PUT",
      token: b.token,
      body: { dekId: b.keys.dekId, recoveryWrappedDek: k.wrappedDek, userId: a.userId },
    });
    expect(keys.status).toBe(400);
  });

  it("removes a device and its sessions", async () => {
    const a = await signupUser();
    const login = await (await api("/v1/auth/login", { body: { email: a.email, authKey: a.keys.authKey } })).json<{
      sessionToken: string;
    }>();
    const k = clientKeys();
    const reg = await api("/v1/account/keys", {
      method: "PUT",
      token: login.sessionToken,
      body: { dekId: a.keys.dekId, dekProof: a.keys.dekProof, device: { name: "Tablet", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: b64(rand(32)) } },
    });
    expect(reg.status).toBe(200);
    const { deviceId: tablet } = await reg.json<{ deviceId: string }>();
    const list = await (await api("/v1/devices", { token: a.token })).json<{ devices: Array<{ id: string; current: boolean }> }>();
    expect(list.devices).toHaveLength(2);
    expect(list.devices.find((d) => d.id === a.deviceId)?.current).toBe(true);

    expect((await api(`/v1/devices/${tablet}`, { method: "DELETE", token: a.token })).status).toBe(204);
    expect((await api("/v1/sync/meta", { token: login.sessionToken })).status).toBe(401);
  });
});

describe("account", () => {
  it("rejects a key with another dekId and requires the first wrap on website accounts", async () => {
    const a = await signupUser();
    const other = await api("/v1/account/keys", {
      method: "PUT",
      token: a.token,
      body: { dekId: "dek-other", wrappedDek: clientKeys().wrappedDek },
    });
    expect(other.status).toBe(409);

    const w = await signupUser({ withKeys: false });
    const k = clientKeys();
    const noWrap = await api("/v1/account/keys", {
      method: "PUT",
      token: w.token,
      body: { dekId: k.dekId, dekProof: k.dekProof, device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: b64(rand(32)) } },
    });
    expect(noWrap.status).toBe(400);
    const first = await api("/v1/account/keys", {
      method: "PUT",
      token: w.token,
      body: { dekId: k.dekId, dekProof: k.dekProof, wrappedDek: k.wrappedDek, device: { name: "Phone", devicePub: k.devicePub, sealedDek: k.sealedDek, mac: b64(rand(32)) } },
    });
    expect(first.status).toBe(200);
    const login = await (await api("/v1/auth/login", { body: { email: w.email, authKey: w.keys.authKey } })).json<{
      wrappedDek: string;
      dekId: string;
    }>();
    expect(login).toMatchObject({ wrappedDek: k.wrappedDek, dekId: k.dekId });
  });

  it("changes the password and signs out other sessions", async () => {
    const a = await signupUser();
    const other = await (await api("/v1/auth/login", { body: { email: a.email, authKey: a.keys.authKey } })).json<{
      sessionToken: string;
    }>();
    const k = clientKeys();
    const res = await api("/v1/account/password", {
      token: a.token,
      body: { salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey, wrappedDek: k.wrappedDek, dekId: a.keys.dekId },
    });
    expect(res.status).toBe(204);
    expect((await api("/v1/sync/meta", { token: other.sessionToken })).status).toBe(401);
    expect((await api("/v1/sync/meta", { token: a.token })).status).toBe(200);
    expect((await api("/v1/auth/login", { body: { email: a.email, authKey: a.keys.authKey } })).status).toBe(401);
    const login = await api("/v1/auth/login", { body: { email: a.email, authKey: k.authKey } });
    expect(login.status).toBe(200);
    expect((await login.json<{ wrappedDek: string }>()).wrappedDek).toBe(k.wrappedDek);
  });

  it("requires a sign-in within the last 10 minutes for sensitive actions", async () => {
    const a = await signupUser();
    await makeOld(a.userId);
    expect((await api("/v1/account", { method: "DELETE", token: a.token })).status).toBe(403);
    expect((await api(`/v1/devices/${a.deviceId}`, { method: "DELETE", token: a.token })).status).toBe(403);
    const k = clientKeys();
    const pw = await api("/v1/account/password", {
      token: a.token,
      body: { salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey, wrappedDek: k.wrappedDek, dekId: a.keys.dekId },
    });
    expect(pw.status).toBe(403);
    // Normal sync keeps working.
    expect((await api("/v1/sync/meta", { token: a.token })).status).toBe(200);
  });

  it("deleting the account removes all D1 rows and the R2 blob", async () => {
    const a = await signupUser();
    expect((await upload(a.token, rand(128), 0, a.keys.dekId)).status).toBe(200);
    expect(await env.SNAPSHOTS.head(`snap/${a.userId}`)).not.toBeNull();

    expect((await api("/v1/account", { method: "DELETE", token: a.token })).status).toBe(204);

    expect(await env.SNAPSHOTS.head(`snap/${a.userId}`)).toBeNull();
    for (const table of ["sessions", "devices", "tokens", "device_requests", "snapshots"]) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(a.userId).first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
    const user = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").bind(a.userId).first<{ n: number }>();
    expect(user?.n).toBe(0);
    expect((await api("/v1/auth/login", { body: { email: a.email, authKey: a.keys.authKey } })).status).toBe(401);
  });
});

describe("sync", () => {
  it("uploads with If-Match, returns 409 on a wrong version and serves the blob", async () => {
    const a = await signupUser();
    const blob1 = rand(256);
    const r1 = await upload(a.token, blob1, 0, a.keys.dekId);
    expect(r1.status).toBe(200);
    expect((await r1.json<{ version: number }>()).version).toBe(1);

    const stale = await upload(a.token, rand(256), 0, a.keys.dekId);
    expect(stale.status).toBe(409);
    expect((await stale.json<{ error: string; version: number }>())).toMatchObject({ error: "version_conflict", version: 1 });
    expect((await upload(a.token, rand(256), null, a.keys.dekId)).status).toBe(409);
    expect((await upload(a.token, rand(256), 1, "dek-wrong")).status).toBe(409);

    const blob2 = rand(300);
    expect((await upload(a.token, blob2, 1, a.keys.dekId)).status).toBe(200);
    const meta = await (await api("/v1/sync/meta", { token: a.token })).json<{ version: number; size: number; dekId: string }>();
    expect(meta).toMatchObject({ version: 2, size: 300, dekId: a.keys.dekId });

    const get = await api("/v1/sync/snapshot", { token: a.token });
    expect(get.status).toBe(200);
    expect(get.headers.get("X-Snapshot-Version")).toBe("2");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(blob2);

    expect((await api("/v1/sync", { method: "DELETE", token: a.token })).status).toBe(204);
    expect((await api("/v1/sync/snapshot", { token: a.token })).status).toBe(404);
    expect((await (await api("/v1/sync/meta", { token: a.token })).json<{ version: number }>()).version).toBe(0);
  });

  it("rejects snapshots over 10 MB and non-binary uploads", async () => {
    const a = await signupUser();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const res = await upload(a.token, big, 0, a.keys.dekId);
    expect(res.status).toBe(413);
    const asJson = await api("/v1/sync/snapshot", {
      method: "PUT",
      token: a.token,
      raw: new TextEncoder().encode("{}"),
      headers: { "Content-Type": "application/json", "If-Match": "0", "X-Dek-Id": a.keys.dekId },
    });
    expect(asJson.status).toBe(415);
    expect(await env.SNAPSHOTS.head(`snap/${a.userId}`)).toBeNull();
  });
});

describe("rate limits", () => {
  it("slows down logins per email with a growing wait, without a hard lock", async () => {
    const u = await signupUser();
    // Email counters are kept per IP range (M-2): every attempt here comes from one /24, each from its own address.
    const net = `10.${rand(1)[0]}.${rand(1)[0]}`;
    for (let i = 0; i < 5; i++) {
      const r = await api("/v1/auth/login", { ip: `${net}.${i + 1}`, body: { email: u.email, authKey: b64(rand(32)) } });
      expect(r.status).toBe(401);
    }
    const blocked = await api("/v1/auth/login", { ip: `${net}.9`, body: { email: u.email, authKey: u.keys.authKey } });
    expect(blocked.status).toBe(429);
    const wait = Number(blocked.headers.get("Retry-After"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(30);

    // Once the wait is over (simulated by moving the last failure back), the right password works again.
    await env.DB.prepare("UPDATE rate_limits SET last_at = last_at - 60 WHERE key LIKE 'login-email:%'").run();
    const ok = await api("/v1/auth/login", { ip: `${net}.10`, body: { email: u.email, authKey: u.keys.authKey } });
    expect(ok.status).toBe(200);
  });

  it("limits login bursts per IP", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await api("/v1/auth/login", { ip, body: { email: freshEmail(), authKey: b64(rand(32)) } });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });

  it("limits signups per IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await signupUser({ ip });
    const k = clientKeys();
    const sixth = await api("/v1/auth/signup", {
      ip,
      body: { email: freshEmail(), salt: k.salt, kdf: DEFAULT_KDF, authKey: k.authKey },
    });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
  });

  it("limits uploads to 30 per hour per account", async () => {
    const a = await signupUser();
    for (let v = 0; v < 30; v++) {
      expect((await upload(a.token, rand(32), v, a.keys.dekId)).status).toBe(200);
    }
    expect((await upload(a.token, rand(32), 30, a.keys.dekId)).status).toBe(429);
  });
});

describe("cron", () => {
  it("removes unconfirmed accounts after 7 days and expired tokens", async () => {
    const old = await signupUser();
    const fresh = await signupUser();
    expect((await upload(old.token, rand(64), 0, old.keys.dekId)).status).toBe(200);
    await env.DB.prepare("UPDATE users SET created_at = created_at - 8 * 86400 WHERE id = ?").bind(old.userId).run();
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES ('expired-token', ?, 'reset', ?, ?)",
    )
      .bind(fresh.userId, t - 7200, t - 60)
      .run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "17 3 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    const users = await env.DB.prepare("SELECT id FROM users WHERE id IN (?, ?)").bind(old.userId, fresh.userId).all<{ id: string }>();
    expect(users.results.map((r) => r.id)).toEqual([fresh.userId]);
    expect(await env.SNAPSHOTS.head(`snap/${old.userId}`)).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM tokens WHERE token_hash = 'expired-token'").first()).toBeNull();
  });
});

describe("zero knowledge", () => {
  it("stores no plaintext from a client-encrypted package in R2 or D1", async () => {
    const a = await signupUser();
    const marker = "PLAINTEXT-MARKER-anilist-token-7f3a9c";
    const plaintext = JSON.stringify({ anilistToken: marker, history: ["One Piece ep 1100 at 12:34"] });

    // Client side: encrypt with a key the server never sees (AES-256-GCM stands in for the app's XChaCha20-Poly1305).
    const key = await crypto.subtle.importKey("raw", rand(32), "AES-GCM", false, ["encrypt", "decrypt"]);
    const iv = rand(12);
    const aad = new TextEncoder().encode(`sm-snap-v1|${a.userId}|1|${a.keys.dekId}`);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, new TextEncoder().encode(plaintext)),
    );
    const blob = new Uint8Array(iv.length + ct.length);
    blob.set(iv);
    blob.set(ct, iv.length);
    expect((await upload(a.token, blob, 0, a.keys.dekId)).status).toBe(200);

    // Everything the server stored for this account.
    const obj = await env.SNAPSHOTS.get(`snap/${a.userId}`);
    const stored = new Uint8Array(await obj!.arrayBuffer());
    const storedText = String.fromCharCode(...stored);
    expect(storedText).not.toContain(marker);
    expect(storedText).not.toContain("One Piece");

    const dump: unknown[] = [];
    for (const table of ["users", "sessions", "devices", "tokens", "device_requests", "google_nonces", "snapshots", "rate_limits"]) {
      dump.push((await env.DB.prepare(`SELECT * FROM ${table}`).all()).results);
    }
    const dbText = JSON.stringify(dump);
    expect(dbText).not.toContain(marker);
    expect(dbText).not.toContain("One Piece");
    expect(dbText).not.toContain(a.keys.authKey);
    expect(dbText).not.toContain(a.token);
    expect(dbText).toContain(a.userId); // the dump really covers this account

    // The client can still read its own data back.
    const back = new Uint8Array(await (await api("/v1/sync/snapshot", { token: a.token })).arrayBuffer());
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: back.slice(0, 12), additionalData: aad }, key, back.slice(12));
    expect(new TextDecoder().decode(pt)).toBe(plaintext);
  });
});
