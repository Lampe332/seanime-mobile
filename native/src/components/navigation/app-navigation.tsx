import { useIncognito, useSetAppSwitches } from "@/api/hooks/app-switches.hooks"
import { menuIn, menuOut, scrimIn, scrimOut } from "@/components/ui/core/animations"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { GlidePill, GlideStandIn, useGlide } from "@/components/ui/core/glide"
import { cn } from "@/components/ui/core/styling"
import { usePressScale } from "@/components/ui/core/press"
import { Text } from "@/components/ui/text/text"
import { appLanguageAtom, translate } from "@/lib/app-language"
import { MobileIcon, type MobileIconName } from "@/lib/mobile-icons"
import { MAX_NAV_ITEMS, navHighlight, menuTargets, navIcon, navItemLabel, navItemTabLabel, navLabel, type NavItem } from "@/lib/nav/nav-items"
import { moreSupportRow } from "@/lib/nav/more-panel"
import { useAllNavItems } from "@/lib/nav/nav-store"
import { openTab } from "@/lib/helpers/browser"
import Heart from "lucide-react-native/icons/heart"
import { MoreProfileHead } from "@/components/navigation/more-profile-head"
import { settingsHref } from "@/main/settings/_lib/settings-phone"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { updateDotOn } from "@/main/extensions/_lib/extension-updates"
import { useExtensionUpdateCount } from "@/main/extensions/_lib/use-extension-updates"
import { useUpdatesCount } from "@/lib/updates/use-updates"
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
    const label = navItemTabLabel(item, language)
    // the setup tour points at the Menu button
    const tourRef = useTourTarget(item.isMenu ? TOUR_TARGETS.menu : null)
    // extension updates: a dot on Extensions, or on Menu while Extensions is in the Menu (extension-updates.ts)
    const updates = useExtensionUpdateCount()
    const extensionsInBar = useNavItems().some(entry => entry.href === "/extensions")
    // new episodes/chapters (Updates): a dot on its bar entry, or on Menu while Updates is in the Menu
    const fresh = useUpdatesCount()
    const updatesInBar = useNavItems().some(entry => entry.href === "/updates")
    const dot = updateDotOn(item, updates, extensionsInBar) || (fresh > 0 && (item.href === "/updates" || (!!item.isMenu && !updatesInBar)))
    // incognito mode: a small mask on the Menu button, so it is not forgotten (the switch is in the Menu)
    const incognito = useIncognito() && !!item.isMenu
    return (
        <Pressable
            ref={tourRef}
            accessibilityRole={item.isMenu ? "button" : "tab"}
            accessibilityState={{ selected: active }}
            accessibilityLabel={[navItemLabel(item, language), dot ? translate(language, "updates available", "Updates verfügbar") : "", incognito ? translate(language, "incognito on", "Inkognito an") : ""].filter(Boolean).join(", ")}
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
            <View>
                <MobileIcon
                    name={navIcon(item)}
                    size={dense && !rail ? sizes.navIconDense : sizes.navIcon}
                    color={active ? colors.navActive : colors.navItem}
                />
                {dot && !incognito && <View pointerEvents="none" className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-sm-accent" />}
                {incognito && (
                    <View pointerEvents="none" style={{ backgroundColor: colors.smAccent }}
                        className="absolute -right-2.5 -top-1.5 h-[17px] w-[17px] items-center justify-center rounded-full border border-black/40">
                        <MobileIcon name="incognito" size={11} color="#ffffff" />
                    </View>
                )}
            </View>
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
    // one entry lit (4.2.0 E): the open More with a pill of its own, else the page's entry with the gliding pill
    const lit = navHighlight(items, pathname, menuOpen)
    const glide = useGlide(menuOpen ? null : lit)
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
                        // the one lit entry (navHighlight): More while its panel is open, else the page's entry
                        active={item.id === lit}
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

/** Tablet (≥600dp window on a tablet screen): the rail down the left edge, the app's mark on top */
export function NavRail({ items, pathname, menuOpen, onNavigate, onMenu, short }: NavProps & { short: boolean }) {
    const insets = useSafeAreaInsets()
    // one entry lit, as in the bar: the open More (its own pill, below), else the page's entry with the gliding pill
    const lit = navHighlight(items, pathname, menuOpen)
    const glide = useGlide(menuOpen ? null : lit)
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
                        // the one lit entry (navHighlight): More while its panel is open, else the page's entry
                        active={item.id === lit}
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
                    accessibilityLabel="Seanime Mobile"
                    style={{ position: "absolute", top: insets.top + 20, left: (sizes.tabletRail - sizes.tabletRailMark) / 2, width: sizes.tabletRailMark, height: sizes.tabletRailMark, borderRadius: 12 }}
                    contentFit="cover"
                />
            )}
        </View>
    )
}

