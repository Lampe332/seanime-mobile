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
    /** S3: KDF of the recovery key. With a new recovery wrap it is stored (its SHA-256); alone it shows the owner's code. */
    recoveryProof: DekProof.optional(),
    device: DeviceKeys.optional(),
  })
  .refine((b) => b.wrappedDek !== undefined || b.recoveryWrappedDek !== undefined || b.device !== undefined, {
    message: "Nothing to store",
  })
  .refine((b) => b.recoveryWrappedDek === undefined || b.recoveryProof !== undefined, {
    message: "A recovery wrap needs its proof",
    path: ["recoveryProof"],
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
/** The password again (H-2, NEU4-3): unlinking Google, deleting a password account */
export const AuthKeyBody = z.strictObject({ authKey: AuthKey });
export const UnlinkGoogleBody = AuthKeyBody;

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
  /** base64url(SHA-256("sm-commit-v2\n" || devicePub bytes || rN bytes)), see approval.ts. */
  commitment: Nonce32,
});

/** Approval v2: the approver's random rO and its own device key pkO (both go into the number) */
export const ApproverNonceBody = z.strictObject({ nonce: Nonce32, approverPub: DevicePub });
export const RevealBody = z.strictObject({ reveal: Nonce32 });
export const ApproveBody = z.strictObject({ dekId: DekId, sealedDek: SealedDek, mac: Mac });

export const RotateMeta = z
  .strictObject({
    oldDekId: DekId,
    dekId: DekId,
    dekProof: DekProof,
    /** The old DEK's MAC over the new one; devices take the new DEK only with it (K-1). */
    chainMac: Mac,
    /** S2: the devices the user kept; every other row of the account is removed in the same step */
    devices: z
      .array(z.strictObject({ deviceId: Uuid, sealedDek: SealedDek, mac: Mac }))
      .min(1)
      .max(50),
    wrappedDek: b64Blob.optional(),
    recoveryWrappedDek: b64Blob.optional(),
    recoveryProof: DekProof.optional(),
    /** Chain v2: device keys the rotation leaves out (the chain MAC covers them; the devices remember them) */
    removed: z.array(DevicePub).max(50),
    /** "Code only" is on: the new raw DEK, sealed again under ESCROW_KEY (required then, ignored otherwise) */
    escrowDek: b64Exact(32).optional(),
  })
  .refine((b) => b.recoveryWrappedDek === undefined || b.recoveryProof !== undefined, {
    message: "A recovery wrap needs its proof",
    path: ["recoveryProof"],
  });

/** Start fresh (plan 2, 6.3, 6.8): a new DEK for an account whose old one is lost; everything synced goes. */
export const StartFreshBody = z.strictObject({
  dekId: DekId,
  dekProof: DekProof,
  wrappedDek: b64Blob.optional(),
  device: DeviceKeys,
});

// ---------------------------------------------------------------- sign in with a code (4.2.0)

/** A six digit code from the sign-in mail (leading zeros allowed) */
export const SignInCode = z.string().regex(/^[0-9]{6}$/);

export const CodeRequestBody = z.strictObject({ email: Email });

/** Signed like auth/login: challenge from auth/prelogin, the new session's key */
export const CodeLoginBody = z.strictObject({
  email: Email,
  code: SignInCode,
  challenge: Challenge,
  sigKey: SigKeyBody,
});

/** "Code only" on: the raw DEK (32 bytes) and the password again */
export const EscrowBody = z.strictObject({ dek: b64Exact(32), authKey: AuthKey });

/** A new password after a code sign-in; the DEK proof is needed while the session has no device row (like account/password) */
export const AfterCodeBody = z.strictObject({
  authKey: AuthKey,
  salt: Salt,
  kdf: Kdf,
  wrappedDek: b64Blob,
  dekId: DekId,
  dekProof: DekProof.optional(),
});
