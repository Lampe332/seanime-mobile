import type { Box } from "@/lib/motion"
import type { ImageContentPosition } from "expo-image"
import React from "react"

/*
 * The state of the cover flight (cover-flight.tsx) without React views: which cover flies where, the tapped card it came from
 * (for the way back) and which cover is hidden meanwhile. One flight at a time.
 *
 *   in   a card's cover → the page header's cover (entry-cover-transition.ts); the header is hidden until it lands
 *   out  Back on the page: the header's cover → the card it came from; the card's cover is hidden until it lands
 *
 * A card tapped on the page itself (relations, recommendations) opens the next anime out of that card; the card the page
 * came from waits in `earlier` until the way back through those anime reaches its page again, so the last Back still flies
 * into it.
 */

/**
 * How a card shows its picture, so the flying copy starts (or lands) looking the same: dimmed over its ground colour, or
 * cropped from the top. Unset: full opacity, centred, on the cover's ground (sm-surface-control).
 */
export type CoverLook = { opacity?: number, ground?: string, position?: ImageContentPosition }

export type CoverFlight = {
    direction: "in" | "out"
    id: number
    /** the picture that flies: the one already on screen where the flight starts */
    uri: string
    fromLook: CoverLook
    /** window dp */
    from: Box
    /** where it lands, once measured; null while it waits */
    to: Box | null
    /** the landing place's picture (the copy cross-fades into it when the two differ in shape) */
    toUri: string | null
    toLook: CoverLook
    startedAt: number
    /** when the page header was built (in) */
    builtAt: number | null
    /** no place to land in time: the cover fades out where it is */
    missed: boolean
}

/**
 * The card a flight came from: it is measured again for the way back. `measure` gives null once the card shows another
 * title (a recycled list cell), so the way back never lands in a wrong cover.
 */
export type CoverOrigin = { id: number, token: string, uri: string, look: CoverLook, measure: () => Promise<Box | null>, arrived: boolean }

/** The page header's cover, measured for the way back */
export type PageCover = { id: number, uri: string, measure: () => Promise<Box | null> }

export type CoverFlightState = {
    flight: CoverFlight | null
    origin: CoverOrigin | null
    /** the origins of the pages the way back still passes through, the newest last */
    earlier: CoverOrigin[]
    page: PageCover | null
}

let state: CoverFlightState = { flight: null, origin: null, earlier: [], page: null }
const listeners = new Set<() => void>()

function set(next: Partial<CoverFlightState>) {
    state = { ...state, ...next }
    listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export const coverFlightState = () => state

/** A selected part of the state (a card asks only whether it is the hidden one, so it re-renders only then) */
export function useCoverFlight<T>(select: (s: CoverFlightState) => T): T {
    return React.useSyncExternalStore(subscribe, () => select(state), () => select(state))
}

export const coverFlightRunning = () => !!state.flight

/** Is this card (`token`, now showing `id`) the one the way back flies into: hidden until it lands */
export function isHiddenSource(s: CoverFlightState, token: string, id: number) {
    return s.flight?.direction === "out" && !s.flight.missed && s.origin?.token === token && s.origin.id === id
}

export function startFlightIn(origin: Omit<CoverOrigin, "arrived">, from: Box) {
    // tapped on the page the current origin opened: that origin waits for the way back
    const earlier = state.origin?.arrived ? [...state.earlier, state.origin] : []
    set({
        flight: { direction: "in", id: origin.id, uri: origin.uri, fromLook: origin.look, from, to: null, toUri: null, toLook: {}, startedAt: Date.now(), builtAt: null, missed: false },
        origin: { ...origin, arrived: false },
        earlier,
        page: null,
    })
}

export function startFlightOut(page: PageCover, from: Box) {
    set({ flight: { direction: "out", id: page.id, uri: page.uri, fromLook: {}, from, to: null, toUri: null, toLook: {}, startedAt: Date.now(), builtAt: null, missed: false } })
}

/** The flight's landing place (in: the header cover, out: the card) and the picture shown there */
export function landFlight(direction: CoverFlight["direction"], id: number, to: Box, toUri: string, toLook: CoverLook = {}) {
    const flight = state.flight
    if (!flight || flight.direction !== direction || flight.id !== id || flight.to || flight.missed) return
    set({ flight: { ...flight, to, toUri, toLook } })
}

export function pageBuilt(id: number) {
    const flight = state.flight
    if (flight?.direction === "in" && flight.id === id && flight.builtAt === null) set({ flight: { ...flight, builtAt: Date.now() } })
}

export function missFlight() {
    if (state.flight && !state.flight.missed) set({ flight: { ...state.flight, missed: true } })
}

/**
 * The flight is over: the hidden cover shows again; after the way back the card is no longer an origin, the one of the
 * page Back returned to is again (a manga opened from an anime's relations, back on that anime)
 */
export function endFlight() {
    if (state.flight?.direction !== "out") return set({ flight: null })
    set({ flight: null, origin: state.earlier.at(-1) ?? null, earlier: state.earlier.slice(0, -1) })
}

export function arriveAtPage(id: number) {
    if (state.origin && state.origin.id === id && !state.origin.arrived) set({ origin: { ...state.origin, arrived: true } })
}

export function clearOrigin() {
    if (state.origin || state.earlier.length > 0) set({ origin: null, earlier: [] })
}

/**
 * The origin's page shows something else, not through the way back into the card. Still on an entry page (another anime
 * opened from the page, Back through them): the way back waits, and an earlier page of it brings back the card that
 * opened that page. Anywhere else (the bar, a link) the way back ends.
 */
export function leaveOriginPage(onEntryPath: boolean, shownId: number | null) {
    if (!onEntryPath) return clearOrigin()
    if (shownId === null) return
    for (let i = state.earlier.length - 1; i >= 0; i--) {
        if (state.earlier[i].id === shownId) return set({ origin: state.earlier[i], earlier: state.earlier.slice(0, i) })
    }
}

export function registerPageCover(page: PageCover | null) {
    set({ page })
}
