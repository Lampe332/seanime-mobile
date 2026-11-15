// geschrieben nach: goja_plugin_types/core.d.ts (Zusagen von LoadDoc/Doc/DocSelection, $habari, $torrentUtils, $goFeed); Prüfwerte aus eigenen HTML-, RSS- und Atom-Schnipseln, einer selbst erzeugten .torrent-Datei (BEP 3) und den aufgezeichneten torrentMetadata des Servers; keine Vorlage

import { createHash } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodeSandboxEngine } from "../sandbox/node-engine"
import { RECORDED_RELEASE_NAMES } from "./habari-cases"
import { type ExtensionSandbox, openExtensionSandbox } from "./helpers"

const noNetwork = async () => {
    throw new Error("no network in this test")
}

const HTML = `<!doctype html><html><body>
<ul id="list" data-kind="episodes">
  <li class="ep first" data-id="1"><a href="/watch/1" title="One">Episode 1</a></li>
  <li class="ep" data-id="2"><a href="/watch/2">Episode 2</a> <span class="tag">new</span></li>
  <!-- a comment -->
  <li class="ep last" data-id="3"><a href="/watch/3">Episode 3 &amp; more</a></li>
</ul>
<div class="box"><p>Hello <b>world</b></p></div>
</body></html>`

const DOC_CODE = `
const html = ${JSON.stringify(HTML)}
function docProbe() {
    const $ = LoadDoc(html)
    const items = $("li.ep")
    return {
        length: items.length(),
        texts: items.map((i, el) => el.find("a").text()),
        hrefs: $("a").map((i, el) => el.attr("href")),
        missing: $("a").first().attr("nope") === undefined,
        attrs: $("a").first().attrs(),
        dataOne: $("li").eq(1).data("id"),
        dataAll: $("#list").data(),
        eqLast: $("li").eq(-1).attr("data-id"),
        lastText: $("li").last().text().trim(),
        each: (() => { const seen = []; items.each((i, el) => { seen.push(i + ":" + el.attr("data-id")) }); return seen })(),
        children: $("#list").children().length(),
        childrenFiltered: $("#list").children(".last").attr("data-id"),
        contents: $("#list").contents().length() > $("#list").children().length(),
        contentsFiltered: $("#list").contentsFiltered("li").length(),
        parent: $("a").first().parent().attr("data-id"),
        parents: $("b").parents().map((i, el) => el.is("div") ? "div" : el.is("p") ? "p" : "other").slice(0, 2),
        parentsUntil: $("b").parentsUntil("body").length(),
        closest: $("b").closest(".box").length(),
        closestNone: $("b").closest("ul").length(),
        next: $("li.first").next().attr("data-id"),
        nextAll: $("li.first").nextAll().length(),
        nextUntil: $("li.first").nextUntil(".last").length(),
        prev: $("li.last").prev().attr("data-id"),
        prevAll: $("li.last").prevAll().length(),
        prevUntil: $("li.last").prevUntil(".first").length(),
        siblings: $("li").eq(1).siblings().map((i, el) => el.attr("data-id")),
        filter: items.filter(".last").length(),
        filterFn: items.filter((i, el) => i % 2 === 0).length(),
        not: items.not(".first").length(),
        notFn: items.not((i) => i === 0).length(),
        has: items.has("span").attr("data-id"),
        is: items.is(".last"),
        isFn: items.is((i, el) => el.attr("data-id") === "9"),
        html: $(".box").html(),
        htmlNone: $(".nothing").html(),
        end: $("#list").find("a").end().attr("id"),
        entities: $("li.last a").text(),
        doc: new Doc(html).find("span.tag").text(),
        docType: new Doc(html) instanceof Doc,
    }
}
`

