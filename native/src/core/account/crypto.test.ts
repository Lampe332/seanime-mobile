// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5, 6.4, 13) und account-server/src/approval.ts (Commitment-Format); Werte erfunden

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import {
    AccountCryptoError,
    DEFAULT_KDF,
    UnsafeKdfError,
    chainMac,
    chainMacValid,
    checkKdf,
    commitment,
    commitmentMatches,
    decryptPackage,
    dekProof,
    deriveKeys,
    deviceMac,
    deviceMacValid,
    encryptPackage,
    newRecoveryCode,
    newSigningKeyPair,
    boxDek,
    openBoxedDek,
    approvalTranscript,
    parseRecoveryCode,
    recoveryKeyFrom,
    sas,
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

const RFC8032_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
const RFC8032_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
/** RFC 8032 section 7.1 test 1: the signature of the empty message */
const RFC8032_EMPTY_SIGNATURE = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"

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
    newDekId: "dek-vector-2",
    newDek: hex(bytes(32, 180)),
    devicePub: hex(bytes(32, 1)),
    rN: hex(bytes(32, 33)),
    rO: hex(bytes(32, 65)),
    sealSeed: hex(bytes(32, 150)),
    // approval v2 / chain v2: the receiving device's seed and the box nonce (the sender is the sealSeed key pair)
    boxSeed: hex(bytes(32, 120)),
    boxNonce: hex(bytes(24, 90)),
    // Ed25519 secret key (seed || public key) of RFC 8032 section 7.1 test 1, signing a request line as the client builds it
    signSecretKey: `${RFC8032_SEED}${RFC8032_PUBLIC}`,
    signMessage: ["v1", "GET", "/v1/sync/meta", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "1763460000000", "AAECAwQFBgcICQoLDA0ODw", "-"].join("\n"),
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
        boxPublicKey: string
        boxedDek: string
        signature: string
        deviceMac: string
        dekProof: string
        chainMac: string
    }
}

async function compute(): Promise<Vectors["output"] & { sealPrivateKey: Uint8Array }> {
    const { authKey, encKey } = await deriveKeys(sodium, INPUT.password, unhex(INPUT.salt), INPUT.kdf)
    const dek = unhex(INPUT.dek)
    const wrappedPassword = wrapKey(fixedRandom(sodium, unhex(INPUT.wrapNonce)), dek, encKey, INPUT.userId, INPUT.dekId, "password")
    const { code, key } = newRecoveryCode(fixedRandom(sodium, unhex(INPUT.recoveryBytes)))
    const wrappedRecovery = wrapKey(fixedRandom(sodium, unhex(INPUT.wrapNonce)), dek, key, INPUT.userId, INPUT.dekId, "recovery")
    const pkg = encryptPackage(fixedRandom(sodium, unhex(INPUT.packageNonce)), new TextEncoder().encode(INPUT.packagePlain), dek, { userId: INPUT.userId, version: INPUT.version, dekId: INPUT.dekId })
    const seeded = (sodium as unknown as { crypto_box_seed_keypair(seed: Uint8Array): { publicKey: Uint8Array, privateKey: Uint8Array } })
    const seed = seeded.crypto_box_seed_keypair(unhex(INPUT.sealSeed))
    const receiver = seeded.crypto_box_seed_keypair(unhex(INPUT.boxSeed))
    return {
        authKey: hex(authKey),
        encKey: hex(encKey),
        wrappedPassword,
        recoveryCode: code,
        recoveryKey: hex(key),
        wrappedRecovery,
        package: hex(pkg),
        commitment: toB64(sodium, commitment(sodium, unhex(INPUT.devicePub), unhex(INPUT.rN))),
        // approval v2: the new device's key, the approving device's key (the seeded one), rN, rO
        sas: sas(sodium, unhex(INPUT.devicePub), seed.publicKey, unhex(INPUT.rN), unhex(INPUT.rO)),
        sealPublicKey: hex(seed.publicKey),
        sealPrivateKey: seed.privateKey,
        boxPublicKey: hex(receiver.publicKey),
        // a rotation's box from the seeded sender to the seeded receiver, with a fixed nonce: deterministic
        boxedDek: boxDek(fixedRandom(sodium, unhex(INPUT.boxNonce)), dek, INPUT.dekId, { kind: "rotate", userId: INPUT.userId }, receiver.publicKey, seed),
        deviceMac: deviceMac(sodium, dek, { userId: INPUT.userId, dekId: INPUT.dekId, devicePub: unhex(INPUT.devicePub) }),
        dekProof: dekProof(sodium, dek),
        chainMac: chainMac(sodium, dek, { userId: INPUT.userId, oldDekId: INPUT.dekId, newDekId: INPUT.newDekId, rotatorPub: seed.publicKey, removed: [toB64(sodium, unhex(INPUT.devicePub))] }, unhex(INPUT.newDek)),
        signature: hex(sodium.crypto_sign_detached(new TextEncoder().encode(INPUT.signMessage), unhex(INPUT.signSecretKey))),
    }
}

