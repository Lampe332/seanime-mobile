import { describe, expect, it } from "vitest"
import { isActive, MAX_NAV_ITEMS, menuTargets, moveInBar, moveToBar, moveToMenu, navCount, navLabel, type NavItem, resolveNavItems, storedNavState } from "./nav-items"

const bar = (items: NavItem[]) => items.filter(it => it.placement === "nav").map(it => it.id)
const edited = (result: ReturnType<typeof moveToBar>) => {
    if (!("items" in result)) throw new Error(`refused: ${result.refused}`)
    return result.items
}

describe("customize navigation", () => {
    const defaults = resolveNavItems({})

    it("gives a bar entry back to the Menu, which then lists it first", () => {
        const items = edited(moveToMenu(defaults, "discover"))
        expect(bar(items)).toEqual(["home", "lists", "search", "menu", "android-downloads"])
        expect(menuTargets(items)[0]).toMatchObject({ id: "discover", href: "/discover" })
    })

    it("lists the old app's screens in the Menu, not the development pages (release build)", () => {
        const hrefs = menuTargets(defaults).map(target => target.href)
        expect(hrefs).toEqual(expect.arrayContaining(["/schedule", "/manga", "/extensions", "/settings"]))
        expect(hrefs).not.toContain("/server-status")
        expect(hrefs).not.toContain("/building-blocks")
    })

    it("never moves the Menu button out of the bar", () => {
        expect(moveToMenu(defaults, "menu")).toEqual({ refused: "fixed" })
    })

    it("brings a Menu entry into the bar after the last entry, and the Menu stops listing it", () => {
        const items = edited(moveToBar(defaults, { label: "Schedule", href: "/schedule" }))
        expect(bar(items)).toEqual(["home", "lists", "discover", "search", "menu", "android-downloads", "__float_Schedule"])
        expect(menuTargets(items).some(target => target.href === "/schedule")).toBe(false)
    })

    it("puts a default entry back in its place instead of adding it twice", () => {
        const back = edited(moveToBar(edited(moveToMenu(defaults, "discover")), { label: "Discover", href: "/discover" }))
        expect(back.filter(it => it.href === "/discover")).toHaveLength(1)
        expect(back.find(it => it.href === "/discover")?.id).toBe("discover")
    })

    it("refuses an eighth entry", () => {
        let items = edited(moveToBar(defaults, { label: "Schedule", href: "/schedule" }))
        expect(navCount(items)).toBe(MAX_NAV_ITEMS)
        expect(moveToBar(items, { label: "Settings", href: "/settings" })).toEqual({ refused: "full" })
        items = edited(moveToMenu(items, "search"))
        expect(navCount(edited(moveToBar(items, { label: "Settings", href: "/settings" })))).toBe(MAX_NAV_ITEMS)
    })

    it("moves an entry one place along the bar, past the Menu button too, and stops at the ends", () => {
        expect(bar(moveInBar(defaults, "lists", -1)).slice(0, 2)).toEqual(["lists", "home"])
        expect(bar(moveInBar(defaults, "search", 1))).toEqual(["home", "lists", "discover", "menu", "search", "android-downloads"])
        expect(moveInBar(defaults, "home", -1)).toBe(defaults)
        expect(moveInBar(defaults, "android-downloads", 1)).toBe(defaults)
    })

    it("stores the list, the order and the placements that resolveNavItems reads back", () => {
        const items = edited(moveToMenu(defaults, "discover"))
        const state = storedNavState(items)
        expect(state.placement.discover).toBe("float")
        const back = resolveNavItems(JSON.parse(JSON.stringify(state)) as Record<string, unknown>)
        expect(back.map(it => [it.id, it.placement])).toEqual(items.map(it => [it.id, it.placement]))
    })
})

// Rules of UIBottomNav.kt (loadNavItems, prepareNavItems, dedupe, navLabel) for the native bar.
describe("bottom bar entries", () => {
    it("has the app's default bar: Home, My Lists, Discover, Search, Menu, Downloads", () => {
        expect(resolveNavItems({}).map(i => i.label)).toEqual(["Home", "My Lists", "Discover", "Search", "Menu", "Downloads"])
    })

    it("keeps a saved full bar, adds Downloads and drops the removed Offline and torrent pages", () => {
        const items = resolveNavItems({
            items: [
                { id: "search", href: "/search", label: "Search", placement: "nav" },
                { id: "offline", href: "/sync", label: "Offline", placement: "nav" },
                { id: "tl", href: "/torrent-list", label: "Torrents", placement: "nav" },
                { id: "menu", label: "Menu", isMenu: true, placement: "nav" },
            ],
        })
        expect(items.map(i => i.id)).toEqual(["search", "menu", "android-downloads"])
    })

    it("applies the saved order and placement to the defaults", () => {
        const items = resolveNavItems({ order: ["search", "home"], placement: { discover: "float" } })
        expect(items.slice(0, 2).map(i => i.id)).toEqual(["search", "home"])
        expect(items.find(i => i.id === "discover")?.placement).toBe("float")
    })

    it("merges duplicate entries, the bar placement wins", () => {
        const items = resolveNavItems({
            items: [
                { id: "a", href: "/lists", label: "My lists", placement: "float" },
                { id: "b", href: "/lists", label: "My Lists", placement: "nav" },
            ],
        })
        expect(items.filter(i => i.href === "/lists")).toEqual([expect.objectContaining({ id: "b", placement: "nav" })])
    })

    it("marks the entry of the current page", () => {
        const [home, lists] = resolveNavItems({})
        expect(isActive(home, "/")).toBe(true)
        expect(isActive(home, "/lists")).toBe(false)
        expect(isActive(lists, "/lists/stats")).toBe(true)
    })

    it("translates only the shown text; the label stays the English key", () => {
        expect(navLabel("My Lists", "de")).toBe("Meine Listen")
        expect(navLabel("My Lists", "en")).toBe("My Lists")
        expect(navLabel("Unknown entry", "de")).toBe("Unknown entry")
    })
})
