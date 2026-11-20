import type { Models_HomeItem } from "@/api/generated/types"
import { MutationObserver, QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { HOME_ITEMS_QUERY_KEY, homeItemsSaveOptions } from "./home-items-sync"

const section = (id: string, type = "anime-library"): Models_HomeItem => ({ id, type, schemaVersion: 1 })
const before = [section("a"), section("b", "missed-sequels")]

/** A save the test answers by hand, standing in for the core's PATCH */
function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<null>((ok, fail) => {
        resolve = () => ok(null)
        reject = fail
    })
    return { promise, resolve, reject }
}

function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(HOME_ITEMS_QUERY_KEY, before)
    const failed = vi.fn()
    const saves: { items: Models_HomeItem[], answer: ReturnType<typeof deferred> }[] = []
    const save = (items: Models_HomeItem[]) => {
        const observer = new MutationObserver(qc, {
            ...homeItemsSaveOptions(qc, failed),
            mutationFn: async (variables: { items: Models_HomeItem[] }) => {
                const answer = deferred()
                saves.push({ items: variables.items, answer })
                return answer.promise
            },
        })
        return observer.mutate({ items }).catch(() => undefined)
    }
    const shown = () => qc.getQueryData<Models_HomeItem[]>(HOME_ITEMS_QUERY_KEY)
    return { qc, failed, saves, save, shown }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe("saving Home's sections", () => {
    it("shows the change at once, before the save is answered", async () => {
        const { save, saves, shown } = setup()
        const next = [section("b", "missed-sequels")]
        const done = save(next)
        await tick()
        expect(shown()).toEqual(next)
        saves[0].answer.resolve()
        await done
    })

    it("puts the previous list back and says so when the save fails", async () => {
        const { save, saves, shown, failed } = setup()
        const done = save([section("b", "missed-sequels")])
        await tick()
        saves[0].answer.reject(new Error("disk full"))
        await done
        expect(shown()).toEqual(before)
        expect(failed).toHaveBeenCalledTimes(1)
    })

    it("does not let an older load overwrite the change", async () => {
        const { qc, save, saves, shown } = setup()
        // a load of the list that started before the tap and answers after it with the old list
        let answerLoad!: (items: Models_HomeItem[]) => void
        const load = qc.fetchQuery({ queryKey: HOME_ITEMS_QUERY_KEY, queryFn: () => new Promise<Models_HomeItem[]>(ok => { answerLoad = ok }) }).catch(() => undefined)
        const next = [section("x", "my-lists")]
        const done = save(next)
        await tick()
        answerLoad(before)
        await load
        expect(shown()).toEqual(next)
        saves[0].answer.resolve()
        await done
    })

    it("saves quick taps one after the other and loads the list once, after the last", async () => {
        const { qc, save, saves, shown } = setup()
        const reload = vi.spyOn(qc, "invalidateQueries")
        const first = save([section("b", "missed-sequels"), section("a")])
        const second = save([section("a"), section("b", "missed-sequels")])
        await tick()
        // the second tap shows at once, but its save waits for the first
        expect(shown()!.map(item => item.id)).toEqual(["a", "b"])
        expect(saves.length).toBe(1)
        saves[0].answer.resolve()
        await first
        await tick()
        expect(reload).not.toHaveBeenCalled()
        expect(saves.length).toBe(2)
        expect(saves[1].items.map(item => item.id)).toEqual(["a", "b"])
        saves[1].answer.resolve()
        await second
        expect(reload).toHaveBeenCalledTimes(1)
        expect(reload).toHaveBeenCalledWith({ queryKey: HOME_ITEMS_QUERY_KEY })
    })
})
