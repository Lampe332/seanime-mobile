// geschrieben nach: RFC 8216 (HTTP Live Streaming: §4.2 Attribut-Listen, §4.3.2.2 EXT-X-BYTERANGE, §4.3.2.4 EXT-X-KEY, §4.3.2.5 EXT-X-MAP, §4.3.3.2 EXT-X-MEDIA-SEQUENCE, §4.3.4.1 EXT-X-MEDIA, §4.3.4.2 EXT-X-STREAM-INF, §5.2 IV aus der Sequenznummer), RFC 3986 §5.2 (Adresse gegen eine Basis auflösen), docs/NATIVE-UMBAU.md (Verhalten der Downloads: beste Variante bis zur gewählten Höhe, eigene Tonspur, getarnte Segmente) und docs/EIGENER-KERN.md §4o; kein Server-Quelltext

import type { LoaderPart } from "../download/loader"

/*
 * Reading HLS playlists for a download: which stream of a master playlist to take, and the parts a media playlist is
 * made of, in the order they are joined to one file. The parts go to the device's loader (download/loader.ts), which
 * loads, decrypts (AES-128) and joins them; nothing here touches the network or a file.
 *
 * A segment is taken by its place in the playlist, never by the ending of its address: some sources name their
 * MPEG-TS segments ".jpg".
 */

/** The playlist cannot be saved as a file: protected by a DRM system or by SAMPLE-AES, still running, or empty */
export class HlsUnavailable extends Error {
    constructor(message: string) {
        super(message)
        this.name = "HlsUnavailable"
    }
}

export type HlsVariant = { url: string, height: number, bandwidth: number, audio: string }
export type HlsRendition = { group: string, url: string, name: string, language: string, isDefault: boolean }
export type HlsMaster = { variants: HlsVariant[], audio: HlsRendition[] }
/** hasMap: the parts start with an initialization section (fragmented MP4), the joined file is an MP4 then */
export type HlsMedia = { parts: LoaderPart[], hasMap: boolean }

/** `reference` as an absolute address, seen from `base` (RFC 3986 §5.2); only http and https matter here */
export function resolveAddress(base: string, reference: string): string {
    const given = reference.trim()
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(given)) return given
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)/.exec(base)
    if (!match) return given
    const [, scheme, host, path] = match
    if (given.startsWith("//")) return `${scheme}${given}`
    const cut = given.search(/[?#]/)
    const ownPath = cut < 0 ? given : given.slice(0, cut)
    const rest = cut < 0 ? "" : given.slice(cut)
    if (ownPath === "") return `${scheme}//${host}${path || "/"}${rest}`
    const joined = ownPath.startsWith("/") ? ownPath : `${path.slice(0, path.lastIndexOf("/") + 1) || "/"}${ownPath}`
    const kept: string[] = []
    for (const piece of joined.split("/")) {
        if (piece === "..") {
            if (kept.length > 1) kept.pop()
        }
        else if (piece !== ".") {
            kept.push(piece)
        }
    }
    const last = joined.split("/").pop()
    if (last === "." || last === "..") kept.push("")
    return `${scheme}//${host}${kept.join("/") || "/"}${rest}`
}

/** An attribute list (RFC 8216 §4.2): names in upper case, quoted values without their quotes */
export function attributesOf(list: string): Record<string, string> {
    const found: Record<string, string> = {}
    for (const match of list.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) found[match[1]!] = match[3] ?? match[2]!.trim()
    return found
}

function linesOf(text: string): string[] {
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== "")
}

const tagValue = (line: string, tag: string): string | null => line.startsWith(`${tag}:`) ? line.slice(tag.length + 1) : null

/** A method the loader cannot undo: everything but no encryption and whole-segment AES-128 with a plain key */
function refuseProtection(attributes: Record<string, string>): void {
    const method = attributes.METHOD ?? "NONE"
    if (method !== "NONE" && method !== "AES-128") throw new HlsUnavailable(`the stream is protected (${method})`)
    if (method === "AES-128" && attributes.KEYFORMAT && attributes.KEYFORMAT !== "identity") throw new HlsUnavailable("the stream is protected (key of a DRM system)")
}

export function isMasterPlaylist(text: string): boolean {
    return /^#EXT-X-STREAM-INF:/m.test(text)
}

export function readMaster(text: string, base: string): HlsMaster {
    const variants: HlsVariant[] = []
    const audio: HlsRendition[] = []
    let pending: Record<string, string> | null = null
    for (const line of linesOf(text)) {
        const stream = tagValue(line, "#EXT-X-STREAM-INF")
        const media = tagValue(line, "#EXT-X-MEDIA")
        const sessionKey = tagValue(line, "#EXT-X-SESSION-KEY")
        if (stream !== null) {
            pending = attributesOf(stream)
        }
        else if (media !== null) {
            const attributes = attributesOf(media)
            if (attributes.TYPE !== "AUDIO") continue
            audio.push({
                group: attributes["GROUP-ID"] ?? "",
                url: attributes.URI ? resolveAddress(base, attributes.URI) : "",
                name: attributes.NAME ?? "",
                language: (attributes.LANGUAGE ?? "").toLowerCase(),
                isDefault: attributes.DEFAULT === "YES",
            })
        }
        else if (sessionKey !== null) {
            refuseProtection(attributesOf(sessionKey))
        }
        else if (!line.startsWith("#") && pending) {
            const height = Number(/^\d+x(\d+)$/i.exec(pending.RESOLUTION ?? "")?.[1] ?? 0)
            variants.push({ url: resolveAddress(base, line), height, bandwidth: Number(pending.BANDWIDTH) || 0, audio: pending.AUDIO ?? "" })
            pending = null
        }
    }
    return { variants, audio }
}

