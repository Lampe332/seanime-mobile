import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import React from "react"
import { Pressable, View } from "react-native"
import Svg, { Path } from "react-native-svg"

/** react-icons `SiAnilist` (simple-icons), 24-unit box */
const ANILIST_PATH = "M24 17.53v2.421c0 .71-.391 1.101-1.1 1.101h-5l-.057-.165L11.84 3.736c.106-.502.46-.788 1.053-.788h2.422c.71 0 1.1.391 1.1 1.1v12.38H22.9c.71 0 1.1.392 1.1 1.101zM11.034 2.947l6.337 18.104h-4.918l-1.052-3.131H6.019l-1.077 3.131H0L6.361 2.948h4.673zm-.66 10.96-1.69-5.014-1.541 5.015h3.23z"
/** `gray-link` text on the dark theme, as drawn by 2.0.32 on the S22 */
const LINK_GRAY = "#cacaca"

/**
 * The links at the end of "About this anime/manga" (meta-section.tsx `after`): a centred row (`justify-center gap-3`) of
 * small `gray-link` buttons – the AniList logo as an `IconButton size="sm"` (32dp, `text-lg` glyph) and "Trailer" as a
 * `Button size="sm"` (`text-xs`). They sit as inline links, so the line box leaves ~6dp above and below (measured).
 */
export function EntryAboutLinks({ anilistUrl, trailerUrl, onOpen, children }: { anilistUrl?: string, trailerUrl?: string, onOpen: (url: string) => void, children?: React.ReactNode }) {
    const t = useTr()
    if (!anilistUrl && !trailerUrl && !children) return null
    return <View className="flex-row flex-wrap items-center justify-center gap-3 py-1.5">
        {!!anilistUrl && <Pressable accessibilityRole="link" accessibilityLabel="AniList" onPress={() => onOpen(anilistUrl)}
            className="h-8 w-8 items-center justify-center rounded-full active:opacity-70">
            <Svg width={18} height={18} viewBox="0 0 24 24"><Path fill={LINK_GRAY} d={ANILIST_PATH} /></Svg>
        </Pressable>}
        {!!trailerUrl && <Pressable accessibilityRole="link" accessibilityLabel={t("Trailer", "Trailer")} onPress={() => onOpen(trailerUrl)}
            className="h-8 justify-center active:opacity-70">
            <Text className="text-xs font-semibold" style={{ color: LINK_GRAY }}>Trailer</Text>
        </Pressable>}
        {children}
    </View>
}
