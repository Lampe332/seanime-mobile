import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { usePageBottomPad, usePageTop, usePhonePageTint } from "@/components/shared/phone-screen"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { haptic } from "@/lib/feedback"
import { useThemeColors } from "@/lib/theme/appearance"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { type TourScrollHost, TourScrollContext } from "@/main/_features/tour/tour-targets"
import { activeJumpIndex, chipRowOffset, focusChipId, SETTINGS_WIDE_COLUMN_WIDTH, settingsColumnMaxWidth } from "@/main/settings/_lib/settings-page-layout"
import type { LucideIcon } from "lucide-react-native"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import React from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * The frame of one settings area: its head (the area's icon, name and one sentence, as its entry in the list of areas
 * shows them), jump chips for long pages, and the rows below scrolling on their own. Head and chips stand still, so the
 * chips stay in reach while the rows scroll; the chip of the group at the top is lit and kept in view. The rows keep to one
 * column: 640dp on a phone, on a tablet the room up to 960dp, centred beyond it (settings-page-layout.ts).
 */

export { SETTINGS_COLUMN_WIDTH } from "@/main/settings/_lib/settings-page-layout"

type ViewRef = React.ComponentRef<typeof View>
type ScrollRef = React.ComponentRef<typeof ScrollView>
type JumpTarget = { id: string, label: string, ref: React.RefObject<ViewRef | null> }
type JumpRegistry = { add: (target: JumpTarget) => () => void }

const SettingsJumpContext = React.createContext<JumpRegistry | null>(null)

/**
 * A titled group names itself as a jump target of its page; the ref goes on its outer view. Every page has the registry:
 * the chips show once it has at least JUMP_MIN_TARGETS titled groups.
 */
export function useJumpTarget(label: string | undefined) {
    const registry = React.useContext(SettingsJumpContext)
    const ref = React.useRef<ViewRef>(null)
    React.useEffect(() => {
        if (!registry || !label) return undefined
        return registry.add({ id: label, label, ref })
    }, [registry, label])
    return ref
}

/**
 * What a search hit opens the page on: the group by its title and the row by its names, all as the page shows them. A
 * new `nonce` runs the jump again (the same hit tapped twice on a tablet).
 */
export type SettingsPageFocus = { group?: string, labels?: readonly string[], nonce: number }
/** The matching row hands the page its view; the page scrolls it into sight */
export type RowReveal = (row: React.RefObject<ViewRef | null>) => void

const SettingsFocusContext = React.createContext<{ focus: SettingsPageFocus, reveal: RowReveal } | null>(null)

/** For a row of the kit: set when this row is the one the page was opened on */
export function useRowFocus(label: string, group: string | undefined) {
    const context = React.useContext(SettingsFocusContext)
    if (!context?.focus.labels?.includes(label)) return null
    if (context.focus.group !== undefined && group !== undefined && context.focus.group !== group) return null
    return { nonce: context.focus.nonce, reveal: context.reveal }
}

/** Under this many titled groups a page is short enough to see at once */
const JUMP_MIN_TARGETS = 3
const AT_START = { x: 0, y: 0 }

