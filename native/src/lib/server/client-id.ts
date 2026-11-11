import { localStore, sessionStore } from "@/lib/storage"
import { randomUUID } from "expo-crypto"

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
    try {
        if (inMemoryClientId) {
            localStore.setItem(CLIENT_ID_STORAGE_KEY, inMemoryClientId)
        } else {
            localStore.removeItem(CLIENT_ID_STORAGE_KEY)
        }

        if (inMemoryClientIdProof) {
            sessionStore.setItem(CLIENT_ID_PROOF_STORAGE_KEY, inMemoryClientIdProof)
        } else {
            sessionStore.removeItem(CLIENT_ID_PROOF_STORAGE_KEY)
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

    try {
        inMemoryClientId = normalizeClientId(localStore.getItem(CLIENT_ID_STORAGE_KEY))
        inMemoryClientIdProof = normalizeClientId(sessionStore.getItem(CLIENT_ID_PROOF_STORAGE_KEY))
    }
    catch {
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
    // The web app needed a getRandomValues fallback outside secure contexts; expo-crypto always has randomUUID
    return randomUUID()
}
