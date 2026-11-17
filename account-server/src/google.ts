import { fromB64url, safeEqual } from "./crypto";
import { HttpError } from "./http";
import { now } from "./session";

/** Accepted issuers of Google ID tokens. */
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Allowed clock skew for exp / iat. */
const SKEW_SECONDS = 60;
/** Cache lifetime when Google sends no usable max-age. */
const DEFAULT_CACHE_SECONDS = 3600;
const MAX_CACHE_SECONDS = 24 * 3600;
/** A key id that is not in the cached set may trigger at most one refetch per minute. */
const REFETCH_GAP_SECONDS = 60;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface KeyCache {
  url: string;
  keys: Map<string, CryptoKey>;
  expiresAt: number;
  fetchedAt: number;
}

// Module-level cache of Google's public signing keys (not request state). Lives as long as the isolate.
let cache: KeyCache | null = null;

function maxAge(header: string | null): number {
  const m = /(?:^|,)\s*max-age=(\d+)/i.exec(header ?? "");
  if (!m) return DEFAULT_CACHE_SECONDS;
  return Math.min(MAX_CACHE_SECONDS, Number(m[1]));
}

async function fetchKeys(url: string): Promise<KeyCache> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new HttpError(503, "google_unavailable", "Google sign-in is not available right now.");
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== "RSA" || !jwk.kid || !jwk.n || !jwk.e || (jwk.alg && jwk.alg !== "RS256")) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keys.set(jwk.kid, key);
  }
  const t = now();
  return { url, keys, fetchedAt: t, expiresAt: t + maxAge(res.headers.get("Cache-Control")) };
}

async function signingKey(env: Env, kid: string): Promise<CryptoKey | null> {
  const url = env.GOOGLE_JWKS_URL;
  const t = now();
  if (!cache || cache.url !== url || cache.expiresAt <= t) {
    cache = await fetchKeys(url);
  } else if (!cache.keys.has(kid) && t - cache.fetchedAt >= REFETCH_GAP_SECONDS) {
    // Google rotated its keys before our cache expired.
    cache = await fetchKeys(url);
  }
  return cache.keys.get(kid) ?? null;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
}

const invalid = () => new HttpError(401, "invalid_google_token", "Google sign-in failed. Try again.");

function decodeJson(part: string): Record<string, unknown> {
  const bytes = fromB64url(part);
  if (!bytes) throw invalid();
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw invalid();
    return v as Record<string, unknown>;
  } catch {
    throw invalid();
  }
}

/**
 * Verifies a Google ID token (plan 6.3): RS256 signature against Google's JWKS,
 * iss, aud = our web client id, exp / iat with small skew, email_verified and
 * the nonce the client got from `auth/google/nonce`. Consuming the nonce is the caller's job.
 */
export async function verifyGoogleIdToken(env: Env, idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw invalid();
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw invalid();
  const signature = fromB64url(s);
  if (!signature) throw invalid();

  const key = await signingKey(env, header.kid);
  if (!key) throw invalid();
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw invalid();

  const claims = decodeJson(p);
  const t = now();
  const aud = claims.aud;
  const audOk = typeof aud === "string" ? aud === env.GOOGLE_WEB_CLIENT_ID : Array.isArray(aud) && aud.includes(env.GOOGLE_WEB_CLIENT_ID);
  if (!env.GOOGLE_WEB_CLIENT_ID || !audOk) throw invalid();
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw invalid();
  if (typeof claims.exp !== "number" || claims.exp + SKEW_SECONDS < t) throw invalid();
  if (typeof claims.iat !== "number" || claims.iat - SKEW_SECONDS > t) throw invalid();
  if (claims.email_verified !== true && claims.email_verified !== "true") throw invalid();
  if (typeof claims.sub !== "string" || !/^[0-9A-Za-z_-]{1,255}$/.test(claims.sub)) throw invalid();
  if (typeof claims.email !== "string" || claims.email.length > 254 || !claims.email.includes("@")) throw invalid();
  if (typeof claims.nonce !== "string") throw invalid();
  const enc = new TextEncoder();
  if (!safeEqual(enc.encode(claims.nonce), enc.encode(expectedNonce))) throw invalid();

  return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
}
