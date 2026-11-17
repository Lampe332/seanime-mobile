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
