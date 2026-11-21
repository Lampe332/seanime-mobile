/**
 * Time limits of the online stream (use-onlinestream-auto-provider-cycler):
 * - PROVIDER_TIMEOUT_MS: how long a provider may take to answer (episode list, episode source, a forced source refresh).
 * - PLAYBACK_TIMEOUT_MS: how long a stream handed to the player may take to answer (first metadata) before it counts as
 *   broken. Measured from the moment the URL reaches the player, after the provider answered, so the two never overlap.
 *   It is longer because an HLS stream through the server proxy needs the playlist, the variant and the first segment.
 */
import type { Translate } from "@/lib/app-language"

export const PROVIDER_TIMEOUT_MS = 15_000
export const PLAYBACK_TIMEOUT_MS = 20_000

/**
 * What the page and the player show when the stream of the chosen server failed and nothing is left to try. The cycler's
 * reasons are internal ("playback timeout", "episode source error", "no video sources") or the player's own (an mpv
 * error); the user gets what went wrong in plain words and what to do.
 */
export function cyclerFailureText(reason: string, t: Translate): string {
    if (/timeout/i.test(reason)) {
        return t("The stream did not start in time. Try another server or provider.", "Der Stream ist nicht rechtzeitig gestartet. Probiere einen anderen Server oder Provider.")
    }
    if (reason === "episode source error") {
        return t("The provider could not load this episode. Try another server or provider.", "Der Provider konnte diese Folge nicht laden. Probiere einen anderen Server oder Provider.")
    }
    if (reason === "no video sources") {
        return t("The provider has no video for this episode. Try another server or provider.", "Der Provider hat kein Video für diese Folge. Probiere einen anderen Server oder Provider.")
    }
    return t("This stream could not be played. Try another server or provider.", "Dieser Stream ließ sich nicht abspielen. Probiere einen anderen Server oder Provider.")
}

/** "Try all providers" ended without a provider that plays: the page's and the player's text. */
export function noWorkingProviderText(t: Translate): string {
    return t("No working providers found", "Kein funktionierender Anbieter gefunden")
}

/** The toast when "Try all providers" has nothing to try. */
export function noProvidersText(dubbed: boolean, t: Translate): string {
    return dubbed ? t("No dubbed providers available", "Keine Provider mit Synchro verfügbar") : t("No providers available", "Keine Provider verfügbar")
}

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
