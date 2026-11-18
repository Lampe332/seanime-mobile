// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5 DEK-Rotation, 6.4 Freigabe, 6.9, Bau-Stand Fix-Design 2 R1–R3 und Fix-Design 3 S1–S6) und dem Server-Vertrag account-server/src/approval.ts, rotate.ts und routes.ts (GET devices, GET account/keys/device)

import { AccountApiError, type AccountClient, type ApprovalRequest, type DeviceInfo } from "./client"
import {
    AccountCryptoError,
    UntrustedDevicesError,
    UntrustedKeyChangeError,
    approvalTranscript,
    boxDek,
    chainMac,
    chainMacValid,
    commitment,
    commitmentMatches,
    decryptPackage,
    dekProof,
    deviceMac,
    deviceMacValid,
    encryptPackage,
    equalBytes,
    fromB64,
    newApprovalRandom,
    newDek,
    newDekId,
    newDeviceKeyPair,
    openBoxedDek,
    recoveryProof,
    sasOf,
    toB64,
    wipe,
    wrapKey,
} from "./crypto"
import type { AccountSession } from "./session"
import type { Sodium, SodiumKeyPair } from "./sodium"

/*
 * Invariants of the account (fix design 3). The server is not trusted with keys; each one is a test in
 * server.e2e.test.ts (named after it) against the real Worker.
 *
 * I1 A device takes a DEK only through: the password wrap, the recovery wrap (flows.ts), ONE approval its user confirmed
 *    on BOTH devices (exactly one number per request: "No", a timeout or any swapped value ends the request for good),
 *    or a key chain from the DEK it holds, made by a device it does not know as removed (pickUpDeviceKey).
 * I2 A device hands out the real DEK only to the device whose number its user confirmed with "Yes" here (approveRequest),
 *    or by a key change to the devices the user kept in the list (rotate, an allowlist: every other row is removed).
 * I3 Owning the account (the password, or the recovery code) always allows joining, changing the key and Start fresh.
 *    The DEK proof alone never allows a sign-in, joining again or a key change (account-server routes.ts putKeys).
 * I4 The owner is never locked out for good: over the email's counter a right password signs in through a mailed link.
 * I5 Every change that matters for security (new device, sign-out, removal, key change, recovery code, Google link,
 *    Start fresh) sends a mail and leaves an event the app and the website list.
 */

export type AccountDeps = { client: AccountClient, session: AccountSession, sodium: Sodium }

/** This device's key pair, made once and kept in the secured storage */
export async function deviceKeys(deps: AccountDeps): Promise<SodiumKeyPair> {
    const kept = await deps.session.deviceKeys()
    if (kept) return kept
    const keys = newDeviceKeyPair(deps.sodium)
    await deps.session.saveDeviceKeys(keys)
    return keys
}

/* ---- New device (plan 6.4 steps 1, 3, 6; approval v2, S1) ---- */

export type PendingApproval = {
    id: string
    expiresAt: number
    devicePub: Uint8Array
    rN: Uint8Array
    /** This device sent rN (only after it saw rO); an approval that never passed through here is refused */
    revealed: boolean
    /** The ONE number this request shows, with the other device's key and random value it came from; never replaced */
    shown: { sas: string, approverPub: string, approverNonce: string } | null
    /** The user confirmed the shown number on this device ("Yes, same number"); the key is taken only then */
    confirmed: boolean
    /** S1: "No", a timeout, a denial or a swapped value ended the request for good; nothing is taken from it any more */
    ended: boolean
}

export type ApprovalProgress =
    | { state: "waiting" }
    /** Show the number and ask whether the other device shows the same; `confirmed`: the user said yes here */
    | { state: "compare", sas: string, confirmed: boolean }
    | { state: "approved" }
    | { state: "denied" }
    | { state: "expired" }

