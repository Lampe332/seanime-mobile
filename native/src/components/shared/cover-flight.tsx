import {
    arriveAtPage, type CoverLook, coverFlightState, endFlight, isHiddenSource, landFlight, leaveOriginPage, missFlight, pageBuilt,
    registerPageCover, startFlightIn, startFlightOut, useCoverFlight,
} from "@/components/shared/cover-flight-store"
import {
    type Box, boxTransform, COVER_FLIGHT, coverGroundWaits, coverLayerOpacity, coverLayerScale, coverOnScreen, coverShapesDiffer, coverWaitOver, MAX_WAIT_MS, mixBox,
} from "@/lib/motion"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { Image } from "expo-image"
import { useFocusEffect, useGlobalSearchParams, usePathname } from "expo-router"
import React from "react"
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native"
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"

/*
 * Cover → page and back (entry-cover-transition.ts, plus the way back the web never had). Tapping a cover (a card on Home,
 * My lists, Search, Discover …) opens the anime or manga page out of it: a copy of the cover, laid out where the card's
 * cover is, flies on transform alone to the page header's cover while the page fades in. It waits for the header's picture
 * (coverWaitOver: WAIT_MS from the page being built, at most MAX_WAIT_MS), so it never lands in an empty frame; with none in
 * time it fades out where it is. Back on the page flies the header's cover back into the card, if the card is still on
 * screen where it was. Reduced motion: no flight, the pages just change.
 *
 * The flying box clips its picture, and the picture is counter-scaled to grow evenly (coverLayerScale): a wide start (a
 * Discover banner, an Upcoming episode still) narrows into the portrait cover instead of being squeezed, and cross-fades
 * into the cover's own picture on the way (coverShapesDiffer), as the web's view transition did with object-fit: cover.
 */
const ENTRY_PATHS = ["/entry", "/manga/entry"]

/*
 * Back steps a page takes itself before it is left (the anime page's way back through relations and recommendations).
 * The host's Back listener registers after the page's (it sits after the pages in the layout, so its effect runs later in
 * the same commit) and would answer first: router.back() left the page instead of going back to the previous anime.
 */
let pageBackSteps = 0

/** While `active`, Back belongs to the page's own steps; the way back into the card waits until they are done. */
export function useCoverFlightPageBackSteps(active: boolean) {
    React.useEffect(() => {
        if (!active) return
        pageBackSteps += 1
        return () => {
            pageBackSteps -= 1
        }
    }, [active])
}

type ViewRef = React.ComponentRef<typeof View>

function measureBox(view: ViewRef | null): Promise<Box | null> {
    return new Promise(resolve => {
        if (!view) return resolve(null)
        view.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null))
    })
}

