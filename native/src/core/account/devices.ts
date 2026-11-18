// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5 DEK-Rotation, 6.4 Freigabe, 6.9, Bau-Stand Fix-Design 2 R1–R3) und dem Server-Vertrag account-server/src/approval.ts, rotate.ts und routes.ts (GET devices, GET account/keys/device, sync/meta removedDevices)

import { AccountApiError, type AccountClient, type ApprovalRequest, type DeviceInfo } from "./client"
import {
    AccountCryptoError,
    RemovedDeviceListedError,
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
    sasOf,
    toB64,
    wipe,
    wrapKey,
} from "./crypto"
import type { AccountSession } from "./session"
import type { Sodium, SodiumKeyPair } from "./sodium"

/*
 * R1: a device takes a DEK only on four authentic ways: the password wrap, the recovery wrap (flows.ts), the approval box
 * from the device whose number the user confirmed on THIS device, and a key chain from the DEK it holds, made by a device
 * it does not know as removed. Never from an anonymous sealed box, and never because the server says so.
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

/* ---- New device (plan 6.4 steps 1, 3, 6; approval v2) ---- */

export type PendingApproval = {
    id: string
    expiresAt: number
    devicePub: Uint8Array
    rN: Uint8Array
    /** This device sent rN (only after it saw rO); an approval that never passed through here is refused */
    revealed: boolean
    /** The number shown, with the other device's key and random value it came from */
    shown: { sas: string, approverPub: string, approverNonce: string } | null
    /** The number the user confirmed on this device ("Yes, it's the same"); the key is taken only then */
    confirmed: string | null
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
 * existing device row, NEU-12). Keep the result in memory until the request ends.
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
    return { id: created.id, expiresAt: created.expiresAt, devicePub: keys.publicKey, rN, revealed: false, shown: null, confirmed: null }
}

const changed = () => new AccountCryptoError("the request was changed on the way; nothing was taken")

function showNumber(deps: AccountDeps, pending: PendingApproval, request: ApprovalRequest): { sas: string, transcript: Uint8Array } {
    const { sodium } = deps
    const approverPub = fromB64(sodium, request.approverPub ?? "", 32)
    const rO = fromB64(sodium, request.approverNonce ?? "", 32)
    const transcript = approvalTranscript(sodium, pending.devicePub, approverPub, pending.rN, rO)
    const shown = sasOf(transcript)
    // the server may not swap the other device's key or random value once the number is on the screen
    if (pending.shown && (pending.shown.approverPub !== request.approverPub || pending.shown.approverNonce !== request.approverNonce)) throw changed()
    pending.shown = { sas: shown, approverPub: request.approverPub!, approverNonce: request.approverNonce! }
    return { sas: shown, transcript }
}

/**
 * Steps 3 and 6, called while "Approve on your phone" shows: reveals rN once the other device sent its key and rO (never
 * before), shows the number, and takes the DEK only when (a) the user confirmed the same number on THIS device, (b) the
 * box opens with the key of the device that number belongs to and (c) it is bound to this request (NEU-1). An approval
 * the server made up, or one with another key, never opens.
 */
