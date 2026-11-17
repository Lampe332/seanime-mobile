// geschrieben nach: der libsodium-Doku (doc.libsodium.org: Password hashing, Key derivation, XChaCha20-Poly1305-IETF, Sealed boxes, Generic hashing, SHA-2, Helpers) und der JNI-Spezifikation; keine eigene Kryptografie

/*
 * The JNI side of SodiumNative (CoreSodiumModule.kt). Every function checks the lengths libsodium expects (libsodium
 * itself trusts its buffers) and then calls exactly one libsodium function. A failed check throws
 * IllegalArgumentException; a failed verification (decrypt, seal open, base64) returns null.
 */

#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include <sodium.h>

typedef struct {
    jbyteArray array;
    jbyte *bytes;
    size_t length;
} Bytes;

static int throwing(JNIEnv *env, const char *type, const char *message) {
    jclass error = (*env)->FindClass(env, type);
    if (error) (*env)->ThrowNew(env, error, message);
    return 0;
}

#define BAD_ARGUMENT(message) throwing(env, "java/lang/IllegalArgumentException", message)

static int take(JNIEnv *env, jbyteArray array, Bytes *out) {
    out->array = array;
    out->bytes = NULL;
    out->length = 0;
    if (!array) return BAD_ARGUMENT("missing bytes");
    out->length = (size_t) (*env)->GetArrayLength(env, array);
    // empty: no pointer (libsodium reads nothing when the length is 0)
    if (out->length == 0) return 1;
    out->bytes = (*env)->GetByteArrayElements(env, array, NULL);
    return out->bytes != NULL;
}

static void give_back(JNIEnv *env, Bytes *bytes) {
    if (bytes->bytes) (*env)->ReleaseByteArrayElements(env, bytes->array, bytes->bytes, JNI_ABORT);
    bytes->bytes = NULL;
}

#define U(held) ((const unsigned char *) (held).bytes)

static unsigned char *room(JNIEnv *env, size_t length) {
    unsigned char *buffer = malloc(length ? length : 1);
    if (!buffer) throwing(env, "java/lang/OutOfMemoryError", "core-sodium");
    return buffer;
}

/** A new byte[] with the first `length` bytes of `buffer`; the buffer is wiped and freed */
static jbyteArray hand_over(JNIEnv *env, unsigned char *buffer, size_t length) {
    jbyteArray array = (*env)->NewByteArray(env, (jsize) length);
    if (array) (*env)->SetByteArrayRegion(env, array, 0, (jsize) length, (const jbyte *) buffer);
    sodium_memzero(buffer, length);
    free(buffer);
    return array;
}

static void drop(unsigned char *buffer, size_t length) {
    sodium_memzero(buffer, length);
    free(buffer);
}

static int base64_variant(int variant) {
    return variant == sodium_base64_VARIANT_ORIGINAL || variant == sodium_base64_VARIANT_ORIGINAL_NO_PADDING ||
           variant == sodium_base64_VARIANT_URLSAFE || variant == sodium_base64_VARIANT_URLSAFE_NO_PADDING;
}

#define NATIVE(type, name) JNIEXPORT type JNICALL Java_com_seanime_coresodium_SodiumNative_##name

NATIVE(jint, sodiumInit)(JNIEnv *env, jobject self) {
    (void) env; (void) self;
    return sodium_init();
}