/**
 * Step 1: asks the account's devices to approve this one, with a new device key pair (a request never takes over an
 * existing device row, NEU-12). Keep the result in memory until the request ends; a new attempt is a new request.
 */
export async function requestApproval(deps: AccountDeps, deviceName: string): Promise<PendingApproval> {
    const keys = newDeviceKeyPair(deps.sodium)
    await deps.session.saveDeviceKeys(keys)
    const rN = newApprovalRandom(deps.sodium)
    const created = await deps.client.createRequest({
        deviceName,
        devicePub: toB64(deps.sodium, keys.publicKey),
        commitment: toB64(deps.sodium, commitment(deps.sodium, keys.publicKey, rN)),
    })
    return { id: created.id, expiresAt: created.expiresAt, devicePub: keys.publicKey, rN, revealed: false, shown: null, confirmed: false, ended: false }
}

const changed = () => new AccountCryptoError("the request was changed on the way; nothing was taken")

/** S1: the request is over on this device; the server hears "deny" (best effort, a server that ignores it changes nothing) */
async function endRequest(deps: AccountDeps, pending: PendingApproval): Promise<void> {
    if (pending.ended) return
    pending.ended = true
    pending.confirmed = false
    wipe(deps.sodium, pending.rN)
    try {
        await deps.client.deny(pending.id)
    }
    catch (error) {
        if (!(error instanceof AccountApiError)) throw error
    }
}

function showNumber(deps: AccountDeps, pending: PendingApproval, request: ApprovalRequest): { sas: string, transcript: Uint8Array } | null {
    const { sodium } = deps
    // NEU3-1: once a number was shown, the other device's key and random value are fixed for this request
    if (pending.shown && (pending.shown.approverPub !== request.approverPub || pending.shown.approverNonce !== request.approverNonce)) return null
    const approverPub = fromB64(sodium, request.approverPub ?? "", 32)
    const rO = fromB64(sodium, request.approverNonce ?? "", 32)
    const transcript = approvalTranscript(sodium, pending.devicePub, approverPub, pending.rN, rO)
    const sas = sasOf(transcript)
    pending.shown ??= { sas, approverPub: request.approverPub!, approverNonce: request.approverNonce! }
    return { sas, transcript }
}

/**
 * Steps 3 and 6, called while "Approve on your phone" shows: reveals rN once the other device sent its key and rO (never
 * before), shows the number, and takes the DEK only when (a) the user confirmed that number on THIS device, (b) the box
 * opens with the key of the device that number belongs to and (c) it is bound to this request (NEU-1). S1 (NEU3-1): a
 * request shows exactly one number; once it ended ("No", denied, expired, a swapped value) it only ever says "denied".
 */
export async function checkApproval(deps: AccountDeps, pending: PendingApproval): Promise<ApprovalProgress> {
    const { client, session, sodium } = deps
    if (pending.ended) return { state: "denied" }
    const request = await client.request(pending.id)
    const fail = async () => {
        await endRequest(deps, pending)
        return changed()
    }
    if (request.devicePub !== toB64(sodium, pending.devicePub)) throw await fail()
    switch (request.status) {
        case "pending":
            return { state: "waiting" }
        case "denied":
        case "expired":
            pending.ended = true
            pending.confirmed = false
            wipe(sodium, pending.rN)
            return { state: request.status }
        case "nonce":
        case "revealed": {
            if (request.status === "revealed" && !pending.revealed) throw await fail()
            const shown = showNumber(deps, pending, request)
            if (!shown) throw await fail()
            if (!pending.revealed) {
                await client.reveal(pending.id, toB64(sodium, pending.rN))
                pending.revealed = true
            }
            return { state: "compare", sas: shown.sas, confirmed: pending.confirmed }
        }
        case "approved": {
            if (!pending.revealed) throw await fail()
            const shown = showNumber(deps, pending, request)
            if (!shown) throw await fail()
            // the other device approved; this one waits until its own user said the numbers are the same
            if (!pending.confirmed) return { state: "compare", sas: shown.sas, confirmed: false }
            if (!request.sealedDek || !request.dekId || !request.deviceId) throw new AccountApiError(502, "invalid_request", "The approval came without a key.")
            const keys = await session.deviceKeys()
            if (!keys || !equalBytes(keys.publicKey, pending.devicePub)) throw await fail()
            const dek = openBoxedDek(sodium, request.sealedDek, request.dekId, { kind: "approve", transcript: shown.transcript }, fromB64(sodium, request.approverPub!, 32), keys)
            await session.saveDek(request.dekId, dek)
            await session.updateSession({ deviceId: request.deviceId })
            // the account's data is never applied without asking: the import question comes first
            await session.updateSync({ imported: false, highestVersion: 0, lastHash: null, lastSyncAt: null })
            wipe(sodium, dek, pending.rN)
            pending.ended = true
            return { state: "approved" }
        }
    }
}

