import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { LONGEST_PIECE_MS, createBlockingWatch } from "./index"
import { PAUSE_AFTER_MS, type PieceWhere, afterCallersTurn } from "./blocking"

/** A clock the test moves */
function watched() {
    const clock = { now: 0 }
    const pieces: { milliseconds: number, what: string }[] = []
    const watch = createBlockingWatch({
        now: () => clock.now,
        onPiece: (milliseconds, what) => void pieces.push({ milliseconds, what }),
        free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    })
    /** Time passes: core code keeping the thread, or the thread being free while the core waits */
    const pass = (milliseconds: number) => void (clock.now += milliseconds)
    return { watch, pass, pieces }
}

describe("blocking watch", () => {
    it("allows what the plan allows", () => {
        expect(LONGEST_PIECE_MS).toBe(8)
    })

    it("measures a call that never waits as one piece", () => {
        const { watch, pass, pieces } = watched()
        watch.enter("GET /thing")
        pass(3)
        watch.leave()
        expect(pieces).toEqual([{ milliseconds: 3, what: "GET /thing" }])
    })

    it("does not count real waiting: the pieces before and after are separate", async () => {
        const { watch, pass, pieces } = watched()
        let answer: (value: string) => void = () => undefined
        const askServer = watch.waiting(() => new Promise<string>(resolve => void (answer = resolve)))

        watch.enter("GET /status")
        pass(2)
        const pending = askServer().then(() => {
            pass(5)
            watch.leave()
        })
        // 100 ms on the network: the thread is free
        pass(100)
        answer("status")
        await pending
        expect(pieces).toEqual([{ milliseconds: 2, what: "GET /status" }, { milliseconds: 5, what: "GET /status" }])
    })

    it("counts statements that run on the calling thread into the piece", async () => {
        const { watch, pass, pieces } = watched()
        // like the first database driver on the device: the statement has run when the function returns, and is not wrapped
        const statement = async () => pass(4)

        watch.enter("PATCH /settings")
        pass(1)
        await statement()
        pass(1)
        await statement()
        await statement()
        pass(1)
        watch.leave()
        expect(pieces).toEqual([{ milliseconds: 15, what: "PATCH /settings" }])
        expect(pieces[0].milliseconds).toBeGreaterThan(LONGEST_PIECE_MS)
    })

    it("counts what a wrapped function does before it waits", async () => {
        const { watch, pass, pieces } = watched()
        let done: () => void = () => undefined
        const slowStart = watch.waiting(() => {
            pass(6)
            return new Promise<void>(resolve => void (done = resolve))
        })
        watch.enter("POST /start")
        const pending = slowStart()
        pass(30)
        done()
        await pending
        watch.leave()
        expect(pieces.map(piece => piece.milliseconds)).toEqual([6, 0])
    })

    it("goes on after a wrapped function failed, and passes the failure on", async () => {
        const { watch, pass, pieces } = watched()
        const failing = watch.waiting(async () => {
            throw new Error("no answer")
        })
        watch.enter("GET /thing")
        await expect(failing()).rejects.toThrow("no answer")
        pass(2)
        watch.leave()
        expect(pieces).toEqual([{ milliseconds: 0, what: "GET /thing" }, { milliseconds: 2, what: "GET /thing" }])
    })

    it("keeps the name of each request while two of them wait at the same time", async () => {
        const { watch, pass, pieces } = watched()
        const answers: (() => void)[] = []
        const askServer = watch.waiting(() => new Promise<void>(resolve => void answers.push(resolve)))
        const call = async (what: string) => {
            watch.enter(what)
            pass(1)
            await askServer()
            pass(2)
            watch.leave()
        }
        const a = call("GET /a")
        const b = call("GET /b")
        answers[1]()
        await b
        answers[0]()
        await a
        expect(pieces).toEqual([
            { milliseconds: 1, what: "GET /a" },
            { milliseconds: 1, what: "GET /b" },
            { milliseconds: 2, what: "GET /b" },
            { milliseconds: 2, what: "GET /a" },
        ])
    })

    it("lets the thread go in a pause once the work has run long, and names the part that follows", async () => {
        const { watch, pass, pieces } = watched()
        watch.enter("GET /lists")
        await watch.pause("reading")
        pass(PAUSE_AFTER_MS - 1)
        // short so far: no wait, the piece goes on
        await watch.pause()
        expect(pieces).toEqual([])
        pass(1)
        await watch.pause("shaping")
        pass(2)
        watch.leave()
        expect(pieces).toEqual([{ milliseconds: PAUSE_AFTER_MS, what: "GET /lists (reading)" }, { milliseconds: 2, what: "GET /lists (shaping)" }])
    })

    it("keeps pausing long work when another request's end closed the piece", async () => {
        const { watch, pass, pieces } = watched()
        watch.enter("GET /lists")
        pass(1)
        // another request ends in between
        watch.leave()
        pass(PAUSE_AFTER_MS)
        await watch.pause()
        await watch.pause()
        pass(PAUSE_AFTER_MS)
        await watch.pause()
        watch.leave()
        expect(pieces).toEqual([{ milliseconds: 1, what: "GET /lists" }, { milliseconds: PAUSE_AFTER_MS, what: "GET /lists" }, { milliseconds: 0, what: "GET /lists" }])
    })

    it("never waits for a timer while the app is not in front, and lets the thread go again once it is (4b-C1K)", async () => {
        const clock = { now: 0 }
        const pieces: { milliseconds: number, what: string }[] = []
        let front = false
        let freed = 0
        const watch = createBlockingWatch({
            now: () => clock.now,
            onPiece: (milliseconds, what) => void pieces.push({ milliseconds, what }),
            // the app's timers while it is not in front: they never fire
            free: () => {
                freed += 1
                return new Promise<void>(() => {})
            },
            inFront: () => front,
        })
        watch.enter("offline: event of the loader")
        clock.now += PAUSE_AFTER_MS + 3
        // before 4b-C1K this pause waited for the timer, and the work hung until the app was opened
        await watch.pause("offline: next")
        clock.now += 1
        watch.leave()
        expect(freed).toBe(0)
        expect(pieces).toEqual([{ milliseconds: PAUSE_AFTER_MS + 4, what: "offline: event of the loader (offline: next)" }])

        // in front the pause gives the thread away as before
        front = true
        watch.enter("GET /lists")
        clock.now += PAUSE_AFTER_MS
        let over = false
        void watch.pause().then(() => void (over = true))
        for (let turn = 0; turn < 10; turn++) await Promise.resolve()
        expect(freed).toBe(1)
        expect(over).toBe(false)
        expect(pieces.at(-1)).toEqual({ milliseconds: PAUSE_AFTER_MS, what: "GET /lists" })
    })

    it("stands in the one seam every core call goes through, with every wait wrapped", () => {
        const seam = fs.readFileSync(path.join(__dirname, "../api/client/core-switch.ts"), "utf8")
        expect(seam).toContain("fetch: watch.waiting(async (url, init) => {")
        // reading the answer's body is a wait too; unwrapped, its time counted as the core's
        expect(seam).toContain("text: watch.waiting(() => response.text(), \"network read\")")
        expect(seam).toContain("pause: watch.pause,")
        // a request's piece names the core's own part and what follows its answer (8-ms round 2)
        const asked = seam.split("const result = await answer({ body: data, query: params }, environment)")
        expect(asked).toHaveLength(2)
        expect(asked[0].trimEnd().endsWith("watch.mark(\"core\")")).toBe(true)
        expect(asked[1].split("logger(")[0]).toContain("watch.mark(\"answered\")")
        expect(seam).toContain("const openFile = watch.waiting((name: string) => openDatabaseAsync(name), \"database file\")")
        expect(seam).toContain("openCoreDatabase(watch.waiting(sqlDriverFor(await openFile(DATABASE_NAME)), \"sql\"), Date.now, watch.waiting(<T>(pending: Promise<T>) => pending, \"database line\") as LineWait)")
        // the statements must not run on the calling thread again: then they would be no waits
        const driver = fs.readFileSync(path.join(__dirname, "../api/client/core-database.ts"), "utf8")
        expect(driver.split("export function sqlDriverFor")[1]).not.toContain("Sync(")
        // the extensions' files only through the module's async functions: `exists`, `list()`, size and time of the newer
        // File/Directory run on the calling thread and so are no waits (3f-4)
        const files = fs.readFileSync(path.join(__dirname, "../api/client/core-extensions.ts"), "utf8")
        expect(files).not.toContain("from \"expo-file-system\"")
        expect(files).toContain("from \"expo-file-system/legacy\"")
        expect(files).not.toMatch(/Sync\(|new File\(|new Directory\(|\.list\(\)/)
        // the library folders the same way: Directory.list() and File.size held the thread 9.5 ms in "library scan
        // folders" on the tablet (5b-1); every device call is a wait of the watch (5b-2)
        const folders = fs.readFileSync(path.join(__dirname, "../api/client/core-local-files.ts"), "utf8")
        expect(folders).not.toContain("from \"expo-file-system\"")
        expect(folders).toContain("from \"expo-file-system/legacy\"")
        expect(folders).not.toMatch(/Sync\(|new File\(|new Directory\(|\.list\(\)/)
        expect(folders).toMatch(/return \{\s+list: watch\.waiting\(list, "folder list"\),\s+removeEmptyFolder: watch\.waiting\(removeEmptyFolder, "folder remove"\),\s+removeFile: watch\.waiting\(removeFile, "file remove"\),\s+\}/)
        expect(seam).toContain("localFolders: async () => (await import(\"@/api/client/core-local-files\")).localFoldersFor(watch),")
        // the core starts after the turn of the hook that asked (3g)
        expect(seam).toMatch(/await watch\.afterCallersTurn\(\)\s+watch\.enter\(what\)\s+const environment = coreEnvironment\(\)\s+watch\.mark\("core"\)\s+const result = await answer\(/)
        expect(seam).toMatch(/finally \{[^}]*watch\.leave\(\)\s+\}/)
    })
})

describe("blocking watch: named measuring points (3f-2)", () => {
    function named() {
        const clock = { now: 0 }
        const pieces: { milliseconds: number, what: string, where: PieceWhere }[] = []
        const watch = createBlockingWatch({
            now: () => clock.now,
            onPiece: (milliseconds, what, where) => void pieces.push({ milliseconds, what, where }),
            free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
        })
        return { watch, pass: (milliseconds: number) => void (clock.now += milliseconds), pieces }
    }

    it("cuts a piece at its marks and names the waits around it", async () => {
        const { watch, pass, pieces } = named()
        let answer: () => void = () => undefined
        const read = watch.waiting(() => new Promise<void>(resolve => void (answer = resolve)), "file read")
        watch.enter("POST /onlinestream/episode-list")
        pass(1)
        watch.mark("choose")
        pass(3)
        const reading = read()
        pass(20) // the screens run while the file is read
        answer()
        await reading
        watch.mark("parse")
        pass(9)
        watch.mark("answer")
        pass(2)
        watch.leave()
        expect(pieces).toEqual([
            { milliseconds: 4, what: "POST /onlinestream/episode-list", where: { from: "start", until: "file read", sections: [{ name: "start", milliseconds: 1 }, { name: "choose", milliseconds: 3 }] } },
            { milliseconds: 11, what: "POST /onlinestream/episode-list", where: { from: "file read", until: "end", sections: [{ name: "file read", milliseconds: 0 }, { name: "parse", milliseconds: 9 }, { name: "answer", milliseconds: 2 }] } },
        ])
    })

    it("names an unnamed wait by its function, else as a wait", async () => {
        const { watch, pass, pieces } = named()
        const fileText = watch.waiting(async function fileText() {
            await Promise.resolve()
        })
        watch.enter("GET /x")
        pass(1)
        await fileText()
        watch.leave()
        expect(pieces.map(piece => [piece.where.from, piece.where.until])).toEqual([["start", "fileText"], ["fileText", "end"]])
    })

    it("forgets a wait nobody went on after: a later idle close does not count the free time since (3f-4)", async () => {
        const { watch, pass, pieces } = named()
        const close = watch.waiting(() => Promise.resolve(), "sandbox close")
        const join = watch.waiting(<T>(pending: Promise<T>) => pending, "join")
        watch.enter("POST /api/v1/extensions/all")
        pass(2)
        watch.leave()
        // the idle timer of one sandbox closes it, outside of any request; nothing goes on after the close
        await close()
        // the thread is free for a while (other turns run)
        pass(2351)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        // the idle timer of a second sandbox: its close joins the sandbox's opening first
        const joined = join(Promise.resolve("box"))
        pass(1)
        expect(await joined).toBe("box")
        // only the request's own 2 ms; no piece from the first close's end
        expect(pieces.map(piece => piece.milliseconds)).toEqual([2])
    })

    it("still opens the piece of code that goes on after a wait in the same turn", async () => {
        const { watch, pass, pieces } = named()
        const close = watch.waiting(() => Promise.resolve(), "sandbox close")
        const names = watch.waiting(() => Promise.resolve(["a.json"]), "file names")
        watch.enter("POST /api/v1/extensions/install")
        await close()
        pass(5) // work after the close, before the next wait
        await names()
        watch.leave()
        expect(pieces.map(piece => [piece.where.from, piece.where.until, piece.milliseconds])).toEqual([["start", "sandbox close", 0], ["sandbox close", "file names", 5], ["file names", "end", 0]])
    })

    it("starts a request after its caller's turn: what the caller still does is not the core's (3g)", async () => {
        const { watch, pass, pieces } = named()
        const names = watch.waiting(() => new Promise<string[]>(resolve => setTimeout(() => resolve([]), 1)), "file names")
        // a hook asks inside the screens' work (a page mounting) and that work goes on after the call returned
        async function request(late: boolean) {
            if (late) await afterCallersTurn()
            watch.enter("POST /api/v1/onlinestream/episode-source")
            try {
                pass(1)
                await Promise.resolve()
                return await names()
            }
            finally {
                watch.leave()
            }
        }
        const atOnce = request(false)
        pass(50)
        await atOnce
        // entered at once, the piece ran until the first wait and held the caller's 50 ms (S22 3f-4: 54.2 ms)
        expect(pieces[0]).toMatchObject({ milliseconds: 51, where: { from: "start", until: "file names" } })
        pieces.length = 0
        const late = request(true)
        pass(50)
        await late
        expect(pieces[0]).toMatchObject({ milliseconds: 1, where: { from: "start", until: "file names" } })
    })

    it("starts a request after its caller's promise jobs too, in front only (8-ms run)", async () => {
        const { watch, pass, pieces } = named()
        const names = watch.waiting(() => new Promise<string[]>(resolve => setTimeout(() => resolve([]), 1)), "file names")
        async function request(start: () => Promise<void>) {
            await start()
            watch.enter("GET /api/v1/library/collection")
            try {
                pass(1)
                // an await on something already there: the promise jobs queued before it run in between
                await Promise.resolve()
                return await names()
            }
            finally {
                watch.leave()
            }
        }
        // the screen that asked goes on in its own promise jobs (a query library, React's work after a mount)
        async function caller(start: () => Promise<void>) {
            const asked = request(start)
            await null
            pass(20)
            await asked
        }
        // one promise job was not enough: the caller's next job ran inside the core's open piece
        await caller(afterCallersTurn)
        expect(pieces[0]).toMatchObject({ milliseconds: 21, where: { from: "start", until: "file names" } })
        pieces.length = 0
        await caller(watch.afterCallersTurn)
        expect(pieces[0]).toMatchObject({ milliseconds: 1, where: { from: "start", until: "file names" } })
        // not in front React Native's timers stand still: the core starts after one promise job as before
        const clock = { now: 0 }
        const behind: number[] = []
        const back = createBlockingWatch({ now: () => clock.now, onPiece: milliseconds => void behind.push(milliseconds), free: () => new Promise<void>(() => undefined), inFront: () => false })
        await back.afterCallersTurn()
        expect(behind).toEqual([])
    })

    it("ignores a mark outside a piece", () => {
        const { watch, pieces } = named()
        watch.mark("nowhere")
        expect(pieces).toEqual([])
    })
})