NATIVE(jbyteArray, pwhash)(JNIEnv *env, jobject self, jint keyLength, jbyteArray password, jbyteArray salt, jlong opsLimit, jlong memLimit, jint algorithm) {
    (void) self;
    if (keyLength < (jint) crypto_pwhash_BYTES_MIN) { BAD_ARGUMENT("invalid key length"); return NULL; }
    if (algorithm != crypto_pwhash_ALG_ARGON2ID13 && algorithm != crypto_pwhash_ALG_ARGON2I13) { BAD_ARGUMENT("invalid algorithm"); return NULL; }
    if (opsLimit < 0 || memLimit < 0 || (unsigned long long) memLimit > (unsigned long long) SIZE_MAX) { BAD_ARGUMENT("invalid limits"); return NULL; }
    Bytes p = {0}, s = {0};
    jbyteArray result = NULL;
    if (take(env, password, &p) && take(env, salt, &s)) {
        if (s.length != crypto_pwhash_SALTBYTES) BAD_ARGUMENT("invalid salt length");
        else {
            unsigned char *key = room(env, (size_t) keyLength);
            if (key) {
                if (crypto_pwhash(key, (unsigned long long) keyLength, (const char *) p.bytes, p.length, U(s),
                                  (unsigned long long) opsLimit, (size_t) memLimit, algorithm) == 0) {
                    result = hand_over(env, key, (size_t) keyLength);
                } else {
                    drop(key, (size_t) keyLength);
                    throwing(env, "java/lang/IllegalStateException", "crypto_pwhash failed (limits out of range or out of memory)");
                }
            }
        }
    }
    give_back(env, &p);
    give_back(env, &s);
    return result;
}

NATIVE(jbyteArray, kdfDeriveFromKey)(JNIEnv *env, jobject self, jint subkeyLength, jlong subkeyId, jbyteArray context, jbyteArray key) {
    (void) self;
    if (subkeyLength < (jint) crypto_kdf_BYTES_MIN || subkeyLength > (jint) crypto_kdf_BYTES_MAX) { BAD_ARGUMENT("invalid subkey length"); return NULL; }
    Bytes c = {0}, k = {0};
    jbyteArray result = NULL;
    if (take(env, context, &c) && take(env, key, &k)) {
        if (c.length != crypto_kdf_CONTEXTBYTES) BAD_ARGUMENT("invalid context length");
        else if (k.length != crypto_kdf_KEYBYTES) BAD_ARGUMENT("invalid key length");
        else {
            unsigned char *subkey = room(env, (size_t) subkeyLength);
            if (subkey) {
                if (crypto_kdf_derive_from_key(subkey, (size_t) subkeyLength, (uint64_t) subkeyId, (const char *) c.bytes, U(k)) == 0) {
                    result = hand_over(env, subkey, (size_t) subkeyLength);
                } else {
                    drop(subkey, (size_t) subkeyLength);
                    BAD_ARGUMENT("crypto_kdf_derive_from_key failed");
                }
            }
        }
    }
    give_back(env, &c);
    give_back(env, &k);
    return result;
}

NATIVE(jbyteArray, aeadEncrypt)(JNIEnv *env, jobject self, jbyteArray message, jbyteArray additionalData, jbyteArray nonce, jbyteArray key) {
    (void) self;
    Bytes m = {0}, a = {0}, n = {0}, k = {0};
    jbyteArray result = NULL;
    if (take(env, message, &m) && take(env, additionalData, &a) && take(env, nonce, &n) && take(env, key, &k)) {
        if (n.length != crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) BAD_ARGUMENT("invalid nonce length");
        else if (k.length != crypto_aead_xchacha20poly1305_ietf_KEYBYTES) BAD_ARGUMENT("invalid key length");
        else if (m.length > crypto_aead_xchacha20poly1305_ietf_MESSAGEBYTES_MAX || m.length > (size_t) 0x7fffffff - crypto_aead_xchacha20poly1305_ietf_ABYTES) BAD_ARGUMENT("message too long");
        else {
            size_t length = m.length + crypto_aead_xchacha20poly1305_ietf_ABYTES;
            unsigned char *sealed = room(env, length);
            if (sealed) {
                unsigned long long written = 0;
                crypto_aead_xchacha20poly1305_ietf_encrypt(sealed, &written, U(m), m.length, a.length ? U(a) : NULL, a.length, NULL, U(n), U(k));
                result = hand_over(env, sealed, (size_t) written);
            }
        }
    }
    give_back(env, &m);
    give_back(env, &a);
    give_back(env, &n);
    give_back(env, &k);
    return result;
}