/**
 * The user's answer on this device to "Does your other device show this number?". No (S1): the request ends for good on
 * both sides, nothing is ever taken from it; a new attempt is a new request with new keys. Yes: the key is taken as soon
 * as the other device approved (checkApproval).
 */
export async function confirmApproval(deps: AccountDeps, pending: PendingApproval, same: boolean): Promise<ApprovalProgress> {
    if (pending.ended) return { state: "denied" }
    if (!pending.shown) throw new AccountCryptoError("there is no number to confirm yet")
    if (!same) {
        await endRequest(deps, pending)
        return { state: "denied" }
    }
    pending.confirmed = true
    return checkApproval(deps, pending)
}

/* ---- Old device (plan 6.4 steps 2, 4, 5) ---- */

export type ApproverTurn = { request: ApprovalRequest, rO: Uint8Array }

/** Requests waiting for an approval (when the app opens and with every sync tick) */
export function openRequests(deps: AccountDeps): Promise<ApprovalRequest[]> {
    return deps.client.openRequests()
}

/**
 * Step 2, only after the user tapped "Show number" (NEU3-10): this device answers a request with its random rO and its own
 * device key (both go into the number)
 */
export async function answerRequest(deps: AccountDeps, request: ApprovalRequest): Promise<ApproverTurn> {
    const state = await deps.session.load()
    wipe(deps.sodium, state?.dek)
    if (!state?.deviceKeys) throw new AccountCryptoError("this device has no key to share")
    if ((await deps.session.removedDevices(state.userId)).includes(request.devicePub)) {
        await deps.client.deny(request.id)
        throw new AccountCryptoError("a removed device asked to sign in again; the request was denied")
    }
    const rO = newApprovalRandom(deps.sodium)
    await deps.client.sendNonce(request.id, toB64(deps.sodium, rO), toB64(deps.sodium, state.deviceKeys.publicKey))
    return { request, rO }
}

async function checkedTurn(deps: AccountDeps, turn: ApproverTurn): Promise<{ progress: ApprovalProgress, transcript: Uint8Array | null }> {
    const { client, sodium } = deps
    const request = await client.request(turn.request.id)
    if (request.status === "nonce" || request.status === "pending") return { progress: { state: "waiting" }, transcript: null }
    if (request.status === "approved" || request.status === "denied" || request.status === "expired") return { progress: { state: request.status }, transcript: null }
    const own = await deps.session.deviceKeys()
    const devicePub = fromB64(sodium, request.devicePub, 32)
    const intact = !!own
        && request.devicePub === turn.request.devicePub
        && request.commitment === turn.request.commitment
        && request.approverNonce === toB64(sodium, turn.rO)
        && request.approverPub === toB64(sodium, own.publicKey)
        && request.reveal !== null
        && commitmentMatches(sodium, devicePub, fromB64(sodium, request.reveal, 32), fromB64(sodium, request.commitment, 32))
    if (!intact) {
        await client.deny(request.id)
        throw new AccountCryptoError("the device check failed; the request was denied")
    }
    const transcript = approvalTranscript(sodium, devicePub, own!.publicKey, fromB64(sodium, request.reveal!, 32), turn.rO)
    return { progress: { state: "compare", sas: sasOf(transcript), confirmed: false }, transcript }
}

