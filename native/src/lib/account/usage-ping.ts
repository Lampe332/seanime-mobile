/*
 * Anonymous daily count (4.3.2): at most once per UTC day the app sends POST /v1/ping with a random install ID made on
 * its first start and the app version. No account, no email; the server stores only the SHA-256 of the ID. Errors are
 * dropped; after a failed try the next one waits an hour, so a phone without network never loops.
 */

/** Device keys (seanime-core-*): app-backup-keys.ts keeps them out of every backup and sync package. */
export const USAGE_ID_KEY = "seanime-core-usage-id"
export const USAGE_DAY_KEY = "seanime-core-usage-day"
/** The switch in Settings, App, Privacy (default on). */
export const USAGE_COUNT_KEY = "seanime-mobile-usage-count"

export const USAGE_RETRY_MS = 60 * 60 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// same format the server accepts (account-server/src/schemas.ts PingBody)
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}(?:[-+][0-9A-Za-z.-]{1,20})?$/

export type UsagePingResult = "sent" | "skipped" | "failed"

export interface UsagePingDeps {
    get(key: string): string | undefined
    set(key: string, value: string): void
    enabled(): boolean
    version: string
    newId(): string
    now(): number
    send(body: { id: string; version: string }): Promise<{ status: number }>
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function createUsagePing(deps: UsagePingDeps): () => Promise<UsagePingResult> {
    let running = false
    let lastTry = -Infinity
    return async () => {
        const t = deps.now()
        const day = utcDay(t)
        if (running || !deps.enabled() || !VERSION.test(deps.version)) return "skipped"
        if (deps.get(USAGE_DAY_KEY) === day || t - lastTry < USAGE_RETRY_MS) return "skipped"
        running = true
        lastTry = t
        try {
            let id = deps.get(USAGE_ID_KEY)
            if (!id || !UUID.test(id)) {
                id = deps.newId()
                deps.set(USAGE_ID_KEY, id)
            }
            const { status } = await deps.send({ id, version: deps.version })
            // a 4xx other than 429 will not change by asking again today
            if (status < 500 && status !== 429) {
                deps.set(USAGE_DAY_KEY, day)
                return status < 300 ? "sent" : "failed"
            }
            return "failed"
        } catch {
            return "failed"
        } finally {
            running = false
        }
    }
}
