import { describe, expect, it } from "vitest"
import { moveInBar, NAV_STORAGE_KEYS, type NavItem } from "@/lib/nav/nav-items"
import { readNavItems, resetNavigation, saveNavItems, subscribeNavItems } from "@/lib/nav/nav-store"
import { storage } from "@/lib/storage"

describe("nav store", () => {
    it("hands out a new list after every save and reset (the editor's arrows on the S22 saved without showing it)", () => {
        let calls = 0
        const stop = subscribeNavItems(() => calls++)
        const before = readNavItems()
        expect(readNavItems()).toBe(before) // same snapshot while nothing changed
        const ids = before.map(it => it.id)

        saveNavItems(moveInBar(before, before[0].id, 1))
        expect(calls).toBe(1)
        const moved = readNavItems()
        expect(moved).not.toBe(before)
        expect(moved.map(it => it.id).slice(0, 2)).toEqual([ids[1], ids[0]])

        resetNavigation()
        expect(calls).toBe(2)
        expect(readNavItems().map(it => it.id)).toEqual(ids)

        stop()
        saveNavItems(before)
        expect(calls).toBe(2)
        resetNavigation()
    })

    // 4.2.0: a new default bar; a bar the user saved before stays as it is until "Reset navigation"
    it("keeps a saved bar of the old default and gives the new default after a reset", () => {
        const oldDefault: NavItem[] = [
            { id: "home", href: "/", label: "Home", matchExact: true, placement: "nav" },
            { id: "lists", href: "/lists", label: "My Lists", matchExact: false, placement: "nav" },
            { id: "discover", href: "/discover", label: "Discover", matchExact: false, placement: "nav" },
            { id: "search", href: "/search", label: "Search", matchExact: false, placement: "nav" },
            { id: "menu", href: null, label: "Menu", matchExact: false, placement: "nav", isMenu: true },
            { id: "android-downloads", href: "/android-downloads", label: "Downloads", matchExact: true, placement: "nav" },
        ]
        saveNavItems(oldDefault)
        const stored = storage.getString(NAV_STORAGE_KEYS.items)
        expect(readNavItems()).toEqual(oldDefault.map(it => ({ ...it, isMenu: !!it.isMenu })))
        // reading never writes: the stored list is byte for byte the one saved
        expect(storage.getString(NAV_STORAGE_KEYS.items)).toBe(stored)

        resetNavigation()
        expect(readNavItems().filter(it => it.placement === "nav").map(it => it.id)).toEqual(["home", "lists", "discover", "android-downloads", "menu"])
        expect(readNavItems().find(it => it.id === "search")?.placement).toBe("float")
    })
})
