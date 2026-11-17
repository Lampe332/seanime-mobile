// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.1–6.3, 6.6–6.9) und dem Server-Vertrag account-server/src (routes.ts, identity.ts, schemas.ts)

import { AccountApiError } from "./client"
import {
    AccountCryptoError,
    DEFAULT_KDF,
    type Kdf,
    deriveKeys,
    fromB64,
    newDek,
    newDekId,
    newRecoveryCode,
    newSalt,
    recoveryKeyFrom,
    sealDek,
    toB64,
    unwrapKey,
    wipe,
    wrapKey,
} from "./crypto"
import { type AccountDeps, type RotationResult, ServerContractError, deviceKeys, rotate } from "./devices"
import type { AccountKind } from "./session"

/*
 * The account steps the screens call. Each one leaves the secured storage (session.ts) in a known state:
 * "ready" = signed in and the DEK is on this device (sync can run; on an account with data the sync engine then reports
 * "import-available"), "needs-key" = signed in, the DEK must come from another device (devices.ts requestApproval) or
 * the recovery code (useRecoveryCode).
 * The userId is part of every wrap's AAD and is only known after the server answered, so a new account gets its first
 * DEK with a second call (PUT account/keys) right after sign-up; the server accepts that for a fresh session.
 */

export type SignInResult = {
    userId: string
    status: "ready" | "needs-key"
    emailVerified: boolean
    /** Google: the account was made with this sign-in */
    created: boolean
    /** For useRecoveryCode on a device without the DEK (Google accounts) */
    recoveryWrappedDek: string | null
}

/** Registers this device with the DEK (sealed to its own key), plus the wraps given; stores the DEK */
async function registerDevice(deps: AccountDeps, userId: string, dekId: string, dek: Uint8Array, deviceName: string, wraps: { wrappedDek?: string, recoveryWrappedDek?: string } = {}): Promise<void> {
    const keys = await deviceKeys(deps)
    const answer = await deps.client.putKeys({
        dekId,
        ...wraps,
        device: { name: deviceName, devicePub: toB64(deps.sodium, keys.publicKey), sealedDek: sealDek(deps.sodium, dek, keys.publicKey) },
    })
    await deps.session.saveDek(dekId, dek)
    await deps.session.updateSession({ deviceId: answer.deviceId })
}

/** Starts a new session; a different account before on this device is forgotten first (its sync state does not carry over) */
async function startSession(deps: AccountDeps, userId: string, sessionToken: string, kind: AccountKind, email: string | null) {
    const prior = await deps.session.load()
    if (prior && prior.userId !== userId) await deps.session.clear()
    const kept = prior?.userId === userId ? prior : null
    await deps.session.saveSession({ userId, sessionToken, kind, email, deviceId: null })
    return kept
}

/* ---- Email ---- */

/** Plan 6.1: account with email and password, this device makes the DEK */
export async function signupEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string, kdf?: Kdf }): Promise<SignInResult> {
    const { client, sodium } = deps
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const { authKey, encKey } = deriveKeys(sodium, input.password, salt, kdf)
    const dek = newDek(sodium)
    try {
        const answer = await client.signup({ email: input.email, salt: toB64(sodium, salt), kdf, authKey: toB64(sodium, authKey) })
        await startSession(deps, answer.userId, answer.sessionToken, "email", input.email)
        await deps.session.updateSync({ imported: true, highestVersion: 0, lastHash: null, lastSyncAt: null })
        await registerDevice(deps, answer.userId, newDekId(sodium), dek, input.deviceName, { wrappedDek: wrapKey(sodium, dek, encKey, answer.userId, "password") })
        return { userId: answer.userId, status: "ready", emailVerified: answer.emailVerified, created: true, recoveryWrappedDek: null }
    }
    finally {
        wipe(sodium, authKey, encKey, dek)
    }
}

/** Sign-in with password; returns encKey for the steps that need it (the caller wipes it) */
async function signInEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string }): Promise<SignInResult & { encKey: Uint8Array }> {
    const { client, sodium } = deps
    const { salt, kdf } = await client.prelogin(input.email)
    const { authKey, encKey } = deriveKeys(sodium, input.password, fromB64(sodium, salt, 16), kdf)
    try {
        const answer = await client.login(input.email, toB64(sodium, authKey))
        const kept = await startSession(deps, answer.userId, answer.sessionToken, "email", input.email)
        const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: false, recoveryWrappedDek: null, encKey }
        if (answer.wrappedDek && answer.dekId) {
            const dek = unwrapKey(sodium, answer.wrappedDek, encKey, answer.userId, "password")
            await registerDevice(deps, answer.userId, answer.dekId, dek, input.deviceName)
            wipe(sodium, dek)
            return { ...result, status: "ready" }
        }
        if (answer.dekId === null) {
            // made on the website: the first app device makes the DEK; nothing to import
            const dek = newDek(sodium)
            await deps.session.updateSync({ imported: true })
            await registerDevice(deps, answer.userId, newDekId(sodium), dek, input.deviceName, { wrappedDek: wrapKey(sodium, dek, encKey, answer.userId, "password") })
            wipe(sodium, dek)
            return { ...result, status: "ready" }
        }
        if (answer.rewrapNeeded && kept?.dek && kept.dekId === answer.dekId) {
            // password reset without recovery code: this device still holds the DEK and wraps it for the new password
            await registerDevice(deps, answer.userId, answer.dekId, kept.dek, input.deviceName, { wrappedDek: wrapKey(sodium, kept.dek, encKey, answer.userId, "password") })
            return { ...result, status: "ready" }
        }
        return { ...result, status: "needs-key" }
    }
    catch (error) {
        wipe(sodium, encKey)
        throw error
    }
    finally {
        wipe(sodium, authKey)
    }
}

