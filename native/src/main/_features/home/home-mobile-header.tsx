import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { getAssetUrl } from "@/lib/server/assets"
import { colors } from "@/lib/theme/tokens"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { Image } from "expo-image"
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
    const image = rail ? "" : ts.libraryScreenCustomBannerImage?.trim()

    return (
        // the same top as every page (page-top.ts); a banner still reaches up to the edge behind it
        <View style={{ paddingTop: top }} className="px-4">
            {!!image && <HomeBanner image={image} opacity={homeBannerOpacity(ts.libraryScreenCustomBannerOpacity)} position={ts.libraryScreenCustomBannerPosition} />}
            {/* With a banner the head gets the height of a picture strip; title and actions sit at its foot. */}
            <View className={cn("flex-row flex-wrap justify-between gap-x-3 gap-y-1 pt-2 pb-1", image ? "min-h-36 items-end pb-3" : "items-center")}>
                <View className="min-w-0 shrink">
                    {!rail && <Text className="text-[11px] font-semibold uppercase tracking-[1.3px] text-sm-accent opacity-85">Seanime</Text>}
                    <Text accessibilityRole="header" className="mt-[2px] text-[28px] font-bold leading-[32px] tracking-[-0.84px]">{t("Home", "Startseite")}</Text>
                </View>
                {!!actions && <View className="ml-auto max-w-full flex-row flex-wrap items-center justify-end">{actions}</View>}
            </View>
        </View>
    )
}

/**
 * The banner behind the head: one still picture cropped by the stored position, at the stored opacity, darkened under the
 * text and faded out at the bottom. It fades in once loaded (opacity only, 320 ms).
 */
function HomeBanner({ image, opacity, position }: { image: string, opacity: number, position?: string }) {
    return (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="absolute inset-0 overflow-hidden">
            <Image
                key={image}
                source={getAssetUrl(image)}
                contentFit="cover"
                contentPosition={homeBannerPosition(position)}
                transition={{ duration: 320, effect: "cross-dissolve" }}
                style={{ position: "absolute", inset: 0, opacity }}
            />
            {/* the scrim under the title (::after) */}
            <View className="absolute inset-0" style={{ backgroundImage: "linear-gradient(90deg, rgba(12,12,14,0.62), rgba(12,12,14,0.28) 70%, rgba(12,12,14,0.4))" }} />
            {/* React Native has no mask-image: the lower 45% fades into the head's tint instead of to transparent */}
            <View className="absolute inset-0" style={{ backgroundImage: "linear-gradient(180deg, rgba(17,15,31,0) 55%, rgb(17,15,31) 100%)" }} />
        </View>
    )
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
