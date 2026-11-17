// geschrieben nach: dem Server-Vertrag account-server/src (index.ts Routen, routes.ts, identity.ts, approval.ts, rotate.ts, schemas.ts, http.ts; GET account, account/keys/device, account/start-fresh) und account-server/README.md

import type { Kdf } from "./crypto"
import type { Sodium, SodiumKeyPair } from "./sodium"

/*
 * Typed calls to the account server (`/v1`). The app sends `Authorization: Bearer <token>` and no `Origin` (the server
 * answers browsers with a cookie instead). Every non-2xx answer becomes an AccountApiError; 409 and 429 have their own
 * types, because the sync and the screens act on them (merge and retry, wait).
 *
 * Plan 10.2b: every request with a session is signed with the session's Ed25519 key (libsodium crypto_sign_detached),
 * see account-server/README.md "Signed requests": headers X-SM-Sig, X-SM-Ts, X-SM-Nonce over
 *   v1 \n METHOD \n path+query \n hex SHA-256 of the body \n ms \n nonce \n base64url(SHA-256(token)) or "-"
 * A sign-in (login, signup, Google) carries the server's one-time challenge and the new key's public half and is signed
 * with that new key (session id "-"); the new session is bound to it.
 */

export type HttpFetch = (url: string, init: { method: string, headers: Record<string, string>, body?: string | Uint8Array }) => Promise<{
    status: number
    headers: { get(name: string): string | null }
    json(): Promise<unknown>
    arrayBuffer(): Promise<ArrayBuffer>
}>

export class AccountApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, unknown> = {}) {
        super(message)
        this.name = "AccountApiError"
    }
}

/** 409: version_conflict (with the server's current `version`), dek_mismatch, wrong_order, email_taken, account_exists, … */
export class ConflictError extends AccountApiError {
    readonly version: number | null
    constructor(code: string, message: string, body: Record<string, unknown>) {
        super(409, code, message, body)
        this.name = "ConflictError"
        this.version = typeof body.version === "number" ? body.version : null
    }
}

/** 429: wait `retryAfter` seconds (Retry-After), or a limit on open requests without a time */
export class RateLimitedError extends AccountApiError {
    constructor(code: string, message: string, body: Record<string, unknown>, readonly retryAfter: number | null) {
        super(429, code, message, body)
        this.name = "RateLimitedError"
    }
}

/** 401: no or expired session, or wrong email / password */
export class UnauthorizedError extends AccountApiError {
    constructor(code: string, message: string, body: Record<string, unknown>) {
        super(401, code, message, body)
        this.name = "UnauthorizedError"
    }
}

/** 403 reauth_required: a sensitive step needs a sign-in within the last 10 minutes */
export class ReauthRequiredError extends AccountApiError {
    constructor(message: string, body: Record<string, unknown>) {
        super(403, "reauth_required", message, body)
        this.name = "ReauthRequiredError"
    }
}

/* ---- Shapes of the answers ---- */

