import { describe, expect, it } from "vitest"
import { inTurns } from "./check-turns"

// 4.2.0 E (S22): five `client-check&do=remove` links in a row, only the first torrent went away
describe("test links that change something run one after another", () => {
    it("runs every link, each after the one before, and says how many wait ahead", async () => {
        const turns = inTurns()
        const done: string[] = []
        const ahead: number[] = []
        let release: () => void = () => {}
        const first = turns(() => new Promise<void>(resolve => {
            release = () => {
                done.push("a")
                resolve()
            }
        }), count => ahead.push(count))
        const second = turns(async () => {
            done.push("b")
        }, count => ahead.push(count))
        const third = turns(async () => {
            done.push("c")
        }, count => ahead.push(count))
        // the second and third wait while the first runs
        await Promise.resolve()
        expect(done).toEqual([])
        expect(ahead).toEqual([0, 1, 2])
        release()
        await Promise.all([first, second, third])
        expect(done).toEqual(["a", "b", "c"])
    })

    it("goes on after a run that fails", async () => {
        const turns = inTurns()
        const failed = turns(async () => {
            throw new Error("no such torrent")
        }, () => {})
        const next = turns(async () => "ran", () => {})
        await expect(failed).rejects.toThrow("no such torrent")
        await expect(next).resolves.toBe("ran")
    })
})
