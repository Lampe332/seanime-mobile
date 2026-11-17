// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5, 6.4, 13) und account-server/src/approval.ts (Commitment-Format); Werte erfunden

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import {
    AccountCryptoError,
    DEFAULT_KDF,
    commitment,
    commitmentMatches,
    decryptPackage,
    deriveKeys,
    encryptPackage,
    newRecoveryCode,
    openSealedDek,
    parseRecoveryCode,
    recoveryKeyFrom,
    sas,
    sealDek,
    toB64,
    unwrapKey,
    wrapKey,
} from "./crypto"
import type { Sodium } from "./sodium"
import { bytes, fixedRandom, hex, ready, unhex } from "./__fixtures__/harness"

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(createRequire(import.meta.url)("libsodium-wrappers-sumo"))
})

const VECTORS_FILE = path.join(__dirname, "__fixtures__", "vectors.json")
const SERVER = path.resolve(__dirname, "../../../../account-server")

/* Fixed inputs. Set WRITE_VECTORS=1 once to write __fixtures__/vectors.json; afterwards every run must reproduce it. */
const INPUT = {
    password: "correct horse battery staple ü",
    salt: hex(bytes(16)),
    kdf: DEFAULT_KDF,
    userId: "6f1c2c1e-0d7b-4c3a-9a51-2f0e7d4b8a10",
    dek: hex(bytes(32, 100)),
    wrapNonce: hex(bytes(24, 200)),
    recoveryBytes: hex(bytes(16, 50)),
    packagePlain: "{\"hello\":\"world\"}",
    packageNonce: hex(bytes(24, 7)),
    version: 3,
    dekId: "dek-vector-1",
    devicePub: hex(bytes(32, 1)),
    rN: hex(bytes(32, 33)),
    rO: hex(bytes(32, 65)),
    sealSeed: hex(bytes(32, 150)),
}

type Vectors = {
    input: typeof INPUT
    output: {
        authKey: string
        encKey: string
        wrappedPassword: string
        recoveryCode: string
        recoveryKey: string
        wrappedRecovery: string
        package: string
        commitment: string
        sas: string
        sealPublicKey: string
        sealedDek: string
    }
}

function compute(): Vectors["output"] & { sealPrivateKey: Uint8Array } {
    const { authKey, encKey } = deriveKeys(sodium, INPUT.password, unhex(INPUT.salt), INPUT.kdf)
    const dek = unhex(INPUT.dek)
    const wrappedPassword = wrapKey(fixedRandom(sodium, unhex(INPUT.wrapNonce)), dek, encKey, INPUT.userId, "password")
    const { code, key } = newRecoveryCode(fixedRandom(sodium, unhex(INPUT.recoveryBytes)))
    const wrappedRecovery = wrapKey(fixedRandom(sodium, unhex(INPUT.wrapNonce)), dek, key, INPUT.userId, "recovery")
    const pkg = encryptPackage(fixedRandom(sodium, unhex(INPUT.packageNonce)), new TextEncoder().encode(INPUT.packagePlain), dek, { userId: INPUT.userId, version: INPUT.version, dekId: INPUT.dekId })
    const seed = (sodium as unknown as { crypto_box_seed_keypair(seed: Uint8Array): { publicKey: Uint8Array, privateKey: Uint8Array } }).crypto_box_seed_keypair(unhex(INPUT.sealSeed))
    return {
        authKey: hex(authKey),
        encKey: hex(encKey),
        wrappedPassword,
        recoveryCode: code,
        recoveryKey: hex(key),
        wrappedRecovery,
        package: hex(pkg),
        commitment: toB64(sodium, commitment(sodium, unhex(INPUT.devicePub), unhex(INPUT.rN))),
        sas: sas(sodium, unhex(INPUT.devicePub), unhex(INPUT.rN), unhex(INPUT.rO)),
        sealPublicKey: hex(seed.publicKey),
        sealPrivateKey: seed.privateKey,
        sealedDek: sealDek(sodium, dek, seed.publicKey),
    }
}