/**
 * Step 4: once the new device revealed rN, checks its commitment (made before it knew rO) and that the server swapped
 * neither key nor rO. A failed check denies the request. Returns the number to compare (one per request: rO, the new
 * device's key and its committed rN are fixed).
 */
export async function compareRequest(deps: AccountDeps, turn: ApproverTurn): Promise<ApprovalProgress> {
    return (await checkedTurn(deps, turn)).progress
}

/**
 * Step 5, after the user compared the numbers: the DEK boxed from this device's key to the new device's key, bound to
 * this request (crypto_box, approval v2), and this device's MAC for the new row.
 */
export async function approveRequest(deps: AccountDeps, turn: ApproverTurn): Promise<void> {
    const state = await deps.session.load()
    if (!state?.dek || !state.dekId || !state.deviceKeys) throw new AccountCryptoError("this device has no key to share")
    try {
        const { progress, transcript } = await checkedTurn(deps, turn)
        if (progress.state !== "compare" || !transcript) throw new AccountApiError(409, "wrong_order", `The request is ${progress.state}.`)
        const devicePub = fromB64(deps.sodium, turn.request.devicePub, 32)
        const boxed = boxDek(deps.sodium, state.dek, state.dekId, { kind: "approve", transcript }, devicePub, state.deviceKeys)
        // the new device's row carries this device's MAC, so the other devices trust it too
        const mac = deviceMac(deps.sodium, state.dek, { userId: state.userId, dekId: state.dekId, devicePub })
        await deps.client.approve(turn.request.id, state.dekId, boxed, mac)
    }
    finally {
        wipe(deps.sodium, state.dek, turn.rO)
    }
}

export function denyRequest(deps: AccountDeps, requestId: string): Promise<void> {
    return deps.client.deny(requestId)
}

/* ---- The device list, checked against the DEK (K-1) ---- */

export type CheckedDevice = DeviceInfo & {
    /** A holder of the current DEK added it (valid MAC) and this device does not know it as removed */
    verified: boolean
    /** S4: it signed out (it may have kept the old key) */
    signedOut: boolean
    /** S2: whether a key change keeps it unless the user says otherwise: verified and not signed out */
    keepByDefault: boolean
}

/**
 * The account's devices, each marked whether a holder of the current DEK added it (valid MAC) and it is no device this
 * one knows as removed. The server cannot add a verified device; an unverified one is shown as such and gets nothing.
 */
export async function checkedDevices(deps: AccountDeps): Promise<CheckedDevice[]> {
    const [state, devices] = await Promise.all([deps.session.load(), deps.client.devices()])
    try {
        const removed = state ? new Set(await deps.session.removedDevices(state.userId)) : new Set<string>()
        return devices.map(device => {
            const verified = !!state && !removed.has(device.devicePub) && deviceVerified(deps, state, device)
            const signedOut = device.signedOutAt != null
            return { ...device, verified, signedOut, keepByDefault: verified && !signedOut }
        })
    }
    finally {
        wipe(deps.sodium, state?.dek)
    }
}

function deviceVerified(deps: AccountDeps, state: { userId: string, dek: Uint8Array | null, dekId: string | null, deviceKeys: { publicKey: Uint8Array } | null }, device: DeviceInfo): boolean {
    if (!state.dek || !state.dekId || device.dekId !== state.dekId) return false
    let pub: Uint8Array
    try {
        pub = fromB64(deps.sodium, device.devicePub, 32)
    }
    catch {
        return false
    }
    // the row the server calls this device must hold this device's own key
    if (device.current && (!state.deviceKeys || !equalBytes(pub, state.deviceKeys.publicKey))) return false
    return deviceMacValid(deps.sodium, state.dek, { userId: state.userId, dekId: state.dekId, devicePub: pub }, device.mac)
}

