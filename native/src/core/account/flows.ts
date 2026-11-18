// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.1–6.3, 6.6–6.9) und dem Server-Vertrag account-server/src (routes.ts mit account/start-fresh, identity.ts mit reset/info userId, schemas.ts)

import { AccountApiError } from "./client"
import {
    AccountCryptoError,
    UntrustedKeyChangeError,
    DEFAULT_KDF,
    type Kdf,
    boxDek,
    checkKdf,
    dekProof,
    deriveKeys,
    deviceMac,
    fromB64,
    newDek,
    newDekId,
    newRecoveryCode,
    newSalt,
    recoveryKeyFrom,
    toB64,
    unwrapKey,
    wipe,
    wrapKey,
} from "./crypto"
import { type AccountDeps, type RotationResult, deviceKeys, rotate } from "./devices"
import type { RequestSigner } from "./client"
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
    /**
     * NEU-7: this device held the account's key before, and the account now uses another one it can't confirm (start fresh
     * on another device, or someone tampering). The old key and sync state are gone; nothing was imported or uploaded.
     */
    keyChanged: boolean
}

/** This device's row: its public key, the DEK boxed to it and the MAC that makes the other devices trust it */
async function deviceRow(deps: AccountDeps, userId: string, dekId: string, dek: Uint8Array, deviceName: string) {
    const keys = await deviceKeys(deps)
    return {
        name: deviceName,
        devicePub: toB64(deps.sodium, keys.publicKey),
        sealedDek: boxDek(deps.sodium, dek, dekId, { kind: "own", userId }, keys.publicKey, keys),
        mac: deviceMac(deps.sodium, dek, { userId, dekId, devicePub: keys.publicKey }),
    }
}

/**
 * Registers this device with the DEK (sealed to its own key), plus the wraps given; stores the DEK. The DEK proof tells the
 * server this session holds the key: without it a session cannot add a device or change a wrap (K-1, M-5).
 */
async function registerDevice(deps: AccountDeps, userId: string, dekId: string, dek: Uint8Array, deviceName: string, wraps: { wrappedDek?: string, recoveryWrappedDek?: string } = {}): Promise<void> {
    const answer = await deps.client.putKeys({
        dekId,
        dekProof: dekProof(deps.sodium, dek),
        ...wraps,
        device: await deviceRow(deps, userId, dekId, dek, deviceName),
    })
    await deps.session.saveDek(dekId, dek)
    await deps.session.updateSession({ deviceId: answer.deviceId })
}

/**
 * Starts a new session (bound on the server to the key that signed the sign-in, deps.session.signer()). A DEK kept from an earlier session of the
 * same account (also one the server ended, N-3) is returned when it is still the account's key. When the account's key
 * changed meanwhile (start fresh elsewhere, a rotation this device can't follow), the kept DEK and the sync state go and
 * the result says so (keyChanged, NEU-7): the device asks before it imports and never merges into the new account
 * automatically. A different account before on this device is forgotten first.
 */
async function startSession(deps: AccountDeps, userId: string, sessionToken: string, kind: AccountKind, email: string | null, accountDekId: string | null) {
    const kept = await deps.session.keptKey()
    const prior = await deps.session.load()
    if ((prior && prior.userId !== userId) || (kept && kept.userId !== userId)) await deps.session.clear()
    await deps.session.saveSession({ userId, sessionToken, kind, email, deviceId: null })
    wipe(deps.sodium, prior?.dek)
    if (!kept || kept.userId !== userId) return { kept: null, keyChanged: false }
    if (kept.dekId !== accountDekId) {
        await deps.session.forgetDek()
        await deps.session.updateSync({ imported: false, highestVersion: 0, lastHash: null, lastSyncAt: null })
        wipe(deps.sodium, kept.dek)
        return { kept: null, keyChanged: true }
    }
    return { kept, keyChanged: false }
}

