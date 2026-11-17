// geschrieben nach: Expo Modules API (Kotlin: Module, Function, AsyncFunction, ByteArray <-> Uint8Array, typedarray.Uint8Array) und der libsodium-Doku; Muster: modules/core-download; keine eigene Kryptografie
package com.seanime.coresodium

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array

/** libsodium 1.0.22 (android/libsodium.cmake) through JNI (src/main/cpp/sodium-jni.c): one libsodium call per function */
object SodiumNative {
    init {
        System.loadLibrary("seanime-core-sodium")
        check(sodiumInit() >= 0) { "sodium_init failed" }
    }

    @JvmStatic private external fun sodiumInit(): Int
    @JvmStatic external fun pwhash(keyLength: Int, password: ByteArray, salt: ByteArray, opsLimit: Long, memLimit: Long, algorithm: Int): ByteArray
    @JvmStatic external fun kdfDeriveFromKey(subkeyLength: Int, subkeyId: Long, context: ByteArray, key: ByteArray): ByteArray
    @JvmStatic external fun aeadEncrypt(message: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray): ByteArray
    @JvmStatic external fun aeadDecrypt(ciphertext: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray): ByteArray?
    @JvmStatic external fun boxKeypair(): ByteArray
    @JvmStatic external fun boxSeedKeypair(seed: ByteArray): ByteArray
    @JvmStatic external fun boxSeal(message: ByteArray, publicKey: ByteArray): ByteArray
    @JvmStatic external fun boxSealOpen(ciphertext: ByteArray, publicKey: ByteArray, privateKey: ByteArray): ByteArray?
    @JvmStatic external fun hashSha256(message: ByteArray): ByteArray
    @JvmStatic external fun generichash(hashLength: Int, message: ByteArray, key: ByteArray): ByteArray
    @JvmStatic external fun randombytesBuf(length: Int): ByteArray
    @JvmStatic external fun memzero(buffer: java.nio.ByteBuffer)
    @JvmStatic external fun toBase64(input: ByteArray, variant: Int): String
    @JvmStatic external fun fromBase64(input: String, variant: Int): ByteArray?
}

/** Wipes the copies the bridge made of secret inputs once the call is done */
private inline fun <T> wiping(vararg secrets: ByteArray, block: () -> T): T =
    try { block() } finally { secrets.forEach { it.fill(0) } }

class CoreSodiumModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("SeanimeCoreSodium")

        // Argon2id with 64 MiB takes about a second: the sync form blocks the JS thread for that long, the async form
        // runs on the module's background queue
        Function("crypto_pwhash") { keyLength: Int, password: ByteArray, salt: ByteArray, opsLimit: Long, memLimit: Long, algorithm: Int ->
            wiping(password) { SodiumNative.pwhash(keyLength, password, salt, opsLimit, memLimit, algorithm) }
        }
        AsyncFunction("crypto_pwhash_async") { keyLength: Int, password: ByteArray, salt: ByteArray, opsLimit: Long, memLimit: Long, algorithm: Int ->
            wiping(password) { SodiumNative.pwhash(keyLength, password, salt, opsLimit, memLimit, algorithm) }
        }
        Function("crypto_kdf_derive_from_key") { subkeyLength: Int, subkeyId: Long, context: ByteArray, key: ByteArray ->
            wiping(key) { SodiumNative.kdfDeriveFromKey(subkeyLength, subkeyId, context, key) }
        }
        Function("crypto_aead_xchacha20poly1305_ietf_encrypt") { message: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray ->
            wiping(message, key) { SodiumNative.aeadEncrypt(message, additionalData, nonce, key) }
        }
        Function("crypto_aead_xchacha20poly1305_ietf_decrypt") { ciphertext: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray ->
            wiping(key) { SodiumNative.aeadDecrypt(ciphertext, additionalData, nonce, key) }
                ?: throw IllegalArgumentException("ciphertext cannot be decrypted using that key")
        }
        Function("crypto_box_keypair") { SodiumNative.boxKeypair() }
        Function("crypto_box_seed_keypair") { seed: ByteArray -> wiping(seed) { SodiumNative.boxSeedKeypair(seed) } }
        Function("crypto_box_seal") { message: ByteArray, publicKey: ByteArray ->
            wiping(message) { SodiumNative.boxSeal(message, publicKey) }
        }
        Function("crypto_box_seal_open") { ciphertext: ByteArray, publicKey: ByteArray, privateKey: ByteArray ->
            wiping(privateKey) { SodiumNative.boxSealOpen(ciphertext, publicKey, privateKey) }
                ?: throw IllegalArgumentException("incorrect key pair for the given ciphertext")
        }
        Function("crypto_hash_sha256") { message: ByteArray -> SodiumNative.hashSha256(message) }
        Function("crypto_generichash") { hashLength: Int, message: ByteArray, key: ByteArray ->
            wiping(key) { SodiumNative.generichash(hashLength, message, key) }
        }
        Function("randombytes_buf") { length: Int -> SodiumNative.randombytesBuf(length) }
        // the JavaScript array itself, not a copy
        Function("memzero") { bytes: Uint8Array -> SodiumNative.memzero(bytes.toDirectBuffer()) }
        Function("to_base64") { input: ByteArray, variant: Int -> SodiumNative.toBase64(input, variant) }
        Function("from_base64") { input: String, variant: Int ->
            SodiumNative.fromBase64(input, variant) ?: throw IllegalArgumentException("invalid input")
        }
    }
}
