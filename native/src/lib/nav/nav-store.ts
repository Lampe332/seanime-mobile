import { NAV_STORAGE_KEYS, type NavItem, resolveNavItems, storedNavState } from "@/lib/nav/nav-items"
import { readStoredJSON, storage } from "@/lib/storage"
import React from "react"

/*
 * The bar's entries as stored, live: the bar, the rail, the Menu and the navigation editor (Settings › App) all read
 * them here, so a change in the editor shows in the bar at once. Same keys as UIBottomNav.kt (NAV_STORAGE_KEYS).
 *
 * The store keeps the resolved list itself and hands it to useSyncExternalStore. It used to hand out a version number
 * and re-read in `useMemo(() => { void version; … }, [version])`; on the S22 the editor's arrows saved the new order, but
 * neither the editor nor the bar showed it until the app restarted (the React Compiler memoizes that read).
 */
const KEYS: string[] = Object.values(NAV_STORAGE_KEYS)
const readers = new Set<() => void>()
let cached: NavItem[] | null = null

function changed() {
    cached = null
    for (const onChange of readers) onChange()
}

/** Calls `onChange` after every save or reset of the bar (useAllNavItems re-reads then) */
export function subscribeNavItems(onChange: () => void) {
    readers.add(onChange)
    return () => {
        readers.delete(onChange)
    }
}

/** Every entry with its placement, resolved once per change (the same array until the next save or reset) */
export function readNavItems(): NavItem[] {
    cached ??= resolveNavItems({
        items: readStoredJSON<unknown>(NAV_STORAGE_KEYS.items, null),
        placement: readStoredJSON<unknown>(NAV_STORAGE_KEYS.placement, null),
        order: readStoredJSON<unknown>(NAV_STORAGE_KEYS.order, null),
    })
    return cached
}

/** Every entry with its placement ("nav" = in the bar, "float" = in the Menu), in the stored order */
export function useAllNavItems(): NavItem[] {
    return React.useSyncExternalStore(subscribeNavItems, readNavItems, readNavItems)
}

/** saveNavState: the full list, its order and the placements */
export function saveNavItems(items: NavItem[]) {
    const state = storedNavState(items)
    storage.set(NAV_STORAGE_KEYS.items, JSON.stringify(state.items))
    storage.set(NAV_STORAGE_KEYS.order, JSON.stringify(state.order))
    storage.set(NAV_STORAGE_KEYS.placement, JSON.stringify(state.placement))
    changed()
}

/** resetToDefaults: the default bar, the Menu's hidden entries and order cleared */
export function resetNavigation() {
    for (const key of KEYS) storage.remove(key)
    changed()
}