NATIVE(jbyteArray, aeadDecrypt)(JNIEnv *env, jobject self, jbyteArray ciphertext, jbyteArray additionalData, jbyteArray nonce, jbyteArray key) {
    (void) self;
    Bytes c = {0}, a = {0}, n = {0}, k = {0};
    jbyteArray result = NULL;
    if (take(env, ciphertext, &c) && take(env, additionalData, &a) && take(env, nonce, &n) && take(env, key, &k)) {
        if (c.length < crypto_aead_xchacha20poly1305_ietf_ABYTES) BAD_ARGUMENT("ciphertext is too short");
        else if (n.length != crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) BAD_ARGUMENT("invalid nonce length");
        else if (k.length != crypto_aead_xchacha20poly1305_ietf_KEYBYTES) BAD_ARGUMENT("invalid key length");
        else {
            size_t length = c.length - crypto_aead_xchacha20poly1305_ietf_ABYTES;
            unsigned char *plain = room(env, length);
            if (plain) {
                unsigned long long written = 0;
                if (crypto_aead_xchacha20poly1305_ietf_decrypt(plain, &written, NULL, U(c), c.length, a.length ? U(a) : NULL, a.length, U(n), U(k)) == 0) {
                    result = hand_over(env, plain, (size_t) written);
                } else {
                    drop(plain, length);
                }
            }
        }
    }
    give_back(env, &c);
    give_back(env, &a);
    give_back(env, &n);
    give_back(env, &k);
    return result;
}

/** publicKey || privateKey */
NATIVE(jbyteArray, boxKeypair)(JNIEnv *env, jobject self) {
    (void) self;
    unsigned char *pair = room(env, crypto_box_PUBLICKEYBYTES + crypto_box_SECRETKEYBYTES);
    if (!pair) return NULL;
    crypto_box_keypair(pair, pair + crypto_box_PUBLICKEYBYTES);
    return hand_over(env, pair, crypto_box_PUBLICKEYBYTES + crypto_box_SECRETKEYBYTES);
}

/** publicKey || privateKey */
NATIVE(jbyteArray, boxSeedKeypair)(JNIEnv *env, jobject self, jbyteArray seed) {
    (void) self;
    Bytes s = {0};
    jbyteArray result = NULL;
    if (take(env, seed, &s)) {
        if (s.length != crypto_box_SEEDBYTES) BAD_ARGUMENT("invalid seed length");
        else {
            unsigned char *pair = room(env, crypto_box_PUBLICKEYBYTES + crypto_box_SECRETKEYBYTES);
            if (pair) {
                crypto_box_seed_keypair(pair, pair + crypto_box_PUBLICKEYBYTES, U(s));
                result = hand_over(env, pair, crypto_box_PUBLICKEYBYTES + crypto_box_SECRETKEYBYTES);
            }
        }
    }
    give_back(env, &s);
    return result;
}

NATIVE(jbyteArray, boxSeal)(JNIEnv *env, jobject self, jbyteArray message, jbyteArray publicKey) {
    (void) self;
    Bytes m = {0}, pk = {0};
    jbyteArray result = NULL;
    if (take(env, message, &m) && take(env, publicKey, &pk)) {
        if (pk.length != crypto_box_PUBLICKEYBYTES) BAD_ARGUMENT("invalid publicKey length");
        else if (m.length > (size_t) 0x7fffffff - crypto_box_SEALBYTES) BAD_ARGUMENT("message too long");
        else {
            size_t length = m.length + crypto_box_SEALBYTES;
            unsigned char *sealed = room(env, length);
            if (sealed) {
                if (crypto_box_seal(sealed, U(m), m.length, U(pk)) == 0) {
                    result = hand_over(env, sealed, length);
                } else {
                    drop(sealed, length);
                    BAD_ARGUMENT("crypto_box_seal failed");
                }
            }
        }
    }
    give_back(env, &m);
    give_back(env, &pk);
    return result;
}

