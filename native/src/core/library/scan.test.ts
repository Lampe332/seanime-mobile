// geschrieben nach: Form der Aufzeichnung api vom 13.11.2026 (library.recorded.json, home.recorded.json: nur Arten, keine Werte), App-Typen Anime_LocalFile/Summary_ScanSummaryItem/NativePlayer_PlaybackInfo, App-Code library-status.tsx (scan-progress/scan-status) und docs/EIGENER-KERN.md §4p (Phase 5b-1); Titel, Pfade und Nummern erfunden; kein Server-Quelltext
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { ANILIST_URL, type HttpFetch } from "../anilist/client"
import { keepCollection } from "../anilist/store"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { type CoreEvent, onCoreEvent } from "../events"
import { type CoreEnvironment, type CoreMethod, matchCoreRoute } from "../registry"
import { METADATA_URL } from "./metadata"
import { bestMatch, fileMetadataOf, readName, titleScore } from "./local-files"
import { AUTO_SCAN_EVERY_MS, forgetLookAtFolders, forgetScanAtStart, refreshAfterDownload } from "./folders"
import type { LocalFolderEntry } from "./scan"
import homeRecorded from "./home.recorded.json"
import recorded from "./library.recorded.json"

type Json = Record<string, unknown>

const STONE = 4242
const WARS = 4243
const OTHER = 9999
const ROOT = "/storage/made/Anime"

const media = (id: number, romaji: string, fields: Json = {}): Json => ({
    id, idMal: 1, siteUrl: `https://anilist.example/anime/${id}`, status: "FINISHED", season: "SPRING", type: "ANIME", format: "TV",
    seasonYear: 2020, bannerImage: "https://img.example/b.jpg", episodes: 4, synonyms: [], isAdult: false, countryOfOrigin: "JP",
    meanScore: 80, description: "made up", genres: ["Made"], duration: 24,
    title: { english: romaji, native: "Made", romaji, userPreferred: romaji },
    coverImage: { color: "#fff", extraLarge: "https://img.example/xl.jpg", large: "https://img.example/l.jpg", medium: "https://img.example/m.jpg" },
    startDate: { day: 1, month: 4, year: 2020 }, endDate: { day: 1, month: 6, year: 2020 }, ...fields,
})

let now = Date.UTC(2026, 10, 14)
let database: CoreDatabase | null = null
let tree: Record<string, LocalFolderEntry[]> = {}
let searches: string[] = []
let searchAnswer: Json[] = []
let documents: string[] = []
let autoScan = false
let removed: string[] = []
let deletedFiles: string[] = []
let stuck = ""
let pauses = 0
let events: CoreEvent[] = []

const httpFetch: HttpFetch = async (url, init) => {
    if (url === ANILIST_URL) {
        const body = JSON.parse(String(init?.body)) as { query: string, variables: { search: string } }
        documents.push(body.query)
        searches.push(body.variables.search)
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { Page: { pageInfo: {}, media: searchAnswer } } }) }
    }
    if (url.startsWith(METADATA_URL)) throw new TypeError("no metadata in these tests")
    throw new TypeError(`no network in tests: ${url}`)
}

const environment = {
    fetch: httpFetch,
    secret: async () => "token",
    server: async (method: CoreMethod, endpoint: string) => {
        if (method === "GET" && endpoint === "/api/v1/status") return { settings: { library: { libraryPath: ROOT + "/", libraryPaths: [], refreshLibraryOnStart: autoScan } } }
        throw new Error(`the server is not asked: ${endpoint}`)
    },
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => void pauses++,
    localFolders: async () => ({
        list: async (path: string) => {
            const entries = tree[path]
            if (!entries) throw new Error("not there")
            return entries
        },
        // like the device: only a folder that holds nothing goes, and it leaves its parent's list
        removeEmptyFolder: async (path: string) => {
            if (!tree[path] || tree[path].length > 0) return false
            delete tree[path]
            const parent = path.slice(0, path.lastIndexOf("/"))
            tree[parent] = tree[parent].filter(entry => `${parent}/${entry.name}` !== path)
            removed.push(path)
            return true
        },
        // like the device: a file goes, a folder never; `stuck` cannot be deleted
        removeFile: async (path: string) => {
            if (path === stuck) throw new Error("not allowed")
            const parent = path.slice(0, path.lastIndexOf("/"))
            const entry = tree[parent]?.find(item => `${parent}/${item.name}` === path)
            if (entry?.folder) return false
            if (entry) tree[parent] = tree[parent].filter(item => item !== entry)
            deletedFiles.push(path)
            return true
        },
    }),
} as unknown as CoreEnvironment