function MenuRow({ label, icon, current, first, tourTarget, onPress, count, countLabel, state }: {
    label: string
    icon: React.ComponentProps<typeof MobileIcon>["name"]
    current: boolean
    first: boolean
    /** a switch row (incognito mode): its state as a small "On"/"Off" at the row's end */
    state?: { on: boolean, label: string }
    /** a count at the row's end (Extensions: updates) and how it is read out */
    count?: number
    countLabel?: string
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
                accessibilityRole={state ? "switch" : "button"}
                accessibilityState={state ? { checked: state.on } : { selected: current }}
                accessibilityLabel={count ? `${label}, ${countLabel ?? count}` : undefined}
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
                {!!count && (
                    <View className="h-6 min-w-6 items-center justify-center rounded-full bg-sm-accent-soft px-2">
                        <Text className="text-[13px] font-semibold text-sm-accent" style={{ fontVariant: ["tabular-nums"] }}>{count}</Text>
                    </View>
                )}
                {!!state && (
                    <View className={cn("h-6 items-center justify-center rounded-full px-2.5", state.on ? "bg-sm-accent-soft" : "bg-white/6")}>
                        <Text className={cn("text-[12.5px] font-semibold", state.on ? "text-sm-accent" : "text-white/60")}>{state.label}</Text>
                    </View>
                )}
            </Pressable>
        </Animated.View>
    )
}

/**
 * The last row of More (moreSupportRow): smaller and dimmer than the entries above it, a heart without its tile, the label
 * on the same line as theirs; opens Ko-fi outside the app.
 */
function SupportRow({ label, onPress }: { label: string, onPress: () => void }) {
    const { animatedStyle, pressIn, pressOut } = usePressScale(0.975)
    return (
        <Animated.View style={animatedStyle}>
            <View pointerEvents="none" className="absolute left-16 right-3 top-0 h-px bg-white/5" />
            <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
                className="min-h-11 flex-row items-center gap-3.5 rounded-[16px] pl-2.5 pr-3 active:bg-white/8">
                <View className="w-[38px] items-center">
                    <Heart size={17} strokeWidth={1.8} color="rgba(255,255,255,0.5)" />
                </View>
                <Text numberOfLines={1} className="flex-1 text-[13.5px] font-medium text-white/60">{label}</Text>
            </Pressable>
        </Animated.View>
    )
}

/**
 * More (the old Menu, renamed in 4.2.0): the panel that unfolds above the bar (phone) or beside the rail (tablet). On top
 * the profile head, then the destinations that are not in the bar (Search among them in the default bar). It lists only
 * screens that exist (MENU_ENTRIES.ready). Back or a tap outside closes it.
 */
/** A menu row that runs an action instead of opening a page (the sidebar's buttons, e.g. "Sign in") */
export type NavMenuAction = { id: string, label: string, icon: MobileIconName, onPress: () => void }

