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
 * - KDF parameters are checked on the device, never trusted from the server: m 65536..262144 KiB, t 3..10, p 1
 *   (a server that lowers them could guess the password offline; session.ts also remembers the highest seen per email).
 * - wrap(key, wrappingKey) = nonce[24] || XChaCha20-Poly1305(key), AAD = "sm-wrap-v2\n" userId "\n" dekId "\n" purpose.
 * - Recovery code: 16 random bytes as 26 characters of RFC 4648 Base32; recoveryKey = BLAKE2b-256("sm-recovery-v1" || bytes).
 * - Boxed DEK (v2, replaces the anonymous crypto_box_seal of v1, NEU-1): nonce[24] || crypto_box_easy("sm-box-v2\n"
 *   context "\n" dekId "\n" || DEK, nonce, recipientPub, senderSecret). The receiver opens it with the SENDER's public
 *   key, so it knows which device made it; context is "approve <b64 transcript>", "rotate <userId>" or "own <userId>".
 * - Keys from the DEK (crypto_kdf, context "sm-dkey\0"): 1 = device MAC key, 2 = DEK proof, 3 = chain MAC key.
 *   deviceMac = BLAKE2b-256(key 1, "sm-device-v1\n" userId "\n" dekId "\n" || devicePub[32]): only a DEK holder can add a
 *   device the others trust. dekProof = key 2 (the server keeps its SHA-256 and lets only a key holder change keys).
 *   chainMac (v2) = BLAKE2b-256(key 3 of the OLD DEK, "sm-chain-v2\n" userId "\n" oldDekId "\n" newDekId "\n"
 *   b64(rotatorPub) "\n" sorted b64 removed device keys joined by "," "\n" || newDEK): a device takes a new DEK only when
 *   the old one vouches for it, the rotating device boxed it and that device is not one it knows as removed (R3).
 * - Package: "SMS" 0x01 || nonce[24] || XChaCha20-Poly1305(gzip(JSON)), AAD = "sm-snap-v1" || userId || version (8 bytes,
 *   big-endian) || dekId.
 * - Approval v2: commitment = SHA-256("sm-commit-v2\n" || pkN[32] || rN[32]) (the server checks it too); transcript =
 *   SHA-256("sm-approve-v2\n" || pkN || pkO || rN || rO); SAS = its first 6 bytes as a 48-bit number, modulo 1 000 000
 *   (bias below 4e-9). Both device keys are in the number, so a server in between changes it (ZRTP principle).
 * Everything that travels is Base64url without padding.
 */

export type Kdf = { alg: "argon2id", m: number, t: number, p: number }

/** The server's default (account-server/src/schemas.ts DEFAULT_KDF): 64 MiB, 3 passes, 1 lane */
export const DEFAULT_KDF: Kdf = { alg: "argon2id", m: 65536, t: 3, p: 1 }

/** What the device accepts from a server: an account's parameters can rise, never fall below these (H-1) */
export const KDF_LIMITS = { minM: 65536, maxM: 262144, minT: 3, maxT: 10 } as const

export const AUTH_CONTEXT = "sm-auth"
export const ENC_CONTEXT = "sm-encr"
export const DEK_CONTEXT = "sm-dkey"
const DEVICE_MAC_SUBKEY = 1
const DEK_PROOF_SUBKEY = 2
const CHAIN_MAC_SUBKEY = 3
export type WrapPurpose = "password" | "recovery"

const WRAP_AAD = "sm-wrap-v2"
const BOX_PREFIX = "sm-box-v2"
const BOX_MAC_BYTES = 16
const DEVICE_MAC_DOMAIN = "sm-device-v1"
const CHAIN_MAC_DOMAIN = "sm-chain-v2"
const COMMIT_DOMAIN = "sm-commit-v2\n"
const APPROVE_DOMAIN = "sm-approve-v2\n"
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

/** The server offered a new DEK that the device's current DEK does not vouch for (start fresh elsewhere, or tampering) */
export class UntrustedKeyChangeError extends AccountCryptoError {
    constructor() {
        super("the account's key changed in a way this device can't confirm")
        this.name = "UntrustedKeyChangeError"
    }
}

/** A key change was asked to keep a device no DEK holder added, one this device knows as removed, or one that signed out */
export class UntrustedDevicesError extends AccountCryptoError {
    constructor(readonly names: string[]) {
        super(`unverified device in the account: ${names.join(", ")}`)
        this.name = "UntrustedDevicesError"
    }
}

