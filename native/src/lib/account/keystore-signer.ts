// geschrieben nach: core/account/session.ts (SignerStore) und modules/core-sodium (keystore_p256_*); keine eigene Kryptografie
import type { RequestSigner } from "@/core/account/client"
import { type SecureStore, type SignerStore, sodiumSignerStore } from "@/core/account/session"
import type { Sodium } from "@/core/account/sodium"
import native from "../../../modules/core-sodium"

/*
 * The account's request signing key on the phone (N-8): ECDSA P-256 inside the Android Keystore (StrongBox when the device
 * has one, else the TEE), never exportable, so whoever copies the session token out of the app storage still cannot sign
 * a request. The server knows the key as sig_alg "p256" (account-server/src/signature.ts). Only a device whose Keystore
 * cannot make the key falls back to Ed25519 from libsodium in the secured storage (core/account/session.ts).
 */

export const ACCOUNT_SIGNING_ALIAS = "seanime-account-signing"

function keystoreSigner(alias: string, publicKey: Uint8Array): RequestSigner {
    return { alg: "p256", publicKey, sign: message => native.keystore_p256_sign(alias, message) }
}

function keptPublicKey(alias: string): Uint8Array | null {
    try {
        return native.keystore_p256_public(alias)
    }
    catch {
        return null
    }
}

export function keystoreSignerStore(store: SecureStore, sodium: Sodium, alias = ACCOUNT_SIGNING_ALIAS): SignerStore {
    const fallback = sodiumSignerStore(store, sodium)
    const current = async () => {
        const publicKey = keptPublicKey(alias)
        return publicKey ? keystoreSigner(alias, publicKey) : fallback.current()
    }
    return {
        current,
        async obtain() {
            const kept = await current()
            if (kept) return kept
            try {
                return keystoreSigner(alias, await native.keystore_p256_create(alias))
            }
            catch (error) {
                console.warn(`[account] no Android Keystore signing key, using the libsodium fallback: ${error instanceof Error ? error.message : String(error)}`)
                return fallback.obtain()
            }
        },
        async remove() {
            try {
                native.keystore_delete(alias)
            }
            catch {
                // no Keystore: nothing there
            }
            await fallback.remove()
        },
    }
}
