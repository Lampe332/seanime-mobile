// geschrieben nach: core/account/crypto.test.ts (Testvektoren, gleiche Rechnung) und dem Muster der Selbsttests in app-links-handler.ts; nur Entwickler-Diagnose
import {
    chainMac, commitment, decryptPackage, dekProof, deriveKeys, deviceMac, encryptPackage, newRecoveryCode, openSealedDek, recoveryKeyFrom, sas,
    sealDek, toB64, unwrapKey, wrapKey,
} from "@/core/account/crypto"
import vectors from "@/core/account/__fixtures__/vectors.json"
import type { Sodium } from "@/core/account/sodium"
import { accountSodium } from "@/lib/account-sodium"
import native from "../../modules/core-sodium"
import { Alert } from "react-native"

/*
 * Developer check of the native libsodium (modules/core-sodium): computes core/account/__fixtures__/vectors.json on the
 * device and times Argon2id (sync and async). Test and scratch builds only; metro.config.js leaves this file out of the
 * release bundle. Start (test app):
 *   adb shell am start -a android.intent.action.VIEW -d "seanime-native://core?sodium=selftest" com.seanime.app.native
 * The result is a dialog and one log line per check ([SodiumSelfTest]).
 */

const hex = (data: Uint8Array) => Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("")
const unhex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16))
const utf8 = (text: string) => new TextEncoder().encode(text)
/** RFC 8032 section 7.1 test 1: Ed25519 signature of the empty message */
const RFC8032_EMPTY_SIGNATURE = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"

/** libsodium with a fixed sequence of "random" bytes, as in the core's test harness */
function fixedRandom(sodium: Sodium, ...chunks: Uint8Array[]): Sodium {
    const queue = [...chunks]
    return {
        ...sodium,
        randombytes_buf: (length: number) => {
            const next = queue.shift()
            if (!next || next.length !== length) throw new Error(`no fixed random bytes of length ${length}`)
            return Uint8Array.from(next)
        },
    }
}