/** KDF parameters below the floor, above the ceiling, or lower than this device saw for the account before */
export class UnsafeKdfError extends AccountCryptoError {
    constructor() {
        super("the server asked for weaker password protection than this app allows")
        this.name = "UnsafeKdfError"
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
/** Ed25519 key pair of a new session (plan 10.2b): libsodium crypto_sign_keypair; the private half stays on the device */
export function newSigningKeyPair(sodium: Sodium): SodiumKeyPair {
    const { publicKey, privateKey } = sodium.crypto_sign_keypair()
    return { publicKey, privateKey }
}

export const newDeviceKeyPair = (sodium: Sodium): SodiumKeyPair => {
    const { publicKey, privateKey } = sodium.crypto_box_keypair()
    return { publicKey, privateKey }
}

/* ---- Password ---- */

/**
 * authKey (goes to the server) and encKey (never leaves the device) from the password. The master key is wiped.
 * Argon2id runs off the JS thread when the Sodium has crypto_pwhash_async (the device's module), so the screen keeps moving.
 */
export function checkKdf(kdf: Kdf, floor?: { m: number, t: number } | null): void {
    const ok = kdf?.alg === "argon2id" && kdf.p === 1
        && Number.isSafeInteger(kdf.m) && kdf.m >= KDF_LIMITS.minM && kdf.m <= KDF_LIMITS.maxM
        && Number.isSafeInteger(kdf.t) && kdf.t >= KDF_LIMITS.minT && kdf.t <= KDF_LIMITS.maxT
    if (!ok || (floor && (kdf.m < floor.m || kdf.t < floor.t))) throw new UnsafeKdfError()
}

export async function deriveKeys(sodium: Sodium, password: string, salt: Uint8Array, kdf: Kdf): Promise<{ authKey: Uint8Array, encKey: Uint8Array }> {
    checkKdf(kdf)
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

const lines = (...parts: string[]) => utf8(parts.join("\n"))
const wrapAad = (userId: string, dekId: string, purpose: WrapPurpose) => lines(WRAP_AAD, userId, dekId, purpose)

/** The DEK wrapped for a password or recovery key; bound to account, DEK id and purpose (N-1) */
export function wrapKey(sodium: Sodium, key: Uint8Array, wrappingKey: Uint8Array, userId: string, dekId: string, purpose: WrapPurpose): string {
    const nonce = sodium.randombytes_buf(NONCE_BYTES)
    const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, wrapAad(userId, dekId, purpose), null, nonce, wrappingKey)
    return toB64(sodium, concat(nonce, sealed))
}

export function unwrapKey(sodium: Sodium, wrapped: string, wrappingKey: Uint8Array, userId: string, dekId: string, purpose: WrapPurpose): Uint8Array {
    const bytes = fromB64(sodium, wrapped)
    if (bytes.length <= NONCE_BYTES) throw new AccountCryptoError("the key could not be unlocked")
    try {
        const key = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes.subarray(NONCE_BYTES), wrapAad(userId, dekId, purpose), bytes.subarray(0, NONCE_BYTES), wrappingKey)
        if (key.length !== KEY_BYTES) throw new Error("length")
        return key
    }
    catch {
        throw new AccountCryptoError("the key could not be unlocked")
    }
}

/* ---- Device keys: the DEK boxed from one device to another (v2) ---- */

/** What a boxed DEK is for; it is boxed with it, so a box made for one use never opens as another */
export type BoxContext =
    /** Approval v2: bound to the request's transcript (both device keys and both random values) */
    | { kind: "approve", transcript: Uint8Array }
    /** A rotation: the rotating device to every device of the account */
    | { kind: "rotate", userId: string }
    /** A device's own row (it never opens it; a rotation replaces it) */
    | { kind: "own", userId: string }

function boxHead(sodium: Sodium, context: BoxContext, dekId: string): Uint8Array {
    const what = context.kind === "approve" ? `approve ${toB64(sodium, context.transcript)}` : `${context.kind} ${context.userId}`
    return utf8(`${BOX_PREFIX}\n${what}\n${dekId}\n`)
}

/** The DEK and its id, boxed from `sender` to `recipientPub` (crypto_box_easy: only the sender's key makes it) */
export function boxDek(sodium: Sodium, dek: Uint8Array, dekId: string, context: BoxContext, recipientPub: Uint8Array, sender: SodiumKeyPair): string {
    if (dek.length !== KEY_BYTES || recipientPub.length !== KEY_BYTES) throw new AccountCryptoError("key has the wrong length")
    const nonce = sodium.randombytes_buf(NONCE_BYTES)
    const plain = concat(boxHead(sodium, context, dekId), dek)
    try {
        return toB64(sodium, concat(nonce, sodium.crypto_box_easy(plain, nonce, recipientPub, sender.privateKey)))
    }
    finally {
        wipe(sodium, plain)
    }
}

/**
 * Opens a boxed DEK. It must come from `senderPub` (the device the user confirmed, or the rotating device), carry the
 * expected use and DEK id; anything else, also an anonymous sealed box of v1, does not open.
 */
export function openBoxedDek(sodium: Sodium, boxed: string, dekId: string, context: BoxContext, senderPub: Uint8Array, own: SodiumKeyPair): Uint8Array {
    let plain: Uint8Array | null = null
    try {
        const bytes = fromB64(sodium, boxed)
        if (bytes.length <= NONCE_BYTES + BOX_MAC_BYTES || senderPub.length !== KEY_BYTES) throw new Error("length")
        plain = sodium.crypto_box_open_easy(bytes.subarray(NONCE_BYTES), bytes.subarray(0, NONCE_BYTES), senderPub, own.privateKey)
        const head = boxHead(sodium, context, dekId)
        if (plain.length !== head.length + KEY_BYTES || !equalBytes(plain.subarray(0, head.length), head)) throw new Error("context")
        return plain.slice(head.length)
    }
    catch {
        throw new AccountCryptoError("the key could not be opened")
    }
    finally {
        wipe(sodium, plain)
    }
}

/** Constant-time comparison of two byte strings */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
    return diff === 0
}