describe("LoadDoc and Doc", () => {
    let sandbox: ExtensionSandbox
    beforeAll(async () => {
        sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
        await sandbox.load(DOC_CODE, "doc.js")
    })
    afterAll(async () => sandbox.close())

    it("selects, reads text and attributes and walks the tree as the contract says", async () => {
        const r = await sandbox.call<Record<string, unknown>>("docProbe")
        expect(r).toEqual({
            length: 3,
            texts: ["Episode 1", "Episode 2", "Episode 3 & more"],
            hrefs: ["/watch/1", "/watch/2", "/watch/3"],
            missing: true,
            attrs: { href: "/watch/1", title: "One" },
            dataOne: "2",
            dataAll: { kind: "episodes" },
            eqLast: "3",
            lastText: "Episode 3 & more",
            each: ["0:1", "1:2", "2:3"],
            children: 3,
            childrenFiltered: "3",
            contents: true,
            contentsFiltered: 3,
            parent: "1",
            parents: ["p", "div"],
            parentsUntil: 2,
            closest: 1,
            closestNone: 0,
            next: "2",
            nextAll: 2,
            nextUntil: 1,
            prev: "2",
            prevAll: 2,
            prevUntil: 1,
            siblings: ["1", "3"],
            filter: 1,
            filterFn: 2,
            not: 2,
            notFn: 2,
            has: "2",
            is: true,
            isFn: false,
            html: "<p>Hello <b>world</b></p>",
            htmlNone: null,
            end: "list",
            entities: "Episode 3 & more",
            doc: "new",
            docType: true,
        })
    })

    it("runs the second script only where the code names it", async () => {
        const plain = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
        try {
            // the name is put together, so this code does not name it
            await plain.load("function kinds() { return [typeof globalThis['Load' + 'D' + 'oc'], typeof $habari, typeof $torrentUtils] }", "plain.js")
            expect(await plain.call("kinds")).toEqual(["undefined", "object", "object"])
            expect(plain.docHelpersMs()).toBeUndefined()
            await plain.load("function feedKind() { return typeof $goFeed.parse }", "feed.js")
            expect(await plain.call("feedKind")).toBe("function")
            expect(plain.docHelpersMs()).toBeGreaterThan(0)
        }
        finally {
            await plain.close()
        }
        expect(sandbox.docHelpersMs()).toBeGreaterThan(0)
    })
})

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://example.test/xmlns/nyaa" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Test releases</title>
  <link>https://example.test/</link>
  <atom:link href="https://example.test/rss" rel="self" type="application/rss+xml"/>
  <description>Releases for the test</description>
  <language>en</language>
  <lastBuildDate>Tue, 10 Jun 2025 04:00:00 GMT</lastBuildDate>
  <item>
    <title>[Group] Show - 01 [1080p]</title>
    <link>https://example.test/download/1.torrent</link>
    <guid isPermaLink="true">https://example.test/view/1</guid>
    <pubDate>Mon, 09 Jun 2025 12:30:00 +0000</pubDate>
    <description><![CDATA[<a href="https://example.test/view/1">#1</a> &amp; more]]></description>
    <category>Anime</category>
    <enclosure url="https://example.test/download/1.torrent" length="1234" type="application/x-bittorrent"/>
    <nyaa:infoHash>0123456789abcdef0123456789abcdef01234567</nyaa:infoHash>
    <nyaa:seeders>42</nyaa:seeders>
  </item>
  <item>
    <title>Second &amp; last</title>
    <link>https://example.test/download/2.torrent</link>
  </item>
</channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="de">
  <title>Atom test</title>
  <subtitle>A feed for the test</subtitle>
  <link href="https://example.test/atom" rel="self"/>
  <link href="https://example.test/"/>
  <id>urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6</id>
  <updated>2025-06-10T18:30:02Z</updated>
  <author><name>Writer</name><email>writer@example.test</email></author>
  <entry>
    <title>First entry</title>
    <link href="https://example.test/2025/06/10/first"/>
    <link rel="enclosure" type="application/x-bittorrent" length="99" href="https://example.test/first.torrent"/>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <updated>2025-06-10T18:30:02Z</updated>
    <published>2025-06-09T08:00:00+02:00</published>
    <summary>Some text.</summary>
    <category term="anime"/>
  </entry>
</feed>`

describe("$goFeed", () => {
    let sandbox: ExtensionSandbox
    beforeAll(async () => {
        sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
        await sandbox.load("function feed(text) { return $goFeed.parse(text) }\nfunction broken(text) { try { $goFeed.parse(text); return 'parsed' } catch (error) { return error.message } }", "feed.js")
    })
    afterAll(async () => sandbox.close())

    it("reads RSS 2.0 with its items, enclosures and namespaced elements", async () => {
        const feed = await sandbox.call<Record<string, any>>("feed", RSS)
        expect(feed).toMatchObject({
            title: "Test releases",
            link: "https://example.test/",
            feedLink: "https://example.test/rss",
            description: "Releases for the test",
            language: "en",
            updatedParsed: "2025-06-10T04:00:00.000Z",
            feedType: "rss",
            feedVersion: "2.0",
        })
        expect(feed.items).toHaveLength(2)
        expect(feed.items[0]).toMatchObject({
            title: "[Group] Show - 01 [1080p]",
            link: "https://example.test/download/1.torrent",
            guid: "https://example.test/view/1",
            publishedParsed: "2025-06-09T12:30:00.000Z",
            description: "<a href=\"https://example.test/view/1\">#1</a> &amp; more",
            categories: ["Anime"],
            enclosures: [{ url: "https://example.test/download/1.torrent", length: "1234", type: "application/x-bittorrent" }],
        })
        expect(feed.items[0].extensions.nyaa.infoHash[0].value).toBe("0123456789abcdef0123456789abcdef01234567")
        expect(feed.items[0].extensions.nyaa.seeders[0].value).toBe("42")
        expect(feed.items[1].title).toBe("Second & last")
    })

    it("reads Atom 1.0 into the same shape", async () => {
        const feed = await sandbox.call<Record<string, any>>("feed", ATOM)
        expect(feed).toMatchObject({
            title: "Atom test",
            description: "A feed for the test",
            link: "https://example.test/",
            feedLink: "https://example.test/atom",
            language: "de",
            updatedParsed: "2025-06-10T18:30:02.000Z",
            author: { name: "Writer", email: "writer@example.test" },
            feedType: "atom",
            feedVersion: "1.0",
        })
        expect(feed.items[0]).toMatchObject({
            title: "First entry",
            link: "https://example.test/2025/06/10/first",
            guid: "urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a",
            description: "Some text.",
            publishedParsed: "2025-06-09T06:00:00.000Z",
            categories: ["anime"],
            enclosures: [{ url: "https://example.test/first.torrent", length: "99", type: "application/x-bittorrent" }],
        })
    })

    it("refuses what is no feed", async () => {
        expect(await sandbox.call("broken", "<html><body>no</body></html>")).toMatch(/no RSS or Atom feed/)
    })
})

/** Bencoding (BEP 3) of a value, for a .torrent file made in the test */
function bencode(value: unknown): Buffer {
    if (typeof value === "number") return Buffer.from(`i${value}e`)
    if (typeof value === "string" || Buffer.isBuffer(value)) {
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
        return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes])
    }
    if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")])
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
    return Buffer.concat([Buffer.from("d"), ...entries.flatMap(([key, item]) => [bencode(key), bencode(item)]), Buffer.from("e")])
}

describe("$torrentUtils", () => {
    const info = { "length": 1024, "name": "Show - 01 [1080p].mkv", "piece length": 16384, "pieces": Buffer.alloc(20, 7) }
    const torrent = bencode({ "announce": "udp://tracker.example.test:1337/announce", "announce-list": [["udp://tracker.example.test:1337/announce"], ["https://second.example.test/announce"]], "created by": "test", info })
    const infoHash = createHash("sha1").update(bencode(info)).digest("hex")

    it("gives the magnet link of a .torrent with its infohash, name and trackers", async () => {
        const sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
        try {
            await sandbox.load("function magnet(b64) { return $torrentUtils.getMagnetLinkFromTorrentData(b64) }\nfunction broken(b64) { try { return $torrentUtils.getMagnetLinkFromTorrentData(b64) } catch (error) { return 'error: ' + error.message } }", "torrent.js")
            const link = await sandbox.call<string>("magnet", torrent.toString("base64"))
            expect(link).toBe(`magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent("Show - 01 [1080p].mkv")}&tr=${encodeURIComponent("udp://tracker.example.test:1337/announce")}&tr=${encodeURIComponent("https://second.example.test/announce")}`)
            expect(await sandbox.call("broken", Buffer.from("d3:foo3:bare").toString("base64"))).toMatch(/^error: .*info/)
        }
        finally {
            await sandbox.close()
        }
    })

    it("hashes with SHA-1 as FIPS 180-4 gives it", async () => {
        const sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
        try {
            // "abc" as the only key of an info dictionary: the hash is that of the bencoded dictionary
            await sandbox.load("function magnet(b64) { return $torrentUtils.getMagnetLinkFromTorrentData(b64) }", "torrent.js")
            const tiny = bencode({ info: { name: "abc" } })
            expect(await sandbox.call("magnet", tiny.toString("base64"))).toBe(`magnet:?xt=urn:btih:${createHash("sha1").update("d4:name3:abce").digest("hex")}&dn=abc`)
        }
        finally {
            await sandbox.close()
        }
    })
})

describe("$habari", () => {
    let sandbox: ExtensionSandbox
    beforeAll(async () => {
        sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
        await sandbox.load("function parse(name) { return $habari.parse(name) }\nfunction parseAll(names) { return names.map(name => $habari.parse(name)) }", "habari.js")
    })
    afterAll(async () => sandbox.close())

    it("reads the usual parts of release names", async () => {
        expect(await sandbox.call("parse", "[SubsPlease] Dr. Stone - 05 (1080p) [ABCD1234].mkv")).toEqual({
            file_name: "[SubsPlease] Dr. Stone - 05 (1080p) [ABCD1234]", file_extension: "mkv", release_group: "SubsPlease",
            title: "Dr. Stone", formatted_title: "Dr. Stone", episode_number: ["05"], video_resolution: "1080p", file_checksum: "ABCD1234",
        })
        expect(await sandbox.call("parse", "[Erai-raws] Some Show 2nd Season - 12v2 [1080p][Multiple Subtitle].mkv")).toMatchObject({
            release_group: "Erai-raws", title: "Some Show", season_number: ["2"], episode_number: ["12"], release_version: ["2"], subtitles: ["Multiple Subtitle"],
        })
        expect(await sandbox.call("parse", "Show.Name.S02E07.1080p.WEB-DL.AAC2.0.H.264-GROUP.mkv")).toMatchObject({
            title: "Show.Name", formatted_title: "Show Name", season_number: ["02"], episode_number: ["07"], source: ["WEB-DL"], audio_term: ["AAC2.0"], video_term: ["H.264"], release_group: "GROUP",
        })
        expect(await sandbox.call("parse", "[Group] Movie Title (2019) [BD 1080p HEVC FLAC]")).toMatchObject({
            release_group: "Group", title: "Movie Title", year: "2019", source: ["BD"], video_term: ["HEVC"], audio_term: ["FLAC"],
        })
    })

    it("reads the recorded names nearly as the server did", async () => {
        const got = await sandbox.call<Record<string, string | string[]>[]>("parseAll", RECORDED_RELEASE_NAMES.map(want => want.file_name))
        const fields: Record<string, { same: number, all: number }> = {}
        RECORDED_RELEASE_NAMES.forEach((want, index) => {
            for (const key of new Set([...Object.keys(want), ...Object.keys(got[index])])) {
                if (key === "file_name") continue
                fields[key] ??= { same: 0, all: 0 }
                fields[key].all++
                if (JSON.stringify(want[key]) === JSON.stringify(got[index][key])) fields[key].same++
            }
        })
        const share = (key: string) => fields[key].same / fields[key].all
        // measured 13.11.2026 (docs/EIGENER-KERN.md §4j); the test holds the reader at that level
        expect(share("title")).toBeGreaterThanOrEqual(0.95)
        expect(share("episode_number")).toBeGreaterThanOrEqual(0.94)
        expect(share("season_number")).toBe(1)
        expect(share("release_group")).toBeGreaterThanOrEqual(0.93)
        expect(share("video_resolution")).toBe(1)
        expect(share("video_term")).toBe(1)
        expect(share("subtitles")).toBeGreaterThanOrEqual(0.99)
        expect(share("episode_title")).toBeGreaterThanOrEqual(0.82)
    })
})