/** Plan 6.2 */
export async function loginEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string }): Promise<SignInResult> {
    const { encKey, ...result } = await signInEmail(deps, input)
    wipe(deps.sodium, encKey)
    return result
}

/** Plan 6.7: sign in again with the current password, new salt and keys, the DEK wrapped anew; other sessions end */
export async function changePassword(deps: AccountDeps, input: { email: string, currentPassword: string, newPassword: string, deviceName: string, kdf?: Kdf }): Promise<void> {
    const { sodium } = deps
    const signedIn = await signInEmail(deps, { email: input.email, password: input.currentPassword, deviceName: input.deviceName })
    wipe(sodium, signedIn.encKey)
    const state = await deps.session.load()
    if (signedIn.status !== "ready" || !state?.dek || !state.dekId) throw new AccountCryptoError("this device has no key; approve it first")
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const { authKey, encKey } = deriveKeys(sodium, input.newPassword, salt, kdf)
    try {
        await deps.client.changePassword({ salt: toB64(sodium, salt), kdf, authKey: toB64(sodium, authKey), wrappedDek: wrapKey(sodium, state.dek, encKey, state.userId, "password"), dekId: state.dekId })
    }
    finally {
        wipe(sodium, authKey, encKey, state.dek)
    }
}

/**
 * Plan 6.8 with recovery code: unwraps the DEK with the code, sends the new password wrap and the unchanged recovery
 * wrap, then signs in. `userId` (the recovery wrap's AAD) comes from this device's stored account when not given: the
 * server's reset/info does not return it.
 */
export async function resetWithRecovery(deps: AccountDeps, input: { token: string, recoveryCode: string, email: string, newPassword: string, deviceName: string, userId?: string, kdf?: Kdf }): Promise<SignInResult> {
    const { client, sodium } = deps
    const info = await client.resetInfo(input.token)
    if (!info.hasRecovery || !info.recoveryWrappedDek || !info.dekId) throw new AccountApiError(409, "no_recovery", "This account has no recovery code.")
    const userId = input.userId ?? (await deps.session.load())?.userId
    if (!userId) throw new ServerContractError("POST /v1/auth/reset/info does not return the userId the recovery wrap is bound to, and this device has no stored account")
    const recoveryKey = recoveryKeyFrom(sodium, input.recoveryCode)
    const dek = unwrapKey(sodium, info.recoveryWrappedDek, recoveryKey, userId, "recovery")
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const { authKey, encKey } = deriveKeys(sodium, input.newPassword, salt, kdf)
    try {
        await client.reset({
            token: input.token,
            salt: toB64(sodium, salt),
            kdf,
            authKey: toB64(sodium, authKey),
            keys: { dekId: info.dekId, wrappedDek: wrapKey(sodium, dek, encKey, userId, "password"), recoveryWrappedDek: info.recoveryWrappedDek },
        })
    }
    finally {
        wipe(sodium, recoveryKey, dek, authKey, encKey)
    }
    return loginEmail(deps, { email: input.email, password: input.newPassword, deviceName: input.deviceName })
}

export type ResetResult = SignInResult & { rotation: "done" | "not-needed" | "blocked" }

/**
 * Plan 6.8 without code: the server drops the password wrap. A device that still holds the DEK wraps it for the new
 * password at sign-in and rotates the DEK; without one the account needs an approval or the recovery code.
 * "blocked": the rotation could not run here (another device must do it after signing in, or ServerContractError).
 */
export async function resetWithoutRecovery(deps: AccountDeps, input: { token: string, email: string, newPassword: string, deviceName: string, kdf?: Kdf }): Promise<ResetResult> {
    const { client, sodium } = deps
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const derived = deriveKeys(sodium, input.newPassword, salt, kdf)
    try {
        await client.reset({ token: input.token, salt: toB64(sodium, salt), kdf, authKey: toB64(sodium, derived.authKey) })
    }
    finally {
        wipe(sodium, derived.authKey, derived.encKey)
    }
    const { encKey, ...signedIn } = await signInEmail(deps, { email: input.email, password: input.newPassword, deviceName: input.deviceName })
    try {
        if (signedIn.status !== "ready") return { ...signedIn, rotation: "blocked" }
        if (!(await client.syncMeta()).rotationRequired) return { ...signedIn, rotation: "not-needed" }
        try {
            await rotate(deps, { encKey })
            return { ...signedIn, rotation: "done" }
        }
        catch (error) {
            if (error instanceof ServerContractError) return { ...signedIn, rotation: "blocked" }
            throw error
        }
    }
    finally {
        wipe(sodium, encKey)
    }
}

