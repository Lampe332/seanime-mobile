/**
 * Time limits of the online stream (use-onlinestream-auto-provider-cycler):
 * - PROVIDER_TIMEOUT_MS: how long a provider may take to answer (episode list, episode source, a forced source refresh).
 * - PLAYBACK_TIMEOUT_MS: how long a stream handed to the player may take to answer (first metadata) before it counts as
 *   broken. Measured from the moment the URL reaches the player, after the provider answered, so the two never overlap.
 *   It is longer because an HLS stream through the server proxy needs the playlist, the variant and the first segment.
 */
export const PROVIDER_TIMEOUT_MS = 15_000
export const PLAYBACK_TIMEOUT_MS = 20_000

export function shouldRecoverStartup(currentTime: number) {
    return currentTime < 1
}

export function getRefreshKey(provider: string | null, server: string | undefined, episodeNumber: number | null) {
    return `${provider ?? ""}:${server ?? ""}:${episodeNumber ?? ""}`
}

export function markSourceRefreshed(refreshed: Set<string>, key: string) {
    if (refreshed.has(key)) return false
    refreshed.add(key)
    return true
}

export function orderProviders(providers: { id: string }[], currentProvider: string | null) {
    const ids = providers.map(provider => provider.id)
    if (!currentProvider || !ids.includes(currentProvider)) return ids
    return [currentProvider, ...ids.filter(id => id !== currentProvider)]
}

/**
 * Whether a stream handed to the player has timed out. Only a stream that never answered has: one that loaded and waits
 * paused (the viewer paused it, or it is held back) is fine, and so is one whose position moved on.
 * The same rule holds while "Try all providers" runs; its own limit used to drop a working provider whose stream had
 * loaded but not started within 20 s of choosing the server.
 */
export function playbackTimedOut({ startedAt, playbackTime, streamReady }: { startedAt: number, playbackTime: number, streamReady: boolean }) {
    return playbackTime <= startedAt && !streamReady
}

/**
 * A provider request with the provider limit: a source refresh that never answers would otherwise hold the cycler in
 * "refreshing" for good (every timer waits for it), so "Try all providers" would hang on that provider.
 */
export function withProviderTimeout<T>(request: Promise<T>, ms = PROVIDER_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("provider timeout")), ms)
        request.then(value => {
            clearTimeout(timer)
            resolve(value)
        }, error => {
            clearTimeout(timer)
            reject(error)
        })
    })
}