export async function checkApproval(deps: AccountDeps, pending: PendingApproval): Promise<ApprovalProgress> {
    const { client, session, sodium } = deps
    const request = await client.request(pending.id)
    if (request.devicePub !== toB64(sodium, pending.devicePub)) throw changed()
    switch (request.status) {
        case "pending":
            return { state: "waiting" }
        case "denied":
        case "expired":
            wipe(sodium, pending.rN)
            return { state: request.status }
        case "nonce":
        case "revealed": {
            if (request.status === "revealed" && !pending.revealed) throw changed()
            const { sas } = showNumber(deps, pending, request)
            if (!pending.revealed) {
                await client.reveal(pending.id, toB64(sodium, pending.rN))
                pending.revealed = true
            }
            return { state: "compare", sas, confirmed: pending.confirmed === sas }
        }
        case "approved": {
            if (!pending.revealed) throw changed()
            const { sas, transcript } = showNumber(deps, pending, request)
            // the other device approved; this one waits until its own user said the numbers are the same
            if (pending.confirmed === null) return { state: "compare", sas, confirmed: false }
            if (pending.confirmed !== sas) throw changed()
            if (!request.sealedDek || !request.dekId || !request.deviceId) throw new AccountApiError(502, "invalid_request", "The approval came without a key.")
            const keys = await session.deviceKeys()
            if (!keys || !equalBytes(keys.publicKey, pending.devicePub)) throw changed()
            const dek = openBoxedDek(sodium, request.sealedDek, request.dekId, { kind: "approve", transcript }, fromB64(sodium, request.approverPub!, 32), keys)
            await session.saveDek(request.dekId, dek)
            await session.updateSession({ deviceId: request.deviceId })
            // the account's data is never applied without asking: the import question comes first
            await session.updateSync({ imported: false, highestVersion: 0, lastHash: null, lastSyncAt: null })
            wipe(sodium, dek, pending.rN)
            return { state: "approved" }
        }
    }
}

/**
 * The user's answer on this device to "Does your other device show this number?". No: the request is denied right away.
 * Yes: the key is taken as soon as the other device approved (checkApproval).
 */
export async function confirmApproval(deps: AccountDeps, pending: PendingApproval, same: boolean): Promise<ApprovalProgress> {
    if (!pending.shown) throw new AccountCryptoError("there is no number to confirm yet")
    if (!same) {
        try {
            await deps.client.deny(pending.id)
        }
        catch (error) {
            // the server may say it is approved already: this device refuses it anyway, it never opens the key
            if (!(error instanceof AccountApiError)) throw error
        }
        wipe(deps.sodium, pending.rN)
        pending.confirmed = null
        pending.shown = null
        return { state: "denied" }
    }
    pending.confirmed = pending.shown.sas
    return checkApproval(deps, pending)
}

/* ---- Old device (plan 6.4 steps 2, 4, 5) ---- */

export type ApproverTurn = { request: ApprovalRequest, rO: Uint8Array }

/** Requests waiting for an approval (when the app opens and with every sync tick) */
export function openRequests(deps: AccountDeps): Promise<ApprovalRequest[]> {
    return deps.client.openRequests()
}

/** Step 2: this device answers a request with its random rO and its own device key (both go into the number) */
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
 * neither key nor rO. A failed check denies the request. Returns the number to compare.
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

/* ---- The device list, checked against the DEK (K-1) ---- */

export type CheckedDevice = DeviceInfo & { verified: boolean }

/**
 * The account's devices, each marked whether a holder of the current DEK added it (valid MAC) and it is no device this
 * one knows as removed. The server cannot add a verified device; an unverified one is shown as such and gets nothing.
 */
