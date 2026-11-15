// geschrieben nach: RFC 8216 (HLS: Master- und Medien-Listen, EXT-X-KEY mit AES-128, EXT-X-MAP, EXT-X-BYTERANGE, IV aus der Sequenznummer), dem Vertrag des Laders (download/loader.ts: Teile eines Sammel-Auftrags) und docs/EIGENER-KERN.md §4o; eigene, erzeugte Testdaten, keine echte Quelle; kein Server-Quelltext

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { LoaderPart } from "../download/loader"
import { HlsUnavailable, attributesOf, chooseAudio, chooseVariant, isMasterPlaylist, readMaster, readMedia, resolveAddress, sequenceIv, wantedHeight } from "./hls"

const BASE = "https://cdn.example/show/ep1/master.m3u8"

function encrypt(plain: Buffer, key: Buffer, ivHex: string): Buffer {
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.from(ivHex, "hex"))
    return Buffer.concat([cipher.update(plain), cipher.final()])
}

/**
 * What the device's loader does with the parts of a request (LoaderParts.kt), written for Node: fetch each part (only
 * its byte range when it names one), undo AES-128 with the key of its address and its IV, append it to its file.
 */
export function joinParts(parts: LoaderPart[], source: Map<string, Buffer>, main = "main"): Map<string, Buffer> {
    const files = new Map<string, Buffer[]>()
    for (const part of parts) {
        const whole = source.get(part.url)
        if (!whole) throw new Error(`not at the source: ${part.url}`)
        let body = part.range ? whole.subarray(part.range.from, part.range.from + part.range.length) : whole
        if (part.key) {
            const key = source.get(part.key.url)
            if (!key || key.length !== 16) throw new Error("no key")
            const decipher = createDecipheriv("aes-128-cbc", key, Buffer.from(part.key.iv, "hex"))
            body = Buffer.concat([decipher.update(body), decipher.final()])
        }
        const file = part.path ?? main
        files.set(file, [...(files.get(file) ?? []), body])
    }
    return new Map([...files].map(([file, pieces]) => [file, Buffer.concat(pieces)]))
}

describe("addresses of a playlist", () => {
    it("are resolved against the playlist's own address", () => {
        expect(resolveAddress(BASE, "seg-1.ts")).toBe("https://cdn.example/show/ep1/seg-1.ts")
        expect(resolveAddress(BASE, "../ep2/a.ts?x=1")).toBe("https://cdn.example/show/ep2/a.ts?x=1")
        expect(resolveAddress(BASE, "./720/index.m3u8")).toBe("https://cdn.example/show/ep1/720/index.m3u8")
        expect(resolveAddress(BASE, "/keys/k.bin")).toBe("https://cdn.example/keys/k.bin")
        expect(resolveAddress(BASE, "//other.example/a.ts")).toBe("https://other.example/a.ts")
        expect(resolveAddress(BASE, "http://plain.example/a.ts")).toBe("http://plain.example/a.ts")
        expect(resolveAddress("https://cdn.example/list.m3u8?token=1", "a/b.ts")).toBe("https://cdn.example/a/b.ts")
        expect(resolveAddress("https://cdn.example", "a.ts")).toBe("https://cdn.example/a.ts")
        expect(resolveAddress(BASE, "../../../../a.ts")).toBe("https://cdn.example/a.ts")
    })

    it("reads attribute lists with quoted commas", () => {
        expect(attributesOf(`BANDWIDTH=2000000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720,AUDIO="aud"`))
            .toEqual({ BANDWIDTH: "2000000", CODECS: "avc1.64001f,mp4a.40.2", RESOLUTION: "1280x720", AUDIO: "aud" })
    })
})

