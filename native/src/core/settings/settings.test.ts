import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { CoreError } from "../errors"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import recorded from "./settings.recorded.json"
import { SERVER_PART_WITHOUT_SERVER, USER_WITHOUT_ACCOUNT } from "../start/without-server"

/*
 * The server's answers to the interfaces that write settings, look and home items, recorded at the scratch app
 * (scripts/record-server.mjs api-write, 13.11.2026): the request, the answer, and the state after each call. The core
 * gets the same requests in the same order on an empty database and has to answer the same, field for field, and be in
 * the same state afterwards. Only the times differ: they are the moment of the call.
 */

type Json = Record<string, unknown>
type OwnPart = { settings: Json | null, themeSettings: Json }
type RecordedStep = { name: string, recordedAt: string, method: string, endpoint: string, body: unknown, status: number, answer: unknown, after: OwnPart }

const steps = recorded.steps as RecordedStep[]
/** The status without the server (start/without-server.ts): the part of a server never set up, no account */
const serverStatus: Json = { ...SERVER_PART_WITHOUT_SERVER, user: USER_WITHOUT_ACCOUNT, updating: false, serverReady: true }

let clock = 0
let askedServer: string[] = []
let database: Promise<CoreDatabase> | null = null

/** The server as the core sees it: its status, with settings and look of its own that must not show up in an answer. */
const environment: CoreEnvironment = {
    fetch: async () => {
        throw new Error("the settings need no network")
    },
    secret: async () => null,
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
}

/** Asks the core the way core-switch.ts does: through the register, by method and address. */
function ask(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match?.route.area, `${method} ${endpoint}`).toBe("settings")
    return match!.route.answer({ path: match!.path, query: null, body }, environment)
}

const status = () => ask("GET", "/api/v1/status") as Promise<Json & OwnPart>
const time = (milliseconds: number) => new Date(milliseconds).toISOString()

/** The recorded state with the times of this run: settings changed at `settingsAt`, look saved first at `lookFrom`. */
function withTimes(own: OwnPart, settingsAt: number, look: { from: number, changed: number } | null): OwnPart {
    return {
        settings: own.settings && { ...own.settings, updatedAt: time(settingsAt) },
        themeSettings: look ? { ...own.themeSettings, createdAt: time(look.from), updatedAt: time(look.changed) } : own.themeSettings,
    }
}

/** Same fields in the same order, also inside the sections */
function expectSameFieldOrder(actual: unknown, wanted: unknown, where: string) {
    if (typeof wanted !== "object" || wanted === null || Array.isArray(wanted)) return
    expect(Object.keys(actual as object), where).toEqual(Object.keys(wanted))
    for (const [name, value] of Object.entries(wanted)) expectSameFieldOrder((actual as Json)[name], value, `${where}.${name}`)
}

/** Plays the recorded calls up to and including `last`; returns the state the recording had after it, with this run's times. */
async function play(last: string): Promise<OwnPart> {
    let look = null as { from: number, changed: number } | null
    let settingsAt = 0
    let wanted: OwnPart = recorded.firstStart as OwnPart
    for (const step of steps) {
        clock = Date.parse(step.recordedAt)
        if (step.name.startsWith("THEME.")) look = { from: look?.from ?? clock, changed: clock }
        else settingsAt = clock
        const answer = await ask(step.method, step.endpoint, step.body)
        wanted = withTimes(step.after, settingsAt, look)
        const wantedAnswer = step.answer === "status" ? { ...serverStatus, ...wanted } : step.name.startsWith("THEME.") ? wanted.themeSettings : step.answer
        expect(answer, step.name).toEqual(wantedAnswer)
        if (step.answer === "status") {
            expectSameFieldOrder((answer as OwnPart).settings, wanted.settings, `${step.name} settings`)
            expectSameFieldOrder((answer as OwnPart).themeSettings, wanted.themeSettings, `${step.name} themeSettings`)
        }
        else {
            expectSameFieldOrder(answer, wantedAnswer, step.name)
        }
        if (step.name === last) return wanted
    }
    throw new Error(`no recorded step ${last}`)
}

beforeEach(() => {
    forgetDatabases()
    database = null
    clock = Date.parse("2026-11-13T09:00:00.000Z")
    askedServer = []
})

describe("an empty database", () => {
    it("is the first start: no settings, the look nobody has touched, no home items", async () => {
        const answer = await status()
        expect(answer).toEqual({ ...serverStatus, ...recorded.firstStart })
        expect(answer.settings).toBeNull()
        expect(answer.themeSettings.id).toBe(0)
        expectSameFieldOrder(answer.themeSettings, recorded.firstStart.themeSettings, "themeSettings")
        expect(await ask("GET", "/api/v1/status/home-items")).toBe(recorded.homeItems.before)
        expect(recorded.homeItems.before).toBeNull()
    })
})


