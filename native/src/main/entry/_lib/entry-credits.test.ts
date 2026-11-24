import { describe, expect, it } from "vitest"
import { creditRole, pickCredits, pickTags, type StaffEdgeInput } from "./entry-credits"

const edge = (role: string, id: number, name = `Person ${id}`): StaffEdgeInput => ({ role, node: { id, name: { full: name } } })

describe("creditRole", () => {
    it("reads the role without its note and leaves assistants and other roles out", () => {
        expect(creditRole("Director (eps 1-12)", "anime")).toBe("director")
        expect(creditRole("Chief Director", "anime")).toBe("director")
        expect(creditRole("Original Creator", "anime")).toBe("original")
        expect(creditRole("Assistant Director", "anime")).toBeNull()
        expect(creditRole("Episode Director (ep 3)", "anime")).toBeNull()
        expect(creditRole("Art (assistant)", "manga")).toBeNull()
        expect(creditRole("Story & Art", "manga")).toBe("storyArt")
        expect(creditRole("Music", "manga")).toBeNull()
        expect(creditRole(null, "anime")).toBeNull()
    })
})

describe("pickCredits", () => {
    it("keeps the page's order, folds repeated roles of one person and caps the people of a role", () => {
        const rows = pickCredits([
            edge("Music", 9),
            edge("Director (eps 1-6)", 1),
            edge("Director (eps 7-12)", 1),
            edge("Original Creator", 2),
            edge("Series Composition", 3),
            edge("Character Design", 4),
            edge("Character Design", 5),
            edge("Character Design", 6),
            edge("Character Design", 7),
            edge("Storyboard (ep 1)", 8),
        ], "anime")
        expect(rows.map(row => row.roles)).toEqual([["original"], ["director"], ["composition"], ["characters"], ["music"]])
        expect(rows[1].people).toEqual([{ id: 1, name: "Person 1" }])
        expect(rows[3].people.map(person => person.id)).toEqual([4, 5, 6])
    })

    it("puts people who share every role on one line and shows at most five lines", () => {
        expect(pickCredits([edge("Story", 1), edge("Art", 1)], "manga")).toEqual([{ roles: ["story", "art"], people: [{ id: 1, name: "Person 1" }] }])
        expect(pickCredits([edge("Story", 1), edge("Art", 2)], "manga").map(row => row.roles)).toEqual([["story"], ["art"]])
        expect(pickCredits([edge("Original Creator", 1), edge("Director", 2), edge("Series Composition", 3), edge("Character Design", 4), edge("Music", 5)], "anime", 3)).toHaveLength(3)
    })

    it("is empty without staff, names or ids (TVmaze and custom-source titles)", () => {
        expect(pickCredits(undefined, "anime")).toEqual([])
        expect(pickCredits([null, { role: "Director", node: { id: 1, name: { full: " " } } }, { role: "Director", node: null }], "anime")).toEqual([])
    })
})

describe("pickTags", () => {
    it("takes the best-ranked tags and keeps spoilers apart", () => {
        const tags = Array.from({ length: 10 }, (_, i) => ({ name: `Tag ${i}`, rank: 10 * i, isMediaSpoiler: false, isGeneralSpoiler: false }))
        const picked = pickTags([...tags, { name: "Time Skip", rank: 95, isMediaSpoiler: true }, { name: "Death", rank: 60, isGeneralSpoiler: true }, { name: "Tag 9", rank: 1 }])
        expect(picked.tags.map(tag => tag.name)).toEqual(["Tag 9", "Tag 8", "Tag 7", "Tag 6", "Tag 5", "Tag 4", "Tag 3", "Tag 2"])
        expect(picked.spoilers.map(tag => tag.name)).toEqual(["Time Skip", "Death"])
    })

    it("is empty without tags", () => {
        expect(pickTags(null)).toEqual({ tags: [], spoilers: [] })
        expect(pickTags([null, { name: "" }])).toEqual({ tags: [], spoilers: [] })
    })
})
