import { menuIn, menuOut } from "@/components/ui/core/animations"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { GlidePill, GlideStandIn, useGlide } from "@/components/ui/core/glide"
import { cn } from "@/components/ui/core/styling"
import { usePressScale } from "@/components/ui/core/press"
import { Text } from "@/components/ui/text/text"
import { appLanguageAtom } from "@/lib/app-language"
import { MobileIcon, type MobileIconName } from "@/lib/mobile-icons"
import { isActive, MAX_NAV_ITEMS, menuTargets, navIcon, navLabel, type NavItem } from "@/lib/nav/nav-items"
import { useAllNavItems } from "@/lib/nav/nav-store"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { pressTourTarget, TOUR_TARGETS, useTourTarget } from "@/main/_features/tour/tour-targets"
import { colors, sizes } from "@/lib/theme/tokens"
import { Image } from "expo-image"
import { useAtomValue } from "jotai"
import React from "react"
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * The bottom bar (phone) and the navigation rail (tablet) with the bar's Menu, rebuilt from UIBottomNav.kt and the rail
 * rules of app/tablet.css. Same entries in the same order as the old app; their labels are storage keys, only the shown
 * text follows the app language. The active pill glides from entry to entry (segment-glide, glide.tsx).
 */
export function useNavItems() {
    const all = useAllNavItems()
    return React.useMemo(() => all.filter(item => item.placement === "nav"), [all])
}

/** Height the bar takes at the bottom of a phone screen (without the system inset); 60dp in landscape on a phone */
export function useNavBarHeight() {
    const { width, height } = useWindowDimensions()
    return width > height && height <= 600 ? sizes.navBarLandscape : sizes.navBar
}

type NavProps = {
    items: NavItem[]
    pathname: string
    menuOpen: boolean
    onNavigate: (item: NavItem) => void
    onMenu: () => void
}

function NavEntry({ item, active, dense, rail, railHeight, onPress, onLayout, standIn }: {
    item: NavItem
    active: boolean
    dense: boolean
    rail: boolean
    railHeight: number
    onPress: () => void
    onLayout: (event: LayoutChangeEvent) => void
    /** the pill on this entry until the gliding one has its place (GlideStandIn) */
    standIn: React.ReactNode
}) {
    const language = useAtomValue(appLanguageAtom)
    const label = navLabel(item.label, language)
    // the setup tour points at the Menu button
    const tourRef = useTourTarget(item.isMenu ? TOUR_TARGETS.menu : null)
    return (
        <Pressable
            ref={tourRef}
            accessibilityRole={item.isMenu ? "button" : "tab"}
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            onPress={() => {
                if (item.isMenu) pressTourTarget(TOUR_TARGETS.menu)
                onPress()
            }}
            onLayout={onLayout}
            // UIBottomNav.kt's 4px item margin stays on the rail: entries 76dp apart (4rem + 2 × 4px + the rail's .25rem gap)
            style={rail ? { width: sizes.tabletRailItemWidth, height: railHeight, marginVertical: 4 } : undefined}
            // the active entry's pill is the gliding bubble under the entries (GlidePill)
            className={cn(
                "items-center justify-center",
                rail ? "rounded-rail gap-[3.5px]" : "my-1 min-h-12 flex-1 rounded-nav",
                !rail && (dense ? "mx-[0.5px] gap-[3.2px]" : "mx-px gap-[3.5px] px-px"),
                "active:bg-nav-item-pressed",
            )}
        >
            {standIn}
            <MobileIcon
                name={navIcon(item)}
                size={dense && !rail ? sizes.navIconDense : sizes.navIcon}
                color={active ? colors.navActive : colors.navItem}
            />
            {/* UIBottomNav.kt: one line, never an ellipsis. Android lays the label out a little wider than the WebView did, so a
                label that just fit there ("Meine Listen") shrinks by up to 12 % instead of ending in "Meine Lis…" */}
            <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
                className={cn(
                    "font-semibold leading-[1.2]",
                    dense && !rail ? "text-[10px] tracking-[-0.1px]" : "text-[11px] tracking-[-0.22px]",
                    active ? "text-nav-active-label" : "text-nav-item",
                )}
            >
                {label}
            </Text>
        </Pressable>
    )
}