export async function runAccountSodiumSelfTest(): Promise<string[]> {
    const sodium = accountSodium
    const { input, output } = vectors
    const lines: string[] = []
    const check = (name: string, run: () => boolean) => {
        const start = performance.now()
        let ok = false
        let note = ""
        try { ok = run() }
        catch (error) { note = ` (${error instanceof Error ? error.message : String(error)})` }
        lines.push(`${ok ? "PASS" : "FAIL"} ${name} ${Math.round(performance.now() - start)} ms${note}`)
    }
    const dek = unhex(input.dek)
    const binding = { userId: input.userId, version: input.version, dekId: input.dekId }
    const salt = unhex(input.salt)

    let encKey: Uint8Array = new Uint8Array(0)
    // Argon2id on the JS thread (the core's fallback) and off it (what deriveKeys uses on the device)
    for (const [name, lib] of [["sync", { ...sodium, crypto_pwhash_async: undefined }], ["async", sodium]] as const) {
        const start = performance.now()
        try {
            const keys = await deriveKeys(lib, input.password, salt, input.kdf as Parameters<typeof deriveKeys>[3])
            encKey = keys.encKey
            const ok = hex(keys.authKey) === output.authKey && hex(keys.encKey) === output.encKey
            lines.push(`${ok ? "PASS" : "FAIL"} deriveKeys authKey+encKey (Argon2id ${name}) ${Math.round(performance.now() - start)} ms`)
        }
        catch (error) {
            lines.push(`FAIL deriveKeys (Argon2id ${name}) (${error instanceof Error ? error.message : String(error)})`)
        }
    }

    check("wrappedPassword", () => wrapKey(fixedRandom(sodium, unhex(input.wrapNonce)), dek, encKey, input.userId, input.dekId, "password") === output.wrappedPassword)
    let recoveryKey: Uint8Array = new Uint8Array(0)
    check("recoveryCode+recoveryKey", () => {
        const { code, key } = newRecoveryCode(fixedRandom(sodium, unhex(input.recoveryBytes)))
        recoveryKey = key
        return code === output.recoveryCode && hex(key) === output.recoveryKey
    })
    check("wrappedRecovery", () => wrapKey(fixedRandom(sodium, unhex(input.wrapNonce)), dek, recoveryKey, input.userId, input.dekId, "recovery") === output.wrappedRecovery)
    check("package", () => hex(encryptPackage(fixedRandom(sodium, unhex(input.packageNonce)), utf8(input.packagePlain), dek, binding)) === output.package)
    check("commitment", () => toB64(sodium, commitment(sodium, unhex(input.devicePub), unhex(input.rN))) === output.commitment)
    check("sas", () => sas(sodium, unhex(input.devicePub), unhex(input.rN), unhex(input.rO)) === output.sas)
    const seeded = sodium.crypto_box_seed_keypair(unhex(input.sealSeed))
    check("sealPublicKey", () => hex(seeded.publicKey) === output.sealPublicKey)
    check("sealedDek opens", () => hex(openSealedDek(sodium, output.sealedDek, input.dekId, seeded)) === input.dek)
    check("unwrap password", () => hex(unwrapKey(sodium, output.wrappedPassword, unhex(output.encKey), input.userId, input.dekId, "password")) === input.dek)
    check("unwrap recovery", () => hex(unwrapKey(sodium, output.wrappedRecovery, recoveryKeyFrom(sodium, output.recoveryCode), input.userId, input.dekId, "recovery")) === input.dek)
    check("decrypt package", () => new TextDecoder().decode(decryptPackage(sodium, unhex(output.package), dek, binding)) === input.packagePlain)
    check("flipped bit refused", () => {
        const changed = unhex(output.package)
        changed[changed.length - 1]! ^= 1
        try { decryptPackage(sodium, changed, dek, binding) }
        catch { return true }
        return false
    })
    check("new keypair seal+open", () => {
        const pair = sodium.crypto_box_keypair()
        return hex(openSealedDek(sodium, sealDek(sodium, dek, input.dekId, pair.publicKey), input.dekId, pair)) === input.dek
    })
    // K-1 / N-1 (fix round 1): keyed BLAKE2b and crypto_kdf under the DEK, as the device list and the key chain use them
    check("deviceMac", () => deviceMac(sodium, dek, { userId: input.userId, dekId: input.dekId, devicePub: unhex(input.devicePub) }) === output.deviceMac)
    check("dekProof", () => dekProof(sodium, dek) === output.dekProof)
    check("chainMac", () => chainMac(sodium, dek, { userId: input.userId, oldDekId: input.dekId, newDekId: input.newDekId }, unhex(input.newDek)) === output.chainMac)
    // Ed25519 request signing (plan 10.2b): RFC 8032 7.1 test 1, the request-line vector, a new key pair signed and checked back
    const signSecret = unhex(input.signSecretKey)
    check("sign RFC 8032 vector", () => hex(sodium.crypto_sign_detached(new Uint8Array(0), signSecret)) === RFC8032_EMPTY_SIGNATURE)
    check("sign request vector", () => hex(sodium.crypto_sign_detached(utf8(input.signMessage), signSecret)) === output.signature)
    check("sign verify vector", () => sodium.crypto_sign_verify_detached(unhex(output.signature), utf8(input.signMessage), signSecret.subarray(32)))
    check("new sign keypair sign+verify", () => {
        const pair = sodium.crypto_sign_keypair()
        const message = utf8(input.signMessage)
        const signature = sodium.crypto_sign_detached(message, pair.privateKey)
        const good = pair.publicKey.length === 32 && pair.privateKey.length === 64 && hex(pair.privateKey.subarray(32)) === hex(pair.publicKey)
            && sodium.crypto_sign_verify_detached(signature, message, pair.publicKey)
        message[0]! ^= 1
        return good && !sodium.crypto_sign_verify_detached(signature, message, pair.publicKey)
    })
    check("randombytes+memzero", () => {
        const random = sodium.randombytes_buf(64)
        const filled = random.some(byte => byte !== 0)
        const view = random.subarray(8, 40)
        sodium.memzero(view)
        return filled && view.every(byte => byte === 0) && random.subarray(0, 8).some(byte => byte !== 0) && random.length === 64
    })

    // N-8: the request signing key in the Android Keystore under a test alias (the account's own key is never touched):
    // made in StrongBox or the TEE, 32 signatures in the server's r || s form checked outside the Keystore, a changed
    // message refused, the key gone after delete
    const alias = "seanime-account-selftest"
    const start = performance.now()
    try {
        const point = await native.keystore_p256_create(alias)
        const level = native.keystore_security_level(alias)
        const message = utf8(input.signMessage)
        let good = point.length === 65 && point[0] === 4 && (level === "strongbox" || level === "tee")
        for (let i = 0; i < 32 && good; i++) {
            const signature = await native.keystore_p256_sign(alias, message)
            good = signature.length === 64 && native.p256_verify(point, message, signature)
        }
        const signature = await native.keystore_p256_sign(alias, message)
        const changed = Uint8Array.from(message)
        changed[0]! ^= 1
        good = good && !native.p256_verify(point, changed, signature) && hex(native.keystore_p256_public(alias) ?? new Uint8Array(0)) === hex(point)
        native.keystore_delete(alias)
        good = good && native.keystore_p256_public(alias) === null
        lines.push(`${good ? "PASS" : "FAIL"} Keystore P-256 sign+verify (${level}) ${Math.round(performance.now() - start)} ms`)
    }
    catch (error) {
        lines.push(`FAIL Keystore P-256 (${error instanceof Error ? error.message : String(error)})`)
    }

    const failed = lines.filter(line => line.startsWith("FAIL")).length
    lines.unshift(`libsodium ${failed === 0 ? "ALL PASS" : `${failed} FAIL`} (${lines.length} checks)`)
    for (const line of lines) console.log(`[SodiumSelfTest] ${line}`)
    Alert.alert("libsodium self-test", lines.join("\n"))
    return lines
}
