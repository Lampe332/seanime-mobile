import { exports } from "cloudflare:workers";

export const ORIGIN = "https://seanimemobile.com";
export const DEFAULT_KDF = { alg: "argon2id", m: 65536, t: 3, p: 1 };

export function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Unique test IP per call so burst limits of one test never leak into another. */
export const freshIp = () => `10.${rand(1)[0]}.${rand(1)[0]}.${rand(1)[0]}`;
export const freshEmail = (tag = "user") => `${tag}-${crypto.randomUUID()}@example.com`;

export interface ApiOptions {
  method?: string;
  body?: unknown;
  raw?: Uint8Array;
  token?: string;
  headers?: Record<string, string>;
  ip?: string;
}

export function api(path: string, opts: ApiOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Length", String(opts.raw.byteLength));
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("Content-Type", "application/json");
  }
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("CF-Connecting-IP", opts.ip ?? freshIp());
  return exports.default.fetch(
    new Request(`https://api.example.com${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body }),
  );
}

/** What a real client would derive locally. The server only ever sees authKey and wrapped keys. */
export function clientKeys() {
  return {
    salt: b64(rand(16)),
    authKey: b64(rand(32)),
    dekId: `dek-${b64(rand(6))}`,
    wrappedDek: b64(rand(72)),
    devicePub: b64(rand(32)),
    sealedDek: b64(rand(80)),
  };
}

export async function signupUser(opts: { withKeys?: boolean; ip?: string } = {}) {
  const email = freshEmail();
  const keys = clientKeys();
  const withKeys = opts.withKeys ?? true;
  const res = await api("/v1/auth/signup", {
    ip: opts.ip,
    body: {
      email,
      salt: keys.salt,
      kdf: DEFAULT_KDF,
      authKey: keys.authKey,
      ...(withKeys
        ? {
            keys: {
              wrappedDek: keys.wrappedDek,
              dekId: keys.dekId,
              device: { name: "Test Phone", devicePub: keys.devicePub, sealedDek: keys.sealedDek },
            },
          }
        : {}),
    },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const data = await res.json<{ userId: string; deviceId: string | null; sessionToken: string }>();
  return { email, keys, token: data.sessionToken, userId: data.userId, deviceId: data.deviceId };
}

export function upload(token: string, blob: Uint8Array, version: number | null, dekId: string) {
  const headers: Record<string, string> = { "X-Dek-Id": dekId };
  if (version !== null) headers["If-Match"] = String(version);
  return api("/v1/sync/snapshot", { method: "PUT", token, raw: blob, headers });
}
