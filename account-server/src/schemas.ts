import { z } from "zod";

/** Base64url (no padding) string that decodes to exactly `n` bytes. */
const b64Exact = (n: number) =>
  z
    .string()
    .length(Math.ceil((n * 4) / 3))
    .regex(/^[A-Za-z0-9_-]+$/);

/** Base64url blob of bounded size (wrapped / sealed keys). */
const b64Blob = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const Email = z
  .string()
  .max(254)
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.email());

export const DEFAULT_KDF = { alg: "argon2id", m: 65536, t: 3, p: 1 } as const;

/** The same range the app and the website accept (H-1): 64 to 256 MiB, 3 to 10 passes, one lane. */
export const Kdf = z.strictObject({
  alg: z.literal("argon2id"),
  m: z.number().int().min(65536).max(262144), // KiB
  t: z.number().int().min(3).max(10),
  p: z.literal(1),
});

export const Salt = b64Exact(16);
export const AuthKey = b64Exact(32);
export const DevicePub = b64Exact(32);
export const DekId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const DeviceName = z.string().trim().min(1).max(64);
export const Uuid = z.uuid();

/** A DEK holder's MAC over a device row (32 bytes) and the DEK proof (32 bytes), both base64url. */
export const Mac = b64Exact(32);
export const DekProof = b64Exact(32);

export const DeviceKeys = z.strictObject({
  name: DeviceName,
  devicePub: DevicePub,
  sealedDek: b64Blob,
  mac: Mac,
});

export const PreloginBody = z.strictObject({ email: Email });

/** Public signing key of a new session (plan 10.2b): Ed25519 (32 bytes) or ECDSA P-256 (65-byte uncompressed point). */
export const SigKeyBody = z.discriminatedUnion("alg", [
  z.strictObject({ alg: z.literal("ed25519"), pub: b64Exact(32) }),
  z.strictObject({ alg: z.literal("p256"), pub: b64Exact(65) }),
]);
/** One-time sign-in challenge from auth/prelogin or auth/google/nonce (signature.ts): 36 bytes. */
export const Challenge = b64Exact(36);

export const SignupBody = z.strictObject({
  email: Email,
  salt: Salt,
  kdf: Kdf,
  authKey: AuthKey,
  challenge: Challenge,
  sigKey: SigKeyBody,
  // Present when signing up in the app (plan 6.1); absent for website signups.
  keys: z
    .strictObject({
      wrappedDek: b64Blob,
      dekId: DekId,
      dekProof: DekProof,
      device: DeviceKeys,
    })
    .optional(),
});

export const LoginBody = z.strictObject({
  email: Email,
  authKey: AuthKey,
  challenge: Challenge,
  sigKey: SigKeyBody,
});

export const KeysBody = z
  .strictObject({
    dekId: DekId,
    dekProof: DekProof.optional(),
    wrappedDek: b64Blob.optional(),
    recoveryWrappedDek: b64Blob.optional(),
    device: DeviceKeys.optional(),
  })
  .refine((b) => b.wrappedDek !== undefined || b.recoveryWrappedDek !== undefined || b.device !== undefined, {
    message: "Nothing to store",
  });

export const PasswordBody = z.strictObject({
  salt: Salt,
  kdf: Kdf,
  authKey: AuthKey,
  wrappedDek: b64Blob,
  dekId: DekId,
  dekProof: DekProof.optional(),
});

// ---------------------------------------------------------------- phase 1b

/** 256-bit one-time token (verify / reset), base64url. */
export const Token = b64Exact(32);
export const Nonce32 = b64Exact(32);
export const SealedDek = b64Blob;

export const TokenBody = z.strictObject({ token: Token });

const IdToken = z
  .string()
  .min(20)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

/** Linking Google to a password account (H-2): the ID token with its nonce and the password again (authKey). */
export const LinkGoogleBody = z.strictObject({ idToken: IdToken, nonce: Nonce32, authKey: AuthKey });
export const UnlinkGoogleBody = z.strictObject({ authKey: AuthKey });

/** Google sign-in: the ID token, its nonce, the challenge issued with the nonce and the new session's key. */
export const GoogleLoginBody = z.strictObject({
  idToken: IdToken,
  nonce: Nonce32,
  challenge: Challenge,
  sigKey: SigKeyBody,
});

export const ResetRequestBody = z.strictObject({ email: Email });

export const ResetBody = z.strictObject({
  token: Token,
  salt: Salt,
  kdf: Kdf,
  authKey: AuthKey,
  // With recovery code: the device unwrapped the DEK with the recovery key and sends both new wraps.
  // Without: no keys, the password wrap is dropped until a signed-in device sends a new one.
  keys: z
    .strictObject({
      dekId: DekId,
      // proves the recovery code opened the DEK: a mailbox alone cannot overwrite the wraps (M-5)
      dekProof: DekProof,
      wrappedDek: b64Blob,
      recoveryWrappedDek: b64Blob,
    })
    .optional(),
});

export const DeviceRequestBody = z.strictObject({
  deviceName: DeviceName,
  devicePub: DevicePub,
  /** base64url(SHA-256(devicePub bytes || rN bytes)), see approval.ts. */
  commitment: Nonce32,
});

export const ApproverNonceBody = z.strictObject({ nonce: Nonce32 });
export const RevealBody = z.strictObject({ reveal: Nonce32 });
export const ApproveBody = z.strictObject({ dekId: DekId, sealedDek: SealedDek, mac: Mac });

export const RotateMeta = z.strictObject({
  oldDekId: DekId,
  dekId: DekId,
  dekProof: DekProof,
  /** The old DEK's MAC over the new one; devices take the new DEK only with it (K-1). */
  chainMac: Mac,
  devices: z
    .array(z.strictObject({ deviceId: Uuid, sealedDek: SealedDek, mac: Mac }))
    .max(50),
  wrappedDek: b64Blob.optional(),
  recoveryWrappedDek: b64Blob.optional(),
});

/** Start fresh (plan 2, 6.3, 6.8): a new DEK for an account whose old one is lost; everything synced goes. */
export const StartFreshBody = z.strictObject({
  dekId: DekId,
  dekProof: DekProof,
  wrappedDek: b64Blob.optional(),
  recoveryWrappedDek: b64Blob.optional(),
  device: DeviceKeys,
});