export async function checkedDevices(deps: AccountDeps): Promise<CheckedDevice[]> {
    const [state, devices] = await Promise.all([deps.session.load(), deps.client.devices()])
    try {
        const removed = state ? new Set(await deps.session.removedDevices(state.userId)) : new Set<string>()
        return devices.map(device => ({ ...device, verified: !!state?.dek && !!state.dekId && !removed.has(device.devicePub) && deviceVerified(deps, state, device) }))
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

export function denyRequest(deps: AccountDeps, requestId: string): Promise<void> {
    return deps.client.deny(requestId)
}

/* ---- DEK rotation (plan 5, 6.9; chain v2, R3) ---- */

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
 * A new DEK: the stored package re-encrypted with it, boxed from this device to every device of the account, new password
 * wrap (`encKey`, required for email accounts) and recovery wrap (`recoveryKey`, else the old recovery code stops working).
 * Devices this one knows as removed (its own removals, `removedNow`, the chains it took, the server's list) are never
 * sealed to: when the server lists one again the rotation stops with RemovedDeviceListedError (NEU-3). The chain names
 * this device as the rotating one and the removed devices, so the other devices learn them.
 * Needs a sign-in within the last 10 minutes (the server answers ReauthRequiredError otherwise).
 */
export async function rotate(deps: AccountDeps, keys: { encKey?: Uint8Array, recoveryKey?: Uint8Array } = {}, removedNow: string[] = []): Promise<RotationResult> {
    const { client, session, sodium } = deps
    const state = await session.load()
    if (!state?.dek || !state.dekId || !state.deviceKeys || !state.deviceId) throw new AccountCryptoError("this device has no key to rotate")
    if (state.kind === "email" && !keys.encKey) throw new AccountCryptoError("the password is needed to rotate the key")

    let plain: Uint8Array | null = null
    const dek = newDek(sodium)
    try {
        const meta = await client.syncMeta()
        if (meta.dekId !== null && meta.dekId !== state.dekId) throw new AccountApiError(409, "dek_mismatch", "The account uses a different key.")
        const removed = [...new Set([...(await session.removedDevices(state.userId)), ...(meta.removedDevices ?? []), ...removedNow])]
        await session.addRemoved(state.userId, removed)
        const snapshot = meta.version > 0 ? await client.snapshot() : null
        if (snapshot && (snapshot.version !== meta.version || snapshot.version < state.highestVersion)) throw new AccountApiError(409, "version_conflict", "The synced data changed. Try again.")
        plain = snapshot ? decryptPackage(sodium, snapshot.bytes, state.dek, { userId: state.userId, version: snapshot.version, dekId: state.dekId }) : null

        const devices = await client.devices()
        const relisted = devices.filter(device => removed.includes(device.devicePub))
        if (relisted.length > 0) throw new RemovedDeviceListedError(relisted.map(device => device.name))
        // only devices a DEK holder added get the new key; a row nobody vouches for stops the rotation (remove it first)
        const untrusted = devices.filter(device => !deviceVerified(deps, state, device))
        if (untrusted.length > 0) throw new UntrustedDevicesError(untrusted.map(device => device.name))

        const dekId = newDekId(sodium)
        const chainRemoved = removed.slice(-MAX_REMOVED)
        const sealed = devices.map(device => {
            const devicePub = fromB64(sodium, device.devicePub, 32)
            return {
                deviceId: device.id,
                sealedDek: boxDek(sodium, dek, dekId, { kind: "rotate", userId: state.userId }, devicePub, state.deviceKeys!),
                mac: deviceMac(sodium, dek, { userId: state.userId, dekId, devicePub }),
            }
        })
        const blob = plain ? encryptPackage(sodium, plain, dek, { userId: state.userId, version: meta.version + 1, dekId }) : null
        const binding = { userId: state.userId, oldDekId: state.dekId, newDekId: dekId, rotatorPub: state.deviceKeys.publicKey, removed: chainRemoved }
        const result = await client.rotate({
            oldDekId: state.dekId,
            dekId,
            dekProof: dekProof(sodium, dek),
            chainMac: chainMac(sodium, state.dek, binding, dek),
            devices: sealed,
            removed: chainRemoved,
            ...(keys.encKey ? { wrappedDek: wrapKey(sodium, dek, keys.encKey, state.userId, dekId, "password") } : {}),
            ...(keys.recoveryKey ? { recoveryWrappedDek: wrapKey(sodium, dek, keys.recoveryKey, state.userId, dekId, "recovery") } : {}),
        }, blob, meta.version)
        await session.saveDek(dekId, dek)
        await session.updateSync({ highestVersion: Math.max(state.highestVersion, result.version) })
        return { dekId, version: result.version, recoveryRenewed: keys.recoveryKey !== undefined, recoveryNeedsRenewal: result.recoveryRenewalNeeded === true }
    }
    finally {
        wipe(sodium, dek, plain, state.dek)
    }
}
