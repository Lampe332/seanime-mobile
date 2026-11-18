// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.1–6.9, 8) und den Kern-Schnittstellen core/account/{flows,sync,devices,session,client}.ts; Speicher expo-secure-store, Bildschirmsperre expo-local-authentication

import { corePackageEnvironment } from "@/api/client/core-switch"
import { type AccountInfo, AccountClient, type ApprovalRequest, type HttpFetch } from "@/core/account/client"
import {
    type ApproverTurn, type PendingApproval, answerRequest, approveRequest, checkApproval, checkedDevices, compareRequest, confirmApproval, denyRequest, openRequests,
    requestApproval,
} from "@/core/account/devices"
import {
    changeKey, changePassword, createRecoveryCode, deleteAccount, loginEmail, signOut, signupEmail, startFresh, unlinkGoogle,
    useRecoveryCode as openWithRecoveryCode,
} from "@/core/account/flows"
import { AccountSession, type AccountKind } from "@/core/account/session"
import { SyncEngine, type SyncResult, type SyncTrigger, coreLocalData } from "@/core/account/sync"
import { accountSodium } from "@/lib/account-sodium"
import { accountApiBase, checkAccountUrl } from "@/lib/account/account-config"
import { waitingRequests } from "@/lib/account/account-view"
import { keystoreSignerStore } from "@/lib/account/keystore-signer"
import { type AppStateName, type SyncClock, createSyncClock } from "@/lib/account/sync-clock"
import { isDeviceKey } from "@/lib/app-backup-keys"
import { appPreferences, writeAppPreferences, writeSafetyBackup } from "@/lib/app-backup"
import { APP_VARIANT, APP_VARIANT_NAME } from "@/lib/app-variant"
import * as Application from "expo-application"
import { fetch as expoFetch } from "expo/fetch"
import * as LocalAuthentication from "expo-local-authentication"
import * as SecureStore from "expo-secure-store"
import { gunzipSync, gzipSync } from "fflate"
import { atom, getDefaultStore } from "jotai"
import { Platform } from "react-native"

/*
 * The account core wired into the app: libsodium from modules/core-sodium, the keys and the session in
 * expo-secure-store (Android Keystore; the app has allowBackup=false, so nothing of it goes into an Android cloud
 * backup), the package from the same core data and preferences as the backup, gzip from fflate. The screens read the
 * atoms below and call the steps; the sync clock (sync-clock.ts) runs from AppServices. Without an account nothing here
 * talks to a server.
 */

export const ACCOUNT_API = accountApiBase(APP_VARIANT_NAME, (APP_VARIANT as { accountApi?: string }).accountApi)

// The request signing key lives in the Android Keystore (N-8); keystore-signer.ts falls back to libsodium only without one
const session = new AccountSession(SecureStore, accountSodium, keystoreSignerStore(SecureStore, accountSodium))

// expo/fetch: binary bodies and arrayBuffer() answers (the sealed package) on the native network stack
// Every call is checked again at run time: the release sends nothing to the account server except over https.
const httpFetch: HttpFetch = (url, init) => expoFetch(checkAccountUrl(APP_VARIANT_NAME, url), {
    method: init.method,
    headers: init.headers,
    body: typeof init.body === "string" || init.body === undefined ? init.body : init.body.slice(),
})

// Each request is signed with the session's key (plan 10.2b): P-256 in the Android Keystore
const client = new AccountClient({ baseUrl: ACCOUNT_API, fetch: httpFetch, sodium: accountSodium, credentials: () => session.credentials() })

const deps = { client, session, sodium: accountSodium }

const engine = new SyncEngine({
    api: client,
    session,
    sodium: accountSodium,
    gzip: { gzip: data => gzipSync(data, { mtime: 0 }), gunzip: gunzipSync },
    local: coreLocalData(corePackageEnvironment(), {
        appVersion: Application.nativeApplicationVersion ?? "",
        preferences: appPreferences,
        isDeviceKey,
        writePreferences: writeAppPreferences,
        safetyBackup: writeSafetyBackup,
    }),
    // a key change never runs on its own: the account screen asks the user which devices keep the key (S2)
    now: Date.now,
})

/** "Galaxy S22" style name the other devices and the account list show */
export function deviceName(): string {
    const model = (Platform.constants as { Model?: string }).Model
    return model?.trim() || "Android device"
}

/* ---- What the screens read ---- */

export type AccountSnapshot = {
    loaded: boolean
    signedIn: boolean
    hasKey: boolean
    email: string | null
    kind: AccountKind | null
    deviceId: string | null
    lastSyncAt: number | null
}

const NOT_LOADED: AccountSnapshot = { loaded: false, signedIn: false, hasKey: false, email: null, kind: null, deviceId: null, lastSyncAt: null }