/** Phone: the bar along the bottom edge */
export function NavBar({ items, pathname, menuOpen, onNavigate, onMenu }: NavProps) {
    const insets = useSafeAreaInsets()
    const barHeight = useNavBarHeight()
    const dense = items.length >= MAX_NAV_ITEMS
    // as in the rail: the gliding pill stays on the page's entry, the open Menu gets a pill of its own (2.0.32 S22)
    const glide = useGlide(activeKey(items, pathname))
    return (
        <View
            accessibilityRole="tablist"
            style={{ height: barHeight + insets.bottom, paddingBottom: insets.bottom }}
            className={cn("absolute bottom-0 left-0 right-0 border-t border-nav-line bg-nav-bar", dense ? "px-1.5" : "px-1")}
        >
            {/* without the bar's border: the pill and the entries' boxes count from the same corner (glide.tsx) */}
            <View className="flex-1 flex-row items-stretch">
                <GlidePill glide={glide} className="rounded-nav bg-nav-active-bg" />
                {items.map(item => (
                    <NavEntry
                        key={item.id}
                        item={item}
                        dense={dense}
                        rail={false}
                        railHeight={0}
                        // UIBottomNav.kt marks the Menu button on its own (data-active), the page's entry keeps its pill
                        active={item.isMenu ? menuOpen : isActive(item, pathname)}
                        onPress={() => item.isMenu ? onMenu() : onNavigate(item)}
                        onLayout={glide.onOptionLayout(item.id)}
                        standIn={item.isMenu
                            ? menuOpen && <View pointerEvents="none" className="absolute inset-0 rounded-nav bg-nav-active-bg" />
                            : <GlideStandIn glide={glide} optionKey={item.id} className="rounded-nav bg-nav-active-bg" />}
                    />
                ))}
            </View>
        </View>
    )
}

/** The entry that carries the gliding pill: the page's entry (an open Menu has a pill of its own) */
function activeKey(items: NavItem[], pathname: string) {
    const active = items.find(item => !item.isMenu && isActive(item, pathname))
    return active ? active.id : null
}

/** Tablet (≥600dp window on a tablet screen): the rail down the left edge, the app's mark on top */
export function NavRail({ items, pathname, menuOpen, onNavigate, onMenu, short }: NavProps & { short: boolean }) {
    const insets = useSafeAreaInsets()
    // the gliding pill stays on the page's entry; the open Menu gets a pill of its own (below)
    const glide = useGlide(activeKey(items, pathname))
    return (
        <View
            accessibilityRole="tablist"
            style={{ width: sizes.tabletRail }}
            className="border-r border-nav-rail-line"
        >
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                    alignItems: "center",
                    gap: 4,
                    paddingTop: insets.top + (short ? 8 : sizes.tabletRailTopPadding),
                    paddingBottom: insets.bottom + 80,
                }}
            >
                <GlidePill glide={glide} className="rounded-rail bg-nav-active-bg" />
                {items.map(item => (
                    <NavEntry
                        key={item.id}
                        item={item}
                        dense={false}
                        rail
                        railHeight={short ? sizes.tabletRailItemHeightShort : sizes.tabletRailItemHeight}
                        // UIBottomNav.kt marks the Menu button on its own (data-active), the page's entry keeps its pill
                        active={item.isMenu ? menuOpen : isActive(item, pathname)}
                        onPress={() => item.isMenu ? onMenu() : onNavigate(item)}
                        onLayout={glide.onOptionLayout(item.id)}
                        standIn={item.isMenu
                            ? menuOpen && <View pointerEvents="none" className="absolute inset-0 rounded-rail bg-nav-active-bg" />
                            : <GlideStandIn glide={glide} optionKey={item.id} className="rounded-rail bg-nav-active-bg" />}
                    />
                ))}
            </ScrollView>
            {!short && (
                <Image
                    source={require("../../../assets/images/seanime-logo.png")}
                    accessibilityLabel="Seanime"
                    style={{ position: "absolute", top: insets.top + 20, left: (sizes.tabletRail - sizes.tabletRailMark) / 2, width: sizes.tabletRailMark, height: sizes.tabletRailMark, borderRadius: 12 }}
                    contentFit="cover"
                />
            )}
        </View>
    )
}

function MenuRow({ label, icon, current, first, tourTarget, onPress }: {
    label: string
    icon: React.ComponentProps<typeof MobileIcon>["name"]
    current: boolean
    first: boolean
    /** the setup tour points at this row (Extensions) */
    tourTarget?: string
    onPress: () => void
}) {
    const { animatedStyle, pressIn, pressOut } = usePressScale(0.975)
    const tourRef = useTourTarget(tourTarget ?? null)
    return (
        <Animated.View style={animatedStyle}>
            {!first && !current && <View pointerEvents="none" className="absolute left-16 right-3 top-0 h-px bg-white/5" />}
            <Pressable
                ref={tourRef}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                onPress={() => {
                    if (tourTarget) pressTourTarget(tourTarget)
                    onPress()
                }}
                onPressIn={pressIn}
                onPressOut={pressOut}
                style={current ? { backgroundImage: "linear-gradient(90deg, rgba(97,82,223,0.30), rgba(139,92,246,0.06))" } : undefined}
                className="min-h-14 flex-row items-center gap-3.5 rounded-[16px] pl-2.5 pr-3 active:bg-white/8"
            >
                <View
                    style={current ? {
                        backgroundImage: "linear-gradient(135deg, #6152df, #8b5cf6)",
                        boxShadow: "0 0 16px rgba(97,82,223,0.65)",
                    } : undefined}
                    className={cn("h-[38px] w-[38px] items-center justify-center rounded-[12px] border",
                        current ? "border-[rgba(196,181,253,0.45)]" : "border-white/7 bg-white/6")}
                >
                    <MobileIcon name={icon} size={22} color={current ? "#ffffff" : "rgba(255,255,255,0.78)"} />
                </View>
                <Text
                    numberOfLines={2}
                    className={cn("flex-1 text-[15.2px] tracking-[0.15px]", current ? "font-semibold text-[#ede9fe]" : "font-medium text-white/92")}
                >
                    {label}
                </Text>
            </Pressable>
        </Animated.View>
    )
}

