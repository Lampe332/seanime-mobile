// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5, 8: Speicher, Rollback-Schutz) und der API von expo-secure-store (getItemAsync/setItemAsync/deleteItemAsync)

import type { RequestSigner, SessionCredentials } from "./client"
import { fromB64, newSigningKeyPair, toB64 } from "./crypto"
import type { Sodium, SodiumKeyPair } from "./sodium"

/*
 * What the device keeps for the account, only in the secured storage (the app hands in expo-secure-store, Android
 * Keystore): the session token, the DEK, the device's key pair and the sync state (highest version seen, hash of the
 * last synced plaintext). Never in the app's preferences, never in a backup or a sync package (package.ts leaves every
 * key with this prefix out).
 */

export interface SecureStore {
    getItemAsync(key: string): Promise<string | null>
    setItemAsync(key: string, value: string): Promise<void>
    deleteItemAsync(key: string): Promise<void>
}

/** Prefix of every stored account key (allowed characters of expo-secure-store: letters, digits, ".", "-", "_") */
export const ACCOUNT_STORE_PREFIX = "seanime-account."
const KEYS = {
    session: `${ACCOUNT_STORE_PREFIX}session`,
    dek: `${ACCOUNT_STORE_PREFIX}dek`,
    device: `${ACCOUNT_STORE_PREFIX}device-key`,
    sync: `${ACCOUNT_STORE_PREFIX}sync`,
    /** Highest Argon2 parameters seen per email: a server that lowers them is refused (H-1) */
    kdf: `${ACCOUNT_STORE_PREFIX}kdf`,
    /** The libsodium fallback signing key (only on a device without Android Keystore) */
    signer: `${ACCOUNT_STORE_PREFIX}signing-key`,
    /** Device keys this device knows as removed, per account (R3): never sealed to, their key chains refused */
    removed: `${ACCOUNT_STORE_PREFIX}removed`,
} as const

/**
 * Where the device keeps its request signing key (plan 10.2b). On the phone it is a P-256 key inside the Android Keystore
 * that never leaves it (N-8, src/lib/account/keystore-signer.ts). The key stays across sign-ins of the account, also after
 * the server ended a session, so the server knows the device at the next sign-in and never locks it out (M-2); signing
 * out deletes it, so the next account gets a new one.
 */
export interface SignerStore {
    /** The kept key, or a new one */
    obtain(): Promise<RequestSigner>
    /** The kept key, or null */
    current(): Promise<RequestSigner | null>
    remove(): Promise<void>
}

/**
 * Ed25519 from libsodium with the private key in the secured storage: the core's own signer (tests) and the app's
 * fallback on a device without Android Keystore.
 */
export function sodiumSignerStore(store: SecureStore, sodium: Sodium): SignerStore {
    const signer = (privateKey: Uint8Array): RequestSigner => ({
        alg: "ed25519",
        publicKey: privateKey.slice(32, 64),
        sign: async message => sodium.crypto_sign_detached(message, privateKey),
    })
    const current = async () => {
        const stored = await store.getItemAsync(KEYS.signer)
        return stored ? signer(fromB64(sodium, stored, 64)) : null
    }
    return {
        current,
        async obtain() {
            const kept = await current()
            if (kept) return kept
            const { privateKey } = newSigningKeyPair(sodium)
            await store.setItemAsync(KEYS.signer, toB64(sodium, privateKey))
            return signer(privateKey)
        },
        remove: () => store.deleteItemAsync(KEYS.signer),
    }
}

export function isAccountKey(key: string): boolean {
    return key.startsWith(ACCOUNT_STORE_PREFIX)
}

export type AccountKind = "email" | "google"

export type SessionInfo = {
    userId: string
    sessionToken: string
    kind: AccountKind
    email: string | null
    /** The server's id of this device, once it holds the DEK and is registered */
    deviceId: string | null
}

export type SyncState = {
    /** Highest snapshot version this device has seen: an older one is refused (rollback) */
    highestVersion: number
    /** Hash of the plaintext package last uploaded or applied: unchanged data is not uploaded again */
    lastHash: string | null
    lastSyncAt: number | null
    /** False on a device that signed in to an account with data and has not imported it yet: it never uploads first */
    imported: boolean
}