/** The flying cover, over everything; mounted once in the main layout */
export function CoverFlightHost() {
    const flight = useCoverFlight(s => s.flight)
    const origin = useCoverFlight(s => s.origin)
    const isTablet = useIsTabletScreen()
    const window = useWindowDimensions()
    const pathname = usePathname()
    const params = useGlobalSearchParams<{ id?: string }>()
    const router = useRouter()
    const hostRef = React.useRef<ViewRef>(null)
    const [offset, setOffset] = React.useState({ x: 0, y: 0 })
    const progress = useSharedValue(0)
    const opacity = useSharedValue(1)
    const onEntry = ENTRY_PATHS.includes(pathname) && !!origin && params.id === String(origin.id)

    // The card's page reached; leaving it any other way than Back (the bar, a link) ends the way back, another anime opened
    // from the page (relations, recommendations) only puts it off until Back through them returns (leaveOriginPage)
    const onEntryPath = ENTRY_PATHS.includes(pathname)
    const shownId = params.id ? Number(params.id) : null
    React.useEffect(() => {
        if (!origin) return
        if (onEntry) arriveAtPage(origin.id)
        else if (origin.arrived && coverFlightState().flight?.direction !== "out") leaveOriginPage(onEntryPath, shownId)
    }, [onEntry, origin, onEntryPath, shownId])

    // Back on the card's page: the header's cover flies back into the card (sheets come first: they registered after this;
    // the page's own Back steps through useCoverFlightPageBackSteps)
    React.useEffect(() => {
        if (!onEntry) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            if (pageBackSteps > 0) return false
            const { page, origin: from, flight: running } = coverFlightState()
            if (running || !page || !from || page.id !== from.id) return false
            void page.measure().then(box => {
                if (box && coverOnScreen(box, window)) startFlightOut(page, box)
                router.back()
            })
            return true
        })
        return () => sub.remove()
    }, [onEntry, router, window])

    // Out: the card is measured as soon as it is there, often while its page is still hidden (pages stay attached and rest
    // where they stand, page-transition.tsx pageRiseFrom)
    React.useEffect(() => {
        if (flight?.direction !== "out" || flight.to || flight.missed) return
        const from = coverFlightState().origin
        if (!from) return missFlight()
        let alive = true
        const look = async () => {
            if (!alive) return
            // null once the card shows another title (its list cell was recycled): no landing in a wrong cover
            const box = await from.measure()
            if (!alive) return
            if (box && coverOnScreen(box, window)) return landFlight("out", flight.id, box, from.uri, from.look)
            if (Date.now() - flight.startedAt > MAX_WAIT_MS) return missFlight()
            setTimeout(look, 16)
        }
        const timer = setTimeout(look, 16)
        return () => {
            alive = false
            clearTimeout(timer)
        }
    }, [flight, window])

    // In: the wait for the header's picture
    React.useEffect(() => {
        if (flight?.direction !== "in" || flight.to || flight.missed) return
        const timer = setInterval(() => {
            const current = coverFlightState().flight
            if (current && !current.to && coverWaitOver(Date.now(), current.startedAt, current.builtAt, isTablet)) missFlight()
        }, 16)
        return () => clearInterval(timer)
    }, [flight, isTablet])

    // The move itself, on the UI thread
    React.useEffect(() => {
        if (!flight) return
        if (flight.missed) {
            opacity.set(withTiming(0, { duration: COVER_FLIGHT.miss, easing: Easing.out(Easing.ease) }, finished => {
                if (finished) scheduleOnRN(endFlight)
            }))
            return
        }
        if (!flight.to) {
            progress.set(0)
            opacity.set(1)
            return
        }
        const { duration, ease } = isTablet ? COVER_FLIGHT.tablet : COVER_FLIGHT.phone
        progress.set(withTiming(1, { duration, easing: Easing.bezier(...ease) }, finished => {
            if (finished) scheduleOnRN(endFlight)
        }))
    }, [flight, isTablet, progress, opacity])

    const from = flight ? { ...flight.from, x: flight.from.x - offset.x, y: flight.from.y - offset.y } : null
    const to = flight?.to ? { ...flight.to, x: flight.to.x - offset.x, y: flight.to.y - offset.y } : null
    // a picture of another shape than its landing place cross-fades into the landing place's picture
    const crossfade = !!from && !!to && !!flight?.toUri && flight.toUri !== flight.uri && coverShapesDiffer(from, to)
    const fromOpacity = flight?.fromLook.opacity ?? 1
    const toOpacity = flight?.toLook.opacity ?? 1
    // Back: the copy lies on the header's cover, which is still there; its ground waits for its picture (a fresh view,
    // it shows its picture a frame later even from the cache) or for the move, so the first frame is not an empty box
    const [shownFlight, setShownFlight] = React.useState<number | null>(null)
    const groundWaits = coverGroundWaits(flight?.direction, shownFlight === flight?.startedAt, !!flight?.to)
    const fromGround = flight?.fromLook.ground ?? colors.smSurfaceControl
    const toGround = flight?.toLook.ground ?? colors.smSurfaceControl
    const style = useAnimatedStyle(() => {
        if (!from) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] }
        const t = boxTransform(from, to ? mixBox(from, to, progress.get()) : from)
        return { opacity: opacity.get(), transform: [{ translateX: t.translateX }, { translateY: t.translateY }, { scaleX: t.scaleX }, { scaleY: t.scaleY }] }
    })
    const baseStyle = useAnimatedStyle(() => {
        if (!from) return { opacity: 0, transform: [{ scaleX: 1 }, { scaleY: 1 }] }
        const p = to ? progress.get() : 0
        const s = coverLayerScale(from, to ? mixBox(from, to, p) : from, from)
        return { opacity: coverLayerOpacity(p, fromOpacity, toOpacity, crossfade).base, transform: [{ scaleX: s.scaleX }, { scaleY: s.scaleY }] }
    })
    const topStyle = useAnimatedStyle(() => {
        if (!from || !to) return { opacity: 0, transform: [{ scaleX: 1 }, { scaleY: 1 }] }
        const p = progress.get()
        const s = coverLayerScale(from, mixBox(from, to, p), to)
        return { opacity: coverLayerOpacity(p, fromOpacity, toOpacity, crossfade).top, transform: [{ scaleX: s.scaleX }, { scaleY: s.scaleY }] }
    })
    const groundStyle = useAnimatedStyle(() => ({ opacity: to ? progress.get() : 0 }))

    return (
        <View ref={hostRef} pointerEvents="none" style={StyleSheet.absoluteFill}
            onLayout={() => hostRef.current?.measureInWindow((x, y) => setOffset(prev => prev.x === x && prev.y === y ? prev : { x, y }))}>
            {!!flight && !!from && (
                // the card's own ground under the picture (for the frame or two it takes to decode it again, and under a dimmed one);
                // the landing place's ground fades in over it when the two differ
                <Animated.View style={[{ position: "absolute", left: from.x, top: from.y, width: from.width, height: from.height, borderRadius: 12, overflow: "hidden", backgroundColor: groundWaits ? "transparent" : fromGround }, style]}>
                    {toGround !== fromGround && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: toGround }, groundStyle]} />}
                    <Animated.View style={[StyleSheet.absoluteFill, baseStyle]}>
                        <Image source={flight.uri} contentFit="cover" contentPosition={flight.fromLook.position} style={StyleSheet.absoluteFill} accessible={false}
                            onDisplay={() => setShownFlight(flight.startedAt)} />
                    </Animated.View>
                    {crossfade && !!to && (
                        // laid out at the landing place's size, centred, so it lands as that picture exactly
                        <Animated.View style={[{ position: "absolute", left: (from.width - to.width) / 2, top: (from.height - to.height) / 2, width: to.width, height: to.height }, topStyle]}>
                            <Image source={flight.toUri} contentFit="cover" contentPosition={flight.toLook.position} style={StyleSheet.absoluteFill} accessible={false} />
                        </Animated.View>
                    )}
                </Animated.View>
            )}
        </View>
    )
}

