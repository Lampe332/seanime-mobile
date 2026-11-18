// geschrieben nach: Expo Modules API (Kotlin: Module, Function, AsyncFunction, ByteArray <-> Uint8Array, typedarray.Uint8Array) und der libsodium-Doku; Muster: modules/core-download; keine eigene Kryptografie
// Keystore-Teil nach: Android-Doku KeyGenParameterSpec (setIsStrongBoxBacked, StrongBoxUnavailableException), KeyInfo.getSecurityLevel, Signature "SHA256withECDSA" (DER, RFC 3279 Ecdsa-Sig-Value)
package com.seanime.coresodium

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
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
    @JvmStatic external fun signKeypair(): ByteArray
    @JvmStatic external fun signDetached(message: ByteArray, privateKey: ByteArray): ByteArray
    @JvmStatic external fun signVerifyDetached(signature: ByteArray, message: ByteArray, publicKey: ByteArray): Boolean
    @JvmStatic external fun generichash(hashLength: Int, message: ByteArray, key: ByteArray): ByteArray
    @JvmStatic external fun randombytesBuf(length: Int): ByteArray
    @JvmStatic external fun memzero(buffer: java.nio.ByteBuffer)
    @JvmStatic external fun toBase64(input: ByteArray, variant: Int): String
    @JvmStatic external fun fromBase64(input: String, variant: Int): ByteArray?
}

/**
 * The account's request signing key (N-8): ECDSA P-256 made inside the Android Keystore, never exportable, in StrongBox
 * when the device has one, else in the TEE. The app only ever sees the public key and signatures. The server
 * (account-server/src/signature.ts, sig_alg "p256") verifies with WebCrypto, which takes the raw IEEE P1363 form r || s,
 * so the DER signature of the Keystore is unpacked into two 32-byte numbers here; the public key goes out as the
 * uncompressed point 04 || x || y (65 bytes).
 */
object KeystoreSigner {
    private const val PROVIDER = "AndroidKeyStore"
    private const val COORDINATE = 32

