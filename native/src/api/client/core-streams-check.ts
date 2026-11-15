// geschrieben nach: docs/EIGENER-KERN.md §4m (Vergleich Kern gegen Server am Gerät, nur lesend), RFC 8216 (HLS: #EXT-X-STREAM-INF, #EXT-X-KEY mit METHOD und URI); kein Server-Quelltext
import { takeLongestPieces } from "@/api/client/core-switch"
import { buildSeaQuery } from "@/api/client/requests"
import { logger } from "@/lib/helpers/debug"

/*
 * Test and scratch app only (link `core?streams=check&media=<ids>&query=<words>`): reads the online streams of some
 * anime through the same door the hooks use, so that the area's switch decides who answers, and logs a summary per
 * installed provider: the episode list (count, first and last number), the sources of episode 1 (count, kind, whether
 * headers came) and the manual search (count). Then the time of the extensions' list and of each provider's code view.
 * For the first HLS source it reads the playlist and one variant with the source's headers and says whether the stream
 * is encrypted (#EXT-X-KEY, RFC 8216) and whether its key needs those headers (asked once with, once without). Nothing
 * is changed: no mapping, no cache, no playback. Addresses and titles are not logged.
 */

type Episode = { number: number }
type Source = { type?: string, url?: string, headers?: Record<string, string>, subtitles?: unknown[] }

const LINE_END = /\r?\n/

/** The attribute of an HLS tag line (RFC 8216 §4.2: NAME=VALUE or NAME="VALUE", separated by commas) */
function attribute(line: string, name: string): string | undefined {
    const match = new RegExp(`(?:^|[:,])${name}=("[^"]*"|[^,]*)`).exec(line)
    return match?.[1]?.replace(/^"|"$/g, "")
}

/** Encrypted or not, read the way mpv gets the stream: playlist → first variant → its keys, all with the source's headers */
async function hlsKeys(source: Source): Promise<string> {
    const headers = source.headers ?? {}
    const get = async (url: string, withHeaders = true) => fetch(url, { headers: withHeaders ? headers : {} })
    let url = source.url ?? ""
    let text = await (await get(url)).text()
    if (!text.startsWith("#EXTM3U")) return "not a playlist"
    const lines = text.split(LINE_END)
    const variant = lines.findIndex(line => line.startsWith("#EXT-X-STREAM-INF"))
    let variants = 0
    if (variant >= 0) {
        variants = lines.filter(line => line.startsWith("#EXT-X-STREAM-INF")).length
        const next = lines.slice(variant + 1).find(line => line.trim() && !line.startsWith("#"))
        if (!next) return `${variants} variants, none readable`
        url = new URL(next.trim(), url).toString()
        text = await (await get(url)).text()
    }
    const keys = text.split(LINE_END).filter(line => line.startsWith("#EXT-X-KEY"))
    const methods = [...new Set(keys.map(line => attribute(line, "METHOD") ?? "?"))]
    const encrypted = keys.filter(line => attribute(line, "METHOD") !== "NONE")
    if (encrypted.length === 0) return `${variants} variants, keys: none (${methods.join("/") || "no #EXT-X-KEY"})`
    const uri = attribute(encrypted[0], "URI")
    if (!uri) return `${variants} variants, keys: ${methods.join("/")} without URI`
    const keyUrl = new URL(uri, url).toString()
    const [withH, without] = await Promise.all([get(keyUrl), get(keyUrl, false)])
    return `${variants} variants, keys: ${methods.join("/")} (${encrypted.length} lines), key with headers ${withH.status}, without ${without.status}`
}

const log = (text: string) => logger("CoreStreams").info(text)

async function timed<T>(work: () => Promise<T>): Promise<{ value: T | null, error: string | null, ms: number }> {
    const started = Date.now()
    try {
        return { value: await work(), error: null, ms: Date.now() - started }
    }
    catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        return { value: null, error: text.replace(/https?:\/\/\S+/g, "<address>").slice(0, 160), ms: Date.now() - started }
    }
}

