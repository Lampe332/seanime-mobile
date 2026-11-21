import { sha256 } from "./crypto";
import { clientIp, noContent, readJson } from "./http";
import { burstLimit } from "./ratelimit";
import type { Ctx } from "./routes";
import { PingBody } from "./schemas";

/** Days the daily cleanup keeps in active_installs. */
export const ACTIVE_INSTALLS_KEEP_DAYS = 400;

/** "YYYY-MM-DD" of the UTC day. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * POST /v1/ping, no session: the app's anonymous daily count. Stores only (UTC day, SHA-256 of the random install ID,
 * app version). The IP is used only for the in-memory burst limiter and never reaches D1.
 */
export async function ping(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  await burstLimit(env.PING_LIMITER, clientIp(request));
  const { id, version } = await readJson(request, PingBody);
  const install = toHex(await sha256(`install:${id.toLowerCase()}`));
  await env.DB.prepare("INSERT OR IGNORE INTO active_installs (day, install, version) VALUES (?, ?, ?)")
    .bind(utcDay(new Date()), install, version)
    .run();
  return noContent();
}