export type AccountState = SessionInfo & SyncState & {
    dekId: string | null
    dek: Uint8Array | null
    deviceKeys: SodiumKeyPair | null
}

const EMPTY_SYNC: SyncState = { highestVersion: 0, lastHash: null, lastSyncAt: null, imported: false }

/** Removed device keys of one account: `own` the DEK vouched for (never dropped), `server` from sync/meta (bounded) */
type RemovedLists = { own: string[], server: string[] }

export class AccountSession {
    constructor(
        private readonly store: SecureStore,
        private readonly sodium: Sodium,
        private readonly signers: SignerStore = sodiumSignerStore(store, sodium),
    ) {}

    private async read<T>(key: string): Promise<T | null> {
        const text = await this.store.getItemAsync(key)
        if (text === null) return null
        try {
            return JSON.parse(text) as T
        }
        catch {
            return null
        }
    }

    private write(key: string, value: unknown): Promise<void> {
        return this.store.setItemAsync(key, JSON.stringify(value))
    }

    /** The signed-in account, or null */
    async load(): Promise<AccountState | null> {
        const session = await this.read<SessionInfo>(KEYS.session)
        if (!session) return null
        const stored = await this.read<{ userId?: string | null, dekId: string, dek: string }>(KEYS.dek)
        // a DEK kept for another account (its session ended) is never this account's
        const dek = stored && (stored.userId == null || stored.userId === session.userId) ? stored : null
        const sync = await this.read<SyncState>(KEYS.sync)
        return {
            ...session,
            ...EMPTY_SYNC,
            ...sync,
            dekId: dek?.dekId ?? null,
            dek: dek ? fromB64(this.sodium, dek.dek, 32) : null,
            deviceKeys: await this.deviceKeys(),
        }
    }

    /** Token and signing key of the signed-in session (AccountClient signs with them), or null */
    async credentials(): Promise<SessionCredentials | null> {
        const session = await this.read<SessionInfo>(KEYS.session)
        if (!session?.sessionToken) return null
        const signer = await this.signers.current()
        return signer ? { sessionToken: session.sessionToken, signer } : null
    }

    /** The key a sign-in is signed with and its session bound to: the kept one, or a new one (M-2, N-8) */
    signer(): Promise<RequestSigner> {
        return this.signers.obtain()
    }

    /** Signing out: the signing key goes, the next sign-in (maybe another account) gets a new one (N-6) */
    forgetSigner(): Promise<void> {
        return this.signers.remove()
    }

    async saveSession(session: SessionInfo): Promise<void> {
        await this.write(KEYS.session, session)
    }

    async updateSession(patch: Partial<SessionInfo>): Promise<void> {
        const current = await this.read<SessionInfo>(KEYS.session)
        if (!current) throw new Error("not signed in")
        await this.write(KEYS.session, { ...current, ...patch })
    }

    /** Stores the DEK together with the account it belongs to, so it outlives a session the server ended (N-3) */
    async saveDek(dekId: string, dek: Uint8Array): Promise<void> {
        const session = await this.read<SessionInfo>(KEYS.session)
        await this.write(KEYS.dek, { userId: session?.userId ?? null, dekId, dek: toB64(this.sodium, dek) })
    }

    /** The DEK this device holds, also after the session ended; null when there is none */
    async keptKey(): Promise<{ userId: string | null, dekId: string, dek: Uint8Array } | null> {
        const kept = await this.read<{ userId?: string | null, dekId: string, dek: string }>(KEYS.dek)
        return kept ? { userId: kept.userId ?? null, dekId: kept.dekId, dek: fromB64(this.sodium, kept.dek, 32) } : null
    }

    async forgetDek(): Promise<void> {
        await this.store.deleteItemAsync(KEYS.dek)
    }

    /** The highest Argon2 parameters this device saw for an email (H-1) */
    async kdfFloor(email: string): Promise<{ m: number, t: number } | null> {
        return (await this.read<Record<string, { m: number, t: number }>>(KEYS.kdf))?.[email.trim().toLowerCase()] ?? null
    }

    async rememberKdf(email: string, kdf: { m: number, t: number }): Promise<void> {
        const all = (await this.read<Record<string, { m: number, t: number }>>(KEYS.kdf)) ?? {}
        const key = email.trim().toLowerCase()
        const seen = all[key]
        all[key] = { m: Math.max(seen?.m ?? 0, kdf.m), t: Math.max(seen?.t ?? 0, kdf.t) }
        await this.write(KEYS.kdf, all)
    }

