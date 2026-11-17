// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5, 6.4, 10) und dem Server-Vertrag in account-server/src (schemas.ts: Base64url ohne Padding, approval.ts: Commitment-Format)

import type { Sodium, SodiumKeyPair } from "./sodium"

/*
 * Every key and every sealed or encrypted value of the account, made only with libsodium calls (sodium.ts).
 * The app injects `react-native-libsodium` (phase 0b); the tests and the website use `libsodium-wrappers-sumo`.
 *
 * Byte formats (fixed; __fixtures__/vectors.json holds vectors for a check on the device and in the browser):
 * - Text is UTF-8; a password is NFKC-normalised first, so the app and the website derive the same key.
 * - masterKey = Argon2id13(password, salt[16], t, m KiB, p = 1), 32 bytes.
 * - authKey = KDF(masterKey, 1, "sm-auth"), encKey = KDF(masterKey, 2, "sm-encr") (crypto_kdf, contexts "sm-auth\0"/"sm-encr\0").
 * - wrap(key, wrappingKey) = nonce[24] || XChaCha20-Poly1305(key), AAD = "sm-wrap-v1" || userId || purpose.
 * - Recovery code: 16 random bytes as 26 characters of RFC 4648 Base32; recoveryKey = BLAKE2b-256("sm-recovery-v1" || bytes).
 * - Sealed DEK: crypto_box_seal(DEK, devicePub).
 * - Package: "SMS" 0x01 || nonce[24] || XChaCha20-Poly1305(gzip(JSON)), AAD = "sm-snap-v1" || userId || version (8 bytes,
 *   big-endian) || dekId.
 * - Commitment = SHA-256(devicePub[32] || rN[32]) (the server's check); SAS = six digits from
 *   SHA-256(devicePub || rN || rO): the first 6 bytes as a 48-bit number, modulo 1 000 000 (bias below 4e-9).
 * Everything that travels is Base64url without padding.
 */

export type Kdf = { alg: "argon2id", m: number, t: number, p: number }

/** The server's default (account-server/src/schemas.ts DEFAULT_KDF): 64 MiB, 3 passes, 1 lane */
export const DEFAULT_KDF: Kdf = { alg: "argon2id", m: 65536, t: 3, p: 1 }

export const AUTH_CONTEXT = "sm-auth"
export const ENC_CONTEXT = "sm-encr"
export type WrapPurpose = "password" | "recovery"

const WRAP_AAD = "sm-wrap-v1"
const SNAP_AAD = "sm-snap-v1"
const RECOVERY_DOMAIN = "sm-recovery-v1"
const PACKAGE_MAGIC = [0x53, 0x4d, 0x53, 0x01] // "SMS" 1
const NONCE_BYTES = 24
const KEY_BYTES = 32
const SALT_BYTES = 16
const RANDOM_BYTES = 32
const RECOVERY_BYTES = 16
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/** A key, wrap, package or code that does not open or does not fit. Never says which byte was wrong. */
export class AccountCryptoError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "AccountCryptoError"
    }
}

const utf8 = (text: string) => new TextEncoder().encode(text)

export function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** Overwrites secrets with zeros once they are no longer needed */
export function wipe(sodium: Sodium, ...secrets: (Uint8Array | null | undefined)[]): void {
    for (const secret of secrets) if (secret) sodium.memzero(secret)
}

export function toB64(sodium: Sodium, bytes: Uint8Array): string {
    return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING)
}

export function fromB64(sodium: Sodium, text: string, length?: number): Uint8Array {
    let bytes: Uint8Array
    try {
        bytes = sodium.from_base64(text, sodium.base64_variants.URLSAFE_NO_PADDING)
    }
    catch {
        throw new AccountCryptoError("invalid base64url value")
    }
    if (length !== undefined && bytes.length !== length) throw new AccountCryptoError("value has the wrong length")
    return bytes
}

export const randomBytes = (sodium: Sodium, length: number) => sodium.randombytes_buf(length)
export const newSalt = (sodium: Sodium) => sodium.randombytes_buf(SALT_BYTES)
export const newDek = (sodium: Sodium) => sodium.randombytes_buf(KEY_BYTES)
/** A DEK's name on the server (DekId: 1–64 Base64url characters): 128 random bits */
export const newDekId = (sodium: Sodium) => toB64(sodium, sodium.randombytes_buf(16))
export const newDeviceKeyPair = (sodium: Sodium): SodiumKeyPair => {
    const { publicKey, privateKey } = sodium.crypto_box_keypair()
    return { publicKey, privateKey }
}

