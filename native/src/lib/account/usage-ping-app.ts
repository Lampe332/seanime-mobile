import { accountApiBase, checkAccountUrl } from "@/lib/account/account-config"
import { USAGE_COUNT_KEY, createUsagePing } from "@/lib/account/usage-ping"
import { APP_VARIANT, APP_VARIANT_NAME } from "@/lib/app-variant"
import { atomWithStorage, readStoredJSON, storage } from "@/lib/storage"
import * as Application from "expo-application"
import { randomUUID } from "expo-crypto"

/** Settings, App, Privacy: "Send anonymous usage count" (default on). Off: no ping is sent. */
export const usageCountEnabledAtom = atomWithStorage<boolean>(USAGE_COUNT_KEY, true)

const PING_TIMEOUT_MS = 10_000

const pingUrl = () => checkAccountUrl(
    APP_VARIANT_NAME,
    `${accountApiBase(APP_VARIANT_NAME, (APP_VARIANT as { accountApi?: string }).accountApi)}/v1/ping`,
)

/** Called on app start and whenever the app comes to the front; sends at most once per UTC day, never throws. */
export const pingUsageIfDue = createUsagePing({
    get: key => storage.getString(key),
    set: (key, value) => storage.set(key, value),
    enabled: () => readStoredJSON<boolean>(USAGE_COUNT_KEY, true) !== false,
    version: Application.nativeApplicationVersion ?? "",
    newId: () => randomUUID(),
    now: () => Date.now(),
    send: async body => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
        try {
            const res = await fetch(pingUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal,
            })
            return { status: res.status }
        } finally {
            clearTimeout(timer)
        }
    },
})
