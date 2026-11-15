// geschrieben nach: goja_plugin_types/core.d.ts (CryptoJS, WordArray, AESConfig, CryptoJSEncoder) und der Doku von crypto-js 4 (AES, Passphrase mit OpenSSL-Schlüsselableitung, Kodierer, Hashes); keine Vorlage

/*
 * CryptoJS as the contract describes it: the encoders take and give bytes (Uint8Array), AES takes a passphrase (a
 * string: crypto-js derives a 256-bit key and the IV, OpenSSL style) or a key of bytes with an IV of bytes, and what
 * comes out has `toString(encoder)`. The work itself is done by crypto-js; this file only turns bytes into its word
 * arrays and back. The hashes of crypto-js (MD5, SHA-1, SHA-256, SHA-512 and their HMAC) come along the same way.
 */

import Core from "crypto-js/core"
import "crypto-js/enc-base64"
import "crypto-js/enc-utf16"
import "crypto-js/md5"
import "crypto-js/sha1"
import "crypto-js/sha256"
import "crypto-js/sha512"
import "crypto-js/hmac"
import "crypto-js/evpkdf"
import "crypto-js/cipher-core"
import "crypto-js/aes"

const Words = Core.lib.WordArray

function wordsOf(bytes) {
    const words = []
    for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8)
    return Words.create(words, bytes.length)
}

function bytesOf(words) {
    const out = new Uint8Array(words.sigBytes)
    for (let i = 0; i < words.sigBytes; i++) out[i] = (words.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    return out
}

/** The contract's WordArray: bytes with toString(encoder), Hex when no encoder is named (as crypto-js) */
class WordArray {
    constructor(words, cipherParams) {
        this.words = words
        this.cipherParams = cipherParams
    }

    get sigBytes() {
        return this.words.sigBytes
    }

    toString(encoder) {
        if (!encoder && this.cipherParams) return this.cipherParams.toString()
        return (encoder ?? enc.Hex).stringify(this)
    }
}

/** Bytes, a WordArray of the contract or one of crypto-js, as words of crypto-js */
function asWords(input) {
    if (input instanceof WordArray) return input.words
    if (input instanceof Uint8Array) return wordsOf(input)
    if (input instanceof ArrayBuffer) return wordsOf(new Uint8Array(input))
    if (input && Array.isArray(input.words) && typeof input.sigBytes === "number") return input
    return Core.enc.Utf8.parse(String(input))
}

function encoder(of) {
    return Object.freeze({
        stringify: input => of.stringify(asWords(input)),
        parse: text => bytesOf(of.parse(String(text))),
    })
}

const enc = Object.freeze({
    Utf8: encoder(Core.enc.Utf8),
    Base64: encoder(Core.enc.Base64),
    Hex: encoder(Core.enc.Hex),
    Latin1: encoder(Core.enc.Latin1),
    Utf16: encoder(Core.enc.Utf16),
    Utf16LE: encoder(Core.enc.Utf16LE),
})

function keyAndConfig(key, cfg) {
    if (typeof key === "string") return { key, config: {} }
    if (!cfg || cfg.iv === undefined) throw new Error("CryptoJS.AES: a key of bytes needs an iv of bytes in the config")
    return { key: asWords(key), config: { iv: asWords(cfg.iv) } }
}

const AES = Object.freeze({
    encrypt(message, key, cfg) {
        const use = keyAndConfig(key, cfg)
        const params = Core.AES.encrypt(asWords(message), use.key, use.config)
        return new WordArray(params.ciphertext, params)
    },
    decrypt(message, key, cfg) {
        const use = keyAndConfig(key, cfg)
        let cipher
        if (message instanceof WordArray) cipher = message.cipherParams ?? Core.lib.CipherParams.create({ ciphertext: message.words })
        else if (typeof use.key === "string") cipher = String(message) // OpenSSL format with the salt, as encrypt gives it
        else cipher = Core.lib.CipherParams.create({ ciphertext: Core.enc.Base64.parse(String(message)) })
        return new WordArray(Core.AES.decrypt(cipher, use.key, use.config))
    },
})

const hash = of => (message) => new WordArray(of(asWords(message)))
const hmac = of => (message, key) => new WordArray(of(asWords(message), asWords(key)))

export const CryptoJS = Object.freeze({
    AES,
    enc,
    MD5: hash(Core.MD5),
    SHA1: hash(Core.SHA1),
    SHA256: hash(Core.SHA256),
    SHA512: hash(Core.SHA512),
    HmacMD5: hmac(Core.HmacMD5),
    HmacSHA1: hmac(Core.HmacSHA1),
    HmacSHA256: hmac(Core.HmacSHA256),
    HmacSHA512: hmac(Core.HmacSHA512),
})