/* ---- Password ---- */

/**
 * authKey (goes to the server) and encKey (never leaves the device) from the password. The master key is wiped.
 * Argon2id runs off the JS thread when the Sodium has crypto_pwhash_async (the device's module), so the screen keeps moving.
 */
export async function deriveKeys(sodium: Sodium, password: string, salt: Uint8Array, kdf: Kdf): Promise<{ authKey: Uint8Array, encKey: Uint8Array }> {
    if (kdf.alg !== "argon2id" || kdf.p !== 1) throw new AccountCryptoError("unsupported key derivation parameters")
    if (salt.length !== SALT_BYTES) throw new AccountCryptoError("salt has the wrong length")
    const secret = utf8(password.normalize("NFKC"))
    let master: Uint8Array
    try {
        master = sodium.crypto_pwhash_async
            ? await sodium.crypto_pwhash_async(KEY_BYTES, secret, salt, kdf.t, kdf.m * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13)
            : sodium.crypto_pwhash(KEY_BYTES, secret, salt, kdf.t, kdf.m * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13)
    }
    catch (error) {
        wipe(sodium, secret)
        throw error
    }
    try {
        return {
            authKey: sodium.crypto_kdf_derive_from_key(KEY_BYTES, 1, AUTH_CONTEXT, master),
            encKey: sodium.crypto_kdf_derive_from_key(KEY_BYTES, 2, ENC_CONTEXT, master),
        }
    }
    finally {
        wipe(sodium, master, secret)
    }
}

/* ---- Wrapping the DEK ---- */

const wrapAad = (userId: string, purpose: WrapPurpose) => utf8(WRAP_AAD + userId + purpose)

export function wrapKey(sodium: Sodium, key: Uint8Array, wrappingKey: Uint8Array, userId: string, purpose: WrapPurpose): string {
    const nonce = sodium.randombytes_buf(NONCE_BYTES)
    const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, wrapAad(userId, purpose), null, nonce, wrappingKey)
    return toB64(sodium, concat(nonce, sealed))
}

export function unwrapKey(sodium: Sodium, wrapped: string, wrappingKey: Uint8Array, userId: string, purpose: WrapPurpose): Uint8Array {
    const bytes = fromB64(sodium, wrapped)
    if (bytes.length <= NONCE_BYTES) throw new AccountCryptoError("the key could not be unlocked")
    try {
        const key = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes.subarray(NONCE_BYTES), wrapAad(userId, purpose), bytes.subarray(0, NONCE_BYTES), wrappingKey)
        if (key.length !== KEY_BYTES) throw new Error("length")
        return key
    }
    catch {
        throw new AccountCryptoError("the key could not be unlocked")
    }
}

/* ---- Device keys ---- */

export function sealDek(sodium: Sodium, dek: Uint8Array, devicePub: Uint8Array): string {
    return toB64(sodium, sodium.crypto_box_seal(dek, devicePub))
}

export function openSealedDek(sodium: Sodium, sealed: string, keys: SodiumKeyPair): Uint8Array {
    try {
        const dek = sodium.crypto_box_seal_open(fromB64(sodium, sealed), keys.publicKey, keys.privateKey)
        if (dek.length !== KEY_BYTES) throw new Error("length")
        return dek
    }
    catch {
        throw new AccountCryptoError("the sealed key could not be opened")
    }
}

/* ---- Recovery code ---- */

function base32(bytes: Uint8Array): string {
    let out = ""
    let buffer = 0
    let bits = 0
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte
        bits += 8
        while (bits >= 5) {
            out += BASE32[(buffer >>> (bits - 5)) & 31]
            bits -= 5
        }
        buffer &= (1 << bits) - 1
    }
    if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31]
    return out
}

/** The code's 16 bytes. Spaces and dashes are ignored, lower case is accepted; anything else is no code. */
export function parseRecoveryCode(code: string): Uint8Array {
    const clean = code.toUpperCase().replace(/[\s-]/g, "")
    if (clean.length !== 26 || ![...clean].every(char => BASE32.includes(char))) throw new AccountCryptoError("this is not a recovery code")
    const out = new Uint8Array(RECOVERY_BYTES)
    let buffer = 0
    let bits = 0
    let index = 0
    for (const char of clean) {
        buffer = (buffer << 5) | BASE32.indexOf(char)
        bits += 5
        if (bits >= 8) {
            out[index++] = (buffer >>> (bits - 8)) & 255
            bits -= 8
        }
        buffer &= (1 << bits) - 1
    }
    // 26 characters carry 130 bits: the last two must be zero
    if (buffer !== 0) throw new AccountCryptoError("this is not a recovery code")
    return out
}