describe("the recorded calls, in the recorded order", () => {
    it("has all five recordings as test data, every one answered with 200", () => {
        expect(steps.map(step => `${step.method} ${step.endpoint} ${step.status}`)).toEqual([
            "POST /api/v1/start 200",
            "PATCH /api/v1/settings 200",
            "PATCH /api/v1/settings/path 200",
            "PATCH /api/v1/settings/media-player 200",
            "PATCH /api/v1/theme 200",
        ])
        expect(recorded.homeItems.status).toBe(200)
    })

    for (const step of steps) {
        it(`${step.name}: same answer, same state afterwards`, async () => {
            const wanted = await play(step.name)
            expect(await status()).toEqual({ ...serverStatus, ...wanted })
        })
    }

    it("SETTINGS.GettingStarted stores three values differently from the request, as recorded", async () => {
        const sent = steps[0].body as Record<string, Json>
        const { settings } = await play("SETTINGS.GettingStarted") as { settings: Record<string, Json> }
        expect([sent.library.includeOnlineStreamingInLibrary, settings.library.includeOnlineStreamingInLibrary]).toEqual([false, true])
        expect([sent.torrent.defaultTorrentClient, settings.torrent.defaultTorrentClient]).toEqual(["none", "seanime"])
        expect([sent.discord.richPresenceUseMediaTitleStatus, settings.discord.richPresenceUseMediaTitleStatus]).toEqual([true, false])
        // the parts of the request that are not settings are not kept
        expect(Object.keys(settings)).not.toContain("enableTorrentStreaming")
        expect(Object.keys(settings)).not.toContain("debridApiKey")
    })

    it("SETTINGS.SaveMediaPlayerSettings answers `true` and asks the server nothing", async () => {
        await play("SETTINGS.PatchSetting")
        askedServer = []
        const step = steps.find(candidate => candidate.name === "SETTINGS.SaveMediaPlayerSettings")!
        expect(await ask(step.method, step.endpoint, step.body)).toBe(true)
        expect(askedServer).toEqual([])
    })

    it("STATUS.UpdateHomeItems: empty answer, the items afterwards as recorded", async () => {
        const wanted = await play("THEME.UpdateTheme")
        const lookSavedAt = clock
        clock += 120
        expect(await ask("POST", "/api/v1/status/home-items", recorded.homeItems.body)).toBeUndefined()
        expect(recorded.homeItems.answerBody).toBe("")
        const items = await ask("GET", "/api/v1/status/home-items")
        expect(items).toEqual(recorded.homeItems.after)
        expectSameFieldOrder((items as unknown[])[0], recorded.homeItems.after[0], "home item")
        // the status still shows no home items in the look (recorded: null), but the look counts as changed
        expect(await status()).toEqual({
            ...serverStatus,
            settings: wanted.settings,
            themeSettings: { ...wanted.themeSettings, updatedAt: time(clock) },
        })
        expect(wanted.themeSettings.updatedAt).toBe(time(lookSavedAt))
    })

    it("is all still there after a new start", async () => {
        const wanted = await play("THEME.UpdateTheme")
        await ask("POST", "/api/v1/status/home-items", recorded.homeItems.body)
        const before = await status()
        database = null
        expect(await status()).toEqual(before)
        expect(before.settings).toEqual(wanted.settings)
        expect(await ask("GET", "/api/v1/status/home-items")).toEqual(recorded.homeItems.after)
    })
})