/**
 * The Menu: the panel that unfolds above the bar (phone) or beside the rail (tablet) with the destinations that are not in
 * the bar. It lists only screens that exist (MENU_ENTRIES.ready). Back or a tap outside closes it.
 */
/** A menu row that runs an action instead of opening a page (the sidebar's buttons, e.g. "Sign in") */
export type NavMenuAction = { id: string, label: string, icon: MobileIconName, onPress: () => void }

export function NavMenu({ open, onClose, pathname, onOpen, rail, barItems, actions = [], header }: {
    open: boolean
    onClose: () => void
    pathname: string
    onOpen: (href: string) => void
    rail: boolean
    barItems: NavItem[]
    actions?: NavMenuAction[]
    /** above the entries: the app update panel (`#__seanime_update_menu_host`) */
    header?: React.ReactNode
}) {
    const insets = useSafeAreaInsets()
    const barHeight = useNavBarHeight()
    const { height, width } = useWindowDimensions()
    const language = useAtomValue(appLanguageAtom)
    const allItems = useAllNavItems()
    // Manga only while it is on (Settings › More › Manga), as in the web sidebar
    const librarySettings = useServerStatus()?.settings?.library
    const mangaEnabled = !!librarySettings?.enableManga
    // Scan summaries only once a library folder is set, as in the web sidebar
    const hasLibrary = !!librarySettings?.libraryPath
    useCloseOnBack(open, onClose)
    if (!open) return null

    // Bar entries given back to the Menu (Customize navigation) and the ready screens that are not in the bar
    const entries = menuTargets(allItems).filter(e => !barItems.some(b => b.href === e.href)
        && (mangaEnabled || e.href !== "/manga")
        && (hasLibrary || e.href !== "/scan-summaries"))
    const panelStyle = rail
        ? { left: sizes.tabletRail + 12, bottom: insets.bottom + 16, width: Math.min(352, width - sizes.tabletRail - 24), maxHeight: height - insets.top - insets.bottom - 32, transformOrigin: "0% 100%" }
        : { left: 8, right: 8, bottom: insets.bottom + barHeight + 12, maxHeight: height - insets.top - insets.bottom - 144, transformOrigin: "50% 100%" }

    return (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel={navLabel("Menu", language)} onPress={onClose} style={StyleSheet.absoluteFill} />
            <Animated.View
                entering={menuIn(rail)}
                exiting={menuOut}
                // The panel fades and scales as one GPU layer: without it Android drew all rows into a fresh offscreen
                // buffer for every frame of the fade (S22 framestats 09.11.: GPU 9–11 ms a frame, half the frames late)
                renderToHardwareTextureAndroid
                style={[panelStyle, {
                    position: "absolute",
                    // The old panel was a blurred glass (backdrop-filter); without a blur the same colours are made
                    // nearly opaque so the page under it does not show through (at .97/.98 its text still read through)
                    backgroundImage: "linear-gradient(180deg, rgba(22,20,38,0.99), rgba(9,9,14,0.99))",
                    // A native elevation shadow instead of two blurred box shadows (drawn again on every frame of the
                    // scale/fade in; a box shadow would also be cut off by the layer below)
                    elevation: 18,
                    shadowColor: "#000",
                }]}
                className="rounded-menu border border-menu-border p-2"
            >
                <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
                    {header}
                    {entries.map((entry, i) => (
                        <MenuRow
                            key={entry.id}
                            label={navLabel(entry.label, language)}
                            icon={entry.icon}
                            first={i === 0}
                            current={pathname === entry.href}
                            tourTarget={entry.href === "/extensions" ? TOUR_TARGETS.menuExtensions : undefined}
                            onPress={() => onOpen(entry.href)}
                        />
                    ))}
                    {actions.map((action, i) => (
                        <MenuRow
                            key={action.id}
                            label={navLabel(action.label, language)}
                            icon={action.icon}
                            first={entries.length === 0 && i === 0}
                            current={false}
                            onPress={() => {
                                onClose()
                                action.onPress()
                            }}
                        />
                    ))}
                </ScrollView>
            </Animated.View>
        </View>
    )
}