describe("request signing key (plan 10.2b)", () => {
    it("signs the RFC 8032 vector, round-trips a new key and refuses a changed message", () => {
        const secret = unhex(`${RFC8032_SEED}${RFC8032_PUBLIC}`)
        expect(hex(sodium.crypto_sign_detached(new Uint8Array(0), secret))).toBe(RFC8032_EMPTY_SIGNATURE)
        expect(sodium.crypto_sign_verify_detached(unhex(RFC8032_EMPTY_SIGNATURE), new Uint8Array(0), unhex(RFC8032_PUBLIC))).toBe(true)
        const pair = newSigningKeyPair(sodium)
        expect(pair.publicKey).toHaveLength(32)
        expect(pair.privateKey).toHaveLength(64)
        expect(hex(pair.privateKey.subarray(32))).toBe(hex(pair.publicKey))
        const message = new TextEncoder().encode(["v1", "PUT", "/v1/sync/snapshot"].join("\n"))
        const signature = sodium.crypto_sign_detached(message, pair.privateKey)
        expect(sodium.crypto_sign_verify_detached(signature, message, pair.publicKey)).toBe(true)
        message[0]! ^= 1
        expect(sodium.crypto_sign_verify_detached(signature, message, pair.publicKey)).toBe(false)
    })

    it("libsodium signatures verify with WebCrypto Ed25519, as the server checks them", async () => {
        const pair = newSigningKeyPair(sodium)
        const message = new TextEncoder().encode(INPUT.signMessage)
        const key = await crypto.subtle.importKey("raw", Uint8Array.from(pair.publicKey), { name: "Ed25519" }, false, ["verify"])
        expect(await crypto.subtle.verify({ name: "Ed25519" }, key, Uint8Array.from(sodium.crypto_sign_detached(message, pair.privateKey)), message)).toBe(true)
    })
})

describe("deriveKeys", () => {
    it("runs Argon2id through crypto_pwhash_async when the Sodium has it, with the same keys", async () => {
        let calls = 0
        const withAsync: Sodium = { ...sodium, crypto_pwhash_async: async (...args: Parameters<Sodium["crypto_pwhash"]>) => {
            calls++
            return sodium.crypto_pwhash(...args)
        } }
        const salt = unhex(INPUT.salt)
        const kdf = DEFAULT_KDF
        const viaAsync = await deriveKeys(withAsync, INPUT.password, salt, kdf)
        const viaSync = await deriveKeys(sodium, INPUT.password, salt, kdf)
        expect(calls).toBe(1)
        expect(hex(viaAsync.authKey)).toBe(hex(viaSync.authKey))
        expect(hex(viaAsync.encKey)).toBe(hex(viaSync.encKey))
    })
})

