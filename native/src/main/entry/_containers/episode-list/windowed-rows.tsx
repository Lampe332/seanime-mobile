import { type ChunkSize, chunkRange, holdRange, rowEstimate } from "@/main/entry/_lib/chunk-window"
import React from "react"
import { useWindowDimensions, View } from "react-native"

/*
 * windowed-rows.tsx: a long list inside the anime page's ScrollView draws only the chunks of rows near the screen; the
 * others are spacers as tall as the chunk was when drawn (or as the average row until then). The page tells the list
 * when it scrolls (EntryScrollProvider); without a page around it every row is drawn, as before.
 */

type ScrollSignal = { subscribe: (listener: () => void) => () => void }

const EntryScrollContext = React.createContext<ScrollSignal | null>(null)

export const EntryScrollProvider = EntryScrollContext.Provider

/** The page's side: `emit` goes to the ScrollView's onScroll, the signal into EntryScrollProvider */
export function useEntryScrollSignal() {
    return React.useMemo(() => {
        const listeners = new Set<() => void>()
        return {
            subscribe(listener: () => void) {
                listeners.add(listener)
                return () => {
                    listeners.delete(listener)
                }
            },
            emit() {
                for (const listener of listeners) listener()
            },
        }
    }, [])
}

/** Rows per chunk: small enough that drawing one more while scrolling stays within a frame or two */
const CHUNK = 12
/** Screens above/below the visible part whose chunks get drawn (r19: was 1/2) */
const DRAW_ABOVE = 2
const DRAW_BELOW = 3
/** Drawn chunks stay until they are this many screens away (r19: scrolling back no longer builds them again) */
const KEEP = 6

type ChunkProps<T> = {
    chunkKey: string
    rows: T[]
    keyOf: (item: T) => string
    renderItem: (item: T) => React.ReactElement
    onMeasure: (key: string, rows: number, height: number) => void
}

/** One drawn chunk; memo: a new window or a measured height leaves the chunks already drawn alone */
const Chunk = React.memo(function Chunk<T>({ chunkKey, rows, keyOf, renderItem, onMeasure }: ChunkProps<T>) {
    return <View onLayout={event => onMeasure(chunkKey, rows.length, event.nativeEvent.layout.height)}>
        {rows.map(item => <React.Fragment key={keyOf(item)}>{renderItem(item)}</React.Fragment>)}
    </View>
}) as <T>(props: ChunkProps<T>) => React.ReactElement

export function WindowedRows<T>({ items, keyOf, renderItem, estimate }: {
    items: readonly T[]
    keyOf: (item: T) => string
    renderItem: (item: T) => React.ReactElement
    /** dp of one row before any was drawn */
    estimate: number
}) {
    const signal = React.useContext(EntryScrollContext)
    const { height: screen } = useWindowDimensions()
    const ref = React.useRef<React.ComponentRef<typeof View>>(null)
    const chunks = React.useMemo(() => {
        const out: { key: string, rows: T[] }[] = []
        for (let i = 0; i < items.length; i += CHUNK) {
            const rows = items.slice(i, i + CHUNK)
            out.push({ key: `${keyOf(rows[0])}…${keyOf(rows[rows.length - 1])}:${rows.length}`, rows })
        }
        return out
    }, [items, keyOf])
    const [measured, setMeasured] = React.useState<Record<string, ChunkSize>>({})
    // before the first measurement: the first chunks, enough for a tall screen
    const [range, setRange] = React.useState<[number, number]>([0, 2])
    const average = rowEstimate(Object.values(measured), estimate)
    const heights = chunks.map(chunk => measured[chunk.key]?.height ?? chunk.rows.length * average)

    const latest = React.useRef({ heights, screen })
    React.useEffect(() => {
        latest.current = { heights, screen }
    })

    const update = React.useCallback(() => {
        ref.current?.measureInWindow((_x, y, _width, height) => {
            // a hidden page (another tab in front) measures 0: keep what is drawn
            if (!height) return
            const { heights: now, screen: tall } = latest.current
            const want = chunkRange(now, -y - DRAW_ABOVE * tall, -y + (1 + DRAW_BELOW) * tall)
            const keep = chunkRange(now, -y - KEEP * tall, -y + (1 + KEEP) * tall)
            setRange(prev => {
                const next = holdRange(prev, want, keep)
                return prev[0] === next[0] && prev[1] === next[1] ? prev : next
            })
        })
    }, [])

    const onMeasure = React.useCallback((key: string, rows: number, height: number) => {
        setMeasured(prev => prev[key]?.height === height ? prev : { ...prev, [key]: { height, rows } })
    }, [])

    React.useEffect(() => signal?.subscribe(update), [signal, update])
    // other rows (provider, sort, dub) or new heights: the window again
    React.useEffect(() => update(), [chunks, measured, update])

    const first = signal ? Math.min(range[0], chunks.length - 1) : 0
    const last = signal ? Math.min(range[1], chunks.length - 1) : chunks.length - 1

    return <View ref={ref} onLayout={update}>
        {chunks.map((chunk, i) => i >= first && i <= last
            ? <Chunk key={i} chunkKey={chunk.key} rows={chunk.rows} keyOf={keyOf} renderItem={renderItem} onMeasure={onMeasure} />
            : <View key={i} style={{ height: heights[i] }} />)}
    </View>
}
