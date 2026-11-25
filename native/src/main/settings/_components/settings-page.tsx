import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { PHONE_PAGE_TINT, usePageBottomPad, usePageTop } from "@/components/shared/phone-screen"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { haptic } from "@/lib/feedback"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { type TourScrollHost, TourScrollContext } from "@/main/_features/tour/tour-targets"
import type { LucideIcon } from "lucide-react-native"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import React from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * The frame of one settings area: its head (the area's icon, name and one sentence, as its entry in the list of areas
 * shows them), jump chips for long pages, and the rows below scrolling on their own. Head and chips stand still, so the
 * chips stay in reach while the rows scroll. The rows keep to one column width: on a tablet a switch stays near its text.
 */

/** The widest a settings column gets: at the reading width (832) a switch still sat ~750dp from its label */
export const SETTINGS_COLUMN_WIDTH = 640

type ViewRef = React.ComponentRef<typeof View>
type JumpTarget = { id: string, label: string, ref: React.RefObject<ViewRef | null> }
type JumpRegistry = { add: (target: JumpTarget) => () => void }

const SettingsJumpContext = React.createContext<JumpRegistry | null>(null)

/**
 * A titled group names itself as a jump target of its page (only on pages with `jump`); the ref goes on its outer view.
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

/** Under this many sections a page is short enough to see at once */
const JUMP_MIN_TARGETS = 3

export function SettingsPage({ icon: Icon, title, summary, onBack, jump, pane, bottomPad, children }: {
    icon: LucideIcon
    title: string
    summary: string
    /** the phone's way back to the list of areas; a pane stands beside the list and has none */
    onBack?: () => void
    /** chips that jump to the page's titled groups */
    jump?: boolean
    /** the right pane of the tablet's two panes: the screen's head and sides belong to the panes around it */
    pane?: boolean
    bottomPad?: number
    children: React.ReactNode
}) {
    const t = useTr()
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const { height } = useWindowDimensions()
    const ownBottom = usePageBottomPad((rail ? 32 : barHeight + 32) + insets.bottom)
    const reducedMotion = useReducedMotion()

    const frameRef = React.useRef<ViewRef>(null)
    const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null)
    const offset = React.useRef(0)
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

    const jumpTo = (target: JumpTarget) => {
        const frame = frameRef.current
        const node = target.ref.current
        if (!frame || !node) return
        haptic("tick")
        frame.measureInWindow((_frameX, frameY) => node.measureInWindow((_x, y) => {
            scrollRef.current?.scrollTo({ y: Math.max(0, offset.current + y - frameY - 4), animated: !reducedMotion })
        }))
    }

    // The phone page is centred like every phone tab; a pane starts at the list's edge
    const column = pane ? undefined : { width: "100%" as const, maxWidth: SETTINGS_COLUMN_WIDTH, alignSelf: "center" as const }
    const side = pane ? "" : "px-4"

    return (
        <TourScrollContext value={tourScroll}>
            <SettingsJumpContext.Provider value={jump ? registry : null}>
                <View className="flex-1" style={pane ? { maxWidth: SETTINGS_COLUMN_WIDTH } : { paddingTop: top, ...(!rail ? { backgroundImage: PHONE_PAGE_TINT } : null) }}>
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
                    {targets.length >= JUMP_MIN_TARGETS && (
                        <View style={column}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
                                contentContainerClassName={`gap-2 pb-3 ${side}`}>
                                {targets.map(target => (
                                    <Pressable key={target.id} accessibilityRole="button" accessibilityLabel={target.label} hitSlop={{ top: 6, bottom: 6 }}
                                        onPress={() => jumpTo(target)}
                                        className="h-9 justify-center rounded-full bg-sm-surface-raised px-3.5 active:bg-sm-surface-control">
                                        <Text className="text-[13px] font-medium text-sm-text-muted">{target.label}</Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>
                    )}
                    <View ref={frameRef} collapsable={false} className="flex-1">
                        <ScrollView
                            ref={scrollRef}
                            className="flex-1"
                            onScroll={event => { offset.current = event.nativeEvent.contentOffset.y }}
                            scrollEventThrottle={64}
                            contentContainerStyle={{ ...column, paddingBottom: bottomPad ?? ownBottom }}
                            contentContainerClassName={`gap-6 ${side}`}
                        >
                            {children}
                        </ScrollView>
                    </View>
                </View>
            </SettingsJumpContext.Provider>
        </TourScrollContext>
    )
}