describe("test vectors", () => {
    it("reproduces __fixtures__/vectors.json", () => {
        const { sealPrivateKey, ...output } = compute()
        if (process.env.WRITE_VECTORS === "1" || !existsSync(VECTORS_FILE)) {
            writeFileSync(VECTORS_FILE, JSON.stringify({ input: INPUT, output } satisfies Vectors, null, 4) + "\n")
        }
        const stored = JSON.parse(readFileSync(VECTORS_FILE, "utf8")) as Vectors
        expect(stored.input).toEqual(INPUT)
        const { sealedDek: _fresh, ...deterministic } = output
        const { sealedDek: storedSealed, ...storedDeterministic } = stored.output
        expect(deterministic).toEqual(storedDeterministic)
        // sealing is randomised: the stored value must open with the seeded key and give the DEK
        expect(hex(openSealedDek(sodium, storedSealed, { publicKey: unhex(stored.output.sealPublicKey), privateKey: sealPrivateKey }))).toBe(INPUT.dek)
    })

    it("opens the stored wraps and package with the derived keys", () => {
        const stored = JSON.parse(readFileSync(VECTORS_FILE, "utf8")) as Vectors
        const encKey = unhex(stored.output.encKey)
        expect(hex(unwrapKey(sodium, stored.output.wrappedPassword, encKey, INPUT.userId, "password"))).toBe(INPUT.dek)
        expect(hex(unwrapKey(sodium, stored.output.wrappedRecovery, recoveryKeyFrom(sodium, stored.output.recoveryCode), INPUT.userId, "recovery"))).toBe(INPUT.dek)
        const plain = decryptPackage(sodium, unhex(stored.output.package), unhex(INPUT.dek), { userId: INPUT.userId, version: INPUT.version, dekId: INPUT.dekId })
        expect(new TextDecoder().decode(plain)).toBe(INPUT.packagePlain)
    })
})

describe("tampering", () => {
    const binding = { userId: INPUT.userId, version: 4, dekId: "dek-a" }

    it("a flipped bit anywhere in a package makes it fail cleanly", () => {
        const dek = bytes(32, 9)
        const blob = encryptPackage(sodium, new TextEncoder().encode("{\"a\":1}"), dek, binding)
        for (const index of [0, 3, 4, 27, 28, blob.length - 1]) {
            const changed = Uint8Array.from(blob)
            changed[index]! ^= 1
            expect(() => decryptPackage(sodium, changed, dek, binding)).toThrow(AccountCryptoError)
        }
        expect(new TextDecoder().decode(decryptPackage(sodium, blob, dek, binding))).toBe("{\"a\":1}")
    })

    it("a package does not open for another account, version or DEK id", () => {
        const dek = bytes(32, 9)
        const blob = encryptPackage(sodium, new TextEncoder().encode("x"), dek, binding)
        expect(() => decryptPackage(sodium, blob, dek, { ...binding, userId: "00000000-0000-4000-8000-000000000000" })).toThrow(AccountCryptoError)
        expect(() => decryptPackage(sodium, blob, dek, { ...binding, version: 3 })).toThrow(AccountCryptoError)
        expect(() => decryptPackage(sodium, blob, dek, { ...binding, dekId: "dek-b" })).toThrow(AccountCryptoError)
        expect(() => decryptPackage(sodium, blob, bytes(32, 10), binding)).toThrow(AccountCryptoError)
    })

    it("a wrap opens only for its account, purpose and key, and not with a flipped bit", () => {
        const key = bytes(32, 1)
        const dek = bytes(32, 2)
        const wrapped = wrapKey(sodium, dek, key, INPUT.userId, "password")
        expect(unwrapKey(sodium, wrapped, key, INPUT.userId, "password")).toEqual(dek)
        expect(() => unwrapKey(sodium, wrapped, key, INPUT.userId, "recovery")).toThrow(AccountCryptoError)
        expect(() => unwrapKey(sodium, wrapped, key, "other-user", "password")).toThrow(AccountCryptoError)
        expect(() => unwrapKey(sodium, wrapped, bytes(32, 3), INPUT.userId, "password")).toThrow(AccountCryptoError)
        const raw = sodium.from_base64(wrapped, sodium.base64_variants.URLSAFE_NO_PADDING)
        raw[30]! ^= 0x80
        expect(() => unwrapKey(sodium, toB64(sodium, raw), key, INPUT.userId, "password")).toThrow(AccountCryptoError)
    })

    it("a sealed DEK opens only with the device's key", () => {
        const one = sodium.crypto_box_keypair()
        const two = sodium.crypto_box_keypair()
        const sealed = sealDek(sodium, bytes(32, 5), one.publicKey)
        expect(openSealedDek(sodium, sealed, one)).toEqual(bytes(32, 5))
        expect(() => openSealedDek(sodium, sealed, two)).toThrow(AccountCryptoError)
    })
})