export async function runCoreStreamsCheck(mediaIds: number[], query: string, searchOnly: string[] = []): Promise<void> {
    const side = "core"
    takeLongestPieces(0)
    log(`check start, answered by: ${side}`)
    const providers = await buildSeaQuery<{ id: string }[]>({ endpoint: "/api/v1/extensions/list/onlinestream-provider", method: "GET" }).catch(() => null) ?? []
    for (const { id: provider } of providers) {
        // a search-only provider opens no episode and asks for no source
        for (const mediaId of searchOnly.includes(provider) ? [] : mediaIds) {
            const list = await timed(() => buildSeaQuery<{ episodes?: Episode[] }>({ endpoint: "/api/v1/onlinestream/episode-list", method: "POST", data: { mediaId, dubbed: false, provider } }))
            const numbers = (list.value?.episodes ?? []).map(episode => episode.number)
            log(`${side} ${provider} ${mediaId} list: ${list.error ?? `${numbers.length} episodes, ${numbers[0] ?? "-"}..${numbers[numbers.length - 1] ?? "-"}`} (${list.ms} ms)`)
            const source = await timed(() => buildSeaQuery<{ videoSources?: Source[], servers?: { server: string }[] }>({ endpoint: "/api/v1/onlinestream/episode-source", method: "POST", data: { episodeNumber: 1, mediaId, provider, dubbed: false } }))
            const sources = source.value?.videoSources ?? []
            const kinds = [...new Set(sources.map(item => item.type ?? "-"))].join("/")
            const headers = sources.some(item => item.headers && Object.keys(item.headers).length > 0)
            log(`${side} ${provider} ${mediaId} episode 1: ${source.error ?? `${sources.length} sources, ${kinds || "-"}, headers ${headers ? "yes" : "no"}, subtitles ${sources[0]?.subtitles?.length ?? 0}, servers ${source.value?.servers?.length ?? 0}`} (${source.ms} ms)`)
            const hls = sources.find(item => item.type === "m3u8" && item.url)
            if (hls) {
                const keys = await timed(() => hlsKeys(hls))
                log(`${side} ${provider} ${mediaId} episode 1 hls: ${keys.error ?? keys.value} (${keys.ms} ms)`)
            }
        }
        const found = await timed(() => buildSeaQuery<unknown[]>({ endpoint: "/api/v1/onlinestream/search", method: "POST", data: { provider, query, dubbed: false } }))
        log(`${side} ${provider} search: ${found.error ?? `${found.value?.length ?? 0} results`} (${found.ms} ms)`)
        // the code view (read only), one of the core's pieces over 8 ms in 3e
        const code = await timed(() => buildSeaQuery<string>({ endpoint: `/api/v1/extensions/payload/${provider}`, method: "GET" }))
        log(`${"core"} ${provider} code view: ${code.error ?? `${code.value?.length ?? 0} characters`} (${code.ms} ms)`)
    }
    const listSide = "core"
    for (const round of [1, 2]) {
        const all = await timed(() => buildSeaQuery<{ extensions?: unknown[] }>({ endpoint: "/api/v1/extensions/all", method: "POST", data: { withUpdates: false } }))
        log(`${listSide} extensions/all ${round}: ${all.error ?? `${all.value?.extensions?.length ?? 0} extensions`} (${all.ms} ms)`)
    }
    // the longest piece of the screens' thread per request during the check, with its waits and sections (3f-2)
    for (const line of takeLongestPieces(12)) log(`longest piece: ${line}`)
    log("check done")
}

/*
 * Test and scratch app only, both write (phase 3f-3): installing an extension (link `core?extensions=install&url=<manifest>`)
 * and a provider's mapping (link `core?streams=mapping&media=<id>&provider=<id>&query=<words>&entry=<words>`), through
 * the same door the screens use, so that the area's switch decides who answers. The log gets the time, the answer
 * and the longest piece per request; addresses never.
 */
export async function runCoreInstallCheck(manifestUrl: string): Promise<void> {
    const side = "core"
    takeLongestPieces(0)
    const done = await timed(() => buildSeaQuery<{ message?: string }>({ endpoint: "/api/v1/extensions/external/install", method: "POST", data: { manifestUri: manifestUrl } }))
    log(`${side} install: ${done.error ?? done.value?.message ?? "done"} (${done.ms} ms)`)
    for (const line of takeLongestPieces(6)) log(`longest piece: ${line}`)
}

type Found = { id?: string, title?: string }

export async function runCoreMappingCheck(mediaId: number, provider: string, query: string, entry: string): Promise<void> {
    const side = "core"
    takeLongestPieces(0)
    log(`mapping start, answered by: ${side}, provider ${provider}`)
    const episodes = async (step: string) => {
        const list = await timed(() => buildSeaQuery<{ episodes?: Episode[] }>({ endpoint: "/api/v1/onlinestream/episode-list", method: "POST", data: { mediaId, dubbed: false, provider } }))
        const numbers = (list.value?.episodes ?? []).map(episode => episode.number)
        log(`${side} mapping ${step} list: ${list.error ?? `${numbers.length} episodes, ${numbers[0] ?? "-"}..${numbers[numbers.length - 1] ?? "-"}`} (${list.ms} ms)`)
    }
    const mapping = async (step: string) => {
        const read = await timed(() => buildSeaQuery<{ animeId?: string }>({ endpoint: "/api/v1/onlinestream/get-mapping", method: "POST", data: { provider, mediaId } }))
        log(`${side} mapping ${step} get-mapping: ${read.error ?? (read.value?.animeId ? `entry ${read.value.animeId}` : "none")} (${read.ms} ms)`)
    }
    await mapping("before")
    await episodes("before")
    const found = await timed(() => buildSeaQuery<Found[]>({ endpoint: "/api/v1/onlinestream/search", method: "POST", data: { provider, query, dubbed: false } }))
    const results = found.value ?? []
    log(`${side} mapping search: ${found.error ?? `${results.length} results: ${results.slice(0, 6).map(result => `${result.id} "${result.title}"`).join(", ")}`}`)
    const words = entry.toLowerCase()
    const chosen = results.find(result => words !== "" && (result.title ?? "").toLowerCase().includes(words)) ?? results[0]
    if (!chosen?.id) {
        log("mapping done: no entry to map")
        return
    }
    const set = await timed(() => buildSeaQuery<boolean>({ endpoint: "/api/v1/onlinestream/manual-mapping", method: "POST", data: { provider, mediaId, animeId: chosen.id } }))
    log(`${side} mapping set to ${chosen.id} "${chosen.title}": ${set.error ?? String(set.value)} (${set.ms} ms)`)
    await mapping("after set")
    await episodes("after set")
    const removed = await timed(() => buildSeaQuery<boolean>({ endpoint: "/api/v1/onlinestream/remove-mapping", method: "POST", data: { provider, mediaId } }))
    log(`${side} mapping removed: ${removed.error ?? String(removed.value)} (${removed.ms} ms)`)
    await mapping("after remove")
    const emptied = await timed(() => buildSeaQuery<boolean>({ endpoint: "/api/v1/onlinestream/cache", method: "DELETE", data: { mediaId } }))
    log(`${side} mapping cache emptied: ${emptied.error ?? String(emptied.value)} (${emptied.ms} ms)`)
    await episodes("after remove and empty cache")
    for (const line of takeLongestPieces(8)) log(`longest piece: ${line}`)
    log("mapping done")
}
