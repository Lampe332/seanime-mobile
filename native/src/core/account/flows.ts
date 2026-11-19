// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.1–6.3, 6.6–6.9) und dem Server-Vertrag account-server/src (routes.ts mit account/start-fresh, identity.ts mit reset/info userId, schemas.ts)

import { AccountApiError } from "./client"
import {
    AccountCryptoError,
    UntrustedEscrowError,
    UntrustedKeyChangeError,
    DEFAULT_KDF,
    type Kdf,
    boxDek,
    checkKdf,
    dekProof,
    deriveKeys,
    deviceMac,
    deviceMacValid,
    fromB64,
    newDek,
    newDekId,
    newRecoveryCode,
    newSalt,
    recoveryKeyFrom,
    recoveryProof,
    toB64,
    unwrapKey,
    wipe,
    wrapKey,
} from "./crypto"
import { type AccountDeps, type RotationResult, checkedDevices, deviceKeys, rotate } from "./devices"
import type { RequestSigner } from "./client"
import type { AccountKind, SessionInfo } from "./session"

/*
 * The account steps the screens call. Each one leaves the secured storage (session.ts) in a known state:
 * "ready" = signed in and the DEK is on this device (sync can run; on an account with data the sync engine then reports
 * "import-available"), "needs-key" = signed in, the DEK must come from another device (devices.ts requestApproval) or
 * the recovery code (useRecoveryCode).
 * A sign-in that fails after the server made the session (the connection drops before the device is registered) is taken
 * back (startSession `undo`): never "signed in without the key" by accident, where the screens offer Start fresh.
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
 * server this session holds the key (K-1, M-5); S3: the server also wants the owner, a password sign-in or
 * `recoveryProof`, unless this device takes its own live row back with the signing key it kept.
 */