export const accountAtom = atom<AccountSnapshot>(NOT_LOADED)
export const lastSyncAtom = atom<SyncResult | null>(null)
export const syncingAtom = atom(false)
export const accountInfoAtom = atom<AccountInfo | null>(null)
/** Requests of new devices this device can approve */
export const approvalRequestsAtom = atom<ApprovalRequest[]>([])
/** "Not now" on the import question: asked again at the next app start */
export const importDismissedAtom = atom(false)
/**
 * What the account screen must tell after a sign-in or sync: "key-changed" (NEU-7: the account's key changed since this
 * device last held it; nothing was imported) or "removed" (NEU-2: this device was removed; its key is gone)
 */
export const keyNoticeAtom = atom<"key-changed" | "removed" | null>(null)

const store = getDefaultStore()

/** Set by the service hook: the screens read their data anew after the account's data replaced or merged the local one */
let afterDataChange: () => void = () => undefined
export function onAccountDataChange(run: () => void) {
    afterDataChange = run
}

export async function refreshAccount(): Promise<AccountSnapshot> {
    const state = await session.load()
    if (state?.dek) accountSodium.memzero(state.dek)
    const next: AccountSnapshot = state
        ? { loaded: true, signedIn: true, hasKey: !!state.dekId, email: state.email, kind: state.kind, deviceId: state.deviceId, lastSyncAt: state.lastSyncAt }
        : { ...NOT_LOADED, loaded: true }
    store.set(accountAtom, next)
    if (!state) {
        store.set(accountInfoAtom, null)
        store.set(approvalRequestsAtom, [])
    }
    return next
}

async function refreshInfo() {
    try {
        store.set(accountInfoAtom, await client.account())
    }
    catch {
        // offline: the last known info stays
    }
}

/** One sync run; the answer goes to lastSyncAtom ("skipped" ticks change nothing) */
export async function runSync(trigger: SyncTrigger): Promise<SyncResult | null> {
    if (!store.get(accountAtom).signedIn) return null
    store.set(syncingAtom, true)
    try {
        const result = await engine.sync(trigger)
        if (result.state === "skipped") return result
        store.set(lastSyncAtom, result)
        if (result.state === "removed") {
            // NEU-2: removed on another device or on the website: the key, the device keys and the session go at once
            await session.clear()
            await session.forgetDeviceKeys()
            await session.forgetSigner()
            store.set(keyNoticeAtom, "removed")
        }
        if (result.state === "signed-out") {
            // the session ended on the server (expired, password reset, removed on another device): only the session goes.
            // The key stays until the user signs in again or signs out, so a reset without code keeps the data (N-3).
            await session.dropSession()
        }
        if (result.state === "updated" || result.state === "merged") afterDataChange()
        await refreshAccount()
        if (result.state !== "signed-out" && result.state !== "removed") await refreshInfo()
        return result
    }
    finally {
        store.set(syncingAtom, false)
    }
}

/** Requests of new devices waiting for this one (when the app opens and with every tick) */
export async function checkApprovalRequests(): Promise<void> {
    const account = store.get(accountAtom)
    if (!account.signedIn || !account.hasKey) return
    store.set(approvalRequestsAtom, waitingRequests(await openRequests(deps), Date.now()))
}

let clock: SyncClock | null = null

/** The clock of AppServices; started once */
export function startAccountClock(state: AppStateName, every: (ms: number, run: () => void) => () => void): SyncClock {
    clock?.stop()
    clock = createSyncClock({ sync: runSync, checkRequests: checkApprovalRequests, now: Date.now, every })
    clock.start(state)
    return clock
}

export function syncNow(): Promise<unknown> {
    return clock ? clock.syncNow() : runSync("manual")
}

/* ---- Steps of the screens ---- */

let recoveryWrappedDek: string | null = null

async function afterSignIn(status: "ready" | "needs-key") {
    store.set(lastSyncAtom, null)
    store.set(importDismissedAtom, false)
    await refreshAccount()
    if (status === "ready") await runSync("start")
    else await refreshInfo()
}

export async function createAccount(email: string, password: string): Promise<void> {
    const result = await signupEmail(deps, { email: email.trim(), password, deviceName: deviceName() })
    await afterSignIn(result.status)
}

export async function signIn(email: string, password: string): Promise<void> {
    const result = await loginEmail(deps, { email: email.trim(), password, deviceName: deviceName() }).catch(error => {
        if ((error as Error | null)?.name === "UntrustedKeyChangeError") store.set(keyNoticeAtom, "key-changed")
        throw error
    })
    recoveryWrappedDek = result.recoveryWrappedDek
    store.set(keyNoticeAtom, result.keyChanged ? "key-changed" : null)
    await afterSignIn(result.status)
}