/** prelogin's KDF parameters, refused below the floor or below what this device saw for the email before (H-1) */
async function preloginChecked(deps: AccountDeps, email: string) {
    const answer = await deps.client.prelogin(email)
    checkKdf(answer.kdf, await deps.session.kdfFloor(email))
    return answer
}

/* ---- Email ---- */

/** Plan 6.1: account with email and password, this device makes the DEK */
export async function signupEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string, kdf?: Kdf }): Promise<SignInResult> {
    const { client, sodium } = deps
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const { authKey, encKey } = await deriveKeys(sodium, input.password, salt, kdf)
    const dek = newDek(sodium)
    const signing: RequestSigner = await deps.session.signer()
    try {
        const { challenge } = await client.prelogin(input.email)
        const answer = await client.signup({ email: input.email, salt: toB64(sodium, salt), kdf, authKey: toB64(sodium, authKey), challenge }, signing)
        await startSession(deps, answer.userId, answer.sessionToken, "email", input.email, null)
        await deps.session.rememberKdf(input.email, kdf)
        await deps.session.updateSync({ imported: true, highestVersion: 0, lastHash: null, lastSyncAt: null })
        const dekId = newDekId(sodium)
        await registerDevice(deps, answer.userId, dekId, dek, input.deviceName, { wrappedDek: wrapKey(sodium, dek, encKey, answer.userId, dekId, "password") })
        return { userId: answer.userId, status: "ready", emailVerified: answer.emailVerified, created: true, recoveryWrappedDek: null, keyChanged: false }
    }
    finally {
        wipe(sodium, authKey, encKey, dek)
    }
}

/** Sign-in with password; returns encKey for the steps that need it (the caller wipes it) */
async function signInEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string }): Promise<SignInResult & { encKey: Uint8Array }> {
    const { client, sodium } = deps
    const { salt, kdf, challenge } = await preloginChecked(deps, input.email)
    const { authKey, encKey } = await deriveKeys(sodium, input.password, fromB64(sodium, salt, 16), kdf)
    const signing: RequestSigner = await deps.session.signer()
    try {
        const answer = await client.login(input.email, toB64(sodium, authKey), challenge, signing)
        const { kept, keyChanged } = await startSession(deps, answer.userId, answer.sessionToken, "email", input.email, answer.dekId)
        // the parameters worked for this account: from now on nothing lower is accepted for this email
        await deps.session.rememberKdf(input.email, kdf)
        const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: false, recoveryWrappedDek: null, keyChanged, encKey }
        try {
            if (kept && answer.dekId) {
                // NEU-1: a device that still holds the account's key never goes to an approval; it signs in with its own
                // key and wraps it for the password again when the server has no wrap (after a reset without code)
                await registerDevice(deps, answer.userId, answer.dekId, kept.dek, input.deviceName,
                    answer.wrappedDek ? {} : { wrappedDek: wrapKey(sodium, kept.dek, encKey, answer.userId, answer.dekId, "password") })
                return { ...result, status: "ready" }
            }
            if (answer.wrappedDek && answer.dekId) {
                // the wrap is bound to this dekId: an old wrap served under a new id does not open (N-1)
                let dek: Uint8Array
                try {
                    dek = unwrapKey(sodium, answer.wrappedDek, encKey, answer.userId, answer.dekId, "password")
                }
                catch (error) {
                    // NEU-7: the account's key changed and the new wrap does not open with this password: say so plainly
                    if (keyChanged && error instanceof AccountCryptoError) throw new UntrustedKeyChangeError()
                    throw error
                }
                await registerDevice(deps, answer.userId, answer.dekId, dek, input.deviceName)
                wipe(sodium, dek)
                return { ...result, status: "ready" }
            }
            if (answer.dekId === null) {
                // made on the website: the first app device makes the DEK; nothing to import
                const dek = newDek(sodium)
                const dekId = newDekId(sodium)
                await deps.session.updateSync({ imported: true })
                await registerDevice(deps, answer.userId, dekId, dek, input.deviceName, { wrappedDek: wrapKey(sodium, dek, encKey, answer.userId, dekId, "password") })
                wipe(sodium, dek)
                return { ...result, status: "ready" }
            }
            return { ...result, status: "needs-key" }
        }
        finally {
            wipe(sodium, kept?.dek)
        }
    }
    catch (error) {
        wipe(sodium, encKey)
        throw error
    }
    finally {
        wipe(sodium, authKey)
    }
}