describe("a master playlist", () => {
    const MASTER = [
        "#EXTM3U",
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,URI="audio/ja.m3u8"`,
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Deutsch",LANGUAGE="de",DEFAULT=NO,URI="audio/de.m3u8"`,
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="subs/en.m3u8"`,
        `#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"`,
        "360/index.m3u8",
        `#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="aud"`,
        "1080/index.m3u8",
        `#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080,AUDIO="aud"`,
        "1080-high/index.m3u8",
        `#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="aud"`,
        "720/index.m3u8",
        `#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160,AUDIO="aud"`,
        "2160/index.m3u8",
    ].join("\r\n")

    it("is told from a media playlist and read with its streams and audio tracks", () => {
        expect(isMasterPlaylist(MASTER)).toBe(true)
        expect(isMasterPlaylist("#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST")).toBe(false)
        const master = readMaster(MASTER, BASE)
        expect(master.variants.map(variant => variant.height)).toEqual([360, 1080, 1080, 720, 2160])
        expect(master.variants[0]).toEqual({ url: "https://cdn.example/show/ep1/360/index.m3u8", height: 360, bandwidth: 800000, audio: "aud" })
        expect(master.audio.map(track => track.language)).toEqual(["ja", "de"])
    })

    it("gives the best stream up to the wanted height, Auto is 1080", () => {
        const { variants } = readMaster(MASTER, BASE)
        expect(wantedHeight("Auto")).toBe(1080)
        expect(wantedHeight("720p")).toBe(720)
        expect(chooseVariant(variants, "Auto")?.url).toBe("https://cdn.example/show/ep1/1080-high/index.m3u8")
        expect(chooseVariant(variants, "720p")?.height).toBe(720)
        expect(chooseVariant(variants, "480p")?.height).toBe(360)
        expect(chooseVariant(variants, "2160p")?.height).toBe(2160)
        // every stream is higher: the lowest one
        expect(chooseVariant(variants, "240p")?.height).toBe(360)
        expect(chooseVariant([], "Auto")).toBeNull()
    })

    it("gives the stream's own audio track: the wanted language, else the default one", () => {
        const master = readMaster(MASTER, BASE)
        const variant = chooseVariant(master.variants, "Auto")!
        expect(chooseAudio(master, variant, false)?.url).toBe("https://cdn.example/show/ep1/audio/ja.m3u8")
        expect(chooseAudio(master, variant, true)?.url).toBe("https://cdn.example/show/ep1/audio/de.m3u8")
        expect(chooseAudio({ ...master, audio: master.audio.slice(0, 1) }, variant, true)?.language).toBe("ja")
        // sound inside the stream's segments: no file of its own
        expect(chooseAudio(master, { ...variant, audio: "" }, false)).toBeNull()
        expect(chooseAudio({ ...master, audio: [{ group: "aud", url: "", name: "x", language: "ja", isDefault: true }] }, variant, false)).toBeNull()
    })

    it("refuses a stream protected by a DRM system", () => {
        expect(() => readMaster(`#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"\n`, BASE)).toThrow(HlsUnavailable)
    })
})

