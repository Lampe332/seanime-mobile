import { offlineArtworkUrl } from "@/api/hooks/mobile_offline.helpers"
import { cn } from "@/components/ui/core/styling"
import { colors } from "@/lib/theme/tokens"
import { Image } from "expo-image"
import ArrowDownToLine from "lucide-react-native/icons/arrow-down-to-line"
import Play from "lucide-react-native/icons/play"
import React from "react"
import { View } from "react-native"

/*
 * Small parts of the Downloads tab (downloads-mobile.css): offline artwork with a neutral tile when none is saved, the
 * thin accent line for download or watch progress, the round play mark over a picture.
 */

/** `.mdl-art`: saved artwork from the Go server, else the online URL, else the download icon on the control surface. */
export function Artwork({ asset, url, className, iconSize = 24 }: { asset?: string, url?: string, className?: string, iconSize?: number }) {
    const [failed, setFailed] = React.useState<string | null>(null)
    const source = offlineArtworkUrl(asset, url)
    return <View className={cn("items-center justify-center overflow-hidden bg-sm-surface-control", className)}>
        {source && failed !== source
            ? <Image source={source} contentFit="cover" style={{ position: "absolute", inset: 0 }} onError={() => setFailed(source)} accessibilityIgnoresInvertColors />
            : <ArrowDownToLine size={iconSize} color={colors.smTextSubtle} />}
    </View>
}

/** `.mdl-progress`: 3dp accent line; over a picture it sits on its bottom edge without rounding. */
export function ProgressLine({ value, label, overlay }: { value: number, label: string, overlay?: boolean }) {
    const share = Math.min(100, Math.max(0, value))
    return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(share) }}
        className={cn("h-[3px] overflow-hidden", overlay ? "absolute bottom-0 left-0 right-0 bg-black/55" : "my-1 rounded-full bg-sm-line-strong")}>
        <View className="h-full bg-sm-accent-strong" style={{ width: `${share}%` }} />
    </View>
}

/** `.mdl-play`: the round dark mark with a play triangle, centred over a picture. */
export function PlayMark({ size = 32 }: { size?: number }) {
    return <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <View className="items-center justify-center rounded-full bg-black/60" style={{ width: size, height: size }}>
            <Play size={size * 0.44} color="#ffffff" fill="#ffffff" style={{ marginLeft: 2 }} />
        </View>
    </View>
}
