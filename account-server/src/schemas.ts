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

export const Kdf = z.strictObject({
  alg: z.literal("argon2id"),
  m: z.number().int().min(19456).max(1048576), // KiB
  t: z.number().int().min(1).max(10),
  p: z.number().int().min(1).max(4),
});

export const Salt = b64Exact(16);
export const AuthKey = b64Exact(32);
export const DevicePub = b64Exact(32);
export const DekId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const DeviceName = z.string().trim().min(1).max(64);
export const Uuid = z.uuid();

export const DeviceKeys = z.strictObject({
  name: DeviceName,
  devicePub: DevicePub,
  sealedDek: b64Blob,
});

export const PreloginBody = z.strictObject({ email: Email });

export const SignupBody = z.strictObject({
  email: Email,
  salt: Salt,
  kdf: Kdf,
  authKey: AuthKey,
  // Present when signing up in the app (plan 6.1); absent for website signups.
  keys: z
    .strictObject({
      wrappedDek: b64Blob,
      dekId: DekId,
      device: DeviceKeys,
    })
    .optional(),
});

export const LoginBody = z.strictObject({
  email: Email,
  authKey: AuthKey,
});

export const KeysBody = z
  .strictObject({
    dekId: DekId,
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
});

// ---------------------------------------------------------------- phase 1b

/** 256-bit one-time token (verify / reset), base64url. */
export const Token = b64Exact(32);
export const Nonce32 = b64Exact(32);
export const SealedDek = b64Blob;

export const TokenBody = z.strictObject({ token: Token });

export const GoogleBody = z.strictObject({
  idToken: z
    .string()
    .min(20)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  nonce: Nonce32,
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
export const ApproveBody = z.strictObject({ dekId: DekId, sealedDek: SealedDek });

export const RotateMeta = z.strictObject({
  oldDekId: DekId,
  dekId: DekId,
  devices: z
    .array(z.strictObject({ deviceId: Uuid, sealedDek: SealedDek }))
    .max(50),
  wrappedDek: b64Blob.optional(),
  recoveryWrappedDek: b64Blob.optional(),
});