describe("a media playlist", () => {
    const key = randomBytes(16)
    const otherKey = randomBytes(16)
    const tagIv = "000102030405060708090a0b0c0d0e0f"
    const segments = [0, 1, 2, 3, 4].map(index => randomBytes(1000 + index * 333))
    const VARIANT = "https://cdn.example/show/ep1/1080/index.m3u8"

    it("gives its segments as parts that join to the source: AES-128 with the IV of the tag or of the sequence number, disguised endings", () => {
        const playlist = [
            "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:4", "#EXT-X-MEDIA-SEQUENCE:7",
            `#EXT-X-KEY:METHOD=AES-128,URI="../keys/a.key"`,
            "#EXTINF:4.0,", "000.jpg",
            "#EXTINF:4.0,", "001.jpg",
            `#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/b.key",IV=0x${tagIv.toUpperCase()}`,
            "#EXTINF:4.0,", "002.png?sig=abc",
            "#EXT-X-KEY:METHOD=NONE",
            "#EXTINF:4.0,", "003.ts",
            `#EXT-X-KEY:METHOD=AES-128,URI="../keys/a.key"`,
            "#EXTINF:2.5,", "004.ts",
            "#EXT-X-ENDLIST",
        ].join("\n")
        const media = readMedia(playlist, VARIANT)
        expect(media.hasMap).toBe(false)
        expect(media.parts.map(part => part.url)).toEqual(["000.jpg", "001.jpg", "002.png?sig=abc", "003.ts", "004.ts"].map(name => `https://cdn.example/show/ep1/1080/${name}`))
        expect(media.parts.map(part => part.key?.iv)).toEqual([sequenceIv(7), sequenceIv(8), tagIv, undefined, sequenceIv(11)])
        expect(sequenceIv(7)).toBe("00000000000000000000000000000007")
        expect(media.parts[0]!.key?.url).toBe("https://cdn.example/show/ep1/keys/a.key")

        const source = new Map<string, Buffer>([
            ["https://cdn.example/show/ep1/keys/a.key", key],
            ["https://keys.example/b.key", otherKey],
            [media.parts[0]!.url, encrypt(segments[0]!, key, sequenceIv(7))],
            [media.parts[1]!.url, encrypt(segments[1]!, key, sequenceIv(8))],
            [media.parts[2]!.url, encrypt(segments[2]!, otherKey, tagIv)],
            [media.parts[3]!.url, segments[3]!],
            [media.parts[4]!.url, encrypt(segments[4]!, key, sequenceIv(11))],
        ])
        const joined = joinParts(media.parts, source).get("main")!
        expect(joined.equals(Buffer.concat(segments))).toBe(true)
        // the wrong IV does not give the source
        const wrong = media.parts.map((part, index) => index === 1 && part.key ? { ...part, key: { ...part.key, iv: sequenceIv(9) } } : part)
        expect(joinParts(wrong, source).get("main")!.equals(Buffer.concat(segments))).toBe(false)
    })

    it("puts the initialization section first and reads byte ranges of one file", () => {
        const init = randomBytes(700)
        const body = Buffer.concat(segments)
        const whole = Buffer.concat([init, body])
        const playlist = [
            "#EXTM3U", "#EXT-X-VERSION:7",
            `#EXT-X-MAP:URI="media.mp4",BYTERANGE="700@0"`,
            "#EXTINF:4,", `#EXT-X-BYTERANGE:${segments[0]!.length}@700`, "media.mp4",
            "#EXTINF:4,", `#EXT-X-BYTERANGE:${segments[1]!.length}`, "media.mp4",
            "#EXTINF:4,", `#EXT-X-BYTERANGE:${body.length - segments[0]!.length - segments[1]!.length}`, "media.mp4",
            "#EXT-X-ENDLIST",
        ].join("\n")
        const media = readMedia(playlist, VARIANT)
        expect(media.hasMap).toBe(true)
        expect(media.parts.map(part => part.range)).toEqual([
            { from: 0, length: 700 },
            { from: 700, length: segments[0]!.length },
            { from: 700 + segments[0]!.length, length: segments[1]!.length },
            { from: 700 + segments[0]!.length + segments[1]!.length, length: body.length - segments[0]!.length - segments[1]!.length },
        ])
        const joined = joinParts(media.parts, new Map([["https://cdn.example/show/ep1/1080/media.mp4", whole]])).get("main")!
        expect(joined.equals(whole)).toBe(true)
    })

    it("refuses what cannot be saved as a file", () => {
        const ended = (lines: string[]) => ["#EXTM3U", ...lines, "#EXT-X-ENDLIST"].join("\n")
        const unavailable = (playlist: string) => expect(() => readMedia(playlist, VARIANT)).toThrow(HlsUnavailable)
        unavailable(ended([`#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"`, "#EXTINF:4,", "a.ts"]))
        unavailable(ended([`#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:x"`, "#EXTINF:4,", "a.ts"]))
        unavailable(ended([`#EXT-X-KEY:METHOD=AES-128,URI="k",KEYFORMAT="com.widevine"`, "#EXTINF:4,", "a.ts"]))
        unavailable(ended([`#EXT-X-KEY:METHOD=AES-128`, "#EXTINF:4,", "a.ts"]))
        unavailable(ended([`#EXT-X-KEY:METHOD=AES-128,URI="k",IV=0xZZ`, "#EXTINF:4,", "a.ts"]))
        // still running, empty, not a playlist
        unavailable(["#EXTM3U", "#EXTINF:4,", "a.ts"].join("\n"))
        unavailable(ended([]))
        unavailable("<html>blocked</html>")
        expect(readMedia(ended([`#EXT-X-KEY:METHOD=AES-128,URI="k",KEYFORMAT="identity"`, "#EXTINF:4,", "a.ts"]), VARIANT).parts).toHaveLength(1)
    })
})