/* ---- Google ---- */

/** Plan 6.3, step 1: the one-time nonce the Google ID token must carry */
export function googleNonce(deps: AccountDeps): Promise<{ nonce: string, expiresAt: number }> {
    return deps.client.googleNonce()
}

/** Plan 6.3: the ID token comes from the screens (Credential Manager / Google Identity Services) with the nonce */
export async function loginGoogle(deps: AccountDeps, input: { idToken: string, nonce: string, deviceName: string }): Promise<SignInResult> {
    const { sodium } = deps
    const answer = await deps.client.google(input.idToken, input.nonce)
    const kept = await startSession(deps, answer.userId, answer.sessionToken, "google", null)
    const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: answer.created, recoveryWrappedDek: answer.recoveryWrappedDek }
    if (answer.dekId === null) {
        const dek = newDek(sodium)
        await deps.session.updateSync({ imported: true })
        await registerDevice(deps, answer.userId, newDekId(sodium), dek, input.deviceName)
        wipe(sodium, dek)
        return { ...result, status: "ready" }
    }
    if (kept?.dek && kept.dekId === answer.dekId) {
        await registerDevice(deps, answer.userId, answer.dekId, kept.dek, input.deviceName)
        return { ...result, status: "ready" }
    }
    return { ...result, status: "needs-key" }
}

/* ---- Recovery code ---- */

/** "Save a recovery code": a new code, the DEK wrapped with it. Needs a sign-in within the last 10 minutes. */
export async function createRecoveryCode(deps: AccountDeps): Promise<string> {
    const state = await deps.session.load()
    if (!state?.dek || !state.dekId) throw new AccountCryptoError("this device has no key")
    const { code, key } = newRecoveryCode(deps.sodium)
    try {
        await deps.client.putKeys({ dekId: state.dekId, recoveryWrappedDek: wrapKey(deps.sodium, state.dek, key, state.userId, "recovery") })
        return code
    }
    finally {
        wipe(deps.sodium, key, state.dek)
    }
}

/** "Use recovery code" on a signed-in device without the DEK */
export async function useRecoveryCode(deps: AccountDeps, input: { code: string, recoveryWrappedDek: string, dekId: string, deviceName: string }): Promise<void> {
    const state = await deps.session.load()
    if (!state) throw new AccountApiError(401, "unauthorized", "Sign in first.")
    const key = recoveryKeyFrom(deps.sodium, input.code)
    try {
        const dek = unwrapKey(deps.sodium, input.recoveryWrappedDek, key, state.userId, "recovery")
        await registerDevice(deps, state.userId, input.dekId, dek, input.deviceName)
        wipe(deps.sodium, dek)
    }
    finally {
        wipe(deps.sodium, key)
    }
}

/* ---- Devices, account ---- */

/** Fresh sign-in for a sensitive step: email accounts give their password (and get encKey), Google accounts sign in before */
async function reauth(deps: AccountDeps, password: string | undefined, deviceName: string): Promise<Uint8Array | undefined> {
    const state = await deps.session.load()
    if (!state) throw new AccountApiError(401, "unauthorized", "Sign in first.")
    if (state.kind !== "email") return undefined
    if (!password || !state.email) throw new AccountCryptoError("the password is needed for this step")
    const { encKey } = await signInEmail(deps, { email: state.email, password, deviceName })
    return encKey
}

/** Plan 6.9: the device's session ends on the server, then the DEK is rotated so it can read nothing new */
export async function removeDevice(deps: AccountDeps, input: { deviceId: string, deviceName: string, password?: string }): Promise<RotationResult> {
    const encKey = await reauth(deps, input.password, input.deviceName)
    try {
        await deps.client.deleteDevice(input.deviceId)
        return await rotate(deps, encKey ? { encKey } : {})
    }
    finally {
        wipe(deps.sodium, encKey)
    }
}

/** Plan 6.9: everything on the server goes at once; the data on this device stays */
export async function deleteAccount(deps: AccountDeps, input: { deviceName: string, password?: string }): Promise<void> {
    wipe(deps.sodium, await reauth(deps, input.password, input.deviceName))
    await deps.client.deleteAccount()
    await deps.session.clear(true)
}

/** Signs out on this device: the session ends, the account's keys are forgotten, the app's data stays */
export async function signOut(deps: AccountDeps): Promise<void> {
    try {
        await deps.client.logout()
    }
    catch {
        // offline or already expired: the device forgets the session anyway
    }
    await deps.session.clear()
}
