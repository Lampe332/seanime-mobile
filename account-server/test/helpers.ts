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

export interface TestKey {
  alg: "ed25519" | "p256";
  pair: CryptoKeyPair;
  pub: string;
}

/** A signing key like the app's (Ed25519) or the website's fallback (ECDSA P-256). */
export async function newKey(alg: TestKey["alg"] = "ed25519"): Promise<TestKey> {
  const params = alg === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  const pair = (await crypto.subtle.generateKey(params, false, ["sign", "verify"])) as CryptoKeyPair;
  return { alg, pair, pub: b64(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)) };
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** base64url(SHA-256(token)): the session id the app signs. */
export async function sessionId(token: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

export interface SignOptions {
  ts?: number;
  nonce?: string;
}

/** The headers of a signed request (account-server/src/signature.ts). */
export async function signHeaders(
  key: TestKey,
  method: string,
  pathAndQuery: string,
  body: Uint8Array,
  sid: string,
  opts: SignOptions = {},
): Promise<Record<string, string>> {
  const ts = String(opts.ts ?? Date.now());
  const nonce = opts.nonce ?? b64(rand(16));
  const bodyHex = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  const data = new TextEncoder().encode(["v1", method, pathAndQuery, bodyHex, ts, nonce, sid].join("\n"));
  const algo = key.alg === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  const sig = new Uint8Array(await crypto.subtle.sign(algo, key.pair.privateKey, data));
  return { "X-SM-Sig": b64(sig), "X-SM-Ts": ts, "X-SM-Nonce": nonce };
}

/** Signing key of each session the tests created (by token), as the device would keep it. */
const sessionKeys = new Map<string, TestKey>();
/** Challenge issued with each Google nonce. */
const googleChallenges = new Map<string, string>();

export const keyOf = (token: string) => sessionKeys.get(token);

function cookieToken(headers: Headers): string | null {
  const m = /(?:^|;\s*)__Host-sid=([A-Za-z0-9_-]{43})/.exec(headers.get("Cookie") ?? "");
  return m ? m[1]! : null;
}

/**
 * Signs a request the way the app (Bearer) or the website (cookie) does, with the session's key unless `key` is given.
 * Without a known key the request goes out unsigned.
 */
export async function signed(request: Request, key?: TestKey, opts: SignOptions = {}): Promise<Request> {
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
  const token = bearer ?? cookieToken(request.headers);
  const k = key ?? (token ? sessionKeys.get(token) : undefined);
  if (!k) return request;
  const url = new URL(request.url);
  const sid = bearer ? await sessionId(bearer) : "-";
  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(await signHeaders(k, request.method, url.pathname + url.search, body, sid, opts))) {
    headers.set(name, value);
  }
  return new Request(request.url, { method: request.method, headers, body: request.body === null ? undefined : body });
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  raw?: Uint8Array;
  token?: string;
  headers?: Record<string, string>;
  ip?: string;
  /** false: send without signature; a key: sign with that key instead of the session's (or the new sign-in key). */
  sign?: TestKey | false;
  signOpts?: SignOptions;
}

const SIGN_IN = new Set(["/v1/auth/login", "/v1/auth/signup", "/v1/auth/google"]);

/**
 * Calls the worker like the app does: requests with a session are signed with the session's key; a sign-in without
 * `challenge` in its body first fetches one (prelogin / the Google nonce's), adds a new key and signs with it.
 */
export async function api(path: string, opts: ApiOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  let body: Uint8Array | undefined;
  let signInKey: TestKey | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Length", String(opts.raw.byteLength));
  } else if (opts.body !== undefined) {
    let value = opts.body;
    if (SIGN_IN.has(path) && opts.sign !== false && isRecord(value) && !("challenge" in value)) {
      signInKey = opts.sign || (await newKey());
      const challenge =
        path === "/v1/auth/google"
          ? googleChallenges.get(String(value.nonce)) ?? b64(rand(36))
          : await challengeFor(String(value.email));
      value = { ...value, challenge, sigKey: { alg: signInKey.alg, pub: signInKey.pub } };
    }
    body = new TextEncoder().encode(JSON.stringify(value));
    headers.set("Content-Type", "application/json");
  }
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("CF-Connecting-IP", opts.ip ?? freshIp());
  let request = new Request(`https://api.example.com${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  if (opts.sign !== false) request = await signed(request, signInKey ?? opts.sign, opts.signOpts);
  const res = await exports.default.fetch(request);
  if (res.ok && signInKey) {
    const cookie = /^__Host-sid=([A-Za-z0-9_-]{43});/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
    const token = cookie ?? (await res.clone().json<{ sessionToken?: string }>()).sessionToken;
    if (token) sessionKeys.set(token, signInKey);
  }
  if (res.ok && path === "/v1/auth/google/nonce") {
    const data = await res.clone().json<{ nonce: string; challenge: string }>();
    googleChallenges.set(data.nonce, data.challenge);
  }
  return res;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A fresh one-time challenge for this email, as the app gets it from prelogin before login or signup. */
export async function challengeFor(email: string): Promise<string> {
  const res = await exports.default.fetch(
    new Request("https://api.example.com/v1/auth/prelogin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
      body: JSON.stringify({ email }),
    }),
  );
  return (await res.json<{ challenge: string }>()).challenge;
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