NATIVE(jbyteArray, boxSealOpen)(JNIEnv *env, jobject self, jbyteArray ciphertext, jbyteArray publicKey, jbyteArray privateKey) {
    (void) self;
    Bytes c = {0}, pk = {0}, sk = {0};
    jbyteArray result = NULL;
    if (take(env, ciphertext, &c) && take(env, publicKey, &pk) && take(env, privateKey, &sk)) {
        if (c.length < crypto_box_SEALBYTES) BAD_ARGUMENT("ciphertext is too short");
        else if (pk.length != crypto_box_PUBLICKEYBYTES) BAD_ARGUMENT("invalid publicKey length");
        else if (sk.length != crypto_box_SECRETKEYBYTES) BAD_ARGUMENT("invalid privateKey length");
        else {
            size_t length = c.length - crypto_box_SEALBYTES;
            unsigned char *plain = room(env, length);
            if (plain) {
                if (crypto_box_seal_open(plain, U(c), c.length, U(pk), U(sk)) == 0) {
                    result = hand_over(env, plain, length);
                } else {
                    drop(plain, length);
                }
            }
        }
    }
    give_back(env, &c);
    give_back(env, &pk);
    give_back(env, &sk);
    return result;
}

NATIVE(jbyteArray, hashSha256)(JNIEnv *env, jobject self, jbyteArray message) {
    (void) self;
    Bytes m = {0};
    jbyteArray result = NULL;
    if (take(env, message, &m)) {
        unsigned char *hash = room(env, crypto_hash_sha256_BYTES);
        if (hash) {
            crypto_hash_sha256(hash, U(m), m.length);
            result = hand_over(env, hash, crypto_hash_sha256_BYTES);
        }
    }
    give_back(env, &m);
    return result;
}

/** Ed25519: publicKey (32 bytes) || privateKey (64 bytes, seed || publicKey) */
NATIVE(jbyteArray, signKeypair)(JNIEnv *env, jobject self) {
    (void) self;
    unsigned char *pair = room(env, crypto_sign_PUBLICKEYBYTES + crypto_sign_SECRETKEYBYTES);
    if (!pair) return NULL;
    crypto_sign_keypair(pair, pair + crypto_sign_PUBLICKEYBYTES);
    return hand_over(env, pair, crypto_sign_PUBLICKEYBYTES + crypto_sign_SECRETKEYBYTES);
}

/** Ed25519 signature (64 bytes) of `message` */
NATIVE(jbyteArray, signDetached)(JNIEnv *env, jobject self, jbyteArray message, jbyteArray privateKey) {
    (void) self;
    Bytes m = {0}, sk = {0};
    jbyteArray result = NULL;
    if (take(env, message, &m) && take(env, privateKey, &sk)) {
        if (sk.length != crypto_sign_SECRETKEYBYTES) BAD_ARGUMENT("invalid privateKey length");
        else {
            unsigned char *signature = room(env, crypto_sign_BYTES);
            if (signature) {
                if (crypto_sign_detached(signature, NULL, U(m), m.length, U(sk)) == 0) {
                    result = hand_over(env, signature, crypto_sign_BYTES);
                } else {
                    drop(signature, crypto_sign_BYTES);
                    BAD_ARGUMENT("crypto_sign_detached failed");
                }
            }
        }
    }
    give_back(env, &m);
    give_back(env, &sk);
    return result;
}

/** True when `signature` is the Ed25519 signature of `message` by `publicKey` */
NATIVE(jboolean, signVerifyDetached)(JNIEnv *env, jobject self, jbyteArray signature, jbyteArray message, jbyteArray publicKey) {
    (void) self;
    Bytes s = {0}, m = {0}, pk = {0};
    jboolean result = JNI_FALSE;
    if (take(env, signature, &s) && take(env, message, &m) && take(env, publicKey, &pk)) {
        if (s.length != crypto_sign_BYTES) BAD_ARGUMENT("invalid signature length");
        else if (pk.length != crypto_sign_PUBLICKEYBYTES) BAD_ARGUMENT("invalid publicKey length");
        else result = crypto_sign_verify_detached(U(s), U(m), m.length, U(pk)) == 0 ? JNI_TRUE : JNI_FALSE;
    }
    give_back(env, &s);
    give_back(env, &m);
    give_back(env, &pk);
    return result;
}

