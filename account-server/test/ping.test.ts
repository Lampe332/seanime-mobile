// 4.3.2: the anonymous daily count (POST /v1/ping, migration 0013).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanup } from "../src/cron";
import { utcDay } from "../src/ping";
import { api } from "./helpers";

const ping = (body: unknown) => api("/v1/ping", { body, sign: false });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const rowsFor = (install: string) =>
  env.DB.prepare("SELECT day, install, version FROM active_installs WHERE install = ?")
    .bind(install)
    .all<{ day: string; install: string; version: string }>();

describe("POST /v1/ping", () => {
  it("stores the SHA-256 of the ID, never the raw ID", async () => {
    const id = crypto.randomUUID();
    const res = await ping({ id, version: "4.3.2" });
    expect(res.status).toBe(204);
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM active_installs WHERE install = ? OR install LIKE ?")
      .bind(id, `%${id}%`)
      .first<{ n: number }>();
    expect(raw?.n).toBe(0);
    const { results } = await rowsFor(await sha256Hex(`install:${id}`));
    expect(results).toEqual([{ day: utcDay(new Date()), install: await sha256Hex(`install:${id}`), version: "4.3.2" }]);
  });

  it("counts a second ping on the same day once", async () => {
    const id = crypto.randomUUID();
    expect((await ping({ id, version: "4.3.2" })).status).toBe(204);
    expect((await ping({ id, version: "4.3.3" })).status).toBe(204);
    const { results } = await rowsFor(await sha256Hex(`install:${id}`));
    expect(results).toHaveLength(1);
    expect(results[0]?.version).toBe("4.3.2");
  });

  it("rejects an invalid ID or version with 400 and stores nothing", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM active_installs").first<{ n: number }>();
    for (const body of [
      { id: "not-a-uuid", version: "4.3.2" },
      { id: "", version: "4.3.2" },
      { id: crypto.randomUUID(), version: "x".repeat(40) },
      { id: crypto.randomUUID(), version: "<script>" },
      { id: crypto.randomUUID(), version: "4.3.2", email: "a@example.com" },
      { version: "4.3.2" },
    ]) {
      expect((await ping(body)).status).toBe(400);
    }
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM active_installs").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("is limited per IP in memory", async () => {
    const ip = "10.250.1.1";
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const res = await api("/v1/ping", { body: { id: crypto.randomUUID(), version: "4.3.2" }, sign: false, ip });
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
  });

  it("the daily cleanup drops days older than 400 days", async () => {
    const old = utcDay(new Date(Date.now() - 401 * 24 * 3600 * 1000));
    const recent = utcDay(new Date(Date.now() - 399 * 24 * 3600 * 1000));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO active_installs (day, install, version) VALUES (?, 'old', '4.0.0')").bind(old),
      env.DB.prepare("INSERT INTO active_installs (day, install, version) VALUES (?, 'recent', '4.0.0')").bind(recent),
    ]);
    await cleanup(env);
    const { results } = await env.DB.prepare("SELECT install FROM active_installs WHERE install IN ('old', 'recent')").all<{ install: string }>();
    expect(results.map((r) => r.install)).toEqual(["recent"]);
  });
});
