import type { Translate } from "@/lib/app-language"
import { usePalette, useThemeColors } from "@/lib/theme/appearance"
import { toHex } from "@/lib/theme/palette"
import {
    fitFontSize,
    SHARE_HEIGHT,
    SHARE_PAD,
    SHARE_SIZES,
    SHARE_WIDTH,
    type ShareCard,
    shareLayout,
} from "@/main/wrapped/_lib/wrapped-share"
import React from "react"
import Svg, { Defs, Line, LinearGradient, RadialGradient, Rect, Stop, Text } from "react-native-svg"

/** Inter, embedded by the expo-font plugin (app.json); react-native-svg looks it up like a Text style does */
const FONT = "Inter"
const RIGHT = SHARE_WIDTH - SHARE_PAD
const INNER = SHARE_WIDTH - 2 * SHARE_PAD
/** The second column of genres and studio */
const COLUMN = 576

/**
 * The shareable picture of the year, drawn in 1080 x 1350 units: the accent glows out of a dark ground, the year's three
 * numbers as a ledger, then the best rated titles, the top genres and the top studio. Only parts with data are drawn.
 * Fills the parent; WrappedShareSection shows it and turns it into a PNG with toDataURL.
 * `parts` draws it step by step (ground and head, numbers, top rated, lists and foot): its first draw in one frame took
 * 42 ms on the UI thread (S22 27.11.), mostly the text.
 */
export const SHARE_PARTS = 4

export function WrappedShareImage({ card, t, ref, parts = SHARE_PARTS }: { card: ShareCard, t: Translate, ref: React.Ref<Svg>, parts?: number }) {
    const palette = usePalette()
    const colors = useThemeColors()
    const ramp = palette.ramp
    const layout = shareLayout(card)
    const text = colors.smText
    const muted = colors.smTextMuted
    const accent = toHex(ramp[300])
    const { rated, lists } = layout
    const statsEnd = layout.stats + card.stats.length * SHARE_SIZES.statRow
    const genresX = SHARE_PAD
    const studioX = card.genres.length ? COLUMN : SHARE_PAD

    return (
        <Svg ref={ref} width="100%" height="100%" viewBox={`0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}`}>
            <Defs>
                <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={toHex(ramp[900])} stopOpacity={0.85} />
                    <Stop offset="0.5" stopColor={toHex(ramp[950])} stopOpacity={0.45} />
                    <Stop offset="1" stopColor={toHex(ramp[950])} stopOpacity={0} />
                </LinearGradient>
                <RadialGradient id="glow" cx="0.92" cy="0.02" rx="0.8" ry="0.55" fx="0.92" fy="0.02">
                    <Stop offset="0" stopColor={toHex(ramp[500])} stopOpacity={0.55} />
                    <Stop offset="0.6" stopColor={toHex(ramp[500])} stopOpacity={0.08} />
                    <Stop offset="1" stopColor={toHex(ramp[500])} stopOpacity={0} />
                </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={SHARE_WIDTH} height={SHARE_HEIGHT} fill={toHex(palette.surfaces.background)} />
            <Rect x={0} y={0} width={SHARE_WIDTH} height={SHARE_HEIGHT} fill="url(#ground)" />
            <Rect x={0} y={0} width={SHARE_WIDTH} height={SHARE_HEIGHT} fill="url(#glow)" />

            <Text x={SHARE_PAD} y={136} fill={accent} fontFamily={FONT} fontSize={34} fontWeight="700" letterSpacing={-0.5}>Seanime</Text>
            <Text x={SHARE_PAD} y={236} fill={text} fontFamily={FONT} fontWeight="800" letterSpacing={-1.5}
                fontSize={fitFontSize(card.heading.length, INNER, 76)}>{card.heading}</Text>

            {parts >= 2 && card.stats.map((stat, index) => {
                const top = layout.stats + index * SHARE_SIZES.statRow
                return (
                    <React.Fragment key={stat.key}>
                        <Line x1={SHARE_PAD} x2={RIGHT} y1={top} y2={top} stroke={colors.smLineStrong} strokeWidth={2} />
                        <Text x={SHARE_PAD} y={top + 98} fill={muted} fontFamily={FONT} fontSize={34} fontWeight="500">{stat.label}</Text>
                        <Text x={RIGHT} y={top + 98} textAnchor="end" fill={stat.key === "titles" ? toHex(ramp[200]) : text}
                            fontFamily={FONT} fontWeight="800" letterSpacing={-2} fontSize={fitFontSize(stat.value.length, 520, 100, 0.62)}>
                            {stat.value}
                        </Text>
                    </React.Fragment>
                )
            })}
            {parts >= 2 && <Line x1={SHARE_PAD} x2={RIGHT} y1={statsEnd} y2={statsEnd} stroke={colors.smLineStrong} strokeWidth={2} />}

            {parts >= 3 && rated !== null && (
                <>
                    <Text x={SHARE_PAD} y={rated + 40} fill={accent} fontFamily={FONT} fontSize={30} fontWeight="600">
                        {t("Top rated", "Am besten bewertet")}
                    </Text>
                    {card.topRated.map((item, index) => {
                        const y = rated + SHARE_SIZES.ratedHead + index * SHARE_SIZES.ratedRow + 40
                        return (
                            <React.Fragment key={item.rank}>
                                <Text x={SHARE_PAD} y={y} fill={accent} fontFamily={FONT} fontSize={36} fontWeight="700">{String(item.rank)}</Text>
                                <Text x={SHARE_PAD + 52} y={y} fill={text} fontFamily={FONT} fontSize={38} fontWeight="500">{item.title}</Text>
                                <Text x={RIGHT} y={y} textAnchor="end" fill={muted} fontFamily={FONT} fontSize={36} fontWeight="600">{item.score}</Text>
                            </React.Fragment>
                        )
                    })}
                </>
            )}

            {parts >= 4 && lists !== null && (
                <>
                    {card.genres.length > 0 && (
                        <>
                            <Text x={genresX} y={lists + 40} fill={accent} fontFamily={FONT} fontSize={30} fontWeight="600">
                                {t("Top genres", "Top-Genres")}
                            </Text>
                            {card.genres.map((genre, index) => (
                                <Text key={index} x={genresX} y={lists + SHARE_SIZES.listHead + index * SHARE_SIZES.listRow + 34}
                                    fill={text} fontFamily={FONT} fontSize={36} fontWeight="500">{genre}</Text>
                            ))}
                        </>
                    )}
                    {!!card.studio && (
                        <>
                            <Text x={studioX} y={lists + 40} fill={accent} fontFamily={FONT} fontSize={30} fontWeight="600">
                                {t("Top studio", "Top-Studio")}
                            </Text>
                            <Text x={studioX} y={lists + SHARE_SIZES.listHead + 34} fill={text} fontFamily={FONT} fontSize={36} fontWeight="500">
                                {card.studio}
                            </Text>
                        </>
                    )}
                </>
            )}

            {parts >= 4 && <Text x={SHARE_PAD} y={SHARE_HEIGHT - 88} fill={colors.smTextSubtle} fontFamily={FONT} fontSize={26} fontWeight="400">{card.footer}</Text>}
        </Svg>
    )
}