export function SettingsPage({ icon: Icon, title, summary, onBack, jump = true, pane, bottomPad, focus, children }: {
    icon: LucideIcon
    title: string
    summary: string
    /** the phone's way back to the list of areas; a pane stands beside the list and has none */
    onBack?: () => void
    /** chips that jump to the page's titled groups (on by default; they show from three groups on) */
    jump?: boolean
    /** the right pane of the tablet's two panes: the screen's head and sides belong to the panes around it */
    pane?: boolean
    bottomPad?: number
    /** the group and row a search hit points at: the page scrolls there and the row lights up for a moment */
    focus?: SettingsPageFocus | null
    children: React.ReactNode
}) {
    const colors = useThemeColors()
    const t = useTr()
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const pageTint = usePhonePageTint()
    const barHeight = useNavBarHeight()
    const { rail, isTablet } = useTabletLayout()
    const { height } = useWindowDimensions()
    const ownBottom = usePageBottomPad((rail ? 32 : barHeight + 32) + insets.bottom)
    const reducedMotion = useReducedMotion()

    const frameRef = React.useRef<ViewRef>(null)
    const scrollRef = React.useRef<ScrollRef>(null)
    const chipRowRef = React.useRef<ScrollRef>(null)
    const offset = React.useRef(0)
    const viewport = React.useRef(0)
    const content = React.useRef(0)
    const started = React.useRef(false)
    const tourScroll = React.useMemo<TourScrollHost>(() => ({
        centre: rect => scrollRef.current?.scrollTo({ y: Math.max(0, offset.current + rect.top + rect.height / 2 - height / 2), animated: false }),
    }), [height])

    const [targets, setTargets] = React.useState<JumpTarget[]>([])
    const registry = React.useMemo<JumpRegistry>(() => ({
        add: target => {
            setTargets(list => [...list.filter(other => other.id !== target.id), target])
            return () => setTargets(list => list.filter(other => other !== target))
        },
    }), [])

    // Where each group starts in the rows; the chips follow the groups' order on the page, not the order they mounted in
    const [tops, setTops] = React.useState<Record<string, number>>({})
    const chips = React.useMemo(() => [...targets].sort((a, b) =>
        (tops[a.id] ?? Number.MAX_SAFE_INTEGER) - (tops[b.id] ?? Number.MAX_SAFE_INTEGER)), [targets, tops])
    const showChips = chips.length >= JUMP_MIN_TARGETS
    const chipsRef = React.useRef(chips)
    const topsRef = React.useRef(tops)

    const [activeId, setActiveId] = React.useState<string | null>(null)
    // A tapped chip stays lit while its jump runs (the last groups cannot all reach the top); the next drag ends that
    const pinned = React.useRef(false)
    const refreshActive = React.useCallback(() => {
        if (pinned.current) return
        const list = chipsRef.current
        const index = activeJumpIndex({
            tops: list.map(chip => topsRef.current[chip.id] ?? Number.MAX_SAFE_INTEGER),
            scrollY: offset.current,
            viewportHeight: viewport.current,
            contentHeight: content.current,
        })
        const id = list[index]?.id ?? null
        setActiveId(previous => previous === id ? previous : id)
    }, [])

    React.useEffect(() => {
        chipsRef.current = chips
        topsRef.current = tops
        refreshActive()
    }, [chips, tops, refreshActive])

    const measure = React.useCallback(() => {
        const frame = frameRef.current
        const list = chipsRef.current
        if (!frame || list.length === 0) return
        frame.measureInWindow((_frameX, frameY) => {
            const next: Record<string, number> = {}
            let left = list.length
            const done = () => {
                left -= 1
                if (left > 0) return
                setTops(previous => {
                    const keys = Object.keys(next)
                    const same = keys.length === Object.keys(previous).length && keys.every(key => previous[key] === next[key])
                    return same ? previous : next
                })
            }
            for (const target of list) {
                const node = target.ref.current
                if (!node) {
                    done()
                    continue
                }
                node.measureInWindow((_x, y) => {
                    next[target.id] = Math.round(offset.current + y - frameY)
                    done()
                })
            }
        })
    }, [])

    // Measured once the groups have laid out (the effect above has handed over the new chips)
    React.useEffect(() => {
        if (targets.length < JUMP_MIN_TARGETS) return undefined
        const frame = requestAnimationFrame(measure)
        return () => cancelAnimationFrame(frame)
    }, [targets, measure])

    /** Scrolls the rows so that the view stands `lead(its height)` under their top edge */
    const scrollToNode = React.useCallback((node: ViewRef, lead: (height: number) => number) => {
        const frame = frameRef.current
        if (!frame) return
        frame.measureInWindow((_frameX, frameY) => node.measureInWindow((_x, y, _width, nodeHeight) => {
            scrollRef.current?.scrollTo({ y: Math.max(0, offset.current + y - frameY - lead(nodeHeight)), animated: !reducedMotion })
        }))
    }, [reducedMotion])

    const jumpTo = (target: JumpTarget) => {
        const node = target.ref.current
        if (!frameRef.current || !node) return
        haptic("tick")
        pinned.current = true
        setActiveId(target.id)
        scrollToNode(node, () => 4)
    }

    /*
     * A search hit: its row reports itself once it has mounted and is brought a third down the visible rows, so its group
     * title and neighbours show around it. A row that is not on the page right now (it depends on a state) or a hit that is
     * a group leaves the jump to the group's title.
     */
    const revealed = React.useRef(false)
    const focusTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const whenLaidOut = React.useCallback((run: () => void) => {
        let tries = 0
        // the first content size puts a new page at its top (below); the jump must come after it
        const attempt = () => {
            if (started.current || tries >= 20) run()
            else {
                tries += 1
                focusTimer.current = setTimeout(attempt, 50)
            }
        }
        clearTimeout(focusTimer.current)
        focusTimer.current = setTimeout(attempt, 50)
    }, [])
    const focusGroup = focus?.group
    const reveal = React.useCallback<RowReveal>(row => {
        revealed.current = true
        whenLaidOut(() => {
            // the row stands a third down, so the line at the top still crosses the group before: its chip is lit instead
            const chip = focusChipId(chipsRef.current.map(target => target.id), focusGroup)
            pinned.current = chip !== null
            if (chip !== null) setActiveId(chip)
            if (row.current) scrollToNode(row.current, rowHeight => Math.max(24, (viewport.current - rowHeight) / 3))
        })
    }, [focusGroup, scrollToNode, whenLaidOut])
    const focusContext = React.useMemo(() => focus ? { focus, reveal } : null, [focus, reveal])
    React.useEffect(() => {
        const group = focus?.group
        if (!group) return undefined
        const timer = setTimeout(() => {
            if (revealed.current) return
            whenLaidOut(() => {
                const node = chipsRef.current.find(target => target.id === group)?.ref.current
                if (node) scrollToNode(node, () => 4)
            })
        }, focus.labels ? 300 : 0)
        return () => {
            clearTimeout(timer)
            revealed.current = false
        }
    }, [focus, scrollToNode, whenLaidOut])
    React.useEffect(() => () => clearTimeout(focusTimer.current), [])

    // The chip row follows the lit chip so it stays in view
    const chipLayouts = React.useRef<Record<string, { x: number, width: number }>>({})
    const chipRowWidth = React.useRef(0)
    const chipContentWidth = React.useRef(0)
    React.useEffect(() => {
        const chip = activeId ? chipLayouts.current[activeId] : undefined
        if (!chip || chipRowWidth.current === 0) return
        chipRowRef.current?.scrollTo({
            x: chipRowOffset({ chipX: chip.x, chipWidth: chip.width, rowWidth: chipRowWidth.current, contentWidth: chipContentWidth.current }),
            animated: !reducedMotion,
        })
    }, [activeId, reducedMotion])

    // The phone page is centred like every phone tab; the pane is centred in its room once that is wider than its column
    const column = pane ? undefined : { width: "100%" as const, maxWidth: settingsColumnMaxWidth(isTablet), alignSelf: "center" as const }
    const side = pane ? "" : "px-4"

    const page = (
        <View className="flex-1" style={pane ? { width: "100%", maxWidth: SETTINGS_WIDE_COLUMN_WIDTH } : { paddingTop: top, ...(!rail && pageTint ? { backgroundImage: pageTint } : null) }}>
            {pane ? (
                <View className="flex-row items-center gap-3.5 pb-4">
                    <Icon size={22} color={colors.smAccent} />
                    <View className="min-w-0 flex-1 gap-0.5">
                        <Text accessibilityRole="header" className="text-[22px] font-bold leading-[27.5px] tracking-[-0.44px]">{title}</Text>
                        <Muted className="text-[13px] leading-[19px]">{summary}</Muted>
                    </View>
                </View>
            ) : (
                <View style={column} className="gap-1 px-4 pb-4">
                    <View className="-ml-3 flex-row items-center gap-1 pt-1">
                        {!!onBack && <Pressable accessibilityRole="button" accessibilityLabel={t("Back to settings", "Zurück zu den Einstellungen")} onPress={onBack}
                            className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                            <ArrowLeft size={24} color={colors.smText} />
                        </Pressable>}
                        <Heading accessibilityRole="header" className="min-w-0 flex-1">{title}</Heading>
                    </View>
                    <View className="flex-row items-center gap-2">
                        <Icon size={18} color={colors.smAccent} />
                        <Muted className="min-w-0 flex-1 text-[13px] leading-[19px]">{summary}</Muted>
                    </View>
                </View>
            )}
            {showChips && (
                <View style={column}>
                    <ScrollView ref={chipRowRef} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentOffset={AT_START}
                        onLayout={event => { chipRowWidth.current = event.nativeEvent.layout.width }}
                        onContentSizeChange={width => { chipContentWidth.current = width }}
                        contentContainerClassName={`gap-2 pb-3 ${side}`}>
                        {chips.map(target => {
                            const selected = target.id === activeId
                            return <Pressable key={target.id} accessibilityRole="button" accessibilityLabel={target.label} accessibilityState={{ selected }}
                                hitSlop={{ top: 6, bottom: 6 }} onPress={() => jumpTo(target)}
                                onLayout={event => { chipLayouts.current[target.id] = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width } }}
                                style={selected ? { backgroundColor: colors.smAccentSoft } : undefined}
                                className={cn("h-9 justify-center rounded-full px-3.5", selected ? "active:opacity-80" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                                <Text className={cn("text-[13px] font-medium", selected ? "text-sm-accent" : "text-sm-text-muted")}>{target.label}</Text>
                            </Pressable>
                        })}
                    </ScrollView>
                </View>
            )}
            <View ref={frameRef} collapsable={false} className="flex-1">
                <ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    // A new area starts at its top: Android reuses the native scroll view of the area before, with its offset
                    contentOffset={AT_START}
                    onLayout={event => { viewport.current = event.nativeEvent.layout.height }}
                    onContentSizeChange={(_width, contentHeight) => {
                        content.current = contentHeight
                        if (!started.current) {
                            started.current = true
                            offset.current = 0
                            scrollRef.current?.scrollTo({ y: 0, animated: false })
                        }
                        if (showChips) requestAnimationFrame(measure)
                    }}
                    onScrollBeginDrag={() => { pinned.current = false }}
                    onScroll={event => {
                        offset.current = event.nativeEvent.contentOffset.y
                        if (showChips) refreshActive()
                    }}
                    scrollEventThrottle={64}
                    contentContainerStyle={{ ...column, paddingBottom: bottomPad ?? ownBottom }}
                    contentContainerClassName={`gap-6 ${side}`}
                >
                    {children}
                </ScrollView>
            </View>
        </View>
    )

    return (
        <TourScrollContext value={tourScroll}>
            <SettingsJumpContext.Provider value={jump ? registry : null}>
                <SettingsFocusContext.Provider value={focusContext}>
                    {pane ? <View className="flex-1 items-center">{page}</View> : page}
                </SettingsFocusContext.Provider>
            </SettingsJumpContext.Provider>
        </TourScrollContext>
    )
}