describe("test vectors", () => {
    it("reproduces __fixtures__/vectors.json", async () => {
        const { sealPrivateKey, ...output } = await compute()
        if (process.env.WRITE_VECTORS === "1" || !existsSync(VECTORS_FILE)) {
            writeFileSync(VECTORS_FILE, JSON.stringify({ input: INPUT, output } satisfies Vectors, null, 4) + "\n")
        }
        const stored = JSON.parse(readFileSync(VECTORS_FILE, "utf8")) as Vectors
        expect(stored.input).toEqual(INPUT)
        expect(output).toEqual(stored.output)
        // the stored box opens for the seeded receiver, only with the seeded sender's key
        const receiver = (sodium as unknown as { crypto_box_seed_keypair(seed: Uint8Array): { publicKey: Uint8Array, privateKey: Uint8Array } }).crypto_box_seed_keypair(unhex(INPUT.boxSeed))
        const context = { kind: "rotate" as const, userId: INPUT.userId }
        expect(hex(openBoxedDek(sodium, stored.output.boxedDek, INPUT.dekId, context, unhex(stored.output.sealPublicKey), receiver))).toBe(INPUT.dek)
        expect(() => openBoxedDek(sodium, stored.output.boxedDek, INPUT.dekId, context, sodium.crypto_box_keypair().publicKey, receiver)).toThrow(AccountCryptoError)
        expect(sealPrivateKey).toHaveLength(32)
    })

    it("opens the stored wraps and package with the derived keys", () => {
        const stored = JSON.parse(readFileSync(VECTORS_FILE, "utf8")) as Vectors
        const encKey = unhex(stored.output.encKey)
        expect(hex(unwrapKey(sodium, stored.output.wrappedPassword, encKey, INPUT.userId, INPUT.dekId, "password"))).toBe(INPUT.dek)
        expect(hex(unwrapKey(sodium, stored.output.wrappedRecovery, recoveryKeyFrom(sodium, stored.output.recoveryCode), INPUT.userId, INPUT.dekId, "recovery"))).toBe(INPUT.dek)
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
        const wrapped = wrapKey(sodium, dek, key, INPUT.userId, INPUT.dekId, "password")
        expect(unwrapKey(sodium, wrapped, key, INPUT.userId, INPUT.dekId, "password")).toEqual(dek)
        expect(() => unwrapKey(sodium, wrapped, key, INPUT.userId, INPUT.dekId, "recovery")).toThrow(AccountCryptoError)
        expect(() => unwrapKey(sodium, wrapped, key, "other-user", INPUT.dekId, "password")).toThrow(AccountCryptoError)
        // N-1: an old wrap served under a new dekId does not open
        expect(() => unwrapKey(sodium, wrapped, key, INPUT.userId, "dek-other", "password")).toThrow(AccountCryptoError)
        expect(() => unwrapKey(sodium, wrapped, bytes(32, 3), INPUT.userId, INPUT.dekId, "password")).toThrow(AccountCryptoError)
        const raw = sodium.from_base64(wrapped, sodium.base64_variants.URLSAFE_NO_PADDING)
        raw[30]! ^= 0x80
        expect(() => unwrapKey(sodium, toB64(sodium, raw), key, INPUT.userId, INPUT.dekId, "password")).toThrow(AccountCryptoError)
    })

    it("a boxed DEK opens only for the receiver, only with the sender's key, under its own dekId and use (NEU-1)", () => {
        const sender = sodium.crypto_box_keypair()
        const receiver = sodium.crypto_box_keypair()
        const stranger = sodium.crypto_box_keypair()
        const rotateCtx = { kind: "rotate" as const, userId: INPUT.userId }
        const boxed = boxDek(sodium, bytes(32, 5), "dek-a", rotateCtx, receiver.publicKey, sender)
        expect(openBoxedDek(sodium, boxed, "dek-a", rotateCtx, sender.publicKey, receiver)).toEqual(bytes(32, 5))
        // anybody else's key made it (a server, a removed device): it does not open
        expect(() => openBoxedDek(sodium, boxed, "dek-a", rotateCtx, stranger.publicKey, receiver)).toThrow(AccountCryptoError)
        expect(() => openBoxedDek(sodium, boxed, "dek-a", rotateCtx, sender.publicKey, stranger)).toThrow(AccountCryptoError)
        // N-1: not under another id, not for another use, and an anonymous sealed box (v1) never
        expect(() => openBoxedDek(sodium, boxed, "dek-b", rotateCtx, sender.publicKey, receiver)).toThrow(AccountCryptoError)
        expect(() => openBoxedDek(sodium, boxed, "dek-a", { kind: "own", userId: INPUT.userId }, sender.publicKey, receiver)).toThrow(AccountCryptoError)
        expect(() => openBoxedDek(sodium, boxed, "dek-a", { kind: "approve", transcript: bytes(32, 9) }, sender.publicKey, receiver)).toThrow(AccountCryptoError)
        expect(() => openBoxedDek(sodium, toB64(sodium, sodium.crypto_box_seal(bytes(32, 5), receiver.publicKey)), "dek-a", rotateCtx, sender.publicKey, receiver)).toThrow(AccountCryptoError)
    })

    it("a device MAC and a chain MAC hold only for their DEK, account, ids and keys (K-1)", () => {
        const dek = bytes(32, 40)
        const pub = bytes(32, 41)
        const binding = { userId: INPUT.userId, dekId: "dek-a", devicePub: pub }
        const mac = deviceMac(sodium, dek, binding)
        expect(deviceMacValid(sodium, dek, binding, mac)).toBe(true)
        expect(deviceMacValid(sodium, bytes(32, 42), binding, mac)).toBe(false)
        expect(deviceMacValid(sodium, dek, { ...binding, dekId: "dek-b" }, mac)).toBe(false)
        expect(deviceMacValid(sodium, dek, { ...binding, devicePub: bytes(32, 43) }, mac)).toBe(false)
        expect(deviceMacValid(sodium, dek, { ...binding, userId: "other" }, mac)).toBe(false)
        expect(deviceMacValid(sodium, dek, binding, null)).toBe(false)
        expect(deviceMacValid(sodium, dek, binding, "not base64!")).toBe(false)
        const next = bytes(32, 44)
        const rotator = bytes(32, 47)
        const link = { userId: INPUT.userId, oldDekId: "dek-a", newDekId: "dek-b", rotatorPub: rotator, removed: ["removed-b", "removed-a"] }
        const chain = chainMac(sodium, dek, link, next)
        expect(chainMacValid(sodium, dek, link, next, chain)).toBe(true)
        expect(chainMacValid(sodium, dek, link, bytes(32, 45), chain)).toBe(false)
        expect(chainMacValid(sodium, bytes(32, 46), link, next, chain)).toBe(false)
        expect(chainMacValid(sodium, dek, { ...link, newDekId: "dek-c" }, next, chain)).toBe(false)
        // chain v2: the rotating device and the removed list are covered; the list's order does not matter
        expect(chainMacValid(sodium, dek, { ...link, rotatorPub: bytes(32, 48) }, next, chain)).toBe(false)
        expect(chainMacValid(sodium, dek, { ...link, removed: ["removed-a"] }, next, chain)).toBe(false)
        expect(chainMacValid(sodium, dek, { ...link, removed: ["removed-a", "removed-b"] }, next, chain)).toBe(true)
        expect(dekProof(sodium, dek)).not.toBe(dekProof(sodium, next))
        expect(dekProof(sodium, dek)).not.toBe(mac)
    })

    it("refuses KDF parameters below the floor, above the ceiling or below what was seen (H-1)", async () => {
        for (const kdf of [{ m: 8, t: 1 }, { m: 19456, t: 1 }, { m: 65536, t: 2 }, { m: 262145, t: 3 }, { m: 65536, t: 11 }]) {
            await expect(deriveKeys(sodium, "pw", bytes(16), { alg: "argon2id", p: 1, ...kdf })).rejects.toThrow(UnsafeKdfError)
        }
        expect(() => checkKdf(DEFAULT_KDF, { m: 131072, t: 3 })).toThrow(UnsafeKdfError)
        expect(() => checkKdf({ ...DEFAULT_KDF, m: 131072 }, { m: 131072, t: 3 })).not.toThrow()
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
        const pkO = sodium.crypto_box_keypair().publicKey
        const onNew = sas(sodium, pkN, pkO, rN, rO)
        const onOld = sas(sodium, Uint8Array.from(pkN), Uint8Array.from(pkO), Uint8Array.from(rN), Uint8Array.from(rO))
        expect(onNew).toMatch(/^\d{6}$/)
        expect(onOld).toBe(onNew)
        const otherKey = sodium.crypto_box_keypair().publicKey
        expect(sas(sodium, otherKey, pkO, rN, rO)).not.toBe(onNew)
        // approval v2: a server that swaps the approving device's key changes the number too
        expect(sas(sodium, pkN, otherKey, rN, rO)).not.toBe(onNew)
        expect(sas(sodium, pkN, pkO, rN, bytes(32, 13))).not.toBe(onNew)
        expect(approvalTranscript(sodium, pkN, pkO, rN, rO)).toHaveLength(32)
        expect(commitmentMatches(sodium, otherKey, rN, commitment(sodium, pkN, rN))).toBe(false)
    })

    it("spreads the six digits evenly", () => {
        const counts = Array.from({ length: 10 }, () => 0)
        for (let i = 0; i < 2000; i++) counts[Number(sas(sodium, bytes(32, i), bytes(32, 3), bytes(32, i >> 8), bytes(32, 7))[0])]!++
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