async function registerDevice(deps: AccountDeps, userId: string, dekId: string, dek: Uint8Array, deviceName: string, wraps: { wrappedDek?: string, recoveryWrappedDek?: string, recoveryProof?: string } = {}): Promise<void> {
    let answer: { deviceId: string | null }
    try {
        answer = await deps.client.putKeys({
            dekId,
            dekProof: dekProof(deps.sodium, dek),
            ...wraps,
            device: await deviceRow(deps, userId, dekId, dek, deviceName),
        })
    }
    catch (error) {
        // NEU-2: this device was removed from the account: it drops the key it kept and its device keys
        if (error instanceof AccountApiError && error.code === "device_removed") {
            await deps.session.forgetDek()
            await deps.session.forgetDeviceKeys()
        }
        throw error
    }
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
    // the session this device had for the same account (it gave its password again): what a failed sign-in goes back to
    const before: SessionInfo | null = prior && prior.userId === userId
        ? { userId, sessionToken: prior.sessionToken, kind: prior.kind, email: prior.email, deviceId: prior.deviceId }
        : null
    await deps.session.saveSession({ userId, sessionToken, kind, email, deviceId: null })
    wipe(deps.sodium, prior?.dek)
    /** Puts back what this sign-in dropped before the device was registered (the kept key and the sync state) */
    let undo: () => Promise<void> = async () => undefined
    /**
     * Registers the device (`work`); when that fails the sign-in is taken back as a whole, so the user just signs in
     * again: the new session goes, and a key this sign-in dropped comes back (a device that was "key-untrusted" stays
     * that, it does not become "signed in without the key"). Only a removed device (NEU-2) stays signed in without the
     * key: it has to ask for an approval.
     */
    const finish = async <T>(work: () => Promise<T>): Promise<T> => {
        try {
            return await work()
        }
        catch (error) {
            if (!(error instanceof AccountApiError && error.code === "device_removed")) {
                await undo()
                if (before) await deps.session.saveSession(before)
                else await deps.session.dropSession()
            }
            throw error
        }
    }
    if (!kept || kept.userId !== userId) return { kept: null, stale: null, keyChanged: false, finish }
    if (kept.dekId !== accountDekId) {
        const sync = await deps.session.updateSync({})
        await deps.session.forgetDek()
        await deps.session.updateSync({ imported: false, highestVersion: 0, lastHash: null, lastSyncAt: null })
        undo = async () => {
            // while the new session is still stored: the key is kept for this account
            await deps.session.saveDek(kept.dekId, kept.dek)
            await deps.session.updateSync(sync)
        }
        // `stale`: the key the account no longer uses, held only for `undo`; the caller wipes it
        return { kept: null, stale: kept, keyChanged: true, finish }
    }
    return { kept, stale: null, keyChanged: false, finish }
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
        const { finish } = await startSession(deps, answer.userId, answer.sessionToken, "email", input.email, null)
        await deps.session.rememberKdf(input.email, kdf)
        await deps.session.updateSync({ imported: true, highestVersion: 0, lastHash: null, lastSyncAt: null })
        const dekId = newDekId(sodium)
        // when this fails the account exists without a key: the next sign-in makes it (signInEmail, dekId === null)
        await finish(() => registerDevice(deps, answer.userId, dekId, dek, input.deviceName, { wrappedDek: wrapKey(sodium, dek, encKey, answer.userId, dekId, "password") }))
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
        const { kept, stale, keyChanged, finish } = await startSession(deps, answer.userId, answer.sessionToken, "email", input.email, answer.dekId)
        // the parameters worked for this account: from now on nothing lower is accepted for this email
        await deps.session.rememberKdf(input.email, kdf)
        const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: false, recoveryWrappedDek: null, keyChanged, encKey }
        try {
            if (kept && answer.dekId) {
                // NEU-1: a device that still holds the account's key never goes to an approval; it signs in with its own
                // key and wraps it for the password again when the server has no wrap (after a reset without code)
                const dekId = answer.dekId
                await finish(() => registerDevice(deps, answer.userId, dekId, kept.dek, input.deviceName,
                    answer.wrappedDek ? {} : { wrappedDek: wrapKey(sodium, kept.dek, encKey, answer.userId, dekId, "password") }))
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
                const dekId = answer.dekId
                try {
                    await finish(() => registerDevice(deps, answer.userId, dekId, dek, input.deviceName))
                }
                finally {
                    wipe(sodium, dek)
                }
                return { ...result, status: "ready" }
            }
            if (answer.dekId === null) {
                // made on the website: the first app device makes the DEK; nothing to import
                const dek = newDek(sodium)
                const dekId = newDekId(sodium)
                await deps.session.updateSync({ imported: true })
                try {
                    await finish(() => registerDevice(deps, answer.userId, dekId, dek, input.deviceName, { wrappedDek: wrapKey(sodium, dek, encKey, answer.userId, dekId, "password") }))
                }
                finally {
                    wipe(sodium, dek)
                }
                return { ...result, status: "ready" }
            }
            return { ...result, status: "needs-key" }
        }
        finally {
            wipe(sodium, kept?.dek, stale?.dek)
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
 * Plan 6.2. A key change the server asks for (a device was removed or signed out) is not run here: the user picks the
 * devices that keep the key on the "Change encryption key" screen (S2). S5: MailConfirmationError when the sign-in
 * waits for the mailed link; signing in again with this device after opening it goes through.
 */
export async function loginEmail(deps: AccountDeps, input: { email: string, password: string, deviceName: string }): Promise<SignInResult> {
    const { encKey, ...result } = await signInEmail(deps, input)
    wipe(deps.sodium, encKey)
    return result
}

/**
 * "Change encryption key" (S2, M-4): a new key for the devices the user kept (`keep`, device ids); every other device is
 * removed in the same step. Email accounts give their password (fresh sign-in, new password wrap); Google accounts must
 * have signed in within the last 10 minutes (the server answers reauth_required).
 */
export async function changeKey(deps: AccountDeps, input: { deviceName: string, password?: string, keep: string[] }): Promise<RotationResult> {
    const encKey = await reauth(deps, input.password, input.deviceName)
    try {
        // "code only": the server keeps the new key as well, or it refuses the change (409 escrow_required)
        const escrow = (await deps.client.account()).codeOnly === true
        return await rotate(deps, { keep: input.keep, encKey, escrow })
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

/**
 * Plan 6.8 without code: the server drops the password wrap and asks for a key change. A device that still holds the DEK
 * wraps it for the new password at sign-in; the key change then waits on the "Change encryption key" screen (S2).
 * Without such a device the account needs an approval, the recovery code or startFresh ("needs-key").
 */
export async function resetWithoutRecovery(deps: AccountDeps, input: { token: string, email: string, newPassword: string, deviceName: string, kdf?: Kdf }): Promise<SignInResult> {
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
    return loginEmail(deps, { email: input.email, password: input.newPassword, deviceName: input.deviceName })
}

/* ---- Sign-in code ---- */

/** Mails a 6-digit sign-in code; the server answers the same for every address */
export function requestSignInCode(deps: AccountDeps, email: string): Promise<{ sent: boolean }> {
    return deps.client.requestCode(email)
}

export type CodeSignInResult = SignInResult & {
    /** The key came from the server: the account has "code only" on */
    escrow: boolean
}

/**
 * The DEK the server handed over must make the MAC of at least one of the account's device rows, when it has any: a
 * server that never held the key can't make up one that does (I1), so a device of an account without "code only" never
 * takes a key the server invented.
 */
async function checkEscrowDek(deps: AccountDeps, userId: string, dekId: string, dek: Uint8Array): Promise<void> {
    const rows = (await deps.client.devices()).filter(device => device.dekId === dekId && device.mac)
    if (rows.length === 0) return
    const vouched = rows.some(device => {
        try {
            return deviceMacValid(deps.sodium, dek, { userId, dekId, devicePub: fromB64(deps.sodium, device.devicePub, 32) }, device.mac)
        }
        catch {
            return false
        }
    })
    if (!vouched) throw new UntrustedEscrowError()
}

/**
 * Sign-in with the mailed code (signed like login, the challenge from prelogin). With "code only" on, the server hands
 * over the DEK (escrowDek): this device takes it and is ready. Otherwise the device is signed in with its data locked
 * ("needs-key") and unlocks it as any new device: an approval, the recovery code, or Start fresh. A device that still
 * holds the account's key takes its own row back, as with a password. An account without a password (Google only) is
 * kept as a Google session, so the steps that ask for a password don't.
 */
export async function loginWithCode(deps: AccountDeps, input: { email: string, code: string, deviceName: string }): Promise<CodeSignInResult> {
    const { client, sodium } = deps
    const { challenge } = await client.prelogin(input.email)
    const signing: RequestSigner = await deps.session.signer()
    const answer = await client.codeLogin(input.email, input.code, challenge, signing)
    const { kept, stale, keyChanged, finish } = await startSession(deps, answer.userId, answer.sessionToken, "email", input.email, answer.dekId)
    let escrowDek: Uint8Array | null = null
    try {
        const info = await finish(() => client.account())
        await deps.session.updateSession({ codeLogin: true, ...(info.hasPassword ? {} : { kind: "google" as const, email: null }) })
        const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: false, recoveryWrappedDek: answer.recoveryWrappedDek ?? null, keyChanged, escrow: false }
        const dekId = answer.dekId
        if (kept && dekId) {
            await finish(() => registerDevice(deps, answer.userId, dekId, kept.dek, input.deviceName))
            return { ...result, status: "ready" }
        }
        const escrowText = answer.escrowDek
        if (escrowText && dekId) {
            await finish(async () => {
                escrowDek = fromB64(sodium, escrowText, 32)
                await checkEscrowDek(deps, answer.userId, dekId, escrowDek)
                await registerDevice(deps, answer.userId, dekId, escrowDek, input.deviceName)
            })
            return { ...result, status: "ready", escrow: true }
        }
        if (dekId === null && !info.hasPassword) {
            // a Google account without a key yet: the first app device makes it, as at a Google sign-in
            const dek = newDek(sodium)
            await deps.session.updateSync({ imported: true })
            try {
                await finish(() => registerDevice(deps, answer.userId, newDekId(sodium), dek, input.deviceName))
            }
            finally {
                wipe(sodium, dek)
            }
            return { ...result, status: "ready" }
        }
        return { ...result, status: "needs-key" }
    }
    finally {
        wipe(sodium, kept?.dek, stale?.dek, escrowDek)
    }
}

/**
 * "Set a new password" right after a code sign-in (route password/after-code, at most 15 minutes after it, else 403
 * reauth_required): new salt, KDF and authKey as at sign-up, the DEK this device holds wrapped for the new password and
 * its proof (needed while the session has no device row). Other sessions stay; the server drops a linked Google sign-in.
 */
export async function setNewPasswordAfterCode(deps: AccountDeps, input: { newPassword: string, kdf?: Kdf }): Promise<void> {
    const { sodium } = deps
    const state = await deps.session.load()
    if (!state?.dek || !state.dekId) {
        wipe(sodium, state?.dek)
        throw new AccountCryptoError("this device has no key; unlock it first")
    }
    const email = state.email ?? (await deps.client.account()).email
    const kdf = input.kdf ?? DEFAULT_KDF
    const salt = newSalt(sodium)
    const { authKey, encKey } = await deriveKeys(sodium, input.newPassword, salt, kdf)
    try {
        await deps.client.setPasswordAfterCode({
            authKey: toB64(sodium, authKey),
            salt: toB64(sodium, salt),
            kdf,
            wrappedDek: wrapKey(sodium, state.dek, encKey, state.userId, state.dekId, "password"),
            dekId: state.dekId,
            dekProof: dekProof(sodium, state.dek),
        })
        await deps.session.rememberKdf(email, kdf)
        // the account has a password now: the steps that need one ask for it
        if (state.kind !== "email" || state.email !== email) await deps.session.updateSession({ kind: "email", email })
    }
    finally {
        wipe(sodium, authKey, encKey, state.dek)
    }
}

/**
 * "Sign in with an email code only" on: the password again (its authKey, checked like the other password prompts), then
 * the DEK goes to the server, which can read the synced data from now on. Only the user turns it on.
 */
export async function enableCodeOnly(deps: AccountDeps, input: { password: string }): Promise<void> {
    const authKey = await passwordAuthKey(deps, input.password)
    const state = await deps.session.load()
    try {
        if (!state?.dek || !state.dekId) throw new AccountCryptoError("this device has no key")
        await deps.client.putEscrow(toB64(deps.sodium, state.dek), dekProof(deps.sodium, state.dek), toB64(deps.sodium, authKey))
    }
    finally {
        wipe(deps.sodium, authKey, state?.dek)
    }
}

/** "Code only" off: the server deletes the key it kept, at once; the data is end-to-end encrypted again */
export function disableCodeOnly(deps: AccountDeps): Promise<void> {
    return deps.client.deleteEscrow()
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
    const { kept, stale, keyChanged, finish } = await startSession(deps, answer.userId, answer.sessionToken, "google", null, answer.dekId)
    const result = { userId: answer.userId, emailVerified: answer.emailVerified, created: answer.created, recoveryWrappedDek: answer.recoveryWrappedDek, keyChanged }
    if (answer.dekId === null) {
        const dek = newDek(sodium)
        await deps.session.updateSync({ imported: true })
        try {
            await finish(() => registerDevice(deps, answer.userId, newDekId(sodium), dek, input.deviceName))
        }
        finally {
            wipe(sodium, dek, stale?.dek)
        }
        return { ...result, status: "ready" }
    }
    wipe(sodium, stale?.dek)
    if (kept) {
        // its own live row comes back with the signing key it kept (S3); a removed or signed-out device can't do this
        const dekId = answer.dekId
        try {
            await finish(() => registerDevice(deps, answer.userId, dekId, kept.dek, input.deviceName))
        }
        finally {
            wipe(sodium, kept.dek)
        }
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
        await deps.client.putKeys({
            dekId: state.dekId,
            dekProof: dekProof(deps.sodium, state.dek),
            recoveryWrappedDek: wrapKey(deps.sodium, state.dek, key, state.userId, state.dekId, "recovery"),
            // S3: the server keeps its hash; showing it later lets a device join like the password does
            recoveryProof: recoveryProof(deps.sodium, key),
        })
        return code
    }
    finally {
        wipe(deps.sodium, key, state.dek)
    }
}

/** "Use recovery code" on a signed-in device without the DEK; the code's proof shows the server the owner (S3, I3) */
export async function useRecoveryCode(deps: AccountDeps, input: { code: string, recoveryWrappedDek: string, dekId: string, deviceName: string }): Promise<void> {
    const state = await deps.session.load()
    if (!state) throw new AccountApiError(401, "unauthorized", "Sign in first.")
    const key = recoveryKeyFrom(deps.sodium, input.code)
    try {
        const dek = unwrapKey(deps.sodium, input.recoveryWrappedDek, key, state.userId, input.dekId, "recovery")
        await registerDevice(deps, state.userId, input.dekId, dek, input.deviceName, { recoveryProof: recoveryProof(deps.sodium, key) })
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
    // a code sign-in owns the account for Start fresh: the new key gets no password wrap yet, setNewPasswordAfterCode adds it
    const before = await deps.session.load()
    wipe(sodium, before?.dek)
    const encKey = input.password === undefined && before?.codeLogin ? undefined : await reauth(deps, input.password, input.deviceName)
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
 * Plan 6.9, R4, S2: removing a device in the app is a key change that leaves it out (with the devices a key change
 * leaves out anyway: unverified and signed-out ones). The server removes it in the same step, this device remembers it,
 * and the kept devices learn it from the chain.
 */
export async function removeDevice(deps: AccountDeps, input: { deviceId: string, deviceName: string, password?: string }): Promise<RotationResult> {
    const devices = await checkedDevices(deps)
    const target = devices.find(device => device.id === input.deviceId)
    if (!target) throw new AccountApiError(404, "not_found", "This device is not in the account any more.")
    if (target.current) throw new AccountApiError(409, "invalid_request", "Sign out to remove this device.")
    const keep = devices.filter(device => device.keepByDefault && device.id !== input.deviceId).map(device => device.id)
    return changeKey(deps, { deviceName: input.deviceName, password: input.password, keep })
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