/**
 * A rotation the server asks for (a device was removed, a reset without code) runs right after a fresh sign-in, while the
 * password key and the recent sign-in are at hand (M-4). It never makes the sign-in fail: the sync keeps showing it.
 */
async function finishPendingRotation(deps: AccountDeps, encKey: Uint8Array | undefined): Promise<RotationResult | null> {
    try {
        if (!(await deps.client.syncMeta()).rotationRequired) return null
        return await rotate(deps, encKey ? { encKey } : {})
    }
    catch (error) {
        if (error instanceof AccountApiError || error instanceof AccountCryptoError) return null
        throw error
    }
}

/** Plan 6.2 */
export async function loginEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string }): Promise<SignInResult> {
    const { encKey, ...result } = await signInEmail(deps, input)
    try {
        if (result.status === "ready") await finishPendingRotation(deps, encKey)
    }
    finally {
        wipe(deps.sodium, encKey)
    }
    return result
}

/**
 * M-4: "Finish removing a device" on a device that holds the DEK. Email accounts give their password (fresh sign-in, new
 * password wrap); Google accounts must have signed in within the last 10 minutes (the server answers reauth_required).
 */
export async function completeRotation(deps: AccountDeps, input: { deviceName: string, password?: string }): Promise<RotationResult> {
    const encKey = await reauth(deps, input.password, input.deviceName)
    try {
        return await rotate(deps, encKey ? { encKey } : {})
    }
    finally {
        wipe(deps.sodium, encKey)
    }
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
    const { authKey, encKey } = await deriveKeys(sodium, input.newPassword, salt, kdf)
    try {
        await deps.client.changePassword({
            salt: toB64(sodium, salt),
            kdf,
            authKey: toB64(sodium, authKey),
            wrappedDek: wrapKey(sodium, state.dek, encKey, state.userId, state.dekId, "password"),
            dekId: state.dekId,
            dekProof: dekProof(sodium, state.dek),
        })
        await deps.session.rememberKdf(input.email, kdf)
    }
    finally {
        wipe(sodium, authKey, encKey, state.dek)
    }
}

/**
 * Plan 6.8 with recovery code: unwraps the DEK with the code, sends the new password wrap and a new recovery wrap (same
 * code, fresh nonce), then signs in. `userId` (the wraps' AAD) comes from the server's reset/info, so this works on a
 * device that never held the account. The website's /account/reset/ does exactly the same.
 */
