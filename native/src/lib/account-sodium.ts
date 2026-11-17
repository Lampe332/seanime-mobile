// geschrieben nach: core/account/sodium.ts (Schnittstelle) und der API von libsodium-wrappers (Typen @types/libsodium-wrappers-sumo: Kontext mit Null-Byte, Standard-Base64 URLSAFE_NO_PADDING); keine eigene Kryptografie
import type { Sodium, SodiumKeyPair } from "@/core/account/sodium"
import native from "../../modules/core-sodium"

/*
 * The account core's Sodium on the device: libsodium 1.0.22 in the module modules/core-sodium. Only the shape of
 * libsodium-wrappers is made here (strings to UTF-8, null to an empty array, the 8-byte KDF context); every value comes
 * from one libsodium call.
 */

const ARGON2ID13 = 2
const BASE64 = { ORIGINAL: 1, ORIGINAL_NO_PADDING: 3, URLSAFE: 5, URLSAFE_NO_PADDING: 7 } as const
const KDF_CONTEXT_BYTES = 8
const NONE = new Uint8Array(0)

const utf8 = (text: string) => new TextEncoder().encode(text)
const textOrBytes = (value: string | Uint8Array) => typeof value === "string" ? utf8(value) : value

/** libsodium-wrappers passes the context with its terminating zero byte and libsodium reads its first 8 bytes */
function kdfContext(context: string): Uint8Array {
    const bytes = utf8(context + "\0")
    if (bytes.length < KDF_CONTEXT_BYTES) throw new Error(`crypto_kdf_derive_from_key: the context must be at least ${KDF_CONTEXT_BYTES - 1} bytes`)
    return bytes.subarray(0, KDF_CONTEXT_BYTES)
}

function splitPair(pair: Uint8Array, privateBytes = 32): SodiumKeyPair {
    const keys = { publicKey: pair.slice(0, 32), privateKey: pair.slice(32, 32 + privateBytes) }
    native.memzero(pair)
    return keys
}

export type DeviceSodium = Sodium & {
    /** crypto_pwhash off the JS thread (about a second for Argon2id with 64 MiB) */
    crypto_pwhash_async(keyLength: number, password: string | Uint8Array, salt: Uint8Array, opsLimit: number, memLimit: number, algorithm: number): Promise<Uint8Array>
    crypto_box_seed_keypair(seed: Uint8Array): SodiumKeyPair
}

export const accountSodium: DeviceSodium = {
    crypto_pwhash: (keyLength, password, salt, opsLimit, memLimit, algorithm) =>
        native.crypto_pwhash(keyLength, textOrBytes(password), salt, opsLimit, memLimit, algorithm),
    crypto_pwhash_async: (keyLength, password, salt, opsLimit, memLimit, algorithm) =>
        native.crypto_pwhash_async(keyLength, textOrBytes(password), salt, opsLimit, memLimit, algorithm),
    crypto_pwhash_ALG_ARGON2ID13: ARGON2ID13,
    crypto_kdf_derive_from_key: (subkeyLength, subkeyId, context, key) =>
        native.crypto_kdf_derive_from_key(subkeyLength, subkeyId, kdfContext(context), key),
    crypto_aead_xchacha20poly1305_ietf_encrypt: (message, additionalData, _secretNonce, publicNonce, key) =>
        native.crypto_aead_xchacha20poly1305_ietf_encrypt(message, additionalData ?? NONE, publicNonce, key),
    crypto_aead_xchacha20poly1305_ietf_decrypt: (_secretNonce, ciphertext, additionalData, publicNonce, key) =>
        native.crypto_aead_xchacha20poly1305_ietf_decrypt(ciphertext, additionalData ?? NONE, publicNonce, key),
    crypto_box_keypair: () => splitPair(native.crypto_box_keypair()),
    crypto_box_seed_keypair: seed => splitPair(native.crypto_box_seed_keypair(seed)),
    crypto_box_seal: (message, publicKey) => native.crypto_box_seal(message, publicKey),
    crypto_box_seal_open: (ciphertext, publicKey, privateKey) => native.crypto_box_seal_open(ciphertext, publicKey, privateKey),
    crypto_generichash: (hashLength, message, key) => native.crypto_generichash(hashLength, message, key ?? NONE),
    crypto_hash_sha256: message => native.crypto_hash_sha256(message),
    crypto_sign_keypair: () => splitPair(native.crypto_sign_keypair(), 64),
    crypto_sign_detached: (message, privateKey) => native.crypto_sign_detached(message, privateKey),
    crypto_sign_verify_detached: (signature, message, publicKey) => native.crypto_sign_verify_detached(signature, message, publicKey),
    randombytes_buf: length => native.randombytes_buf(length),
    memzero: bytes => {
        if (bytes.length > 0) native.memzero(bytes)
    },
    to_base64: (input, variant = BASE64.URLSAFE_NO_PADDING) => native.to_base64(input, variant),
    from_base64: (input, variant = BASE64.URLSAFE_NO_PADDING) => native.from_base64(input, variant),
    base64_variants: BASE64,
}