export function recoveryKeyFrom(sodium: Sodium, code: string): Uint8Array {
    const bytes = parseRecoveryCode(code)
    const input = concat(utf8(RECOVERY_DOMAIN), bytes)
    try {
        return sodium.crypto_generichash(KEY_BYTES, input, null)
    }
    finally {
        wipe(sodium, bytes, input)
    }
}

/** A new recovery code (26 characters, 128 bits) and the key it stands for */
export function newRecoveryCode(sodium: Sodium): { code: string, key: Uint8Array } {
    const bytes = sodium.randombytes_buf(RECOVERY_BYTES)
    const code = base32(bytes)
    wipe(sodium, bytes)
    return { code, key: recoveryKeyFrom(sodium, code) }
}

/* ---- The package ---- */

export type PackageBinding = { userId: string, version: number, dekId: string }

function versionBytes(version: number): Uint8Array {
    if (!Number.isSafeInteger(version) || version < 0) throw new AccountCryptoError("invalid snapshot version")
    const out = new Uint8Array(8)
    let rest = version
    for (let i = 7; i >= 0; i--) {
        out[i] = rest % 256
        rest = Math.floor(rest / 256)
    }
    return out
}

const packageAad = ({ userId, version, dekId }: PackageBinding) => concat(utf8(SNAP_AAD + userId), versionBytes(version), utf8(dekId))

export function encryptPackage(sodium: Sodium, plain: Uint8Array, dek: Uint8Array, binding: PackageBinding): Uint8Array {
    const nonce = sodium.randombytes_buf(NONCE_BYTES)
    const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, packageAad(binding), null, nonce, dek)
    return concat(Uint8Array.from(PACKAGE_MAGIC), nonce, sealed)
}

/** Opens a package; it must belong to this account, this version and this DEK, or it does not open */
export function decryptPackage(sodium: Sodium, blob: Uint8Array, dek: Uint8Array, binding: PackageBinding): Uint8Array {
    const head = PACKAGE_MAGIC.length
    if (blob.length <= head + NONCE_BYTES || PACKAGE_MAGIC.some((byte, i) => blob[i] !== byte)) throw new AccountCryptoError("the synced data has an unknown format")
    try {
        return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, blob.subarray(head + NONCE_BYTES), packageAad(binding), blob.subarray(head, head + NONCE_BYTES), dek)
    }
    catch {
        throw new AccountCryptoError("the synced data could not be decrypted (changed, or not for this account)")
    }
}

/* ---- Device approval ---- */

export const newApprovalRandom = (sodium: Sodium) => sodium.randombytes_buf(RANDOM_BYTES)

/** SHA-256(devicePub[32] || rN[32]), the byte format the server checks (account-server/src/approval.ts) */
export function commitment(sodium: Sodium, devicePub: Uint8Array, rN: Uint8Array): Uint8Array {
    if (devicePub.length !== KEY_BYTES || rN.length !== RANDOM_BYTES) throw new AccountCryptoError("approval value has the wrong length")
    return sodium.crypto_hash_sha256(concat(devicePub, rN))
}

export function commitmentMatches(sodium: Sodium, devicePub: Uint8Array, rN: Uint8Array, expected: Uint8Array): boolean {
    const actual = commitment(sodium, devicePub, rN)
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!
    return diff === 0
}

/** The six digits both devices show, as text with leading zeros */
export function sas(sodium: Sodium, devicePub: Uint8Array, rN: Uint8Array, rO: Uint8Array): string {
    if (devicePub.length !== KEY_BYTES || rN.length !== RANDOM_BYTES || rO.length !== RANDOM_BYTES) throw new AccountCryptoError("approval value has the wrong length")
    const hash = sodium.crypto_hash_sha256(concat(devicePub, rN, rO))
    let value = 0
    for (let i = 0; i < 6; i++) value = value * 256 + hash[i]!
    return String(value % 1_000_000).padStart(6, "0")
}