    async updateSync(patch: Partial<SyncState>): Promise<SyncState> {
        const next = { ...EMPTY_SYNC, ...(await this.read<SyncState>(KEYS.sync)), ...patch }
        await this.write(KEYS.sync, next)
        return next
    }

    async deviceKeys(): Promise<SodiumKeyPair | null> {
        const keys = await this.read<{ publicKey: string, privateKey: string }>(KEYS.device)
        return keys ? { publicKey: fromB64(this.sodium, keys.publicKey, 32), privateKey: fromB64(this.sodium, keys.privateKey, 32) } : null
    }

    /** Signing out: the device keys go too, so the next sign-in asks with a new device key (NEU-12) */
    async forgetDeviceKeys(): Promise<void> {
        await this.store.deleteItemAsync(KEYS.device)
    }

    /** Device keys (base64url) this device knows as removed from the account (R3): its own list and the server's */
    async removedDevices(userId: string): Promise<string[]> {
        const lists = (await this.read<Record<string, RemovedLists | string[]>>(KEYS.removed))?.[userId]
        if (Array.isArray(lists)) return lists
        return [...new Set([...(lists?.own ?? []), ...(lists?.server ?? [])])]
    }

    /**
     * Remembers removed device keys the DEK vouched for (S2, NEU3-3): this device's own removals and the ones a key chain
     * names. Only DEK holders add them, so nothing is ever pushed out of this list.
     */
    async addRemoved(userId: string, pubs: string[]): Promise<void> {
        await this.updateRemoved(userId, lists => ({ ...lists, own: [...new Set([...lists.own, ...pubs])] }))
    }

    /**
     * The server's list (sync/meta), kept apart (NEU3-3): only well-formed device keys, at most 50 per answer and 200 in
     * all; once full, new server entries are dropped, never the own ones. Believing it can only leave a device out.
     */
    async addServerRemoved(userId: string, pubs: unknown): Promise<void> {
        if (!Array.isArray(pubs)) return
        const valid = pubs.filter((pub): pub is string => typeof pub === "string" && /^[A-Za-z0-9_-]{43}$/.test(pub)).slice(0, 50)
        await this.updateRemoved(userId, lists => {
            const room = Math.max(0, 200 - lists.server.length)
            const fresh = valid.filter(pub => !lists.server.includes(pub) && !lists.own.includes(pub)).slice(0, room)
            return { ...lists, server: [...lists.server, ...fresh] }
        })
    }

    private async updateRemoved(userId: string, change: (lists: RemovedLists) => RemovedLists): Promise<void> {
        const all = (await this.read<Record<string, RemovedLists | string[]>>(KEYS.removed)) ?? {}
        const stored = all[userId]
        const before: RemovedLists = Array.isArray(stored) ? { own: stored, server: [] } : { own: stored?.own ?? [], server: stored?.server ?? [] }
        const next = change(before)
        if (next.own.length === before.own.length && next.server.length === before.server.length) return
        all[userId] = next
        await this.write(KEYS.removed, all)
    }

    async saveDeviceKeys(keys: SodiumKeyPair): Promise<void> {
        await this.write(KEYS.device, { publicKey: toB64(this.sodium, keys.publicKey), privateKey: toB64(this.sodium, keys.privateKey) })
    }

    /**
     * Forgets the account on this device. The device key pair stays unless `everything`: a later sign-in of the same
     * device then updates its row on the server instead of adding a second one (account-server PUT account/keys).
     */
    async clear(everything = false): Promise<void> {
        for (const key of [KEYS.session, KEYS.dek, KEYS.sync, ...(everything ? [KEYS.device, KEYS.kdf, KEYS.removed] : [])]) await this.store.deleteItemAsync(key)
    }

    /**
     * The server ended the session (401: expired, password reset): only the token goes. The DEK, the device key pair and
     * the sync state stay until the user signs in again or signs out (N-3), so a sign-in after a reset without code can
     * wrap the kept DEK for the new password. A removed device (401 device_removed) uses clear() instead (NEU-2).
     */
    async dropSession(): Promise<void> {
        await this.store.deleteItemAsync(KEYS.session)
    }
}