describe("recovery code", () => {
    it("is 26 Base32 characters for 128 bits and reads back, also with spaces, dashes and lower case", () => {
        const { code, key } = newRecoveryCode(sodium)
        expect(code).toMatch(/^[A-Z2-7]{26}$/)
        const spaced = code.toLowerCase().replace(/(.{5})/g, "$1-").replace(/(.{4})/, "$1 ")
        expect(recoveryKeyFrom(sodium, spaced)).toEqual(key)
        expect(parseRecoveryCode(code)).toHaveLength(16)
    })

    it("refuses what is no code", () => {
        expect(() => parseRecoveryCode("ABC")).toThrow(AccountCryptoError)
        expect(() => parseRecoveryCode("A".repeat(25) + "1")).toThrow(AccountCryptoError)
        // the last two bits of 26 characters must be zero
        expect(() => parseRecoveryCode("A".repeat(25) + "B")).toThrow(AccountCryptoError)
    })
})

describe("device approval values", () => {
    it("the SAS is the same on both sides and differs for another key or random", () => {
        const pkN = sodium.crypto_box_keypair().publicKey
        const rN = bytes(32, 11)
        const rO = bytes(32, 12)
        const onNew = sas(sodium, pkN, rN, rO)
        const onOld = sas(sodium, Uint8Array.from(pkN), Uint8Array.from(rN), Uint8Array.from(rO))
        expect(onNew).toMatch(/^\d{6}$/)
        expect(onOld).toBe(onNew)
        const otherKey = sodium.crypto_box_keypair().publicKey
        expect(sas(sodium, otherKey, rN, rO)).not.toBe(onNew)
        expect(sas(sodium, pkN, rN, bytes(32, 13))).not.toBe(onNew)
        expect(commitmentMatches(sodium, otherKey, rN, commitment(sodium, pkN, rN))).toBe(false)
    })

    it("spreads the six digits evenly", () => {
        const counts = Array.from({ length: 10 }, () => 0)
        for (let i = 0; i < 2000; i++) counts[Number(sas(sodium, bytes(32, i), bytes(32, i >> 8), bytes(32, 7))[0])]!++
        for (const count of counts) expect(count).toBeGreaterThan(130)
    })

    it.skipIf(!existsSync(path.join(SERVER, "node_modules", "zod")))("has the byte format the server checks (account-server/src/approval.ts)", async () => {
        // Workers have crypto.subtle.timingSafeEqual, Node does not: a plain comparison for this check
        const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean }
        subtle.timingSafeEqual ??= (a, b) => a.length === b.length && a.every((value, i) => value === b[i])
        const server = await import(/* @vite-ignore */ path.join(SERVER, "src", "approval.ts")) as { commitmentMatches(pub: string, reveal: string, commitment: string): Promise<boolean> }
        const pkN = sodium.crypto_box_keypair().publicKey
        const rN = bytes(32, 21)
        const ours = toB64(sodium, commitment(sodium, pkN, rN))
        expect(await server.commitmentMatches(toB64(sodium, pkN), toB64(sodium, rN), ours)).toBe(true)
        expect(await server.commitmentMatches(toB64(sodium, pkN), toB64(sodium, bytes(32, 22)), ours)).toBe(false)
    })
})
