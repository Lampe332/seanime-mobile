import { atom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { View, type ViewStyle } from "react-native"
import Animated, {
    cancelAnimation,
    makeMutable,
    scrollTo,
    useAnimatedReaction,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useSharedValue,
    withDecay,
} from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"
import { type BoxGeometry, scrollTarget } from "./player-chrome"

/*
 * r22 (Nick 11.11.): the player's box on the anime page (2.0.x: the online stream page's inline VideoCore). There is still
 * one player over all pages (NativePlayer): a remount of its mpv view would load the stream again (pause, black picture),
 * so the box is a 16:9 place in the page (PlayerBoxSlot) that the player lies over. The page tells where that place is
 * (player_boxSlotAtom: the scroll area in the window, the box in the scroll content) and its scroll offset on the UI
 * thread (boxScroll); the player follows it there per frame (player-chrome boxFrame) and is clipped to the scroll area.
 * As the box lies over the page, the page cannot see a finger on it: a vertical drag on the box scrolls the page through
 * the host (BoxScroller, with a fling).
 */

/** The anime page's scroll offset, written on the UI thread by its scroll handler (one anime page in the app). */
export const boxScroll = makeMutable(0)

/** Scrolling the page from a drag on the box: begin, move by the dragged distance (dp, down = positive), end with the speed (dp/s, down = positive). */
export type BoxScroller = { begin: () => void, move: (dragged: number) => void, end: (velocity: number) => void }

export type BoxSlot = { owner: string, geometry: BoxGeometry, scroller: BoxScroller }

/** The box the page shows right now (only while the page is the one on screen), null when none. */
export const player_boxSlotAtom = atom<BoxSlot | null>(null)

/** What the player plays: its box owner (player-chrome boxOwner); the anime page shows a box for "media:<id>" (library, torrent, debrid, saved episode). */
export const player_nowAtom = atom<{ owner: string | null } | null>(null)

type Rect = { x: number, y: number, width: number, height: number }
type ViewRef = React.ComponentRef<typeof View>

/** The page's side as the box sees it (functions only: the page keeps its refs to itself). */
type BoxHost = {
    focused: boolean
    topInset: number
    /** the scroll content's wrapper the box is measured in */
    content: () => ViewRef | null
    /** the wrapper's place in the scroll content (the content container's padding) */
    contentOffset: () => { x: number, y: number }
    viewport: () => Rect | null
    subscribe: (listener: () => void) => () => void
    scroller: BoxScroller
}

const BoxHostContext = React.createContext<BoxHost | null>(null)
export const BoxHostProvider = BoxHostContext.Provider

/**
 * The anime page's side. `scrollRef` goes to its Animated.ScrollView; `onScroll` keeps the page's own JS signal (the long
 * online list, every `signalMs` as before) while the offset goes to the UI thread on every frame.
 */
export function useBoxHost({ focused, topInset, onScrollSignal, signalMs }: {
    focused: boolean
    topInset: number
    onScrollSignal: () => void
    signalMs: number
}) {
    // the page's Animated.ScrollView (made here: a ref passed into a hook would make its whole result a ref for the compiler)
    const scrollRef = useAnimatedRef<Animated.ScrollView>()
    const contentRef = React.useRef<ViewRef | null>(null)
    const contentOffset = React.useRef({ x: 0, y: 0 })
    const viewport = React.useRef<Rect | null>(null)
    const contentHeight = React.useRef(0)
    const listeners = React.useRef(new Set<() => void>())
    const notify = React.useCallback(() => {
        for (const listener of listeners.current) listener()
    }, [])
    const subscribe = React.useCallback((listener: () => void) => {
        listeners.current.add(listener)
        return () => {
            listeners.current.delete(listener)
        }
    }, [])

    // ── Scroll offset (UI thread) and the page's own throttled signal ──
    const maxScroll = useSharedValue(0)
    const driving = useSharedValue(false)
    const driveY = useSharedValue(0)
    const lastSignal = useSharedValue(0)
    const onScroll = useAnimatedScrollHandler({
        onScroll: e => {
            boxScroll.value = e.contentOffset.y
            maxScroll.value = Math.max(0, e.contentSize.height - e.layoutMeasurement.height)
            const now = Date.now()
            if (now - lastSignal.value >= signalMs) {
                lastSignal.value = now
                scheduleOnRN(onScrollSignal)
            }
        },
        onBeginDrag: () => {
            // a finger on the page stops a fling from the box
            if (driving.value) {
                cancelAnimation(driveY)
                driving.value = false
            }
        },
        onEndDrag: () => {
            scheduleOnRN(onScrollSignal)
        },
        onMomentumEnd: () => {
            scheduleOnRN(onScrollSignal)
        },
    })
    // a drag or fling on the box moves the page from the UI thread
    useAnimatedReaction(() => (driving.value ? driveY.value : -1), y => {
        if (y >= 0) scrollTo(scrollRef, 0, y, false)
    })
    const start = React.useRef(0)
    const scroller = React.useMemo<BoxScroller>(() => ({
        begin: () => {
            cancelAnimation(driveY)
            start.current = boxScroll.get()
            driveY.set(start.current)
            driving.set(true)
        },
        move: dragged => {
            driveY.set(scrollTarget(start.current, dragged, maxScroll.get()))
        },
        end: velocity => {
            driveY.set(withDecay({ velocity: -velocity, clamp: [0, Math.max(0, maxScroll.get())] }, () => {
                driving.value = false
            }))
        },
    }), [driveY, driving, maxScroll])

    // ── Where the scroll area is in the window, how far it scrolls ──
    const updateMax = React.useCallback(() => {
        if (viewport.current) maxScroll.set(Math.max(0, contentHeight.current - viewport.current.height))
    }, [maxScroll])
    const measureViewport = React.useCallback(() => {
        const view = scrollRef.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null
        view?.measureInWindow?.((x, y, width, height) => {
            const old = viewport.current
            if (old && old.x === x && old.y === y && old.width === width && old.height === height) return
            viewport.current = { x, y, width, height }
            updateMax()
            notify()
        })
    }, [scrollRef, notify, updateMax])
    // the page rises in when it comes (page-transition.tsx): measured again once it settled
    React.useEffect(() => {
        if (!focused) return
        const timers = [0, 450].map(ms => setTimeout(measureViewport, ms))
        return () => timers.forEach(clearTimeout)
    }, [focused, measureViewport])

    const host = React.useMemo<BoxHost>(() => ({
        focused,
        topInset,
        content: () => contentRef.current,
        contentOffset: () => contentOffset.current,
        viewport: () => viewport.current,
        subscribe,
        scroller,
    }), [focused, topInset, subscribe, scroller])

    const setContent = React.useCallback((node: ViewRef | null) => {
        contentRef.current = node
    }, [])
    const onContentSizeChange = React.useCallback((_width: number, height: number) => {
        contentHeight.current = height
        updateMax()
        notify()
    }, [updateMax, notify])
    const onContentLayout = React.useCallback((x: number, y: number) => {
        if (contentOffset.current.x === x && contentOffset.current.y === y) return
        contentOffset.current = { x, y }
        notify()
    }, [notify])

    return { scrollRef, host, onScroll, onScrollViewLayout: measureViewport, onContentSizeChange, setContent, onContentLayout }
}

/**
 * The box's place on the page: 16:9 at the full width, `children` shown while the player is elsewhere (the episode card).
 * While `active` (its stream is in the player) and the page is on screen, it tells the player where it is.
 */
export function PlayerBoxSlot({ owner, active, style, className, children }: {
    owner: string
    active: boolean
    style?: ViewStyle
    className?: string
    children?: React.ReactNode
}) {
    const host = React.use(BoxHostContext)
    const ref = React.useRef<ViewRef>(null)
    const setSlot = useSetAtom(player_boxSlotAtom)
    const live = active && !!host?.focused

    const measure = React.useCallback(() => {
        const content = host?.content()
        const slot = ref.current
        const viewport = host?.viewport()
        if (!host || !content || !slot || !viewport) return
        slot.measureLayout(content, (x, y, width, height) => {
            const offset = host.contentOffset()
            const geometry: BoxGeometry = { viewport, content: { x: offset.x + x, y: offset.y + y, width, height }, topInset: host.topInset }
            setSlot(old => old && old.owner === owner && old.scroller === host.scroller && sameGeometry(old.geometry, geometry)
                ? old : { owner, geometry, scroller: host.scroller })
        }, () => {})
    }, [host, owner, setSlot])

    React.useEffect(() => {
        if (!live || !host) return
        measure()
        // things above the box change size (the header, the source options): measured again with the page
        const off = host.subscribe(measure)
        return () => {
            off()
            setSlot(old => (old?.owner === owner ? null : old))
        }
    }, [live, host, measure, owner, setSlot])

    return (
        <View ref={ref} collapsable={false} onLayout={live ? measure : undefined} style={style} className={className}>
            {children}
        </View>
    )
}

function sameGeometry(a: BoxGeometry, b: BoxGeometry) {
    return a.topInset === b.topInset
        && a.viewport.x === b.viewport.x && a.viewport.y === b.viewport.y && a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height
        && a.content.x === b.content.x && a.content.y === b.content.y && a.content.width === b.content.width && a.content.height === b.content.height
}

/**
 * The box for a stream that is not the online page's own (library file, torrent, debrid, saved episode) on its anime's
 * page, above the episodes; nothing while another anime or nothing plays.
 */
export function PlayerMediaBox({ mediaId }: { mediaId: number }) {
    const now = useAtomValue(player_nowAtom)
    const owner = `media:${mediaId}`
    if (now?.owner !== owner) return null
    return <PlayerBoxSlot owner={owner} active className="mb-4 aspect-video w-full bg-black" />
}
