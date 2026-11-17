// geschrieben nach: Plan „Account + Sync“ (Abschnitte 5 DEK-Rotation, 6.4 Freigabe, 6.9) und dem Server-Vertrag account-server/src/approval.ts und rotate.ts

import { AccountApiError, type AccountClient, type ApprovalRequest } from "./client"
import {
    AccountCryptoError,
    commitment,
    commitmentMatches,
    decryptPackage,
    encryptPackage,
    fromB64,
    newApprovalRandom,
    newDek,
    newDekId,
    newDeviceKeyPair,
    openSealedDek,
    sas,
    sealDek,
    toB64,
    wipe,
    wrapKey,
} from "./crypto"
import type { AccountSession } from "./session"
import type { Sodium, SodiumKeyPair } from "./sodium"

export type AccountDeps = { client: AccountClient, session: AccountSession, sodium: Sodium }

/** The server lacks something this step needs (named in the message); the server, not the app, has to change */
export class ServerContractError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "ServerContractError"
    }
}

/** This device's key pair, made once and kept in the secured storage */
export async function deviceKeys(deps: AccountDeps): Promise<SodiumKeyPair> {
    const kept = await deps.session.deviceKeys()
    if (kept) return kept
    const keys = newDeviceKeyPair(deps.sodium)
    await deps.session.saveDeviceKeys(keys)
    return keys
}

/* ---- New device (plan 6.4 steps 1, 3, 6) ---- */

export type PendingApproval = { id: string, expiresAt: number, devicePub: Uint8Array, rN: Uint8Array }

export type ApprovalProgress =
    | { state: "waiting" }
    /** Show the number; the old device shows the same one */
    | { state: "compare", sas: string }
    | { state: "approved" }
    | { state: "denied" }
    | { state: "expired" }

/** Step 1: asks the account's devices to approve this one. Keep the result in memory until the request ends. */
export async function requestApproval(deps: AccountDeps, deviceName: string): Promise<PendingApproval> {
    const keys = await deviceKeys(deps)
    const rN = newApprovalRandom(deps.sodium)
    const created = await deps.client.createRequest({
        deviceName,
        devicePub: toB64(deps.sodium, keys.publicKey),
        commitment: toB64(deps.sodium, commitment(deps.sodium, keys.publicKey, rN)),
    })
    return { id: created.id, expiresAt: created.expiresAt, devicePub: keys.publicKey, rN }
}

/**
 * Steps 3 and 6, called while "Approve on your phone" shows: reveals rN once the old device sent rO (never before),
 * shows the number, and takes the DEK once approved.
 */
export async function checkApproval(deps: AccountDeps, pending: PendingApproval): Promise<ApprovalProgress> {
    const { client, session, sodium } = deps
    const request = await client.request(pending.id)
    switch (request.status) {
        case "pending":
            return { state: "waiting" }
        case "denied":
        case "expired":
            wipe(sodium, pending.rN)
            return { state: request.status }
        case "nonce":
        case "revealed": {
            if (request.devicePub !== toB64(sodium, pending.devicePub)) throw new AccountCryptoError("the request was changed")
            const rO = fromB64(sodium, request.approverNonce ?? "", 32)
            if (request.status === "nonce") await client.reveal(pending.id, toB64(sodium, pending.rN))
            return { state: "compare", sas: sas(sodium, pending.devicePub, pending.rN, rO) }
        }
        case "approved": {
            if (!request.sealedDek || !request.dekId || !request.deviceId) throw new AccountApiError(502, "invalid_request", "The approval came without a key.")
            const keys = await deviceKeys(deps)
            const dek = openSealedDek(sodium, request.sealedDek, keys)
            await session.saveDek(request.dekId, dek)
            await session.updateSession({ deviceId: request.deviceId })
            wipe(sodium, dek, pending.rN)
            return { state: "approved" }
        }
    }
}

/* ---- Old device (plan 6.4 steps 2, 4, 5) ---- */

export type ApproverTurn = { request: ApprovalRequest, rO: Uint8Array }

/** Requests waiting for an approval (when the app opens and with every sync tick) */
export function openRequests(deps: AccountDeps): Promise<ApprovalRequest[]> {
    return deps.client.openRequests()
}

/** Step 2: this device answers a request with its random rO */
export async function answerRequest(deps: AccountDeps, request: ApprovalRequest): Promise<ApproverTurn> {
    const rO = newApprovalRandom(deps.sodium)
    await deps.client.sendNonce(request.id, toB64(deps.sodium, rO))
    return { request, rO }
}

/**
 * Step 4: once the new device revealed rN, checks SHA-256(pkN || rN) against the commitment it made before it knew rO,
 * and that the server did not swap key or rO. A failed check denies the request. Returns the number to compare.
 */