/* ---- Keys from the DEK: device list, proof for the server, key chain (K-1) ---- */

function dekSubkey(sodium: Sodium, dek: Uint8Array, id: number): Uint8Array {
    if (dek.length !== KEY_BYTES) throw new AccountCryptoError("the key has the wrong length")
    return sodium.crypto_kdf_derive_from_key(KEY_BYTES, id, DEK_CONTEXT, dek)
}

function keyedHash(sodium: Sodium, key: Uint8Array, message: Uint8Array): Uint8Array {
    try {
        return sodium.crypto_generichash(KEY_BYTES, message, key)
    }
    finally {
        wipe(sodium, key, message)
    }
}

export type DeviceBinding = { userId: string, dekId: string, devicePub: Uint8Array }

function deviceMacBytes(sodium: Sodium, dek: Uint8Array, { userId, dekId, devicePub }: DeviceBinding): Uint8Array {
    if (devicePub.length !== KEY_BYTES) throw new AccountCryptoError("device key has the wrong length")
    return keyedHash(sodium, dekSubkey(sodium, dek, DEVICE_MAC_SUBKEY), concat(lines(DEVICE_MAC_DOMAIN, userId, dekId, ""), devicePub))
}

/** The MAC a DEK holder puts on a device row: the other devices trust (seal to) only rows with a valid one */
export function deviceMac(sodium: Sodium, dek: Uint8Array, binding: DeviceBinding): string {
    return toB64(sodium, deviceMacBytes(sodium, dek, binding))
}

export function deviceMacValid(sodium: Sodium, dek: Uint8Array, binding: DeviceBinding, mac: string | null | undefined): boolean {
    if (!mac) return false
    let given: Uint8Array
    try {
        given = fromB64(sodium, mac, KEY_BYTES)
    }
    catch {
        return false
    }
    return equalBytes(deviceMacBytes(sodium, dek, binding), given)
}

/** Shown to the server to prove this device holds the DEK; the server keeps only its SHA-256 */
export function dekProof(sodium: Sodium, dek: Uint8Array): string {
    const proof = dekSubkey(sodium, dek, DEK_PROOF_SUBKEY)
    try {
        return toB64(sodium, proof)
    }
    finally {
        wipe(sodium, proof)
    }
}

/** Chain v2 (R3): which device rotated and which device keys (base64url) it left out as removed */
export type ChainBinding = { userId: string, oldDekId: string, newDekId: string, rotatorPub: Uint8Array, removed: string[] }