export type DeviceKeysBody = { name: string, devicePub: string, sealedDek: string }
export type SignupBody = { email: string, salt: string, kdf: Kdf, authKey: string, challenge: string, keys?: { wrappedDek: string, dekId: string, device: DeviceKeysBody } }
/** prelogin: the account's salt and KDF (a decoy for unknown emails) and the one-time challenge for login / signup */
export type Prelogin = { salt: string, kdf: Kdf, challenge: string }
/** The session's credentials as the device keeps them: the token and the Ed25519 private key (64 bytes) it signs with */
export type SessionCredentials = { sessionToken: string, signingKey: Uint8Array }
export type SignupAnswer = { userId: string, deviceId: string | null, emailVerified: boolean, sessionToken: string }
export type LoginAnswer = { userId: string, emailVerified: boolean, kdf: Kdf, wrappedDek: string | null, dekId: string | null, rewrapNeeded: boolean, sessionToken: string }
export type GoogleAnswer = { userId: string, created: boolean, emailVerified: boolean, dekId: string | null, recoveryWrappedDek: string | null, sessionToken: string }
/** `userId` is part of the recovery wrap's AAD, so a device without a stored account can still unwrap it */
export type ResetInfo = { userId: string, dekId: string | null, hasRecovery: boolean, recoveryWrappedDek: string | null }
export type ResetBody = { token: string, salt: string, kdf: Kdf, authKey: string, keys?: { dekId: string, wrappedDek: string, recoveryWrappedDek: string } }
/** `devicePub`: the device's public key, a rotation seals the new DEK to it; `dekId`: the key its sealed DEK belongs to */
export type DeviceInfo = { id: string, name: string, createdAt: number, lastSeenAt: number, current: boolean, devicePub: string, dekId: string | null }
/** The DEK sealed to this session's device (after another device rotated it) */
export type DeviceKey = { deviceId: string, dekId: string, sealedDek: string }
export type StartFreshBody = { dekId: string, wrappedDek?: string, recoveryWrappedDek?: string, device: DeviceKeysBody }
/** GET account: what the account screen shows; never a key or hash */
export type AccountInfo = {
    userId: string
    email: string
    emailVerified: boolean
    googleLinked: boolean
    hasPassword: boolean
    hasRecovery: boolean
    dekId: string | null
    createdAt: number
    rewrapNeeded: boolean
    rotationRequired: boolean
    /** A rotation without the recovery code dropped it: the user should save a new one */
    recoveryRenewalNeeded: boolean
}
export type KeysBody = { dekId: string, wrappedDek?: string, recoveryWrappedDek?: string, device?: DeviceKeysBody }
export type PasswordBody = { salt: string, kdf: Kdf, authKey: string, wrappedDek: string, dekId: string }
export type RequestStatus = "pending" | "nonce" | "revealed" | "approved" | "denied" | "expired"
export type ApprovalRequest = {
    id: string
    deviceName: string
    devicePub: string
    commitment: string
    approverNonce: string | null
    reveal: string | null
    status: RequestStatus
    createdAt: number
    expiresAt: number
    /** Only for the requesting session, once approved */
    sealedDek?: string | null
    dekId?: string | null
    deviceId?: string | null
}
export type RotateMeta = { oldDekId: string, dekId: string, devices: { deviceId: string, sealedDek: string }[], wrappedDek?: string, recoveryWrappedDek?: string }
export type SyncMeta = { version: number, size: number, dekId: string | null, updatedAt: number | null, rotationRequired: boolean, rewrapNeeded: boolean, recoveryRenewalNeeded: boolean }
export type Snapshot = { bytes: Uint8Array, version: number, dekId: string }

type Body = Record<string, unknown>

type ClientOptions = {
    baseUrl: string
    fetch: HttpFetch
    sodium: Sodium
    /** The signed-in session, or null (requests then go without session and the server answers 401) */
    credentials: () => Promise<SessionCredentials | null> | SessionCredentials | null
    /** Unix milliseconds (tests) */
    now?: () => number
}

type SendInit = {
    json?: unknown
    bytes?: Uint8Array
    headers?: Record<string, string>
    /** false: no session (sign-in steps, token links) */
    auth?: boolean
    /** A sign-in: signed with this new key instead of the session's, session id "-" */
    signIn?: SodiumKeyPair
}

const SIGNATURE_VERSION = "v1"
const hex = (data: Uint8Array) => Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("")

export class AccountClient {
    constructor(private readonly options: ClientOptions) {}

    private b64(data: Uint8Array): string {
        return this.options.sodium.to_base64(data, this.options.sodium.base64_variants.URLSAFE_NO_PADDING)
    }

    /** X-SM-Sig / X-SM-Ts / X-SM-Nonce for one request (account-server/src/signature.ts) */
    private signature(method: string, url: string, body: Uint8Array, sessionId: string, privateKey: Uint8Array): Record<string, string> {
        const { sodium } = this.options
        const pathAndQuery = /^[a-z]+:\/\/[^/]+(\/.*)$/i.exec(url)?.[1] ?? url
        const ts = String(Math.floor((this.options.now ?? Date.now)()))
        const nonce = this.b64(sodium.randombytes_buf(16))
        const text = [SIGNATURE_VERSION, method.toUpperCase(), pathAndQuery, hex(sodium.crypto_hash_sha256(body)), ts, nonce, sessionId].join("\n")
        const signature = sodium.crypto_sign_detached(new TextEncoder().encode(text), privateKey)
        return { "X-SM-Sig": this.b64(signature), "X-SM-Ts": ts, "X-SM-Nonce": nonce }
    }

