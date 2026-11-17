/**
 * Signed requests and login challenges (plan 10.2b).
 *
 * Every session is bound to the public half of a signing key that never leaves the device (app: Ed25519 from
 * libsodium, private key in the Android Keystore; website: a non-extractable WebCrypto key in IndexedDB, Ed25519 or
 * ECDSA P-256). Every request with a session carries a signature over
 *
 *   v1\n{METHOD}\n{path+query}\n{hex SHA-256 of the raw body}\n{timestamp ms}\n{nonce}\n{session id or "-"}
 *
 * in the headers X-SM-Sig (base64url, 64 bytes), X-SM-Ts (unix ms) and X-SM-Nonce (base64url, 16 bytes). The session id
 * is base64url(SHA-256(token)) when the token travels as Bearer, "-" for the website's HttpOnly cookie and for sign-ins.
 * The timestamp must be within 5 minutes of the server clock and every nonce is accepted once. A stolen session token
 * alone, or a captured request sent again, gets 401. Every failure answers the same 401.
 *
 * Sign-in (login, signup, Google) is signed the same way with the new key from the body and must carry a one-time
 * challenge from auth/prelogin (bound to the email) or auth/google/nonce (bound to the nonce). Challenges are
 * stateless HMACs; a used one is remembered next to the nonces until it expires.
 */
import { fromB64url, hmacSha256, randomBytes, safeEqual, sha256, toB64url } from "./crypto";
import { HttpError, MAX_JSON_BYTES, readLimited } from "./http";

export type SigAlg = "ed25519" | "p256";
export interface SigKey {
  alg: SigAlg;
  pub: string;
}

export const SIG_HEADER = "X-SM-Sig";
export const TS_HEADER = "X-SM-Ts";
export const NONCE_HEADER = "X-SM-Nonce";
export const MAX_SKEW_MS = 5 * 60 * 1000;
export const CHALLENGE_TTL = 5 * 60;
const NONCE_BYTES = 16;
const SIG_BYTES = 64;
/** How long a nonce is remembered after its timestamp: longer than the window it could still be accepted in. */
const NONCE_KEEP = MAX_SKEW_MS / 1000 + 60;
/** Largest body any route accepts (rotate: snapshot + meta + multipart overhead); routes keep their own limits. */
const MAX_BODY_BYTES = 10 * 1024 * 1024 + MAX_JSON_BYTES + 4096;

const unauthorized = () => new HttpError(401, "unauthorized");
const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- body digest

const digests = new WeakMap<Request, string>();

/**
 * Reads the body once (bounded), remembers its SHA-256 for the signature check and hands the routes an identical
 * request whose body they can read as before.
 */
export async function withBodyDigest(request: Request): Promise<Request> {
  let bytes: Uint8Array = new Uint8Array(0);
  let next = request;
  if (request.body !== null) {
    bytes = await readLimited(request, MAX_BODY_BYTES);
    next = new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
  }
  digests.set(next, hex(await sha256(bytes)));
  return next;
}

function bodyDigest(request: Request): string {
  const digest = digests.get(request);
  if (digest === undefined) throw new Error("body digest missing");
  return digest;
}

// ---------------------------------------------------------------- signatures

export function canonical(method: string, pathAndQuery: string, bodyHex: string, ts: string, nonce: string, sid: string): string {
  return ["v1", method.toUpperCase(), pathAndQuery, bodyHex, ts, nonce, sid].join("\n");
}

async function verifyWith(key: SigKey, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  const pub = fromB64url(key.pub);
  if (!pub) return false;
  try {
    if (key.alg === "ed25519") {
      if (pub.byteLength !== 32) return false;
      const k = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "Ed25519" }, k, signature, data);
    }
    if (key.alg === "p256") {
      if (pub.byteLength !== 65) return false;
      const k = await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, signature, data);
    }
  } catch {
    // not a valid point / key
  }
  return false;
}

/** Remembers a nonce (or used challenge) until `expiresAt`; false when it was seen before. */
async function useOnce(env: Env, value: string, expiresAt: number): Promise<boolean> {
  const res = await env.DB.prepare("INSERT INTO used_nonces (nonce, expires_at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING")
    .bind(value, expiresAt)
    .run();
  return res.meta.changes > 0;
}

/**
 * Checks the request's signature against `key`, the time window and the nonce. `sid` is what the signer had to put in
 * the last line. Throws the same 401 for every failure.
 */
export async function verifyRequest(env: Env, request: Request, key: SigKey, sid: string): Promise<void> {
  const sig = fromB64url(request.headers.get(SIG_HEADER) ?? "");
  const ts = request.headers.get(TS_HEADER) ?? "";
  const nonce = request.headers.get(NONCE_HEADER) ?? "";
  if (!sig || sig.byteLength !== SIG_BYTES) throw unauthorized();
  if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) throw unauthorized();
  if (fromB64url(nonce)?.byteLength !== NONCE_BYTES || nonce.length !== 22) throw unauthorized();
  const url = new URL(request.url);
  const data = encoder.encode(canonical(request.method, url.pathname + url.search, bodyDigest(request), ts, nonce, sid));
  if (!(await verifyWith(key, sig, data))) throw unauthorized();
  if (!(await useOnce(env, `n:${nonce}`, Math.floor(Number(ts) / 1000) + NONCE_KEEP))) throw unauthorized();
}

// ---------------------------------------------------------------- challenges

const CHALLENGE_BYTES = 4 + 16 + 16;

async function challengeMac(env: Env, subject: string, ts: Uint8Array, rand: Uint8Array): Promise<Uint8Array> {
  return (await hmacSha256(env.ENUM_SECRET, `challenge:v1:${subject}:${toB64url(ts)}:${toB64url(rand)}`)).slice(0, 16);
}

/**
 * One-time sign-in challenge bound to `subject` ("email:<email>" or "google:<nonce>"): time || random || HMAC.
 * Unknown emails get one of the same shape, made the same way.
 */
export async function issueChallenge(env: Env, subject: string): Promise<string> {
  const ts = new Uint8Array(4);
  new DataView(ts.buffer).setUint32(0, Math.floor(Date.now() / 1000));
  const rand = randomBytes(16);
  const out = new Uint8Array(CHALLENGE_BYTES);
  out.set(ts, 0);
  out.set(rand, 4);
  out.set(await challengeMac(env, subject, ts, rand), 20);
  return toB64url(out);
}

async function useChallenge(env: Env, challenge: string, subject: string): Promise<boolean> {
  const raw = fromB64url(challenge);
  if (!raw || raw.byteLength !== CHALLENGE_BYTES) return false;
  const ts = raw.slice(0, 4);
  const rand = raw.slice(4, 20);
  if (!safeEqual(raw.slice(20), await challengeMac(env, subject, ts, rand))) return false;
  const issued = new DataView(ts.buffer).getUint32(0);
  const t = Math.floor(Date.now() / 1000);
  if (issued > t + 60 || t - issued > CHALLENGE_TTL) return false;
  return useOnce(env, `c:${toB64url(rand)}`, issued + CHALLENGE_TTL + 60);
}

/**
 * A sign-in request: signed with the new key it registers (session id "-") and carrying an unused challenge for
 * `subject`. Afterwards the key is bound to the new session.
 */
export async function verifySignIn(env: Env, request: Request, key: SigKey, challenge: string, subject: string): Promise<void> {
  await verifyRequest(env, request, key, "-");
  if (!(await useChallenge(env, challenge, subject))) throw unauthorized();
}
