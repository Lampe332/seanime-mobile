// geschrieben nach: goja_plugin_types/core.d.ts ($torrentUtils.getMagnetLinkFromTorrentData), BEP 3 (Bencoding, Infohash), BEP 9 / BEP 12 (Magnet-Link, announce-list) und FIPS 180-4 (SHA-1); keine Vorlage

/*
 * $torrentUtils.getMagnetLinkFromTorrentData: a .torrent file (as Base64) to its magnet link. The infohash is the
 * SHA-1 of the `info` dictionary exactly as its bytes stand in the file (BEP 3), so the reader below remembers where
 * each value starts and ends instead of encoding it again.
 */

import { Buffer } from "buffer"

/** Reads one bencoded value at `at`; gives the value and where it ended */
function read(bytes, at) {
    const c = bytes[at]
    if (c === 0x69) { // i<number>e
        const end = bytes.indexOf(0x65, at)
        if (end < 0) throw new Error("bencode: an integer without its end")
        return { value: Number(Buffer.from(bytes.subarray(at + 1, end)).toString("latin1")), end: end + 1 }
    }
    if (c === 0x6c) { // l…e
        const list = []
        let next = at + 1
        while (bytes[next] !== 0x65) {
            if (next >= bytes.length) throw new Error("bencode: a list without its end")
            const item = read(bytes, next)
            list.push(item.value)
            next = item.end
        }
        return { value: list, end: next + 1 }
    }
    if (c === 0x64) { // d…e, keys as text; each value knows its byte range
        const dictionary = {}
        const ranges = {}
        let next = at + 1
        while (bytes[next] !== 0x65) {
            if (next >= bytes.length) throw new Error("bencode: a dictionary without its end")
            const key = read(bytes, next)
            const value = read(bytes, key.end)
            const name = Buffer.from(key.value).toString("utf8")
            dictionary[name] = value.value
            ranges[name] = [key.end, value.end]
            next = value.end
        }
        Object.defineProperty(dictionary, "ranges", { value: ranges })
        return { value: dictionary, end: next + 1 }
    }
    if (c >= 0x30 && c <= 0x39) { // <length>:<bytes>
        const colon = bytes.indexOf(0x3a, at)
        const length = Number(Buffer.from(bytes.subarray(at, colon)).toString("latin1"))
        if (colon < 0 || !Number.isFinite(length) || colon + 1 + length > bytes.length) throw new Error("bencode: a string longer than the data")
        return { value: bytes.subarray(colon + 1, colon + 1 + length), end: colon + 1 + length }
    }
    throw new Error(`bencode: unexpected byte ${c} at ${at}`)
}

/** SHA-1 (FIPS 180-4) of bytes, as lower-case hex */
export function sha1Hex(bytes) {
    const length = bytes.length
    const blocks = Math.ceil((length + 9) / 64)
    const padded = new Uint8Array(blocks * 64)
    padded.set(bytes)
    padded[length] = 0x80
    const view = new DataView(padded.buffer)
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000))
    view.setUint32(padded.length - 4, (length * 8) >>> 0)
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
    const w = new Uint32Array(80)
    for (let block = 0; block < blocks; block++) {
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(block * 64 + t * 4)
        for (let t = 16; t < 80; t++) {
            const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]
            w[t] = (x << 1) | (x >>> 31)
        }
        let [a, b, c, d, e] = h
        for (let t = 0; t < 80; t++) {
            const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
            const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6
            const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0
            e = d
            d = c
            c = (b << 30) | (b >>> 2)
            b = a
            a = temp
        }
        h[0] = (h[0] + a) >>> 0
        h[1] = (h[1] + b) >>> 0
        h[2] = (h[2] + c) >>> 0
        h[3] = (h[3] + d) >>> 0
        h[4] = (h[4] + e) >>> 0
    }
    return h.map(word => (word >>> 0).toString(16).padStart(8, "0")).join("")
}

const utf8 = value => (value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value))

export function getMagnetLinkFromTorrentData(b64) {
    const bytes = new Uint8Array(Buffer.from(String(b64), "base64"))
    if (bytes.length === 0) throw new Error("$torrentUtils: no torrent data")
    const { value: torrent } = read(bytes, 0)
    if (!torrent || typeof torrent !== "object" || !torrent.ranges?.info) throw new Error("$torrentUtils: the data has no info dictionary")
    const [start, end] = torrent.ranges.info
    const hash = sha1Hex(bytes.subarray(start, end))
    const parts = [`xt=urn:btih:${hash}`]
    const name = torrent.info["name.utf-8"] ?? torrent.info.name
    if (name !== undefined) parts.push(`dn=${encodeURIComponent(utf8(name))}`)
    const trackers = []
    if (torrent.announce !== undefined) trackers.push(utf8(torrent.announce))
    for (const tier of Array.isArray(torrent["announce-list"]) ? torrent["announce-list"] : []) {
        for (const tracker of Array.isArray(tier) ? tier : []) trackers.push(utf8(tracker))
    }
    for (const tracker of new Set(trackers)) parts.push(`tr=${encodeURIComponent(tracker)}`)
    return `magnet:?${parts.join("&")}`
}