/* ---- DEK rotation (plan 5, 6.9; chain v2, R3; allowlist, S2) ---- */

/**
 * Another device rotated the DEK: this device fetches the new DEK boxed to its key and takes it only when (a) the
 * rotating device's own key made the box, (b) that device is none this one knows as removed, and (c) the DEK this device
 * holds vouches for the new one, the rotating device and the list of removed devices (chain v2). The removed devices of
 * the chain are remembered. Anything else (a key the server or a session without the DEK made up, a removed device's
 * chain, start fresh elsewhere, a jump over a rotation this device missed) ends in UntrustedKeyChangeError; the device
 * then imports and uploads nothing until the user signs in again. False when the server holds no newer key for it.
 */
export async function pickUpDeviceKey(deps: { api: Pick<AccountClient, "deviceKey">, session: AccountSession, sodium: Sodium }): Promise<boolean> {
    const { session, sodium } = deps
    const state = await session.load()
    if (!state?.deviceKeys || !state.deviceId || !state.dek || !state.dekId) {
        wipe(sodium, state?.dek)
        return false
    }
    let dek: Uint8Array | null = null
    try {
        const key = await deps.api.deviceKey()
        if (key.deviceId !== state.deviceId || key.dekId === state.dekId) return false
        const removed = Array.isArray(key.removed) ? key.removed : []
        if (key.chainFrom !== state.dekId || !key.rotatorPub || removed.includes(toB64(sodium, state.deviceKeys.publicKey))) throw new UntrustedKeyChangeError()
        // NEU-3: a device this one knows as removed may know the old DEK, but its chain is never taken
        if ((await session.removedDevices(state.userId)).includes(key.rotatorPub)) throw new UntrustedKeyChangeError()
        const rotatorPub = fromB64(sodium, key.rotatorPub, 32)
        dek = openBoxedDek(sodium, key.sealedDek, key.dekId, { kind: "rotate", userId: state.userId }, rotatorPub, state.deviceKeys)
        const binding = { userId: state.userId, oldDekId: state.dekId, newDekId: key.dekId, rotatorPub, removed }
        if (!chainMacValid(sodium, state.dek, binding, dek, key.chainMac)) throw new UntrustedKeyChangeError()
        await session.addRemoved(state.userId, removed)
        await session.saveDek(key.dekId, dek)
        return true
    }
    catch (error) {
        if (error instanceof AccountCryptoError) throw error instanceof UntrustedKeyChangeError ? error : new UntrustedKeyChangeError()
        throw error
    }
    finally {
        wipe(sodium, dek, state.dek)
    }
}

export type RotationResult = {
    dekId: string
    version: number
    recoveryRenewed: boolean
    /** "Recovery code needs renewal": the rotation ran without the code, the server dropped the old recovery wrap */
    recoveryNeedsRenewal: boolean
}

/** The server takes at most this many removed device keys per rotation */
const MAX_REMOVED = 50

/**
 * "Change encryption key" (S2, I2): a new DEK, the stored package re-encrypted with it, boxed from this device ONLY to the
 * devices in `keep` (device ids; this device always keeps it) and every other row of the account removed in the same
 * step. A kept device must be verified, not signed out and not known here as removed, else UntrustedDevicesError. New
 * password wrap (`encKey`, required for email accounts) and recovery wrap (`recoveryKey`, else the old recovery code stops
 * working). The chain names this device and the devices left out, so the kept devices learn them.
 * Needs a sign-in within the last 10 minutes (the server answers ReauthRequiredError otherwise).
 */