/**
 * A card's picture as the start of a flight: `ref` on the view around the picture, `onLoad` on the picture, `hidden`
 * while the way back flies into it, `open` instead of router.push. `pageUri` is the header's picture (fetched at the tap);
 * `look` how the card shows its picture (dimmed, cropped from the top), so the copy starts and lands looking the same.
 * An empty `uri` (a blurred adult cover: the copy would show it sharp) never flies.
 *
 * List cells are recycled: the card remembers which title it shows, and the way back measures it only while it still
 * shows the tapped one; else no landing (the copy fades where it is), never a flight into a wrong cover.
 */
export function useCoverFlightSource(id: number, uri: string, pageUri?: string, look?: CoverLook) {
    const token = React.useId()
    const router = useRouter()
    const reduceMotion = useReducedMotion()
    const window = useWindowDimensions()
    const ref = React.useRef<ViewRef>(null)
    const loaded = React.useRef<string | null>(null)
    const shownId = React.useRef(id)
    const hidden = useCoverFlight(s => isHiddenSource(s, token, id))
    const lookOpacity = look?.opacity
    const lookGround = look?.ground
    const lookPosition = look?.position

    React.useEffect(() => {
        shownId.current = id
    }, [id])

    const onLoad = React.useCallback(() => {
        loaded.current = uri
    }, [uri])

    const open = React.useCallback((href: string) => {
        if (reduceMotion || !uri || loaded.current !== uri || coverFlightState().flight) return router.push(href)
        void measureBox(ref.current).then(box => {
            if (box && coverOnScreen(box, window)) {
                if (pageUri && pageUri !== uri) void Image.prefetch(pageUri)
                const measure = () => shownId.current === id ? measureBox(ref.current) : Promise.resolve(null)
                startFlightIn({ id, token, uri, look: { opacity: lookOpacity, ground: lookGround, position: lookPosition }, measure }, box)
            }
            router.push(href)
        })
    }, [reduceMotion, uri, pageUri, window, id, token, router, lookOpacity, lookGround, lookPosition])

    return { coverRef: ref, onLoad, hidden, open }
}

/**
 * The page header's cover as the flight's landing place: `ref` on the view around it, `onLoad` on its picture, `hidden`
 * until the flight lands there. While the page is shown it is also where Back flies from.
 */
export function useCoverFlightTarget(id: number | null, uri: string | undefined) {
    const ref = React.useRef<ViewRef>(null)
    const loaded = React.useRef<string | null>(null)
    const hidden = useCoverFlight(s => s.flight?.direction === "in" && s.flight.id === id && !s.flight.missed)

    // The flight lands where the cover stands now, once its picture is there
    const land = React.useCallback(() => {
        const flight = coverFlightState().flight
        if (id === null || !uri || loaded.current !== uri || flight?.direction !== "in" || flight.id !== id || flight.to) return
        // a frame for the page's layout to settle (the cover's picture can come before its row is laid out)
        requestAnimationFrame(() => void measureBox(ref.current).then(box => {
            if (box) landFlight("in", id, box, uri)
        }))
    }, [id, uri])

    React.useEffect(() => {
        if (id !== null) pageBuilt(id)
    }, [id])

    useFocusEffect(React.useCallback(() => {
        if (id === null || !uri) return
        const page = { id, uri, measure: () => measureBox(ref.current) }
        registerPageCover(page)
        // the same anime again: its page and picture are still there, no new load comes
        pageBuilt(id)
        land()
        return () => {
            if (coverFlightState().page === page) registerPageCover(null)
        }
    }, [id, uri, land]))

    const onLoad = React.useCallback(() => {
        loaded.current = uri ?? null
        land()
    }, [uri, land])

    return { coverRef: ref, onLoad, hidden }
}