describe("what no recording shows (the core's own decisions)", () => {
    const refused = async (work: Promise<unknown>, text: string) => {
        const error = await work.then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(CoreError)
        expect((error as CoreError).status).toBe(500)
        expect((error as CoreError).message).toContain(text)
    }

    it("refuses to save, patch or set the media player before the first start, and stores nothing", async () => {
        const save = steps[1]
        await refused(ask(save.method, save.endpoint, save.body), "not been set up")
        await refused(ask("PATCH", "/api/v1/settings/path", { path: "anilist.hideAudienceScore", value: true }), "not been set up")
        await refused(ask("PATCH", "/api/v1/settings/media-player", steps[3].body), "not been set up")
        expect((await status()).settings).toBeNull()
    })

    it("patches one field and leaves every other as it was", async () => {
        const before = await play("SETTINGS.GettingStarted") as { settings: Record<string, Json> }
        clock += 50
        const answer = await ask("PATCH", "/api/v1/settings/path", { path: "library.autoPlayNextEpisode", value: true }) as { settings: Record<string, Json> }
        expect(answer.settings).toEqual({
            ...before.settings,
            updatedAt: time(clock),
            library: { ...before.settings.library, autoPlayNextEpisode: true },
        })
    })

    it("refuses a path it does not know and a value of the wrong kind, and stores nothing", async () => {
        const before = await play("SETTINGS.GettingStarted")
        for (const path of ["anilist", "anilist.unknown", "unknown.field", "anilist.hideAudienceScore.more", "", "id", "listSync.x"]) {
            await refused(ask("PATCH", "/api/v1/settings/path", { path, value: true }), "unknown setting")
        }
        await refused(ask("PATCH", "/api/v1/settings/path", { path: "anilist.hideAudienceScore", value: "yes" }), "must be a yes/no value")
        await refused(ask("PATCH", "/api/v1/settings/path", { path: "torrent.seanimePort", value: "50007" }), "must be a number")
        await refused(ask("PATCH", "/api/v1/settings/path", { path: "library.libraryPaths", value: "a" }), "must be a list")
        await refused(ask("PATCH", "/api/v1/settings/path", { path: "anilist.hideAudienceScore" }), "needs a value")
        await refused(ask("PATCH", "/api/v1/settings/path", { path: 5, value: true }), "path must be a text")
        const save = steps[1].body as Json
        await refused(ask("PATCH", "/api/v1/settings", { ...save, anilist: { hideAudienceScore: 1 } }), "anilist.hideAudienceScore must be a yes/no value")
        await refused(ask("PATCH", "/api/v1/settings", null), "must be an object")
        await refused(ask("PATCH", "/api/v1/theme", { theme: null }), "theme must be an object")
        await refused(ask("PATCH", "/api/v1/theme", { theme: { accentColor: 5 } }), "theme.accentColor must be a text")
        await refused(ask("POST", "/api/v1/status/home-items", { items: [{ id: "a" }] }), "items[0] needs an id and a type")
        expect(await status()).toEqual({ ...serverStatus, ...before })
        expect(await ask("GET", "/api/v1/status/home-items")).toBeNull()
    })

    it("drops fields it does not know and fills missing ones with the empty value of their kind", async () => {
        await play("SETTINGS.GettingStarted")
        const save = steps[1].body as Record<string, Json>
        const answer = await ask("PATCH", "/api/v1/settings", {
            ...save,
            anilist: { enableAdultContent: true, somethingElse: 1 },
            library: { ...save.library, libraryPaths: null },
            extra: { a: 1 },
        }) as { settings: Record<string, Json> }
        expect(answer.settings.anilist).toEqual({ hideAudienceScore: false, enableAdultContent: true, blurAdultContent: false, disableCacheLayer: false })
        expect(answer.settings.library.libraryPaths).toEqual([])
        expect(Object.keys(answer.settings)).toEqual(Object.keys(steps[1].after.settings!))
        // a save does not carry the auto downloader; it stays as the first start stored it
        expect(answer.settings.autoDownloader).toEqual(steps[0].after.settings!.autoDownloader)
    })

    it("keeps the look's first-saved time on a second save, and its list of unpinned menu items", async () => {
        await play("THEME.UpdateTheme")
        const firstSaved = clock
        clock += 5000
        const theme = { ...(steps[4].body as { theme: Json }).theme, accentColor: "#112233", unpinnedMenuItems: ["schedule"], homeItems: [{ id: "x", type: "y" }] }
        const answer = await ask("PATCH", "/api/v1/theme", { theme }) as Json
        expect(answer).toEqual({ ...steps[4].after.themeSettings, createdAt: time(firstSaved), updatedAt: time(clock), accentColor: "#112233", unpinnedMenuItems: ["schedule"] })
        expect(answer.homeItems).toBeNull()
    })

    it("replaces the home items as a whole, keeps their order and options, and is empty again after an empty list", async () => {
        const items = [{ id: "b", type: "anime-library", options: { layout: "grid" } }, { id: "a", type: "anime-continue-watching", schemaVersion: 2 }]
        await ask("POST", "/api/v1/status/home-items", recorded.homeItems.body)
        await ask("POST", "/api/v1/status/home-items", { items })
        expect(await ask("GET", "/api/v1/status/home-items")).toEqual([
            { id: "b", type: "anime-library", options: { layout: "grid" }, schemaVersion: 0 },
            { id: "a", type: "anime-continue-watching", schemaVersion: 2 },
        ])
        // no look was saved yet: the home items do not create one
        expect((await status()).themeSettings.id).toBe(0)
        await ask("POST", "/api/v1/status/home-items", { items: [] })
        expect(await ask("GET", "/api/v1/status/home-items")).toBeNull()
    })

    it("keeps both changes when two arrive at the same time", async () => {
        await play("SETTINGS.GettingStarted")
        await Promise.all([
            ask("PATCH", "/api/v1/settings/path", { path: "anilist.enableAdultContent", value: true }),
            ask("PATCH", "/api/v1/settings/path", { path: "anilist.blurAdultContent", value: true }),
            ask("PATCH", "/api/v1/settings/path", { path: "library.autoScan", value: true }),
        ])
        const { settings } = await status() as { settings: Record<string, Json> }
        expect(settings.anilist).toEqual({ hideAudienceScore: false, enableAdultContent: true, blurAdultContent: true, disableCacheLayer: false })
        expect(settings.library.autoScan).toBe(true)
    })
})