export function NavMenu({ open, onClose, pathname, onOpen, onSignIn, rail, barItems, actions = [], header }: {
    open: boolean
    onClose: () => void
    pathname: string
    onOpen: (href: string) => void
    /** AniList's sign-in, opened by the profile head while there is no AniList (MoreProfileHead) */
    onSignIn: () => void
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
    const updates = useExtensionUpdateCount()
    const fresh = useUpdatesCount()
    const allItems = useAllNavItems()
    // Manga only while it is on (Settings › More › Manga), as in the web sidebar
    const librarySettings = useServerStatus()?.settings?.library
    const mangaEnabled = !!librarySettings?.enableManga
    // Scan summaries only once a library folder is set, as in the web sidebar
    const hasLibrary = !!librarySettings?.libraryPath
    const incognito = useIncognito()
    const { mutate: setSwitches } = useSetAppSwitches()
    useCloseOnBack(open, onClose)
    if (!open) return null

    // Bar entries given back to the Menu (Customize navigation) and the ready screens that are not in the bar
    const support = moreSupportRow((en, de) => translate(language, en, de))
    const entries = menuTargets(allItems).filter(e => !barItems.some(b => b.href === e.href)
        && (mangaEnabled || e.href !== "/manga")
        && (hasLibrary || e.href !== "/scan-summaries"))
    const panelStyle = rail
        ? { left: sizes.tabletRail + 12, bottom: insets.bottom + 16, width: Math.min(352, width - sizes.tabletRail - 24), maxHeight: height - insets.top - insets.bottom - 32, transformOrigin: "0% 100%" }
        : { left: 8, right: 8, bottom: insets.bottom + barHeight + 12, maxHeight: height - insets.top - insets.bottom - 144, transformOrigin: "50% 100%" }

    return (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {/* next to the rail the panel floats over the page: the page dims as under the sheets (sheet.tsx bg-black/80, the
                rail stays lit); the phone's panel keeps its undimmed page */}
            <Pressable accessibilityLabel={navLabel("More", language)} onPress={onClose} style={StyleSheet.absoluteFill}>
                {rail && <Animated.View pointerEvents="none" entering={scrimIn} exiting={scrimOut}
                    style={[StyleSheet.absoluteFill, { left: sizes.tabletRail }]} className="bg-black/80" />}
            </Pressable>
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
                    {/* who is signed in (AniList, the Seanime account); opens Settings › Account, without AniList its sign-in */}
                    <MoreProfileHead onPress={() => onOpen(settingsHref("account"))} onSignIn={() => {
                        onClose()
                        onSignIn()
                    }} />
                    {header}
                    {/* the quick switch: stays open on a tap, so the change is seen */}
                    <MenuRow
                        label={translate(language, "Incognito mode", "Inkognito-Modus")}
                        icon="incognito"
                        first
                        current={incognito}
                        state={{ on: incognito, label: incognito ? translate(language, "On", "An") : translate(language, "Off", "Aus") }}
                        onPress={() => setSwitches({ incognitoMode: !incognito })}
                    />
                    {entries.map((entry, i) => (
                        <MenuRow
                            key={entry.id}
                            label={navLabel(entry.label, language)}
                            icon={entry.icon}
                            first={false}
                            current={pathname === entry.href}
                            tourTarget={entry.href === "/extensions" ? TOUR_TARGETS.menuExtensions : undefined}
                            count={entry.href === "/extensions" ? updates : entry.href === "/updates" ? fresh : undefined}
                            countLabel={entry.href === "/updates" ? translate(language, `${fresh} new`, `${fresh} neu`)
                                : updates === 1 ? translate(language, "1 update available", "1 Update verfügbar")
                                    : translate(language, `${updates} updates available`, `${updates} Updates verfügbar`)}
                            onPress={() => onOpen(entry.href)}
                        />
                    ))}
                    {actions.map((action, i) => (
                        <MenuRow
                            key={action.id}
                            label={navLabel(action.label, language)}
                            icon={action.icon}
                            first={false}
                            current={false}
                            onPress={() => {
                                onClose()
                                action.onPress()
                            }}
                        />
                    ))}
                    <SupportRow label={support.label} onPress={() => {
                        onClose()
                        openTab(support.href)
                    }} />
                </ScrollView>
            </Animated.View>
        </View>
    )
}