/** Import: the core makes a local backup first, then the account's data replaces this device's */
export async function importFromAccount(): Promise<SyncResult> {
    const result = await engine.importFromAccount()
    store.set(lastSyncAtom, result)
    await refreshAccount()
    return result
}

export async function signOutHere(): Promise<void> {
    await signOut(deps)
    store.set(lastSyncAtom, null)
    await refreshAccount()
}

/** The synced package goes from the server; this device uploads its data again at the next sync while signed in */
export async function deleteSyncedData(): Promise<void> {
    await client.deleteSync()
    await session.updateSync({ highestVersion: 0, lastHash: null, lastSyncAt: null })
    store.set(lastSyncAtom, null)
    await refreshAccount()
}

export async function deleteWholeAccount(password: string): Promise<void> {
    await deleteAccount(deps, { deviceName: deviceName(), password })
    store.set(lastSyncAtom, null)
    await refreshAccount()
}

export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> {
    const email = store.get(accountAtom).email
    if (!email) throw new Error("Sign in first.")
    await changePassword(deps, { email, currentPassword, newPassword, deviceName: deviceName() })
    await refreshInfo()
}

/** The account's devices, each checked against the key: an unverified one was not added by any of the user's devices */
export const listDevices = () => checkedDevices(deps)

/**
 * "Change encryption key" (S2): a new key only for the devices the user kept (`keep`, device ids), every other device
 * removed in the same step; with the password (email) or a recent sign-in (Google)
 */
export async function changeEncryptionKey(keep: string[], password: string | undefined): Promise<void> {
    await changeKey(deps, { deviceName: deviceName(), password, keep })
    await refreshInfo()
    await runSync("manual")
}

/** "Disconnect Google" (H-2): needs the account's password */
export async function disconnectGoogle(password: string): Promise<void> {
    await unlinkGoogle(deps, { password })
    await refreshInfo()
}

/** A new recovery code; the password signs in afresh first (the server wants a sign-in within 10 minutes) */
export async function newRecoveryCode(password: string): Promise<string> {
    const email = store.get(accountAtom).email
    if (email) await loginEmail(deps, { email, password, deviceName: deviceName() })
    const code = await createRecoveryCode(deps)
    await refreshInfo()
    return code
}

export const resendConfirmation = () => client.resendVerification()

/* ---- New device: "Approve on your phone" ---- */

export const askForApproval = (): Promise<PendingApproval> => requestApproval(deps, deviceName())
export const approvalProgress = (pending: PendingApproval) => checkApproval(deps, pending)
/** The user's answer here to "Does your other device show this number?" (approval v2: both devices ask) */
export const answerNumber = (pending: PendingApproval, same: boolean) => confirmApproval(deps, pending, same)

export async function approvalDone(): Promise<void> {
    store.set(keyNoticeAtom, null)
    await afterSignIn("ready")
}

/** The recovery code works here when the sign-in brought the account's recovery wrap (Google accounts) */
export function recoveryCodeUsable(): boolean {
    return recoveryWrappedDek !== null
}

export async function unlockWithRecoveryCode(code: string): Promise<void> {
    const info = await client.account()
    if (!recoveryWrappedDek || !info.dekId) throw new Error("This account has no recovery code.")
    await openWithRecoveryCode(deps, { code, recoveryWrappedDek, dekId: info.dekId, deviceName: deviceName() })
    await afterSignIn("ready")
}

export async function startFreshHere(password: string | undefined): Promise<void> {
    await startFresh(deps, { deviceName: deviceName(), password })
    await afterSignIn("ready")
}

/* ---- Old device: approving a new one ---- */

export const answerApproval = (request: ApprovalRequest) => answerRequest(deps, request)
export const compareApproval = (turn: ApproverTurn) => compareRequest(deps, turn)

export async function approveApproval(turn: ApproverTurn): Promise<void> {
    await approveRequest(deps, turn)
    store.set(approvalRequestsAtom, store.get(approvalRequestsAtom).filter(request => request.id !== turn.request.id))
}

export async function denyApproval(requestId: string): Promise<void> {
    await denyRequest(deps, requestId)
    store.set(approvalRequestsAtom, store.get(approvalRequestsAtom).filter(request => request.id !== requestId))
}

/** Screen lock or fingerprint before approving, when the device has one set up; true without one */
export async function confirmWithDeviceLock(prompt: string): Promise<boolean> {
    const level = await LocalAuthentication.getEnrolledLevelAsync()
    if (level === LocalAuthentication.SecurityLevel.NONE) return true
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt })
    return result.success
}