    private async send(method: string, path: string, init: SendInit = {}) {
        const { sodium } = this.options
        const headers: Record<string, string> = { Accept: "application/json", ...init.headers }
        let body: string | Uint8Array | undefined
        if (init.json !== undefined) {
            headers["Content-Type"] = "application/json"
            body = JSON.stringify(init.json)
        }
        else if (init.bytes) body = init.bytes
        const url = `${this.options.baseUrl.replace(/\/$/, "")}/v1/${path}`
        const bodyBytes = typeof body === "string" ? new TextEncoder().encode(body) : body ?? new Uint8Array(0)
        if (init.signIn) {
            Object.assign(headers, this.signature(method, url, bodyBytes, "-", init.signIn.privateKey))
        }
        else if (init.auth !== false) {
            const credentials = await this.options.credentials()
            if (credentials) {
                headers.Authorization = `Bearer ${credentials.sessionToken}`
                const sessionId = this.b64(sodium.crypto_hash_sha256(new TextEncoder().encode(credentials.sessionToken)))
                Object.assign(headers, this.signature(method, url, bodyBytes, sessionId, credentials.signingKey))
            }
        }
        const response = await this.options.fetch(url, { method, headers, body })
        if (response.status >= 400) throw await toError(response)
        return response
    }

    private sigKey(keys: SodiumKeyPair) {
        return { alg: "ed25519", pub: this.b64(keys.publicKey) }
    }

    private async call<T>(method: string, path: string, init?: Parameters<AccountClient["send"]>[2]): Promise<T> {
        const response = await this.send(method, path, init)
        return (response.status === 204 ? undefined : await response.json()) as T
    }

    /* auth */
    prelogin = (email: string) => this.call<Prelogin>("POST", "auth/prelogin", { json: { email }, auth: false })
    /** `signing`: the new session's key pair; it signs this request and the session is bound to it */
    signup = (body: SignupBody, signing: SodiumKeyPair) =>
        this.call<SignupAnswer>("POST", "auth/signup", { json: { ...body, sigKey: this.sigKey(signing) }, signIn: signing })
    login = (email: string, authKey: string, challenge: string, signing: SodiumKeyPair) =>
        this.call<LoginAnswer>("POST", "auth/login", { json: { email, authKey, challenge, sigKey: this.sigKey(signing) }, signIn: signing })
    logout = () => this.call<void>("POST", "auth/logout")
    verifyEmail = (token: string) => this.call<{ emailVerified: boolean }>("POST", "auth/verify", { json: { token }, auth: false })
    resendVerification = () => this.call<void>("POST", "auth/verify/resend")
    resetRequest = (email: string) => this.call<{ ok: boolean, message: string }>("POST", "auth/reset-request", { json: { email }, auth: false })
    resetInfo = (token: string) => this.call<ResetInfo>("POST", "auth/reset/info", { json: { token }, auth: false })
    reset = (body: ResetBody) => this.call<{ rewrapNeeded: boolean }>("POST", "auth/reset", { json: body, auth: false })
    googleNonce = () => this.call<{ nonce: string, expiresAt: number, challenge: string }>("POST", "auth/google/nonce", { auth: false })
    google = (idToken: string, nonce: string, challenge: string, signing: SodiumKeyPair) =>
        this.call<GoogleAnswer>("POST", "auth/google", { json: { idToken, nonce, challenge, sigKey: this.sigKey(signing) }, signIn: signing })

    /* devices */
    devices = async () => (await this.call<{ devices: DeviceInfo[] }>("GET", "devices")).devices
    deleteDevice = (id: string) => this.call<void>("DELETE", `devices/${encodeURIComponent(id)}`)
    createRequest = (body: { deviceName: string, devicePub: string, commitment: string }) => this.call<{ id: string, status: RequestStatus, expiresAt: number }>("POST", "devices/requests", { json: body })
    openRequests = async () => (await this.call<{ requests: ApprovalRequest[] }>("GET", "devices/requests")).requests
    request = (id: string) => this.call<ApprovalRequest>("GET", `devices/requests/${encodeURIComponent(id)}`)
    sendNonce = (id: string, nonce: string) => this.call<{ id: string, status: RequestStatus }>("POST", `devices/requests/${encodeURIComponent(id)}/nonce`, { json: { nonce } })
    reveal = (id: string, reveal: string) => this.call<{ id: string, status: RequestStatus }>("POST", `devices/requests/${encodeURIComponent(id)}/reveal`, { json: { reveal } })
    approve = (id: string, dekId: string, sealedDek: string) => this.call<{ id: string, status: RequestStatus }>("POST", `devices/requests/${encodeURIComponent(id)}/approve`, { json: { dekId, sealedDek } })
    deny = (id: string) => this.call<void>("POST", `devices/requests/${encodeURIComponent(id)}/deny`)