/** `key` empty: no key */
NATIVE(jbyteArray, generichash)(JNIEnv *env, jobject self, jint hashLength, jbyteArray message, jbyteArray key) {
    (void) self;
    if (hashLength < (jint) crypto_generichash_BYTES_MIN || hashLength > (jint) crypto_generichash_BYTES_MAX) { BAD_ARGUMENT("invalid hash length"); return NULL; }
    Bytes m = {0}, k = {0};
    jbyteArray result = NULL;
    if (take(env, message, &m) && take(env, key, &k)) {
        if (k.length != 0 && (k.length < crypto_generichash_KEYBYTES_MIN || k.length > crypto_generichash_KEYBYTES_MAX)) BAD_ARGUMENT("invalid key length");
        else {
            unsigned char *hash = room(env, (size_t) hashLength);
            if (hash) {
                if (crypto_generichash(hash, (size_t) hashLength, U(m), m.length, k.length ? U(k) : NULL, k.length) == 0) {
                    result = hand_over(env, hash, (size_t) hashLength);
                } else {
                    drop(hash, (size_t) hashLength);
                    BAD_ARGUMENT("crypto_generichash failed");
                }
            }
        }
    }
    give_back(env, &m);
    give_back(env, &k);
    return result;
}

NATIVE(jbyteArray, randombytesBuf)(JNIEnv *env, jobject self, jint length) {
    (void) self;
    if (length < 0) { BAD_ARGUMENT("invalid length"); return NULL; }
    unsigned char *buffer = room(env, (size_t) length);
    if (!buffer) return NULL;
    randombytes_buf(buffer, (size_t) length);
    return hand_over(env, buffer, (size_t) length);
}

/** Wipes the memory behind a direct buffer (the JavaScript Uint8Array itself) */
NATIVE(void, memzero)(JNIEnv *env, jobject self, jobject buffer) {
    (void) self;
    void *address = (*env)->GetDirectBufferAddress(env, buffer);
    jlong capacity = (*env)->GetDirectBufferCapacity(env, buffer);
    if (!address || capacity < 0) { BAD_ARGUMENT("not a direct buffer"); return; }
    sodium_memzero(address, (size_t) capacity);
}

NATIVE(jstring, toBase64)(JNIEnv *env, jobject self, jbyteArray input, jint variant) {
    (void) self;
    if (!base64_variant(variant)) { BAD_ARGUMENT("unsupported base64 variant"); return NULL; }
    Bytes b = {0};
    jstring result = NULL;
    if (take(env, input, &b)) {
        size_t length = sodium_base64_ENCODED_LEN(b.length, variant);
        char *text = (char *) room(env, length);
        if (text) {
            sodium_bin2base64(text, length, U(b), b.length, variant);
            result = (*env)->NewStringUTF(env, text);
            free(text);
        }
    }
    give_back(env, &b);
    return result;
}

/** null: not valid base64 of this variant (also when not all of it was read) */
NATIVE(jbyteArray, fromBase64)(JNIEnv *env, jobject self, jstring input, jint variant) {
    (void) self;
    if (!base64_variant(variant)) { BAD_ARGUMENT("unsupported base64 variant"); return NULL; }
    if (!input) { BAD_ARGUMENT("missing text"); return NULL; }
    const char *text = (*env)->GetStringUTFChars(env, input, NULL);
    if (!text) return NULL;
    size_t length = strlen(text);
    jbyteArray result = NULL;
    unsigned char *bytes = room(env, length);
    if (bytes) {
        size_t written = 0;
        const char *end = NULL;
        if (sodium_base642bin(bytes, length, text, length, NULL, &written, &end, variant) == 0 && end == text + length) {
            result = hand_over(env, bytes, written);
        } else {
            drop(bytes, length);
        }
    }
    (*env)->ReleaseStringUTFChars(env, input, text);
    return result;
}