async function ask(method: CoreMethod, endpoint: string, body: unknown = null): Promise<unknown> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route: ${method} ${endpoint}`)
    return matched.route.answer({ path: matched.path, query: null, body }, environment)
}

async function lists(progress = 2) {
    const entry = (id: number, item: Json) => ({ id, progress, status: "CURRENT", score: 0, repeat: 0, startedAt: {}, completedAt: {}, createdAt: 1, updatedAt: 2, media: item })
    await keepCollection(await environment.database(), "ANIME", {
        MediaListCollection: { lists: [{ status: "CURRENT", name: "Watching", isCustomList: false, entries: [entry(1, media(STONE, "Dr. STONE")), entry(2, media(WARS, "Dr. STONE: STONE WARS", { synonyms: ["Dr. Stone Season 2"] }))] }] },
    }, now)
}

const file = (name: string, size = 1000): LocalFolderEntry => ({ name, folder: false, size })
const folder = (name: string): LocalFolderEntry => ({ name, folder: true, size: 0 })

const scanned = (body: Json = {}) => ask("POST", "/api/v1/library/scan", { enhanced: false, enhanceWithOfflineDatabase: true, skipLockedFiles: true, skipIgnoredFiles: true, ...body }) as Promise<Json[]>
const byName = (files: Json[], name: string) => files.find(item => item.name === name) as Json & { metadata: Json }
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** The form of a value as the recordings write it */
function formOf(value: unknown): unknown {
    if (value === null) return "null"
    if (Array.isArray(value)) return value.length ? [formOf(value[0])] : []
    if (typeof value === "object") return Object.fromEntries(Object.entries(value as Json).map(([key, field]) => [key, formOf(field)]))
    return typeof value
}

/** Every field the core gives is recorded with the same kind (fields of the recording the core leaves out are allowed) */
function sameForm(core: unknown, recordedForm: unknown, path = "") {
    const form = formOf(core)
    if (Array.isArray(recordedForm)) {
        expect(Array.isArray(form), path).toBe(true)
        if ((form as unknown[]).length && recordedForm.length) sameForm((core as unknown[])[0], recordedForm[0], `${path}[0]`)
        return
    }
    if (typeof recordedForm === "object" && recordedForm !== null) {
        for (const key of Object.keys(core as Json)) {
            expect(Object.keys(recordedForm), `${path}.${key}`).toContain(key)
            sameForm((core as Json)[key], (recordedForm as Json)[key], `${path}.${key}`)
        }
        return
    }
    expect(form, path).toBe(recordedForm)
}

let stopListening = () => {}

beforeEach(async () => {
    forgetDatabases()
    database = null
    now = Date.UTC(2026, 10, 14)
    searches = []
    searchAnswer = []
    documents = []
    autoScan = false
    removed = []
    forgetScanAtStart()
    forgetLookAtFolders()
    pauses = 0
    events = []
    stopListening()
    stopListening = onCoreEvent(event => void events.push(event))
    tree = {
        [ROOT]: [file("Dr. STONE - 01.mp4", 1500), file("Dr. STONE - 02.mp4", 2500), folder("Other"), file("notes.txt"), file(".hidden.mkv")],
        [`${ROOT}/Other`]: [file("Urlaub am See 2025 - 03.mp4")],
    }
    await libraryIs(false)
})

/** The core's own library settings (stage 8b-3: no server's status any more) */
function libraryIs(refreshLibraryOnStart: boolean): Promise<unknown> {
    return ask("POST", "/api/v1/start", { library: { libraryPath: ROOT + "/", libraryPaths: [], refreshLibraryOnStart } })
}

describe("reading a file's name and matching it (own rule)", () => {
    it("takes title, season and episode from the name", () => {
        expect(readName("Dr. STONE - 01.mp4").parsed).toEqual({ original: "Dr. STONE - 01.mp4", title: "Dr. STONE", episode: "01" })
        expect(readName("[Group] Dr. Stone S2 - 05 [1080p].mkv").parsed).toMatchObject({ title: "Dr. Stone", season: "2", episode: "05", releaseGroup: "Group" })
    })

    it("scores the same plain title 1 and a longer title of the same name lower; a season sign moves the match", () => {
        const stone = media(STONE, "Dr. STONE")
        const wars = media(WARS, "Dr. STONE: STONE WARS", { synonyms: ["Dr. Stone Season 2"] })
        expect(titleScore("Dr. STONE", 0, "Dr. STONE")).toBe(1)
        expect(titleScore("Dr. STONE", 0, "Dr. STONE: STONE WARS")).toBeLessThan(0.8)
        expect(bestMatch("dr stone", 0, [wars, stone])?.media.id).toBe(STONE)
        expect(bestMatch("Dr. Stone", 2, [stone, wars])?.media.id).toBe(WARS)
        expect(bestMatch("Urlaub am See 2025", 0, [stone, wars])).toBeNull()
    })

    it("knows main episodes, specials, openings and films without a number", () => {
        const series = media(STONE, "Dr. STONE")
        const film = media(OTHER, "Made Film", { format: "MOVIE", episodes: 1 })
        expect(fileMetadataOf({ episode: "07" }, [], series)).toEqual({ episode: 7, anidbEpisode: "7", type: "main" })
        expect(fileMetadataOf({ episode: "2" }, ["ncop"], series)).toEqual({ episode: 2, anidbEpisode: "OP2", type: "nc" })
        expect(fileMetadataOf({ episode: "1" }, ["ova"], series)).toEqual({ episode: 1, anidbEpisode: "S1", type: "special" })
        expect(fileMetadataOf({}, [], film)).toEqual({ episode: 1, anidbEpisode: "1", type: "main" })
        expect(fileMetadataOf({}, [], series)).toEqual({ episode: 1, anidbEpisode: "S1", type: "special" })
    })
})

describe("the scan", () => {
    it("finds the video files below the folder, matches them against the lists and tells its progress", async () => {
        await lists()
        const files = await scanned()
        await flush()
        expect(files.map(item => item.name).sort()).toEqual(["Dr. STONE - 01.mp4", "Dr. STONE - 02.mp4", "Urlaub am See 2025 - 03.mp4"])
        expect(byName(files, "Dr. STONE - 01.mp4")).toMatchObject({ mediaId: STONE, path: `${ROOT}/Dr. STONE - 01.mp4`, locked: false, ignored: false, metadata: { episode: 1, aniDBEpisode: "1", type: "main" } })
        expect(byName(files, "Dr. STONE - 02.mp4").metadata.episode).toBe(2)
        expect(byName(files, "Urlaub am See 2025 - 03.mp4")).toMatchObject({ mediaId: 0, parsedFolderInfo: [{ original: "Other", title: "Other" }] })
        expect(searches).toEqual([])
        const progress = events.filter(event => event.type === "scan-progress").map(event => event.payload)
        expect(progress[0]).toBe(0)
        expect(progress.at(-1)).toBe(100)
        expect(progress).toEqual([...progress].sort((a, b) => (a as number) - (b as number)))
        expect(events.filter(event => event.type === "scan-status").every(event => typeof event.payload === "string")).toBe(true)
        expect(pauses).toBeGreaterThan(2)
    })

    it("enhanced: a title the lists do not know is searched once on AniList and becomes unknown media", async () => {
        await lists()
        tree[`${ROOT}/Other`] = [file("Made Astra - 01.mkv"), file("Made Astra - 02.mkv")]
        searchAnswer = [media(OTHER, "Made Astra")]
        const files = await scanned({ enhanced: true })
        expect(searches).toEqual(["Made Astra"])
        expect(byName(files, "Made Astra - 02.mkv")).toMatchObject({ mediaId: OTHER, metadata: { episode: 2 } })
        const home = await ask("GET", "/api/v1/library/collection") as Json
        expect(home.unknownGroups).toEqual([{ mediaId: OTHER, localFiles: expect.any(Array) }])
        expect((home.unknownGroups as Json[])[0].localFiles).toHaveLength(2)
    })

    it("a folder that cannot be read stops the scan and leaves the files as they were", async () => {
        await lists()
        await scanned()
        tree = {}
        await expect(scanned()).rejects.toThrow(/cannot read the library folder/)
        expect(((await ask("GET", "/api/v1/library/collection")) as Json).stats).toMatchObject({ totalFiles: 2 })
    })

    it("keeps locked and ignored files when told to skip them, forgets files that are gone", async () => {
        await lists()
        await scanned()
        await ask("PATCH", "/api/v1/library/local-file", { path: `${ROOT}/Dr. STONE - 02.mp4`, metadata: { episode: 9, aniDBEpisode: "9", type: "main" }, locked: true, ignored: false, mediaId: STONE })
        tree[ROOT] = tree[ROOT].filter(entry => entry.name !== "Dr. STONE - 01.mp4")
        const files = await scanned()
        expect(files.map(item => item.name).sort()).toEqual(["Dr. STONE - 02.mp4", "Urlaub am See 2025 - 03.mp4"])
        expect(byName(files, "Dr. STONE - 02.mp4")).toMatchObject({ locked: true, metadata: { episode: 9 } })
        const again = await scanned({ skipLockedFiles: false })
        expect(byName(again, "Dr. STONE - 02.mp4")).toMatchObject({ locked: false, metadata: { episode: 2 } })
    })

    it("keeps a summary per scan, newest first", async () => {
        await lists()
        await scanned()
        now += 1000
        await scanned()
        const summaries = await ask("GET", "/api/v1/library/scan-summaries") as Json[]
        expect(summaries).toHaveLength(2)
        expect(summaries[0].createdAt).toBe(new Date(now).toISOString())
        const summary = summaries[0].scanSummary as Json
        expect(summary.groups).toEqual([expect.objectContaining({ mediaId: STONE, mediaTitle: "Dr. STONE", mediaIsInCollection: true })])
        expect((summary.unmatchedFiles as Json[])[0]).toMatchObject({ localFile: { name: "Urlaub am See 2025 - 03.mp4" }, logs: [{ level: "warning" }] })
    })
})

describe("the files on the anime's page and the home collection", () => {
    it("anime entry: libraryData, files and episodes in the recorded form; own episodes are not to watch", async () => {
        await lists()
        await scanned()
        const entry = await ask("GET", `/api/v1/library/anime-entry/${STONE}`) as Json
        sameForm(entry, (recorded as Json).animeEntry)
        expect(entry.libraryData).toEqual({ allFilesLocked: false, sharedPath: ROOT, unwatchedCount: 0, mainFileCount: 2 })
        expect((entry.localFiles as Json[]).map(item => item.name)).toEqual(["Dr. STONE - 01.mp4", "Dr. STONE - 02.mp4"])
        expect((entry.episodes as Json[]).map(item => [item.episodeNumber, (item.localFile as Json).name])).toEqual([[1, "Dr. STONE - 01.mp4"], [2, "Dr. STONE - 02.mp4"]])
        expect(entry.nextEpisode).toBeNull()
        const toWatch = ((entry.downloadInfo as Json).episodesToDownload as Json[]).map(item => item.episodeNumber)
        expect(toWatch).toEqual([3, 4])
    })

    it("home: the anime with files in its list, the unmatched by folder, the numbers; the next episode on the device", async () => {
        await lists(1)
        await scanned()
        const home = await ask("GET", "/api/v1/library/collection") as Json
        const { stream: _stream, ...ownPart } = home
        sameForm(ownPart, (homeRecorded as Json).libraryCollection)
        const current = (home.lists as Json[]).find(list => list.status === "CURRENT") as Json
        expect((current.entries as Json[]).map(item => [item.mediaId, (item.libraryData as Json).unwatchedCount])).toEqual([[STONE, 1]])
        expect(home.unmatchedGroups).toEqual([{ dir: `${ROOT}/Other`, localFiles: [expect.objectContaining({ name: "Urlaub am See 2025 - 03.mp4" })], suggestions: [] }])
        expect(home.stats).toEqual({ totalEntries: 1, totalFiles: 2, totalShows: 1, totalMovies: 0, totalSpecials: 0, totalSize: "4.88 KB" })
        expect((home.continueWatchingList as Json[]).map(item => [item.episodeNumber, (item.localFile as Json).name])).toEqual([[2, "Dr. STONE - 02.mp4"]])
    })
})

describe("changing the files", () => {
    it("lock, ignore, unignore, unmatch; all at once; per anime", async () => {
        await lists()
        await scanned()
        const one = `${ROOT}/Dr. STONE - 01.mp4`
        expect(await ask("PATCH", "/api/v1/library/local-files", { paths: [one], action: "ignore" })).toBe(true)
        let home = await ask("GET", "/api/v1/library/collection") as Json
        expect((home.ignoredLocalFiles as Json[]).map(item => item.path)).toEqual([one])
        await ask("PATCH", "/api/v1/library/local-files", { paths: [one], action: "unignore" })
        const locked = await ask("POST", "/api/v1/library/local-files", { action: "lock" }) as Json[]
        expect(locked.filter(item => item.locked).map(item => item.name).sort()).toEqual(["Dr. STONE - 01.mp4", "Dr. STONE - 02.mp4"])
        const toggled = await ask("PATCH", "/api/v1/library/anime-entry/bulk-action", { mediaId: STONE, action: "toggle-lock" }) as Json[]
        expect(toggled.some(item => item.locked)).toBe(false)
        await ask("PATCH", "/api/v1/library/anime-entry/bulk-action", { mediaId: STONE, action: "unmatch" })
        home = await ask("GET", "/api/v1/library/collection") as Json
        expect(home.unmatchedLocalFiles).toHaveLength(3)
        await expect(ask("PATCH", "/api/v1/library/local-files", { paths: [one], action: "burn" })).rejects.toThrow(/unknown action/)
    })

    it("manual match puts the files under the anime with episodes from their names and locks them", async () => {
        await lists()
        await scanned()
        const path = `${ROOT}/Other/Urlaub am See 2025 - 03.mp4`
        const files = await ask("POST", "/api/v1/library/anime-entry/manual-match", { paths: [path], mediaId: WARS }) as Json[]
        expect(files.find(item => item.path === path)).toMatchObject({ mediaId: WARS, locked: true, metadata: { episode: 3, type: "main" } })
    })

    it("deleting files deletes them from the device, so the next scan does not bring them back (4.3.1)", async () => {
        await lists()
        await scanned()
        deletedFiles = []
        const left = await ask("DELETE", "/api/v1/library/local-files", { paths: [`${ROOT}/Dr. STONE - 01.mp4`] }) as Json[]
        expect(left.map(item => item.name).sort()).toEqual(["Dr. STONE - 02.mp4", "Urlaub am See 2025 - 03.mp4"])
        expect(deletedFiles).toEqual([`${ROOT}/Dr. STONE - 01.mp4`])
        expect(tree[ROOT].map(entry => entry.name)).not.toContain("Dr. STONE - 01.mp4")
        expect((await scanned()).map(item => item.name).sort()).toEqual(["Dr. STONE - 02.mp4", "Urlaub am See 2025 - 03.mp4"])
    })

    it("deletes only files the library knows inside its folders, and keeps the entry of a file that cannot go", async () => {
        await lists()
        await scanned()
        deletedFiles = []
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        // not in the library, outside its folders, a way out of it, a folder: nothing is touched
        await expect(ask("DELETE", "/api/v1/library/local-files", { paths: ["/storage/emulated/0/DCIM/photo.mp4", `${ROOT}/../x.mp4`, `${ROOT}/Other`] }))
            .rejects.toThrow("3 files could not be deleted")
        expect(deletedFiles).toEqual([])
        expect(warn).toHaveBeenCalledWith(`[Core] warn library: "photo.mp4" was not deleted: the library does not know the file (not scanned yet)`)
        stuck = `${ROOT}/Dr. STONE - 02.mp4`
        await expect(ask("DELETE", "/api/v1/library/local-files", { paths: [stuck, `${ROOT}/Dr. STONE - 01.mp4`] })).rejects.toThrow("1 file could not be deleted")
        // the device's reason is in the log, not swallowed
        expect(warn).toHaveBeenLastCalledWith(`[Core] warn library: "Dr. STONE - 02.mp4" was not deleted: not allowed`)
        warn.mockRestore()
        stuck = ""
        expect(deletedFiles).toEqual([`${ROOT}/Dr. STONE - 01.mp4`])
        const files = await ask("POST", "/api/v1/library/local-files", { action: "unlock" }) as Json[]
        expect(files.map(item => item.name).sort()).toEqual(["Dr. STONE - 02.mp4", "Urlaub am See 2025 - 03.mp4"])
    })
})

describe("playing a file", () => {
    it("tells the app's player to open the file itself (file://), with the anime and the episode", async () => {
        await lists()
        await scanned()
        events = []
        expect(await ask("POST", "/api/v1/directstream/play/localfile", { path: `${ROOT}/Dr. STONE - 01.mp4`, clientId: "x" })).toBeNull()
        await flush()
        const watch = events.find(event => event.type === "native-player")?.payload as { type: string, payload: Json }
        expect(watch.type).toBe("watch")
        expect(watch.payload).toMatchObject({
            streamType: "localfile", streamPath: `${ROOT}/Dr. STONE - 01.mp4`, streamUrl: "file:///storage/made/Anime/Dr.%20STONE%20-%2001.mp4",
            mimeType: "video/mp4", contentLength: 1500, isNakamaWatchParty: false, media: { id: STONE },
            episode: { episodeNumber: 1, progressNumber: 1, localFile: { name: "Dr. STONE - 01.mp4" } }, entryListData: { progress: 2 },
        })
        await expect(ask("POST", "/api/v1/playback-manager/play", { path: `${ROOT}/Other/Urlaub am See 2025 - 03.mp4` })).rejects.toThrow(/no anime/)
        await expect(ask("POST", "/api/v1/playback-manager/play", { path: "/nowhere.mp4" })).rejects.toThrow(/not in the library/)
    })
})

describe("the search for a file's title (5b-2: 36.0 ms reading AniList's answer on the tablet)", () => {
    it("asks only what matching and the pickers need, and lets the thread go before matching", async () => {
        await lists()
        tree[`${ROOT}/Other`] = [file("Made Astra - 01.mkv")]
        searchAnswer = [media(OTHER, "Made Astra")]
        const before = pauses
        await scanned({ enhanced: true })
        expect(documents).toHaveLength(1)
        expect(documents[0]).toContain("query SearchFileMatch")
        for (const heavy of ["description", "genres", "trailer", "bannerImage", "meanScore", "pageInfo"]) expect(documents[0]).not.toContain(heavy)
        for (const needed of ["synonyms", "format", "episodes", "title {", "coverImage {"]) expect(documents[0]).toContain(needed)
        // root, Other: one pause per folder; one per file; one after the search; three per save, summary
        expect(pauses - before).toBeGreaterThanOrEqual(4)
    })
})

describe("the folders beyond the scan (5b-2)", () => {
    it("file tree: the library folder as it is, video files only, counts of the scanned files, files by path", async () => {
        await lists()
        await scanned()
        tree[ROOT].push(file("Dr. STONE - 03.mp4"))
        const answer = await ask("GET", "/api/v1/library/explorer/file-tree") as { root: Json & { children: Json[] }, localFiles: Json }
        expect(answer.root).toMatchObject({ name: "Anime", path: ROOT, normalizedPath: ROOT.toLowerCase(), kind: "directory", mediaIds: [STONE], localFileCount: 3, matchedLocalFileCount: 2 })
        expect(answer.root.children.map(child => child.name).sort()).toEqual(["Dr. STONE - 01.mp4", "Dr. STONE - 02.mp4", "Dr. STONE - 03.mp4", "Other"])
        expect(answer.root.children.find(child => child.name === "Dr. STONE - 01.mp4")).toEqual({
            name: "Dr. STONE - 01.mp4", path: `${ROOT}/Dr. STONE - 01.mp4`, normalizedPath: `${ROOT}/dr. stone - 01.mp4`.toLowerCase(), kind: "file",
            size: 1500, mediaIds: [STONE], localFileCount: 1, matchedLocalFileCount: 1,
        })
        // not scanned yet: in the tree, not counted
        expect(answer.root.children.find(child => child.name === "Dr. STONE - 03.mp4")).toMatchObject({ localFileCount: 0, matchedLocalFileCount: 0 })
        expect(answer.root.children.find(child => child.name === "Other")).toMatchObject({ kind: "directory", mediaIds: [], localFileCount: 1, matchedLocalFileCount: 0 })
        expect(Object.keys(answer.localFiles).sort()).toEqual([`${ROOT}/Dr. STONE - 01.mp4`, `${ROOT}/Dr. STONE - 02.mp4`, `${ROOT}/Other/Urlaub am See 2025 - 03.mp4`])
        expect(await ask("POST", "/api/v1/library/explorer/file-tree/refresh")).toBe(true)
    })

    it("empty folders: only folders that hold nothing go (deepest first), never the library folder, a hidden file or a video", async () => {
        tree[ROOT].push(folder("Empty"), folder("Nested"), folder("Hidden"), folder("Kept"))
        tree[`${ROOT}/Empty`] = []
        tree[`${ROOT}/Nested`] = [folder("Inner")]
        tree[`${ROOT}/Nested/Inner`] = []
        tree[`${ROOT}/Hidden`] = [file(".nomedia")]
        tree[`${ROOT}/Kept`] = [folder("Inner"), file("Made - 01.mkv")]
        tree[`${ROOT}/Kept/Inner`] = []
        expect(await ask("DELETE", "/api/v1/library/empty-directories")).toBe(true)
        expect(removed.sort()).toEqual([`${ROOT}/Empty`, `${ROOT}/Kept/Inner`, `${ROOT}/Nested`, `${ROOT}/Nested/Inner`])
        expect(tree[`${ROOT}/Hidden`]).toEqual([file(".nomedia")])
        expect(tree[`${ROOT}/Kept`]).toEqual([file("Made - 01.mkv")])
        expect(tree[ROOT].map(entry => entry.name)).toEqual(["Dr. STONE - 01.mp4", "Dr. STONE - 02.mp4", "Other", "notes.txt", ".hidden.mkv", "Hidden", "Kept"])
        // an empty library folder itself stays
        tree[ROOT] = []
        removed = []
        expect(await ask("DELETE", "/api/v1/library/empty-directories")).toBe(true)
        expect(removed).toEqual([])
        expect(tree[ROOT]).toEqual([])
        delete tree[ROOT]
        await expect(ask("DELETE", "/api/v1/library/empty-directories")).rejects.toThrow(/cannot read the library folder/)
    })

    it("suggestions: AniList's anime for the folder's title, else for its first file's title; nothing without a title", async () => {
        searchAnswer = [media(OTHER, "Made Astra")]
        expect(await ask("POST", "/api/v1/library/anime-entry/suggestions", { dir: `${ROOT}/Made Astra/` })).toEqual([searchAnswer[0]])
        await lists()
        await scanned()
        expect(await ask("POST", "/api/v1/library/anime-entry/suggestions", { dir: `${ROOT}/1080p` })).toEqual([])
        expect(searches).toEqual(["Made Astra"])
        await expect(ask("POST", "/api/v1/library/anime-entry/suggestions", {})).rejects.toThrow(/dir must be a text/)
        expect(documents.every(document => document.includes("query SearchFileMatch"))).toBe(true)
    })

    it("scan at start: once per run, only with the setting on, told as auto-scan-started/-completed", async () => {
        await lists()
        await ask("GET", "/api/v1/library/collection")
        await flush()
        await flush()
        expect(events.some(event => event.type === "auto-scan-started")).toBe(false)
        forgetScanAtStart()
        autoScan = true
        await libraryIs(true)
        await ask("GET", "/api/v1/library/collection")
        await vi.waitFor(() => expect(events.map(event => event.type)).toContain("auto-scan-completed"))
        expect(events.map(event => event.type).filter(type => type.startsWith("auto-scan"))).toEqual(["auto-scan-started", "auto-scan-completed"])
        expect(((await ask("GET", "/api/v1/library/scan-summaries")) as Json[])).toHaveLength(1)
        events = []
        await ask("GET", "/api/v1/library/collection")
        await flush()
        expect(events.some(event => event.type === "auto-scan-started")).toBe(false)
    })

    it("after a torrent download (4.2.0): reads the folders again for a folder inside the library, not for one outside", async () => {
        await lists()
        await refreshAfterDownload(environment, "/storage/made/Elsewhere")
        await flush()
        expect(events.some(event => event.type === "auto-scan-started")).toBe(false)
        await refreshAfterDownload(environment, `file://${ROOT}/Dr.%20STONE`)
        await flush()
        expect(events.map(event => event.type).filter(type => type.startsWith("auto-scan"))).toEqual(["auto-scan-started", "auto-scan-completed"])
        expect(((await ask("GET", "/api/v1/library/scan-summaries")) as Json[])).toHaveLength(1)
    })

    it("automatic scan when the app is back: not with the switch off, not within 10 minutes, not for unchanged folders; a new file scans", async () => {
        await lists()
        const back = () => ask("POST", "/api/v1/library/auto-scan")
        const autoScans = () => events.map(event => event.type).filter(type => type.startsWith("auto-scan"))
        expect(await back()).toEqual({ scanned: false })
        await ask("PATCH", "/api/v1/settings", { library: { libraryPath: ROOT + "/", libraryPaths: [], autoScan: true } })
        await scanned()
        // the folders as the library has them: nothing to do
        expect(await back()).toEqual({ scanned: false })
        tree[ROOT].push(file("Dr. STONE - 03.mp4", 3500))
        now += AUTO_SCAN_EVERY_MS - 1
        expect(await back()).toEqual({ scanned: false })
        expect(autoScans()).toEqual([])
        now += 1
        expect(await back()).toEqual({ scanned: true })
        await vi.waitFor(() => expect(autoScans()).toEqual(["auto-scan-started", "auto-scan-completed"]))
        expect(((await ask("GET", "/api/v1/library/scan-summaries")) as Json[])).toHaveLength(2)
        // a changed size is a change too; the same files after the scan are not
        now += AUTO_SCAN_EVERY_MS
        expect(await back()).toEqual({ scanned: false })
        tree[ROOT][0] = file("Dr. STONE - 01.mp4", 1600)
        now += AUTO_SCAN_EVERY_MS
        expect(await back()).toEqual({ scanned: true })
        events = []
        await ask("PATCH", "/api/v1/settings", { library: { libraryPath: ROOT + "/", libraryPaths: [], autoScan: false } })
        tree[ROOT].push(file("Dr. STONE - 04.mp4"))
        now += AUTO_SCAN_EVERY_MS
        expect(await back()).toEqual({ scanned: false })
        expect(autoScans()).toEqual([])
    })
})

/*
 * 8 ms (5b-2, docs/EIGENER-KERN.md §4p): "library scan match" held the tablet's thread for 42.2 ms – up to 20 files were
 * read and matched against every anime in the lists before the next pause. The pause lets the thread go only once a
 * piece ran long enough, so it may come after every file.
 */
describe("matching many files (5b-2: 42.2 ms library scan match on the tablet)", () => {
    it("offers the thread a pause before every file", async () => {
        await lists()
        tree[ROOT] = Array.from({ length: 45 }, (_, at) => file(`Dr. STONE - ${String(at + 1).padStart(2, "0")}.mp4`))
        const parts: (string | undefined)[] = []
        const original = environment.pause
        environment.pause = async (part?: string) => void parts.push(part)
        try {
            expect(await scanned()).toHaveLength(45)
        }
        finally {
            environment.pause = original
        }
        expect(parts.filter(part => part === "library scan match").length).toBeGreaterThanOrEqual(45)
    })
})
