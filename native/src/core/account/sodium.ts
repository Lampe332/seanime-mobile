// geschrieben nach: Plan „Account + Sync“ (Abschnitte 4, 5) und der API von libsodium-wrappers (Typen @types/libsodium-wrappers-sumo); kein Server-Quelltext

/*
 * The few libsodium calls the account core makes, in the shape of `libsodium-wrappers`. The core never imports a
 * libsodium build itself: the app hands one in (see crypto.ts), the tests hand in libsodium-wrappers-sumo. Nothing here
 * is own cryptography; every function is a libsodium function under its own name.
 */

export type SodiumKeyPair = { publicKey: Uint8Array, privateKey: Uint8Array }

export interface Sodium {
    /** Argon2id13 when `algorithm` is `crypto_pwhash_ALG_ARGON2ID13`; `memLimit` in bytes */
    crypto_pwhash(keyLength: number, password: string | Uint8Array, salt: Uint8Array, opsLimit: number, memLimit: number, algorithm: number): Uint8Array
    readonly crypto_pwhash_ALG_ARGON2ID13: number
    /** `context` is 8 bytes; a 7-character text is padded with its terminating zero byte ("sm-auth" = "sm-auth\0") */
    crypto_kdf_derive_from_key(subkeyLength: number, subkeyId: number, context: string, key: Uint8Array): Uint8Array
    crypto_aead_xchacha20poly1305_ietf_encrypt(message: Uint8Array, additionalData: Uint8Array | null, secretNonce: null, publicNonce: Uint8Array, key: Uint8Array): Uint8Array
    crypto_aead_xchacha20poly1305_ietf_decrypt(secretNonce: null, ciphertext: Uint8Array, additionalData: Uint8Array | null, publicNonce: Uint8Array, key: Uint8Array): Uint8Array
    crypto_box_keypair(): SodiumKeyPair
    crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array
    crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array
    /** BLAKE2b */
    crypto_generichash(hashLength: number, message: Uint8Array, key?: Uint8Array | null): Uint8Array
    /** SHA-256: the server checks the approval commitment with it (account-server/src/approval.ts) */
    crypto_hash_sha256(message: Uint8Array): Uint8Array
    randombytes_buf(length: number): Uint8Array
    memzero(bytes: Uint8Array): void
    to_base64(input: Uint8Array, variant?: number): string
    from_base64(input: string, variant?: number): Uint8Array
    readonly base64_variants: { readonly URLSAFE_NO_PADDING: number }
}