export async function compareRequest(deps: AccountDeps, turn: ApproverTurn): Promise<ApprovalProgress> {
    const { client, sodium } = deps
    const request = await client.request(turn.request.id)
    if (request.status === "nonce" || request.status === "pending") return { state: "waiting" }
    if (request.status === "approved" || request.status === "denied" || request.status === "expired") return { state: request.status }
    const devicePub = fromB64(sodium, request.devicePub, 32)
    const intact = request.devicePub === turn.request.devicePub
        && request.commitment === turn.request.commitment
        && request.approverNonce === toB64(sodium, turn.rO)
        && request.reveal !== null
        && commitmentMatches(sodium, devicePub, fromB64(sodium, request.reveal, 32), fromB64(sodium, request.commitment, 32))
    if (!intact) {
        await client.deny(request.id)
        throw new AccountCryptoError("the device check failed; the request was denied")
    }
    return { state: "compare", sas: sas(sodium, devicePub, fromB64(sodium, request.reveal!, 32), turn.rO) }
}

/** Step 5, after the user compared the numbers: the DEK sealed to the new device's key */
export async function approveRequest(deps: AccountDeps, turn: ApproverTurn): Promise<void> {
    const state = await deps.session.load()
    if (!state?.dek || !state.dekId) throw new AccountCryptoError("this device has no key to share")
    const check = await compareRequest(deps, turn)
    if (check.state !== "compare") throw new AccountApiError(409, "wrong_order", `The request is ${check.state}.`)
    const sealed = sealDek(deps.sodium, state.dek, fromB64(deps.sodium, turn.request.devicePub, 32))
    await deps.client.approve(turn.request.id, state.dekId, sealed)
    wipe(deps.sodium, state.dek, turn.rO)
}

export function denyRequest(deps: AccountDeps, requestId: string): Promise<void> {
    return deps.client.deny(requestId)
}

/* ---- DEK rotation (plan 5, 6.9) ---- */

export type RotationResult = { dekId: string, version: number, recoveryRenewed: boolean }

/**
 * A new DEK: the stored package re-encrypted with it, sealed to every device of the account, new password wrap
 * (`encKey`, required for email accounts) and recovery wrap (`recoveryKey`, else the old recovery code stops working).
 * Needs a sign-in within the last 10 minutes (the server answers ReauthRequiredError otherwise).
 */
export async function rotate(deps: AccountDeps, keys: { encKey?: Uint8Array, recoveryKey?: Uint8Array } = {}): Promise<RotationResult> {
    const { client, session, sodium } = deps
    const state = await session.load()
    if (!state?.dek || !state.dekId || !state.deviceKeys || !state.deviceId) throw new AccountCryptoError("this device has no key to rotate")
    if (state.kind === "email" && !keys.encKey) throw new AccountCryptoError("the password is needed to rotate the key")

    const meta = await client.syncMeta()
    if (meta.dekId !== null && meta.dekId !== state.dekId) throw new AccountApiError(409, "dek_mismatch", "The account uses a different key.")
    const snapshot = meta.version > 0 ? await client.snapshot() : null
    if (snapshot && (snapshot.version !== meta.version || snapshot.version < state.highestVersion)) throw new AccountApiError(409, "version_conflict", "The synced data changed. Try again.")
    const plain = snapshot ? decryptPackage(sodium, snapshot.bytes, state.dek, { userId: state.userId, version: snapshot.version, dekId: state.dekId }) : null

    const devices = await client.devices()
    const dek = newDek(sodium)
    const dekId = newDekId(sodium)
    try {
        const sealed = devices.map(device => {
            const pub = device.current ? state.deviceKeys!.publicKey : device.devicePub ? fromB64(sodium, device.devicePub, 32) : null
            if (!pub) throw new ServerContractError("GET /v1/devices does not return the devices' public keys (devicePub): the new key cannot be sealed for the other devices")
            return { deviceId: device.id, sealedDek: sealDek(sodium, dek, pub) }
        })
        const blob = plain ? encryptPackage(sodium, plain, dek, { userId: state.userId, version: meta.version + 1, dekId }) : null
        const result = await client.rotate({
            oldDekId: state.dekId,
            dekId,
            devices: sealed,
            ...(keys.encKey ? { wrappedDek: wrapKey(sodium, dek, keys.encKey, state.userId, "password") } : {}),
            ...(keys.recoveryKey ? { recoveryWrappedDek: wrapKey(sodium, dek, keys.recoveryKey, state.userId, "recovery") } : {}),
        }, blob, meta.version)
        await session.saveDek(dekId, dek)
        await session.updateSync({ highestVersion: Math.max(state.highestVersion, result.version) })
        return { dekId, version: result.version, recoveryRenewed: keys.recoveryKey !== undefined }
    }
    finally {
        wipe(sodium, dek, plain, state.dek)
    }
}
