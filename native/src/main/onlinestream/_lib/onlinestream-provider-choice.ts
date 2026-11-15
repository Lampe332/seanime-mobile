// geschrieben nach: Befund #12 des Komfort-Scans (15.11.2026, onlinestream.atoms.ts: Quelle global, Dub/Untertitel schon je Anime); eigene Regeln, kein Server-Quelltext

/*
 * The online stream provider per anime (onlinestream-page.tsx): the one picked on this anime's page, else the one picked
 * last anywhere (the global choice, the default for an anime not opened yet). A kept provider that is no longer installed
 * gives way to the global one; while the installed list is not known yet (empty) the kept one counts.
 */

export type ProviderByMedia = Record<string, string>

export function providerForMedia(byMedia: ProviderByMedia, mediaId: number | string, fallback: string | null, installed: string[]): string | null {
    const own = byMedia[String(mediaId)]
    if (own && (installed.length === 0 || installed.includes(own))) return own
    return fallback
}

/** The map with `provider` kept for this anime (the same map when nothing changes) */
export function withMediaProvider(byMedia: ProviderByMedia, mediaId: number | string, provider: string): ProviderByMedia {
    const key = String(mediaId)
    return byMedia[key] === provider ? byMedia : { ...byMedia, [key]: provider }
}
