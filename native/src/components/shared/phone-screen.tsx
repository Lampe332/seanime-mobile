import { cn } from "@/components/ui/core/styling"
import { Heading, Muted } from "@/components/ui/text/text"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { type TourScrollHost, TourScrollContext } from "@/main/_features/tour/tour-targets"
import { PluginTrayButton } from "@/main/_features/plugin/plugin-tray"
import React from "react"
import { ScrollView, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { HEAD_ACTIONS_STYLE } from "./page-head"
import { pageTop } from "./page-top"

/*
 * Tablet (rail): 2.0.33 lays the phone tabs out over the whole width beside the rail with the phone's 1rem sides (measured
 * on the Pixel Tablet, 09.11.: every title and block starts 16dp right of the rail and ends 16dp before the edge; the 72rem
 * cap of [data-phone-screen] never centred them).
 */
export const TABLET_PAGE_GUTTER = 16
export const PHONE_PAGE_TINT = "linear-gradient(180deg, rgba(97,82,223,0.16) 0px, rgba(97,82,223,0.11) 56px, rgba(97,82,223,0.055) 261px, rgba(97,82,223,0.01) 476px, rgba(0,0,0,0) 568px)"

/*
 * The top of every page (page-top.ts): Nick 10.11. dropped 2.0.32's empty 3.5rem navbar over the phone tabs (and the
 * tablet's 1.25rem), so each page starts right under the safe-area inset plus one small gap.
 */
export function usePageTop() {
    return pageTop(useSafeAreaInsets().top)
}

/** The phone's plugin tray (PluginSidebarTray, once in the empty navbar) joins the head's actions; nothing without plugins. */
export function PhoneHeadTray() {
    const { rail } = useTabletLayout()
    return rail ? null : <PluginTrayButton variant="bar" />
}

/*
 * The frame of a phone tab (phone-screen.css `[data-phone-screen]`): 16dp side padding, 24dp between blocks, at most
 * 72rem wide, room for the bottom bar under the content, and the page tint of the phone tabs: the brand colour easing
 * out over the top 32rem. On a tablet the shared ground (tablet.css) carries the tint instead, behind rail and page.
 * The head is `.ps-header`: the title (28dp bold) with its facts line under it and the actions on the right.
 * The setup tour can scroll a target of this screen into the middle (the web's `scrollIntoView({ block: "center" })`).
 */
export function PhoneScreen({ title, subtitle, actions, children, className }: {
    /** without a title (and actions) the screen has no head, e.g. the content gate */
    title?: string
    subtitle?: string
    actions?: React.ReactNode
    children?: React.ReactNode
    className?: string
}) {
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const { height } = useWindowDimensions()
    const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null)
    const offset = React.useRef(0)
    const tourScroll = React.useMemo<TourScrollHost>(() => ({
        centre: rect => scrollRef.current?.scrollTo({ y: Math.max(0, offset.current + rect.top + rect.height / 2 - height / 2), animated: false }),
    }), [height])
    return (
        <TourScrollContext value={tourScroll}>
            <ScrollView
                ref={scrollRef}
                className="flex-1"
                onScroll={event => { offset.current = event.nativeEvent.contentOffset.y }}
                scrollEventThrottle={64}
                contentContainerStyle={{
                    // at least a screen tall, so the tint (in dp from the top) never ends at the content edge
                    minHeight: height,
                    paddingTop: top,
                    // the phone bar overlays the page; the tablet rail sits beside it
                    paddingBottom: (rail ? 32 : barHeight + 32) + insets.bottom,
                    ...(!rail ? { backgroundImage: PHONE_PAGE_TINT } : null),
                }}
                contentContainerClassName={cn("w-full gap-6 px-4", !rail && "max-w-[1152px] self-center", className)}
            >
                {(!!title || !!actions) && (
                    <View className="flex-row flex-wrap items-center justify-between gap-x-2 pt-1">
                        <Heading className="min-w-0 flex-1">{title}</Heading>
                        {/* the buttons overhang the title's line, so every head is as tall as the title (page-head.ts) */}
                        {actions ? <View className="-mr-2 flex-row items-center" style={HEAD_ACTIONS_STYLE}><PhoneHeadTray />{actions}</View>
                            : <View style={HEAD_ACTIONS_STYLE}><PhoneHeadTray /></View>}
                        {!!subtitle && <Muted className="mt-[3px] w-full">{subtitle}</Muted>}
                    </View>
                )}
                {children}
            </ScrollView>
        </TourScrollContext>
    )
}