export async function resetWithRecovery(deps: AccountDeps, input: { token: string, recoveryCode: string, email: string, newPassword: string, deviceName: string, kdf?: Kdf }): Promise<SignInResult> {
    const { client, sodium } = deps
    const info = await client.resetInfo(input.token)
    if (!info.hasRecovery || !info.recoveryWrappedDek || !info.dekId) throw new AccountApiError(409, "no_recovery", "This account has no recovery code.")
    const userId = info.userId
    const dekId = info.dekId
    const recoveryKey = recoveryKeyFrom(sodium, input.recoveryCode)
    const dek = unwrapKey(sodium, info.recoveryWrappedDek, recoveryKey, userId, dekId, "recovery")
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const { authKey, encKey } = await deriveKeys(sodium, input.newPassword, salt, kdf)
    try {
        await client.reset({
            token: input.token,
            salt: toB64(sodium, salt),
            kdf,
            authKey: toB64(sodium, authKey),
            // the proof shows the server the code really opened the key: a mailbox alone cannot overwrite the wraps (M-5)
            keys: { dekId, dekProof: dekProof(sodium, dek), wrappedDek: wrapKey(sodium, dek, encKey, userId, dekId, "password"), recoveryWrappedDek: wrapKey(sodium, dek, recoveryKey, userId, dekId, "recovery") },
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
 * password at sign-in and rotates the DEK; without one the account needs an approval, the recovery code or startFresh.
 * "blocked": the rotation could not run here (this device has no key; another device must do it after signing in).
 */
export async function resetWithoutRecovery(deps: AccountDeps, input: { token: string, email: string, newPassword: string, deviceName: string, kdf?: Kdf }): Promise<ResetResult> {
    const { client, sodium } = deps
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const derived = await deriveKeys(sodium, input.newPassword, salt, kdf)
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
        await rotate(deps, { encKey })
        return { ...signedIn, rotation: "done" }
    }
    finally {
        wipe(sodium, encKey)
    }
}

/* ---- Google ---- */

/** Plan 6.3, step 1: the one-time nonce the Google ID token must carry, and the sign-in challenge issued with it */
export function googleNonce(deps: AccountDeps): Promise<{ nonce: string, expiresAt: number, challenge: string }> {
    return deps.client.googleNonce()
}

/** Plan 6.3: the ID token comes from the screens (Credential Manager / Google Identity Services) with the nonce */
export async function loginGoogle(deps: AccountDeps, input: { idToken: string, nonce: string, challenge: string, deviceName: string }): Promise<SignInResult> {
    const { sodium } = deps
    const signing: RequestSigner = await deps.session.signer()
    const answer = await deps.client.google(input.idToken, input.nonce, input.challenge, signing)
    const { kept, keyChanged } = await startSession(deps, answer.userId, answer.sessionToken, "google", null, answer.dekId)
    const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: answer.created, recoveryWrappedDek: answer.recoveryWrappedDek, keyChanged }
    if (answer.dekId === null) {
        const dek = newDek(sodium)
        await deps.session.updateSync({ imported: true })
        await registerDevice(deps, answer.userId, newDekId(sodium), dek, input.deviceName)
        wipe(sodium, dek)
        return { ...result, status: "ready" }
    }
    if (kept) {
        try {
            await registerDevice(deps, answer.userId, answer.dekId, kept.dek, input.deviceName)
        }
        finally {
            wipe(sodium, kept.dek)
        }
        // the fresh Google sign-in is the re-login a pending rotation needs (M-4)
        await finishPendingRotation(deps, undefined)
        return { ...result, status: "ready" }
    }
    return { ...result, status: "needs-key" }
}

/**
 * H-2: links a Google account to a password account. Needs the password again (authKey); the server mails the account's
 * address. The ID token comes from the screens with the nonce of googleNonce.
 */
export async function linkGoogle(deps: AccountDeps, input: { password: string, idToken: string, nonce: string }): Promise<void> {
    const authKey = await passwordAuthKey(deps, input.password)
    try {
        await deps.client.linkGoogle(input.idToken, input.nonce, toB64(deps.sodium, authKey))
    }
    finally {
        wipe(deps.sodium, authKey)
    }
}

/** H-2: "Disconnect Google"; needs the password, so a Google sign-in alone can never take the password away */
export async function unlinkGoogle(deps: AccountDeps, input: { password: string }): Promise<void> {
    const authKey = await passwordAuthKey(deps, input.password)
    try {
        await deps.client.unlinkGoogle(toB64(deps.sodium, authKey))
    }
    finally {
        wipe(deps.sodium, authKey)
    }
}

/** The password's authKey for the signed-in email account (the KDF parameters checked as at sign-in) */
async function passwordAuthKey(deps: AccountDeps, password: string): Promise<Uint8Array> {
    const state = await deps.session.load()
    wipe(deps.sodium, state?.dek)
    if (!state?.email) throw new AccountCryptoError("this account has no password")
    const { salt, kdf } = await preloginChecked(deps, state.email)
    const { authKey, encKey } = await deriveKeys(deps.sodium, password, fromB64(deps.sodium, salt, 16), kdf)
    wipe(deps.sodium, encKey)
    return authKey
}

/* ---- Recovery code ---- */

/** "Save a recovery code": a new code, the DEK wrapped with it. Needs a sign-in within the last 10 minutes. */
export async function createRecoveryCode(deps: AccountDeps): Promise<string> {
    const state = await deps.session.load()
    if (!state?.dek || !state.dekId) throw new AccountCryptoError("this device has no key")
    const { code, key } = newRecoveryCode(deps.sodium)
    try {
        await deps.client.putKeys({ dekId: state.dekId, dekProof: dekProof(deps.sodium, state.dek), recoveryWrappedDek: wrapKey(deps.sodium, state.dek, key, state.userId, state.dekId, "recovery") })
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
        const dek = unwrapKey(deps.sodium, input.recoveryWrappedDek, key, state.userId, input.dekId, "recovery")
        await registerDevice(deps, state.userId, input.dekId, dek, input.deviceName)
        wipe(deps.sodium, dek)
    }
    finally {
        wipe(deps.sodium, key)
    }
}

/* ---- Start fresh ---- */

/**
 * Plan 2, 6.3, 6.8 "Start fresh": the old DEK is lost (no device left, no recovery code). A new DEK for the account,
 * sealed to this device; the server deletes the synced data, every other device and every other session in one step.
 * Email accounts give their password (fresh sign-in and the new password wrap); Google accounts must have signed in
 * within the last 10 minutes. This device's own data stays and becomes the account's first upload.
 */
export async function startFresh(deps: AccountDeps, input: { deviceName: string, password?: string }): Promise<{ dekId: string, deviceId: string }> {
    const { sodium } = deps
    const encKey = await reauth(deps, input.password, input.deviceName)
    const dek = newDek(sodium)
    try {
        const state = await deps.session.load()
        if (!state) throw new AccountApiError(401, "unauthorized", "Sign in first.")
        const dekId = newDekId(sodium)
        // a new key chain starts here: the account's other devices refuse this key and ask their user (K-1)
        const answer = await deps.client.startFresh({
            dekId,
            dekProof: dekProof(sodium, dek),
            ...(encKey ? { wrappedDek: wrapKey(sodium, dek, encKey, state.userId, dekId, "password") } : {}),
            device: await deviceRow(deps, state.userId, dekId, dek, input.deviceName),
        })
        wipe(sodium, state.dek)
        await deps.session.saveDek(dekId, dek)
        await deps.session.updateSession({ deviceId: answer.deviceId })
        // versions start again at 1; nothing to import, this device uploads first
        await deps.session.updateSync({ imported: true, highestVersion: 0, lastHash: null, lastSyncAt: null })
        return answer
    }
    finally {
        wipe(sodium, dek, encKey)
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

/**
 * Plan 6.9, R4: removing a device in the app is the rotation in the same step. This device remembers the removed key
 * (it never seals to it again and refuses a key chain it makes, NEU-3), the server ends its sessions, then the DEK is
 * rotated so the removed device can read nothing new. The other devices learn the removal from the chain.
 */
export async function removeDevice(deps: AccountDeps, input: { deviceId: string, deviceName: string, password?: string }): Promise<RotationResult> {
    const encKey = await reauth(deps, input.password, input.deviceName)
    try {
        const target = (await deps.client.devices()).find(device => device.id === input.deviceId)
        if (!target) throw new AccountApiError(404, "not_found", "This device is not in the account any more.")
        if (target.current) throw new AccountApiError(409, "invalid_request", "Sign out to remove this device.")
        const state = await deps.session.load()
        wipe(deps.sodium, state?.dek)
        if (state) await deps.session.addRemoved(state.userId, [target.devicePub])
        await deps.client.deleteDevice(input.deviceId)
        return await rotate(deps, encKey ? { encKey } : {}, [target.devicePub])
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
    await deps.session.forgetSigner()
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
    // the next sign-in, maybe to another account, gets a new signing key (N-6) and a new device key (NEU-12)
    await deps.session.forgetSigner()
    await deps.session.forgetDeviceKeys()
}