/** The height a quality stands for ("1080p", "720"); anything without a number is "Auto" */
export const AUTO_HEIGHT = 1080

export function wantedHeight(quality: string): number {
    const number = Number(/(\d{3,4})/.exec(quality)?.[1] ?? 0)
    return number > 0 ? number : AUTO_HEIGHT
}

/**
 * The best stream up to the wanted height: the highest one that is not higher, among equal heights the one with the
 * most data. Is every stream higher, the lowest one is taken; streams that do not say their height count as lowest.
 */
export function chooseVariant(variants: HlsVariant[], quality: string): HlsVariant | null {
    const wanted = wantedHeight(quality)
    const best = (a: HlsVariant, b: HlsVariant) => b.height - a.height || b.bandwidth - a.bandwidth
    const within = variants.filter(variant => variant.height <= wanted).sort(best)
    if (within[0]) return within[0]
    return [...variants].sort((a, b) => a.height - b.height || b.bandwidth - a.bandwidth)[0] ?? null
}

/**
 * The stream's own audio playlist, when its sound is not inside its segments: of the stream's audio group the track in
 * the wanted language, else the default one, else the first. null: the sound is in the stream itself.
 */
export function chooseAudio(master: HlsMaster, variant: HlsVariant, dubbed: boolean): HlsRendition | null {
    if (variant.audio === "") return null
    const group = master.audio.filter(rendition => rendition.group === variant.audio)
    const languages = dubbed ? ["de", "ger", "deu"] : ["ja", "jp"]
    const chosen = group.find(rendition => languages.some(language => rendition.language.startsWith(language)))
        ?? group.find(rendition => rendition.isDefault)
        ?? group[0]
    return chosen && chosen.url !== "" ? chosen : null
}

/** The IV of a segment without one in its key tag: its sequence number as a 128-bit number (RFC 8216 §5.2) */
export function sequenceIv(sequence: number): string {
    return Math.max(0, Math.floor(sequence)).toString(16).padStart(32, "0")
}

function ivOf(attribute: string | undefined): string | null {
    if (!attribute) return null
    const hex = attribute.replace(/^0x/i, "").toLowerCase()
    if (!/^[0-9a-f]{1,32}$/.test(hex)) throw new HlsUnavailable("the key's IV cannot be read")
    return hex.padStart(32, "0")
}

function rangeOf(value: string, after: number): { from: number, length: number } {
    const [length, from] = value.replace(/"/g, "").split("@").map(Number)
    if (!Number.isFinite(length) || length! <= 0) throw new HlsUnavailable("a byte range of the playlist cannot be read")
    return { from: from !== undefined && Number.isFinite(from) ? from : after, length: length! }
}

/**
 * The parts of a media playlist in the order they are joined: the initialization section first when there is one,
 * then every segment. A part under an AES-128 key carries the key's address and its IV: the one of the key tag, else
 * the segment's sequence number.
 */
export function readMedia(text: string, base: string): HlsMedia {
    const lines = linesOf(text)
    if (lines[0] !== "#EXTM3U") throw new HlsUnavailable("the source did not send a playlist")
    const parts: LoaderPart[] = []
    let key: { url: string, iv: string | null } | null = null
    let sequence = 0
    let ended = false
    let hasMap = false
    let range: { from: number, length: number } | null = null
    /** Where the last byte range of an address ended: a range without a start goes on from there */
    const rangeEnds = new Map<string, number>()
    for (const line of lines) {
        const keyTag = tagValue(line, "#EXT-X-KEY")
        const mapTag = tagValue(line, "#EXT-X-MAP")
        const rangeTag = tagValue(line, "#EXT-X-BYTERANGE")
        const sequenceTag = tagValue(line, "#EXT-X-MEDIA-SEQUENCE")
        if (keyTag !== null) {
            const attributes = attributesOf(keyTag)
            refuseProtection(attributes)
            if ((attributes.METHOD ?? "NONE") === "NONE") {
                key = null
            }
            else {
                if (!attributes.URI) throw new HlsUnavailable("the key has no address")
                key = { url: resolveAddress(base, attributes.URI), iv: ivOf(attributes.IV) }
            }
        }
        else if (mapTag !== null) {
            const attributes = attributesOf(mapTag)
            if (!attributes.URI) throw new HlsUnavailable("the initialization section has no address")
            const url = resolveAddress(base, attributes.URI)
            const part: LoaderPart = { url }
            if (attributes.BYTERANGE) part.range = rangeOf(attributes.BYTERANGE, 0)
            // encrypted only under a key with an IV of its own (RFC 8216 §4.3.2.5)
            if (key?.iv) part.key = { url: key.url, iv: key.iv }
            parts.push(part)
            hasMap = true
        }
        else if (sequenceTag !== null) {
            sequence = Number(sequenceTag) || 0
        }
        else if (rangeTag !== null) {
            range = rangeOf(rangeTag, -1)
        }
        else if (line === "#EXT-X-ENDLIST") {
            ended = true
        }
        else if (!line.startsWith("#")) {
            const url = resolveAddress(base, line)
            const part: LoaderPart = { url }
            if (range) {
                const from = range.from >= 0 ? range.from : rangeEnds.get(url) ?? 0
                part.range = { from, length: range.length }
                rangeEnds.set(url, from + range.length)
                range = null
            }
            if (key) part.key = { url: key.url, iv: key.iv ?? sequenceIv(sequence) }
            parts.push(part)
            sequence += 1
        }
    }
    if (parts.length === (hasMap ? 1 : 0)) throw new HlsUnavailable("the playlist has no segments")
    if (!ended) throw new HlsUnavailable("the stream is still running, it has no end yet")
    return { parts, hasMap }
}
