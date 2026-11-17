// geschrieben nach: core/account/crypto.test.ts (Testvektoren, gleiche Rechnung) und dem Muster der Selbsttests in app-links-handler.ts; nur Entwickler-Diagnose
import {
    AUTH_CONTEXT, ENC_CONTEXT, commitment, decryptPackage, deriveKeys, encryptPackage, newRecoveryCode, openSealedDek, recoveryKeyFrom, sas, sealDek, toB64,
    unwrapKey, wrapKey,
} from "@/core/account/crypto"
import vectors from "@/core/account/__fixtures__/vectors.json"
import type { Sodium } from "@/core/account/sodium"
import { accountSodium } from "@/lib/account-sodium"
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
    check("deriveKeys authKey+encKey (Argon2id sync)", () => {
        const keys = deriveKeys(sodium, input.password, salt, input.kdf as Parameters<typeof deriveKeys>[3])
        encKey = keys.encKey
        return hex(keys.authKey) === output.authKey && hex(keys.encKey) === output.encKey
    })

    // the same derivation with the master key from the background thread
    const asyncStart = performance.now()
    try {
        const master = await sodium.crypto_pwhash_async(32, input.password.normalize("NFKC"), salt, input.kdf.t, input.kdf.m * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13)
        const ms = Math.round(performance.now() - asyncStart)
        const ok = hex(sodium.crypto_kdf_derive_from_key(32, 1, AUTH_CONTEXT, master)) === output.authKey
            && hex(sodium.crypto_kdf_derive_from_key(32, 2, ENC_CONTEXT, master)) === output.encKey
        lines.push(`${ok ? "PASS" : "FAIL"} authKey+encKey (Argon2id async) ${ms} ms`)
    }
    catch (error) {
        lines.push(`FAIL authKey+encKey (Argon2id async) (${error instanceof Error ? error.message : String(error)})`)
    }

    check("wrappedPassword", () => wrapKey(fixedRandom(sodium, unhex(input.wrapNonce)), dek, encKey, input.userId, "password") === output.wrappedPassword)
    let recoveryKey: Uint8Array = new Uint8Array(0)
    check("recoveryCode+recoveryKey", () => {
        const { code, key } = newRecoveryCode(fixedRandom(sodium, unhex(input.recoveryBytes)))
        recoveryKey = key
        return code === output.recoveryCode && hex(key) === output.recoveryKey
    })
    check("wrappedRecovery", () => wrapKey(fixedRandom(sodium, unhex(input.wrapNonce)), dek, recoveryKey, input.userId, "recovery") === output.wrappedRecovery)
    check("package", () => hex(encryptPackage(fixedRandom(sodium, unhex(input.packageNonce)), utf8(input.packagePlain), dek, binding)) === output.package)
    check("commitment", () => toB64(sodium, commitment(sodium, unhex(input.devicePub), unhex(input.rN))) === output.commitment)
    check("sas", () => sas(sodium, unhex(input.devicePub), unhex(input.rN), unhex(input.rO)) === output.sas)
    const seeded = sodium.crypto_box_seed_keypair(unhex(input.sealSeed))
    check("sealPublicKey", () => hex(seeded.publicKey) === output.sealPublicKey)
    check("sealedDek opens", () => hex(openSealedDek(sodium, output.sealedDek, seeded)) === input.dek)
    check("unwrap password", () => hex(unwrapKey(sodium, output.wrappedPassword, unhex(output.encKey), input.userId, "password")) === input.dek)
    check("unwrap recovery", () => hex(unwrapKey(sodium, output.wrappedRecovery, recoveryKeyFrom(sodium, output.recoveryCode), input.userId, "recovery")) === input.dek)
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
        return hex(openSealedDek(sodium, sealDek(sodium, dek, pair.publicKey), pair)) === input.dek
    })
    check("randombytes+memzero", () => {
        const random = sodium.randombytes_buf(64)
        const filled = random.some(byte => byte !== 0)
        const view = random.subarray(8, 40)
        sodium.memzero(view)
        return filled && view.every(byte => byte === 0) && random.subarray(0, 8).some(byte => byte !== 0) && random.length === 64
    })

    const failed = lines.filter(line => line.startsWith("FAIL")).length
    lines.unshift(`libsodium ${failed === 0 ? "ALL PASS" : `${failed} FAIL`} (${lines.length} checks)`)
    for (const line of lines) console.log(`[SodiumSelfTest] ${line}`)
    Alert.alert("libsodium self-test", lines.join("\n"))
    return lines
}