function chainMacBytes(sodium: Sodium, oldDek: Uint8Array, { userId, oldDekId, newDekId, rotatorPub, removed }: ChainBinding, newDek: Uint8Array): Uint8Array {
    if (newDek.length !== KEY_BYTES || rotatorPub.length !== KEY_BYTES) throw new AccountCryptoError("the key has the wrong length")
    const list = [...new Set(removed)].sort().join(",")
    return keyedHash(sodium, dekSubkey(sodium, oldDek, CHAIN_MAC_SUBKEY), concat(lines(CHAIN_MAC_DOMAIN, userId, oldDekId, newDekId, toB64(sodium, rotatorPub), list, ""), newDek))
}

/** The old DEK vouches for the new one (rotation); a device takes a new DEK only with a valid chain MAC */
export function chainMac(sodium: Sodium, oldDek: Uint8Array, binding: ChainBinding, newDek: Uint8Array): string {
    return toB64(sodium, chainMacBytes(sodium, oldDek, binding, newDek))
}

export function chainMacValid(sodium: Sodium, oldDek: Uint8Array, binding: ChainBinding, newDek: Uint8Array, mac: string | null | undefined): boolean {
    if (!mac) return false
    let given: Uint8Array
    try {
        given = fromB64(sodium, mac, KEY_BYTES)
    }
    catch {
        return false
    }
    return equalBytes(chainMacBytes(sodium, oldDek, binding, newDek), given)
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

const RECOVERY_PROOF_CONTEXT = "sm-rcvr"

/**
 * S3: shown to the server to prove the owner has the recovery code (the server keeps only its SHA-256). Unlike the DEK
 * proof a copied DEK can't make it, so it lets a device join the account like the password does.
 */
export function recoveryProof(sodium: Sodium, recoveryKey: Uint8Array): string {
    if (recoveryKey.length !== KEY_BYTES) throw new AccountCryptoError("the key has the wrong length")
    const proof = sodium.crypto_kdf_derive_from_key(KEY_BYTES, 1, RECOVERY_PROOF_CONTEXT, recoveryKey)
    try {
        return toB64(sodium, proof)
    }
    finally {
        wipe(sodium, proof)
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

/* ---- Device approval v2 ---- */

export const newApprovalRandom = (sodium: Sodium) => sodium.randombytes_buf(RANDOM_BYTES)

/** SHA-256("sm-commit-v2\n" || devicePub[32] || rN[32]), the byte format the server checks (account-server/src/approval.ts) */
export function commitment(sodium: Sodium, devicePub: Uint8Array, rN: Uint8Array): Uint8Array {
    if (devicePub.length !== KEY_BYTES || rN.length !== RANDOM_BYTES) throw new AccountCryptoError("approval value has the wrong length")
    return sodium.crypto_hash_sha256(concat(utf8(COMMIT_DOMAIN), devicePub, rN))
}

export function commitmentMatches(sodium: Sodium, devicePub: Uint8Array, rN: Uint8Array, expected: Uint8Array): boolean {
    return equalBytes(commitment(sodium, devicePub, rN), expected)
}

/** SHA-256("sm-approve-v2\n" || pkN || pkO || rN || rO): the number and the boxed DEK are bound to it */
export function approvalTranscript(sodium: Sodium, pkN: Uint8Array, pkO: Uint8Array, rN: Uint8Array, rO: Uint8Array): Uint8Array {
    if (pkN.length !== KEY_BYTES || pkO.length !== KEY_BYTES || rN.length !== RANDOM_BYTES || rO.length !== RANDOM_BYTES) throw new AccountCryptoError("approval value has the wrong length")
    return sodium.crypto_hash_sha256(concat(utf8(APPROVE_DOMAIN), pkN, pkO, rN, rO))
}

/** The six digits both devices show, as text with leading zeros */
export function sasOf(transcript: Uint8Array): string {
    let value = 0
    for (let i = 0; i < 6; i++) value = value * 256 + transcript[i]!
    return String(value % 1_000_000).padStart(6, "0")
}

export function sas(sodium: Sodium, pkN: Uint8Array, pkO: Uint8Array, rN: Uint8Array, rO: Uint8Array): string {
    return sasOf(approvalTranscript(sodium, pkN, pkO, rN, rO))
}