    /* account */
    account = () => this.call<AccountInfo>("GET", "account")
    putKeys = (body: KeysBody) => this.call<{ dekId: string, deviceId: string | null }>("PUT", "account/keys", { json: body })
    deviceKey = () => this.call<DeviceKey>("GET", "account/keys/device")
    /** Needs a sign-in within the last 10 minutes; removes the synced data, every device and every other session */
    startFresh = (body: StartFreshBody) => this.call<{ dekId: string, deviceId: string }>("POST", "account/start-fresh", { json: body })
    changePassword = (body: PasswordBody) => this.call<void>("POST", "account/password", { json: body })
    linkGoogle = (idToken: string, nonce: string) => this.call<void>("POST", "account/link-google", { json: { idToken, nonce } })
    deleteAccount = () => this.call<void>("DELETE", "account")

    /** DEK rotation: multipart/form-data with the parts `meta` (JSON) and `snapshot` (when the account has one) */
    rotate = (meta: RotateMeta, snapshot: Uint8Array | null, ifMatch: number) => {
        const { boundary, body } = multipart(meta, snapshot)
        return this.call<{ dekId: string, version: number, recoveryRenewalNeeded: boolean }>("POST", "account/rotate", {
            bytes: body,
            headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "If-Match": String(ifMatch) },
        })
    }

    /* sync */
    syncMeta = () => this.call<SyncMeta>("GET", "sync/meta")
    deleteSync = () => this.call<void>("DELETE", "sync")

    /** The stored package, or null when the account has none */
    snapshot = async (): Promise<Snapshot | null> => {
        let response
        try {
            response = await this.send("GET", "sync/snapshot", { headers: { Accept: "application/octet-stream" } })
        }
        catch (error) {
            if (error instanceof AccountApiError && error.status === 404) return null
            throw error
        }
        const version = Number(response.headers.get("X-Snapshot-Version") ?? "")
        if (!Number.isSafeInteger(version) || version < 1) throw new AccountApiError(502, "invalid_snapshot", "The server sent a snapshot without a valid version.")
        return { bytes: new Uint8Array(await response.arrayBuffer()), version, dekId: response.headers.get("X-Dek-Id") ?? "" }
    }

    /** Stores a package as version `ifMatch + 1`; a different current version answers ConflictError */
    putSnapshot = (bytes: Uint8Array, ifMatch: number, dekId: string) => this.call<{ version: number, size: number, updatedAt: number }>("PUT", "sync/snapshot", {
        bytes,
        headers: { "Content-Type": "application/octet-stream", "If-Match": String(ifMatch), "X-Dek-Id": dekId },
    })
}

async function toError(response: Awaited<ReturnType<HttpFetch>>): Promise<AccountApiError> {
    let body: Body = {}
    try {
        const parsed = await response.json()
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Body
    }
    catch {
        // a body that is no JSON (a proxy's page): only the status counts
    }
    const code = typeof body.error === "string" ? body.error : `http_${response.status}`
    const message = typeof body.message === "string" ? body.message : code
    if (response.status === 409) return new ConflictError(code, message, body)
    if (response.status === 401) return new UnauthorizedError(code, message, body)
    if (response.status === 403 && code === "reauth_required") return new ReauthRequiredError(message, body)
    if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"))
        const retryAfter = typeof body.retryAfter === "number" ? body.retryAfter : Number.isFinite(header) && header > 0 ? header : null
        return new RateLimitedError(code, message, body, retryAfter)
    }
    return new AccountApiError(response.status, code, message, body)
}

/** A multipart/form-data body built by hand, so it does not depend on the platform's Blob/FormData */
function multipart(meta: RotateMeta, snapshot: Uint8Array | null): { boundary: string, body: Uint8Array } {
    const boundary = `----seanime-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const text = (value: string) => new TextEncoder().encode(value)
    const parts: Uint8Array[] = [
        text(`--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n`),
    ]
    if (snapshot) {
        parts.push(text(`--${boundary}\r\nContent-Disposition: form-data; name="snapshot"; filename="snapshot.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`), snapshot, text("\r\n"))
    }
    parts.push(text(`--${boundary}--\r\n`))
    const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        body.set(part, offset)
        offset += part.length
    }
    return { boundary, body }
}
