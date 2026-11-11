import { describe, expect, it } from "vitest"
import { DEFAULT_COLLECTION_PARAMS, filterCollectionEntries } from "./filtering"

const entry = (id: number, title: string, startDate?: { year?: number, month?: number }) =>
    ({ mediaId: id, media: { id, title: { userPreferred: title }, startDate }, listData: {} }) as any

describe("filterCollectionEntries", () => {
    const entries = [entry(1, "Beta", { year: 2020, month: 4 }), entry(2, "Alpha", { year: 2024, month: 1 }), entry(3, "Gamma", { year: 2018 })]
    const titles = (sorting: string) =>
        filterCollectionEntries("anime", entries, { ...DEFAULT_COLLECTION_PARAMS, sorting: sorting as any }, true).map(n => n.media.title.userPreferred)

    it("sorts by title both ways", () => {
        expect(titles("TITLE")).toEqual(["Alpha", "Beta", "Gamma"])
        expect(titles("TITLE_DESC")).toEqual(["Gamma", "Beta", "Alpha"])
    })

    it("sorts by release date and leaves out entries without a start month", () => {
        expect(titles("RELEASE_DATE")).toEqual(["Beta", "Alpha"])
        expect(titles("RELEASE_DATE_DESC")).toEqual(["Alpha", "Beta"])
    })
})
