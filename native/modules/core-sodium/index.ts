// geschrieben nach: Muster von modules/core-download/index.ts (lokales Expo-Modul) und der API von libsodium-wrappers; keine eigene Kryptografie
import { NativeModule, requireNativeModule } from "expo"

/*
 * libsodium 1.0.22 on the device (Kotlin + JNI, android/): what crosses the bridge. Bytes go in and out as Uint8Array
 * (Kotlin ByteArray); `null` additional data or key is passed as an empty array (libsodium treats both the same).
 * The app reads it through src/lib/account-sodium.ts, which gives it the shape of the account core's Sodium interface.
 */

declare class SeanimeCoreSodiumModule extends NativeModule {
    /** Argon2 (algorithm 2: Argon2id13); blocks the JS thread for the whole hash */
    crypto_pwhash(keyLength: number, password: Uint8Array, salt: Uint8Array, opsLimit: number, memLimit: number, algorithm: number): Uint8Array
    /** The same off the JS thread */
    crypto_pwhash_async(keyLength: number, password: Uint8Array, salt: Uint8Array, opsLimit: number, memLimit: number, algorithm: number): Promise<Uint8Array>
    /** `context`: exactly 8 bytes */
    crypto_kdf_derive_from_key(subkeyLength: number, subkeyId: number, context: Uint8Array, key: Uint8Array): Uint8Array
    crypto_aead_xchacha20poly1305_ietf_encrypt(message: Uint8Array, additionalData: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array
    /** Throws when the ciphertext does not open */
    crypto_aead_xchacha20poly1305_ietf_decrypt(ciphertext: Uint8Array, additionalData: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array
    /** publicKey (32 bytes) followed by privateKey (32 bytes) */
    crypto_box_keypair(): Uint8Array
    /** publicKey (32 bytes) followed by privateKey (32 bytes) */
    crypto_box_seed_keypair(seed: Uint8Array): Uint8Array
    crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array
    /** Throws when the ciphertext does not open */
    crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array
    crypto_hash_sha256(message: Uint8Array): Uint8Array
    /** BLAKE2b; an empty key: no key */
    crypto_generichash(hashLength: number, message: Uint8Array, key: Uint8Array): Uint8Array
    randombytes_buf(length: number): Uint8Array
    /** Wipes this array itself */
    memzero(bytes: Uint8Array): void
    to_base64(input: Uint8Array, variant: number): string
    /** Throws on text that is not base64 of this variant */
    from_base64(input: string, variant: number): Uint8Array
}

export default requireNativeModule<SeanimeCoreSodiumModule>("SeanimeCoreSodium")
