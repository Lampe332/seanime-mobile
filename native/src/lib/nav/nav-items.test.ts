import { describe, expect, it } from "vitest"
import { APP_LANGUAGES } from "@/lib/app-language"
import {
    isActive,
    MAX_NAV_ITEMS,
    menuTargets,
    moveInBar,
    moveToBar,
    moveToMenu,
    navCount,
    navItemLabel,
    navItemTabLabel,
    navLabel,
    navTabLabel,
    type NavItem,
    resolveNavItems,
    storedNavState,
} from "./nav-items"

const bar = (items: NavItem[]) => items.filter(it => it.placement === "nav").map(it => it.id)
const edited = (result: ReturnType<typeof moveToBar>) => {
    if (!("items" in result)) throw new Error(`refused: ${result.refused}`)
    return result.items
}

describe("customize navigation", () => {
    const defaults = resolveNavItems({})

    it("gives a bar entry back to the Menu, which then lists it first", () => {
        const items = edited(moveToMenu(defaults, "discover"))
        expect(bar(items)).toEqual(["home", "lists", "android-downloads", "menu"])
        expect(menuTargets(items)[0]).toMatchObject({ id: "discover", href: "/discover" })
    })

    it("lists the old app's screens in the Menu, not the development pages (release build)", () => {
        const hrefs = menuTargets(defaults).map(target => target.href)
        expect(hrefs).toEqual(expect.arrayContaining(["/schedule", "/manga", "/extensions", "/settings"]))
        expect(hrefs).not.toContain("/server-status")
        expect(hrefs).not.toContain("/building-blocks")
    })

    it("lists the floating Search first in More (4.2.0 default bar)", () => {
        expect(menuTargets(defaults)[0]).toMatchObject({ id: "search", href: "/search", icon: "search" })
    })

    it("never moves the Menu button out of the bar", () => {
        expect(moveToMenu(defaults, "menu")).toEqual({ refused: "fixed" })
    })

    it("brings a Menu entry into the bar in front of More (the last entry), and the Menu stops listing it", () => {
        const items = edited(moveToBar(defaults, { label: "Schedule", href: "/schedule" }))
        expect(bar(items)).toEqual(["home", "lists", "discover", "android-downloads", "__float_Schedule", "menu"])
        expect(menuTargets(items).some(target => target.href === "/schedule")).toBe(false)
    })

    it("brings the floating Search back into the bar once, in front of More", () => {
        const items = edited(moveToBar(defaults, { label: "Search", href: "/search" }))
        expect(bar(items)).toEqual(["home", "lists", "discover", "android-downloads", "search", "menu"])
        expect(items.filter(it => it.href === "/search")).toHaveLength(1)
        expect(menuTargets(items).some(target => target.href === "/search")).toBe(false)
    })

    it("puts a default entry back in its place instead of adding it twice", () => {
        const back = edited(moveToBar(edited(moveToMenu(defaults, "discover")), { label: "Discover", href: "/discover" }))
        expect(back.filter(it => it.href === "/discover")).toHaveLength(1)
        expect(back.find(it => it.href === "/discover")?.id).toBe("discover")
    })

    it("refuses an eighth entry", () => {
        let items = edited(moveToBar(defaults, { label: "Schedule", href: "/schedule" }))
        items = edited(moveToBar(items, { label: "Search", href: "/search" }))
        expect(navCount(items)).toBe(MAX_NAV_ITEMS)
        expect(moveToBar(items, { label: "Settings", href: "/settings" })).toEqual({ refused: "full" })
        items = edited(moveToMenu(items, "search"))
        expect(navCount(edited(moveToBar(items, { label: "Settings", href: "/settings" })))).toBe(MAX_NAV_ITEMS)
    })

    it("moves an entry one place along the bar, past the Menu button too, and stops at the ends", () => {
        expect(bar(moveInBar(defaults, "lists", -1)).slice(0, 2)).toEqual(["lists", "home"])
        expect(bar(moveInBar(defaults, "android-downloads", 1))).toEqual(["home", "lists", "discover", "menu", "android-downloads"])
        expect(moveInBar(defaults, "home", -1)).toBe(defaults)
        expect(moveInBar(defaults, "menu", 1)).toBe(defaults)
        // a floating entry has no place in the bar to move
        expect(moveInBar(defaults, "search", 1)).toBe(defaults)
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
    it("has the 4.2.0 default bar: Home, My Lists, Discover, Downloads, More; Search floats in More", () => {
        const items = resolveNavItems({})
        expect(items.map(i => i.label)).toEqual(["Home", "My Lists", "Discover", "Search", "Downloads", "Menu"])
        const shown = items.filter(it => it.placement === "nav")
        expect(shown.map(it => navItemTabLabel(it, "en"))).toEqual(["Home", "My Lists", "Discover", "Downloads", "More"])
        expect(shown.map(it => navItemTabLabel(it, "de"))).toEqual(["Start", "Meine Listen", "Entdecken", "Downloads", "Mehr"])
        expect(items.find(it => it.id === "search")?.placement).toBe("float")
        // Material 3 navigation bar: 3 to 5 destinations
        expect(navCount(items)).toBe(5)
    })

    it("shows the More button as More, also when a saved bar still holds the old key Menu", () => {
        const saved = resolveNavItems({ items: [{ id: "menu", label: "Menu", isMenu: true, placement: "nav" }] })
        const more = saved.find(it => it.isMenu)!
        expect(more.label).toBe("Menu")
        expect(navItemTabLabel(more, "en")).toBe("More")
        expect(navItemLabel(more, "de")).toBe("Mehr")
        expect(navItemTabLabel(more, "ru")).toBe("Ещё")
        expect(navItemTabLabel(more, "ja")).toBe("その他")
        // the other entries keep their own word
        expect(navItemTabLabel({ label: "Downloads" }, "fr")).toBe("Téléch.")
    })

    it("leaves a saved bar of the old default as it is (no migration)", () => {
        const oldDefault = [
            { id: "home", href: "/", label: "Home", matchExact: true, placement: "nav" },
            { id: "lists", href: "/lists", label: "My Lists", matchExact: false, placement: "nav" },
            { id: "discover", href: "/discover", label: "Discover", matchExact: false, placement: "nav" },
            { id: "search", href: "/search", label: "Search", matchExact: false, placement: "nav" },
            { id: "menu", href: null, label: "Menu", matchExact: false, placement: "nav", isMenu: true },
            { id: "android-downloads", href: "/android-downloads", label: "Downloads", matchExact: true, placement: "nav" },
        ]
        const items = resolveNavItems(JSON.parse(JSON.stringify(storedNavState(oldDefault as NavItem[]))) as Record<string, unknown>)
        expect(items.map(it => [it.id, it.placement])).toEqual(oldDefault.map(it => [it.id, it.placement]))
        // a bar stored the old way (order and placement only, UIBottomNav.kt) keeps Search where it was
        const legacy = resolveNavItems({ order: ["home", "lists", "discover", "search", "menu"], placement: { search: "nav" } })
        expect(legacy.filter(it => it.placement === "nav").map(it => it.id)).toContain("search")
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

    it("gives the bar a short label where the menu word does not fit", () => {
        expect(navTabLabel("Downloads", "fr")).toBe("Téléch.")
        expect(navLabel("Downloads", "fr")).toBe("Téléchargements")
        expect(navTabLabel("My Lists", "de")).toBe("Meine Listen")
        expect(navTabLabel("Downloads", "en")).toBe("Downloads")
        expect(navTabLabel("Unknown entry", "fr")).toBe("Unknown entry")
        // "Meine Listen" (12) is the longest label the bar was made for, "Téléchargements" (15) shrank visibly; CJK 6 signs
        const tooLong = APP_LANGUAGES.flatMap(({ value }) => menuTargets([]).map(target => navTabLabel(target.label, value))
            .concat(["Home", "My Lists", "Discover", "Search", "Menu", "More", "Downloads"].map(label => navTabLabel(label, value)))
            .filter(label => [...label].length > (/[　-鿿]/.test(label) ? 6 : 13)).map(label => `${value}: ${label}`))
        expect(tooLong).toEqual([])
        // "[tab] More" has its own short word in every language (not the English fallback)
        const moreTab = APP_LANGUAGES.map(({ value }) => [value, navItemTabLabel({ label: "Menu", isMenu: true }, value)])
        expect(Object.fromEntries(moreTab)).toEqual({ "en": "More", "de": "Mehr", "es": "Más", "ru": "Ещё", "zh-Hans": "更多", "pt-BR": "Mais", "fr": "Plus", "ja": "その他" })
    })
})