    private fun store(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun generate(alias: String, strongBox: Boolean): ECPublicKey {
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
        generator.initialize(spec.build())
        return generator.generateKeyPair().public as ECPublicKey
    }

    /** A new key under `alias` (an old one is replaced); StrongBox first, the TEE when the device has no StrongBox */
    fun create(alias: String): ByteArray {
        delete(alias)
        val made = try {
            generate(alias, strongBox = true)
        } catch (error: Exception) {
            // StrongBoxUnavailableException (API 28+) or a StrongBox that refuses the key: the TEE instead
            delete(alias)
            generate(alias, strongBox = false)
        }
        return rawPoint(made)
    }

    fun publicKey(alias: String): ByteArray? {
        val certificate = store().getCertificate(alias) ?: return null
        return rawPoint(certificate.publicKey as ECPublicKey)
    }

    fun sign(alias: String, message: ByteArray): ByteArray {
        val key = store().getKey(alias, null) as? PrivateKey ?: throw IllegalStateException("no signing key")
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(key)
        signer.update(message)
        return derToRaw(signer.sign())
    }

    /** "strongbox", "tee", "software" or "unknown": where the Keystore keeps the key (the self-test shows it) */
    fun securityLevel(alias: String): String {
        val key = store().getKey(alias, null) as? PrivateKey ?: return "none"
        val info = KeyFactory.getInstance(key.algorithm, PROVIDER).getKeySpec(key, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return when (info.securityLevel) {
                KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
                KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
                KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
                else -> "unknown"
            }
        }
        @Suppress("DEPRECATION")
        return if (info.isInsideSecureHardware) "tee" else "software"
    }

    fun delete(alias: String) {
        val keys = store()
        if (keys.containsAlias(alias)) keys.deleteEntry(alias)
    }

    /** An unsigned number as exactly 32 bytes, left-padded */
    private fun fixed(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        val start = if (bytes.size > COORDINATE) bytes.size - COORDINATE else 0
        require(bytes.copyOfRange(0, start).all { it == 0.toByte() }) { "number too large" }
        val out = ByteArray(COORDINATE)
        System.arraycopy(bytes, start, out, COORDINATE - (bytes.size - start), bytes.size - start)
        return out
    }

    private fun rawPoint(key: ECPublicKey): ByteArray = byteArrayOf(4) + fixed(key.w.affineX) + fixed(key.w.affineY)

    /**
     * Self-test only: checks a raw r || s signature against an uncompressed point with the platform's ECDSA (outside the
     * Keystore), so the conversion to the server's format is checked on the device.
     */
    fun verify(point: ByteArray, message: ByteArray, raw: ByteArray): Boolean {
        require(point.size == 1 + 2 * COORDINATE && point[0] == 4.toByte() && raw.size == 2 * COORDINATE) { "bad sizes" }
        val parameters = java.security.AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(java.security.spec.ECParameterSpec::class.java)
        val w = java.security.spec.ECPoint(BigInteger(1, point.copyOfRange(1, 33)), BigInteger(1, point.copyOfRange(33, 65)))
        val key = KeyFactory.getInstance("EC").generatePublic(java.security.spec.ECPublicKeySpec(w, parameters))
        fun integer(bytes: ByteArray): ByteArray {
            val value = BigInteger(1, bytes).toByteArray()
            return byteArrayOf(0x02, value.size.toByte()) + value
        }
        val body = integer(raw.copyOfRange(0, COORDINATE)) + integer(raw.copyOfRange(COORDINATE, 2 * COORDINATE))
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(key)
        verifier.update(message)
        return verifier.verify(byteArrayOf(0x30, body.size.toByte()) + body)
    }

    /** SEQUENCE { INTEGER r, INTEGER s } (short lengths: a P-256 signature is at most 72 bytes) -> r || s */
    fun derToRaw(der: ByteArray): ByteArray {
        var i = 0
        fun next(): Int = (der.getOrNull(i++) ?: throw IllegalArgumentException("short signature")).toInt() and 0xff
        require(next() == 0x30) { "not a sequence" }
        val length = next()
        require(length < 0x80 && length == der.size - 2) { "bad sequence length" }
        fun integer(): ByteArray {
            require(next() == 0x02) { "not an integer" }
            val size = next()
            require(size in 1..COORDINATE + 1 && i + size <= der.size) { "bad integer length" }
            val value = BigInteger(1, der.copyOfRange(i, i + size))
            i += size
            return fixed(value)
        }
        val r = integer()
        val s = integer()
        require(i == der.size) { "trailing bytes" }
        return r + s
    }
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
        Function("crypto_sign_keypair") { SodiumNative.signKeypair() }
        Function("crypto_sign_detached") { message: ByteArray, privateKey: ByteArray ->
            wiping(privateKey) { SodiumNative.signDetached(message, privateKey) }
        }
        Function("crypto_sign_verify_detached") { signature: ByteArray, message: ByteArray, publicKey: ByteArray ->
            SodiumNative.signVerifyDetached(signature, message, publicKey)
        }
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

        // Request signing key in the Android Keystore (N-8). Making a key and signing can take a moment in StrongBox,
        // so both run on the module's background queue.
        AsyncFunction("keystore_p256_create") { alias: String -> KeystoreSigner.create(alias) }
        Function("keystore_p256_public") { alias: String -> KeystoreSigner.publicKey(alias) }
        AsyncFunction("keystore_p256_sign") { alias: String, message: ByteArray -> KeystoreSigner.sign(alias, message) }
        Function("keystore_security_level") { alias: String -> KeystoreSigner.securityLevel(alias) }
        Function("keystore_delete") { alias: String -> KeystoreSigner.delete(alias) }
        Function("p256_verify") { point: ByteArray, message: ByteArray, signature: ByteArray -> KeystoreSigner.verify(point, message, signature) }
    }
}
