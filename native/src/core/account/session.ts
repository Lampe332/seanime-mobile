// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5, 8: Speicher, Rollback-Schutz) und der API von expo-secure-store (getItemAsync/setItemAsync/deleteItemAsync)

import type { SessionCredentials } from "./client"
import { fromB64, toB64 } from "./crypto"
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
} as const

export function isAccountKey(key: string): boolean {
    return key.startsWith(ACCOUNT_STORE_PREFIX)
}

export type AccountKind = "email" | "google"

export type SessionInfo = {
    userId: string
    sessionToken: string
    /** base64url Ed25519 private key (64 bytes) this session signs every request with (plan 10.2b); made at sign-in */
    signingKey: string
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

export class AccountSession {
    constructor(private readonly store: SecureStore, private readonly sodium: Sodium) {}

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
        if (!session?.sessionToken || !session.signingKey) return null
        return { sessionToken: session.sessionToken, signingKey: fromB64(this.sodium, session.signingKey, 64) }
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

    async saveDeviceKeys(keys: SodiumKeyPair): Promise<void> {
        await this.write(KEYS.device, { publicKey: toB64(this.sodium, keys.publicKey), privateKey: toB64(this.sodium, keys.privateKey) })
    }

    /**
     * Forgets the account on this device. The device key pair stays unless `everything`: a later sign-in of the same
     * device then updates its row on the server instead of adding a second one (account-server PUT account/keys).
     */
    async clear(everything = false): Promise<void> {
        for (const key of [KEYS.session, KEYS.dek, KEYS.sync, ...(everything ? [KEYS.device, KEYS.kdf] : [])]) await this.store.deleteItemAsync(key)
    }

    /**
     * The server ended the session (401: expired, password reset, removed elsewhere): only the token goes. The DEK, the
     * device key pair and the sync state stay until the user signs in again or signs out (N-3), so a sign-in after a
     * reset without code can wrap the kept DEK for the new password.
     */
    async dropSession(): Promise<void> {
        await this.store.deleteItemAsync(KEYS.session)
    }
}
