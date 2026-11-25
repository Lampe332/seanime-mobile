import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { usePalette } from "@/lib/theme/appearance"
import { glowGround } from "@/lib/theme/palette"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useHomeBanner } from "@/lib/theme/banner-presets"
import type { BannerSource } from "@/lib/theme/home-banner"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useRouter } from "@/lib/navigation"
import { searchHeadLink } from "@/main/search/_lib/search-phone"
import { Image } from "expo-image"
import Search from "lucide-react-native/icons/search"
import React from "react"
import { Pressable, View } from "react-native"
import { usePageTop } from "@/components/shared/phone-screen"
import { homeBannerOpacity, homeBannerPosition } from "./home-layout"

/*
 * Android Home's head (home-mobile-header.tsx + home-mobile.css [data-home-navbar]): the small "Seanime" over the title
 * "Home", the actions on the right as plain 48dp icons. Phones show the banner image of Settings > Appearance behind it;
 * tablets do not (removed in 2.0.33), and the rail already shows the app's mark, so the small "Seanime" goes too.
 */
export function HomeMobileHeader({ actions }: { actions?: React.ReactNode }) {
    const t = useTr()
    const top = usePageTop()
    const { rail } = useTabletLayout()
    const ts = useThemeSettings()
    const banner = useHomeBanner()
    const image = rail ? undefined : banner

    return (
        // the same top as every page (page-top.ts); a banner still reaches up to the edge behind it
        <View style={{ paddingTop: top }} className="px-4">
            {!!image && <HomeBanner image={image} top={top} opacity={homeBannerOpacity(ts.libraryScreenCustomBannerOpacity)} position={ts.libraryScreenCustomBannerPosition} />}
            {/* With a banner the head gets the height of a picture strip; title and actions sit at its foot. */}
            <View className={cn("flex-row flex-wrap justify-between gap-x-3 gap-y-1 pt-2 pb-1", image ? "min-h-36 items-end pb-3" : "items-center")}>
                <View className="min-w-0 shrink">
                    {!rail && <Text className="text-[11px] font-semibold uppercase tracking-[1.3px] text-sm-accent opacity-85">Seanime Mobile</Text>}
                    <Text accessibilityRole="header" className="mt-[2px] text-[28px] font-bold leading-[32px] tracking-[-0.84px]">{t("Home", "Startseite")}</Text>
                </View>
                {!!actions && <View className="ml-auto max-w-full flex-row flex-wrap items-center justify-end">{actions}</View>}
            </View>
        </View>
    )
}

/** How far the banner reaches below the head: its fade ends under the first row, so no edge shows where the head ends. */
const BANNER_BLEED = 40
/** The home tint (home-screen.tsx accentGlow) where the banner's fade ends, so the fade lands on the page's own ground */
const BANNER_FOOT_GLOW = 0.085
/** An eased fade (clear, then slow, fast, slow): a straight two-stop fade shows a band where it starts and ends */
const BANNER_FADE: readonly (readonly [number, number])[] = [[0, 44], [0.1, 56], [0.26, 66], [0.48, 76], [0.72, 86], [0.9, 94], [1, 100]]

/**
 * The banner behind the head: one still picture cropped by the stored position, at the stored opacity, darkened under the
 * text and faded into the page at the bottom (AMOLED black, otherwise the tinted ground). It reaches up under the status
 * bar and a little below the head. It fades in once loaded (opacity only, 320 ms). A bundled picture, the own photo on
 * this device or an old image link (home-banner.ts).
 */
function HomeBanner({ image, top, opacity, position }: { image: BannerSource, top: number, opacity: number, position?: string }) {
    const palette = usePalette()
    const ground = glowGround(BANNER_FOOT_GLOW, palette).join(",")
    const fade = `linear-gradient(180deg, ${BANNER_FADE.map(([a, at]) => `rgba(${ground},${a}) ${at}%`).join(", ")})`
    return (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={{ bottom: -BANNER_BLEED }} className="absolute inset-x-0 top-0 overflow-hidden">
            <Image
                key={image.kind === "preset" ? image.id : image.uri}
                source={image.kind === "preset" ? image.asset : image.uri}
                contentFit="cover"
                contentPosition={homeBannerPosition(position)}
                transition={{ duration: 320, effect: "cross-dissolve" }}
                style={{ position: "absolute", inset: 0, opacity }}
            />
            {/* the scrim under the title (::after) */}
            <View className="absolute inset-0" style={{ backgroundImage: "linear-gradient(90deg, rgba(12,12,14,0.62), rgba(12,12,14,0.28) 70%, rgba(12,12,14,0.4))" }} />
            {/* the status bar's icons stay legible over a bright picture */}
            <View className="absolute inset-x-0 top-0" style={{ height: top + 24, backgroundImage: "linear-gradient(180deg, rgba(12,12,14,0.45), rgba(12,12,14,0))" }} />
            {/* React Native has no mask-image: the lower half fades into the page's ground instead of to transparent */}
            <View className="absolute inset-0" style={{ backgroundImage: fade }} />
        </View>
    )
}

/**
 * Search in a page head (Home, Discover; 4.2.0): Search left the default bar, so its magnifier sits where the page starts.
 * The same 48dp icon (a word pill on a tablet) as the other head actions. `href`: "/search" or "/search?type=manga".
 */
export function SearchHeadAction({ href }: { href: string }) {
    const t = useTr()
    const router = useRouter()
    // each tap lands in the search field; a link with params replaces the open search once per tap (searchHeadLink)
    return <HomeHeaderAction icon={Search} label={t("Search", "Suche")} onPress={() => router.push(searchHeadLink(href, Date.now()))} />
}

/**
 * Playlists, Library and Customize: plain 48dp icon actions without frames; on a tablet the icon and its word as one pill
 * (TabletLabel). A dot marks the icon while something waits.
 */
export function HomeHeaderAction({ icon: Icon, label, accessibilityLabel, dot, onPress }: {
    icon: React.ComponentType<{ size?: number, color?: string }>
    label: string
    accessibilityLabel?: string
    dot?: boolean
    onPress: () => void
}) {
    const { rail } = useTabletLayout()
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            onPress={onPress}
            className={cn("h-12 min-w-12 flex-row items-center justify-center rounded-full active:bg-sm-surface-control", rail && "gap-2 pl-3.5 pr-[18px]")}
        >
            <Icon size={rail ? 18 : 22} color={colors.smTextMuted} />
            {rail && <Text className="text-sm font-semibold text-sm-text-muted">{label}</Text>}
            {dot && <View style={rail ? { top: 10, left: 14 + 15 } : { top: 11, right: 11 }} className="absolute h-2 w-2 rounded-full bg-sm-accent" />}
        </Pressable>
    )
}
