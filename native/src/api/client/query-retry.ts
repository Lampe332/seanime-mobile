/*
 * Retry rule of the query client (client-providers.tsx): a read that failed once is asked again once after a short pause,
 * so a short network or AniList hiccup does not end on an error screen. Answers that will not change by asking again are
 * not retried: 4xx (missing, bad request, auth, rate limit) and the core's "no code for this endpoint" 503 (requests.ts).
 * Mutations keep retry 0: they change data and must not run twice.
 */

export const QUERY_RETRY_COUNT = 1
export const QUERY_RETRY_DELAY_MS = 1000

function statusOf(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) return undefined
    const response = (error as { response?: { status?: unknown } }).response
    return typeof response?.status === "number" ? response.status : undefined
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (failureCount >= QUERY_RETRY_COUNT) return false
    const status = statusOf(error)
    if (status === undefined) return true
    return status >= 500 && status !== 501 && status !== 503
}
