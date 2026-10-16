const CLIENT_ID_STORAGE_KEY = "seanime-client-id"
const CLIENT_ID_PROOF_STORAGE_KEY = "seanime-client-id-proof"

let inMemoryClientId = ""
let inMemoryClientIdProof = ""

export type ClientIdentity = {
    clientId: string
    clientIdProof: string
}

const listeners = new Set<(identity: ClientIdentity) => void>()

function normalizeClientId(value: string | null | undefined): string {
    return (value ?? "").trim()
}

function getClientIdentitySnapshot(): ClientIdentity {
    return {
        clientId: inMemoryClientId,
        clientIdProof: inMemoryClientIdProof,
    }
}

function persistClientIdentity() {
    if (typeof window === "undefined") return

    try {
        if (inMemoryClientId) {
            window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, inMemoryClientId)
        } else {
            window.localStorage.removeItem(CLIENT_ID_STORAGE_KEY)
        }

        if (inMemoryClientIdProof) {
            window.sessionStorage.setItem(CLIENT_ID_PROOF_STORAGE_KEY, inMemoryClientIdProof)
        } else {
            window.sessionStorage.removeItem(CLIENT_ID_PROOF_STORAGE_KEY)
        }
    }
    catch {
    }
}

function emitClientIdentity() {
    const snapshot = getClientIdentitySnapshot()
    for (const listener of listeners) {
        listener(snapshot)
    }
}

function readStoredClientIdentity(): ClientIdentity {
    if (inMemoryClientId || inMemoryClientIdProof) return getClientIdentitySnapshot()

    if (typeof window !== "undefined") {
        try {
            inMemoryClientId = normalizeClientId(window.localStorage.getItem(CLIENT_ID_STORAGE_KEY))
            inMemoryClientIdProof = normalizeClientId(window.sessionStorage.getItem(CLIENT_ID_PROOF_STORAGE_KEY))
        }
        catch {
        }
    }

    return getClientIdentitySnapshot()
}

export function setClientIdentity(clientId: string, clientIdProof = ""): ClientIdentity {
    const normalized = normalizeClientId(clientId)
    const normalizedProof = normalizeClientId(clientIdProof)
    if (!normalized) return getClientIdentitySnapshot()

    const changed = normalized !== inMemoryClientId || normalizedProof !== inMemoryClientIdProof

    inMemoryClientId = normalized
    inMemoryClientIdProof = normalizedProof
    persistClientIdentity()

    if (changed) {
        emitClientIdentity()
    }

    return getClientIdentitySnapshot()
}

export function getClientIdentity(): ClientIdentity {
    const existing = readStoredClientIdentity()
    if (existing.clientId) return existing

    return setClientIdentity(createClientId(), "")
}

export function getClientId(): string {
    return getClientIdentity().clientId
}

export function getClientIdProof(): string {
    return readStoredClientIdentity().clientIdProof
}

export function subscribeToClientIdentity(callback: (identity: ClientIdentity) => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

function createClientId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }

    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
        return `seanime-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`
    }

    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char: string) =>
        (Number(char) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(char) / 4)))).toString(16),
    )
}