export async function rotate(deps: AccountDeps, choice: { keep: string[], encKey?: Uint8Array, recoveryKey?: Uint8Array }): Promise<RotationResult> {
    const { client, session, sodium } = deps
    const state = await session.load()
    if (!state?.dek || !state.dekId || !state.deviceKeys || !state.deviceId) throw new AccountCryptoError("this device has no key to rotate")
    if (state.kind === "email" && !choice.encKey) throw new AccountCryptoError("the password is needed to rotate the key")

    let plain: Uint8Array | null = null
    const dek = newDek(sodium)
    try {
        const meta = await client.syncMeta()
        if (meta.dekId !== null && meta.dekId !== state.dekId) throw new AccountApiError(409, "dek_mismatch", "The account uses a different key.")
        const snapshot = meta.version > 0 ? await client.snapshot() : null
        if (snapshot && (snapshot.version !== meta.version || snapshot.version < state.highestVersion)) throw new AccountApiError(409, "version_conflict", "The synced data changed. Try again.")
        plain = snapshot ? decryptPackage(sodium, snapshot.bytes, state.dek, { userId: state.userId, version: snapshot.version, dekId: state.dekId }) : null

        const known = new Set(await session.removedDevices(state.userId))
        const wanted = new Set([...choice.keep, state.deviceId])
        const devices = await client.devices()
        if ([...wanted].some(id => !devices.some(device => device.id === id))) throw new AccountApiError(409, "device_set_mismatch", "The device list changed. Reload it and choose again.")
        const kept = devices.filter(device => wanted.has(device.id))
        // only devices a DEK holder added, still signed in and not removed get the new key
        const refused = kept.filter(device => device.signedOutAt != null || known.has(device.devicePub) || !deviceVerified(deps, state, device))
        if (refused.length > 0) throw new UntrustedDevicesError(refused.map(device => device.name))
        const left = devices.filter(device => !wanted.has(device.id)).map(device => device.devicePub)
        if (left.length > MAX_REMOVED) throw new AccountApiError(409, "device_set_mismatch", "Too many devices to leave out at once.")

        const dekId = newDekId(sodium)
        const sealed = kept.map(device => {
            const devicePub = fromB64(sodium, device.devicePub, 32)
            return {
                deviceId: device.id,
                sealedDek: boxDek(sodium, dek, dekId, { kind: "rotate", userId: state.userId }, devicePub, state.deviceKeys!),
                mac: deviceMac(sodium, dek, { userId: state.userId, dekId, devicePub }),
            }
        })
        const blob = plain ? encryptPackage(sodium, plain, dek, { userId: state.userId, version: meta.version + 1, dekId }) : null
        const binding = { userId: state.userId, oldDekId: state.dekId, newDekId: dekId, rotatorPub: state.deviceKeys.publicKey, removed: left }
        const result = await client.rotate({
            oldDekId: state.dekId,
            dekId,
            dekProof: dekProof(sodium, dek),
            chainMac: chainMac(sodium, state.dek, binding, dek),
            devices: sealed,
            removed: left,
            ...(choice.encKey ? { wrappedDek: wrapKey(sodium, dek, choice.encKey, state.userId, dekId, "password") } : {}),
            ...(choice.recoveryKey
                ? { recoveryWrappedDek: wrapKey(sodium, dek, choice.recoveryKey, state.userId, dekId, "recovery"), recoveryProof: recoveryProof(sodium, choice.recoveryKey) }
                : {}),
        }, blob, meta.version)
        // the devices left out are this device's own removals: never sealed to again, their chains refused
        await session.addRemoved(state.userId, left)
        await session.saveDek(dekId, dek)
        await session.updateSync({ highestVersion: Math.max(state.highestVersion, result.version) })
        return { dekId, version: result.version, recoveryRenewed: choice.recoveryKey !== undefined, recoveryNeedsRenewal: result.recoveryRenewalNeeded === true }
    }
    finally {
        wipe(sodium, dek, plain, state.dek)
    }
}
