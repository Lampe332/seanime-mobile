import type { z } from "zod";

export const MAX_JSON_BYTES = 16 * 1024;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly extraHeaders: Record<string, string> = {},
    public readonly extraBody: Record<string, unknown> = {},
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function noContent(headers: HeadersInit = {}): Response {
  return new Response(null, { status: 204, headers });
}

export function errorResponse(err: HttpError): Response {
  return json({ error: err.code, message: err.message, ...err.extraBody }, err.status, err.extraHeaders);
}

export function tooMany(retryAfter: number): HttpError {
  const secs = Math.max(1, Math.ceil(retryAfter));
  return new HttpError(429, "rate_limited", "Too many requests. Try again later.", { "Retry-After": String(secs) }, {
    retryAfter: secs,
  });
}

/** Reads at most `max` bytes of the request body; larger bodies are rejected with 413. */
export async function readLimited(request: Request, max: number): Promise<Uint8Array> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    throw new HttpError(413, "payload_too_large");
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function mediaType(request: Request): string {
  return (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
}

export function requireMediaType(request: Request, type: string): void {
  if (mediaType(request) !== type) throw new HttpError(415, "unsupported_media_type", `Expected ${type}`);
}

/** Parses a JSON body against a schema. Unknown fields are rejected by the strict schemas. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  requireMediaType(request, "application/json");
  const raw = await readLimited(request, MAX_JSON_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join(".") || "(root)"))];
    throw new HttpError(400, "invalid_request", "Invalid request body", {}, { fields });
  }
  return result.data;
}

/** Security and CORS headers applied to every response. */
export function finalize(response: Response, corsOrigin: string | null): Response {
  const res = new Response(response.body, response);
  const h = res.headers;
  h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "no-store");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  h.append("Vary", "Origin");
  if (corsOrigin) {
    h.set("Access-Control-Allow-Origin", corsOrigin);
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Access-Control-Expose-Headers", "Retry-After, X-Snapshot-Version, X-Dek-Id");
  }
  return res;
}

export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, If-Match, X-Dek-Id",
      "Access-Control-Max-Age": "600",
    },
  });
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
