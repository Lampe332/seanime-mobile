import type { Habari_Metadata, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import type { Translate } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import {
    copyMagnet,
    factsFlow,
    factsSentence,
    headParts,
    magnetLinkOf,
    SEED_BAR_PATHS,
    type SeedHealth,
    seedBars,
    seedIconBox,
    torrentFacts,
    whole,
} from "@/main/entry/_containers/torrent-search/_lib/torrent-facts"
import { decodeEntities } from "@/main/entry/_containers/torrent-search/_lib/torrent-search-phone"
import * as Clipboard from "expo-clipboard"
import Check from "lucide-react-native/icons/check"
import Copy from "lucide-react-native/icons/copy"
import React from "react"
import { Pressable, View } from "react-native"
import Svg, { Path } from "react-native-svg"

/*
 * One torrent as a card, the same in the stream list, the download list (with a box to pick it) and the download sheet:
 *
 *   SubsPlease · S2 · Ep 5 · v2                         1080p  [copy]
 *   [SubsPlease] Sousou no Frieren S2 - 05 (1080p) [4277EF46].mkv        (quiet, two lines)
 *   ▮ ★ Best match · 332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Nyaa · HEVC · 10bit · BluRay · Dual audio
 *     (Best match on one card only)
 *
 * 4.2.0 (A2): the copy button sits in the head's row and the numbers, the marks and the tags flow as one text, so the
 * lines below the head have nearly the card's whole width (S22, pick box: about 100 dp, the longest ones under 140);
 * a long group is cut short before the episode is (headParts).
 * Surfaces step in tone, nothing has a line or a shadow; the one accent is "Best match". A long press (or the copy
 * button, or the screen reader's action) copies the magnet link.
 */

export type TorrentCardMode = "stream" | "pick" | "show"

const HEALTH: Record<SeedHealth, string> = {
    unknown: colors.smTextSubtle,
    none: colors.smDanger,
    low: colors.smWarning,
    good: colors.smSuccess,
}

/** The marks not reached (4.2.0 E): a quiet tone that still shows on the raised card, so the icon keeps its four-bar size */
const SEED_BAR_EMPTY = colors.muted

/** Lucide's signal icon with every bar drawn: the reached ones in the health colour, the others quiet */
function SeedBars({ health }: { health: SeedHealth }) {
    const filled = seedBars(health)
    return <Svg width={SEED_ICON.size} height={SEED_ICON.size} viewBox="0 0 24 24" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
        style={{ marginTop: SEED_ICON.top }}>
        {SEED_BAR_PATHS.map((d, index) => <Path key={d} d={d} stroke={index < filled ? HEALTH[health] : SEED_BAR_EMPTY} />)}
    </Svg>
}

const DIGITS = { fontVariant: ["tabular-nums"] } as const

/** The seeder icon sized to the flow line beside it (13 dp on 18 dp), its bars on the text's baseline (4.2.0 E) */
const SEED_ICON = seedIconBox(13, 18)

/** The copy button's 48 dp around the 20 dp head row: 14 dp up into the card's top padding and down beside the name */
const COPY_PLACE = { marginVertical: -14 } as const

/** Copies the magnet link and says so in a toast */
export async function copyMagnetWithToast(torrent: HibikeTorrent_AnimeTorrent, t: Translate) {
    const copied = await copyMagnet(torrent, Clipboard.setStringAsync).catch(() => null)
    if (copied) toast.success(t("Magnet link copied", "Magnet-Link kopiert"))
    else toast.error(copied === null ? t("Couldn't copy the magnet link", "Magnet-Link konnte nicht kopiert werden")
        : t("This torrent has no magnet link", "Dieser Torrent hat keinen Magnet-Link"))
}

/** The pick box of a card and of a file in the download sheet's file choice (22 dp, the one outlined thing) */
export function PickBox({ checked }: { checked: boolean }) {
    return <View className={cn("h-[22px] w-[22px] items-center justify-center rounded-[6px]", checked ? "bg-sm-accent-strong" : "border-2 border-sm-text-subtle")}>
        {checked && <Check size={16} color="#ffffff" strokeWidth={3} />}
    </View>
}

export const TorrentCard = React.memo(function TorrentCard({ torrent, parsed, t, language, mode, provider, best, otherShow, cached, checked, disabled, onChoose }: {
    torrent: HibikeTorrent_AnimeTorrent
    /** The name as $habari reads it (use-torrent-reads.ts); undefined while it is being read */
    parsed: Habari_Metadata | undefined
    t: Translate
    language: string
    mode: TorrentCardMode
    /** The provider's name, "" to leave it out */
    provider?: string
    /** The one auto-select would take */
    best?: boolean
    /** Of another show than the anime (otherShowKeys): the head names the year instead of an episode */
    otherShow?: boolean
    /** In the debrid service's cache */
    cached?: boolean
    checked?: boolean
    /** The tap does nothing (a stream without the app's player); the long press still copies */
    disabled?: boolean
    onChoose?: (torrent: HibikeTorrent_AnimeTorrent) => void
}) {
    const facts = React.useMemo(() => torrentFacts(torrent, parsed, t, language, { provider, otherShow }), [torrent, parsed, t, language, provider, otherShow])
    const name = React.useMemo(() => decodeEntities(torrent.name), [torrent.name])
    const { group, rest } = headParts(facts)
    const hasHead = !!(group || rest)
    const hasMagnet = !!magnetLinkOf(torrent)
    const marks = [
        best ? t("[torrent] Best match", "Bester Treffer") : "",
        cached ? t("Cached", "Gecacht") : "",
        torrent.isBestRelease ? t("Best release", "Bestes Release") : "",
    ].filter(Boolean)
    const tags = [...marks.slice(best ? 1 : 0), ...facts.tech]
    const copy = () => void copyMagnetWithToast(torrent, t)
    const tap = mode !== "show" && !disabled && onChoose ? () => onChoose(torrent) : undefined

    return <Pressable
        accessibilityRole={mode === "pick" ? "checkbox" : mode === "stream" ? "button" : undefined}
        accessibilityState={mode === "pick" ? { checked: !!checked } : mode === "stream" ? { disabled: !!disabled } : undefined}
        accessibilityLabel={factsSentence(name, facts, marks)}
        accessibilityActions={hasMagnet ? [{ name: "longpress", label: t("Copy magnet link", "Magnet-Link kopieren") }] : undefined}
        onAccessibilityAction={event => event.nativeEvent.actionName === "longpress" && copy()}
        onPress={tap}
        onLongPress={copy}
        className={cn("min-h-14 flex-row items-start gap-3 bg-sm-surface-raised pb-2.5 pl-4 pt-3", hasMagnet ? "pr-1" : "pr-4",
            mode !== "show" && "active:bg-sm-surface-control")}>
        {/* the box stands at the head's row */}
        {mode === "pick" && <View className="h-5 justify-center"><PickBox checked={!!checked} /></View>}

        <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-2">
                {hasHead
                    // the group gives way first: "Erai-raws…  · S2 · Ep 5" rather than "Erai-raws · S2 · E…"
                    ? <View className="min-w-0 flex-1 flex-row">
                        {!!group && <Text numberOfLines={1} className="min-w-0 shrink text-[15px] font-semibold leading-[20px]">{group}</Text>}
                        {!!rest && <Text numberOfLines={1} className="shrink-0 text-[15px] font-semibold leading-[20px]" style={DIGITS}>{group ? ` · ${rest}` : rest}</Text>}
                    </View>
                    : <Text numberOfLines={2} className="min-w-0 flex-1 text-[15px] font-semibold leading-[20px]">{name}</Text>}
                {!!facts.resolution && <View className="rounded-full bg-sm-surface-control px-2 py-px">
                    <Text className="text-xs font-semibold leading-[18px] text-sm-text" style={DIGITS}>{facts.resolution}</Text>
                </View>}
                {hasMagnet && <Pressable accessibilityRole="button" accessibilityLabel={t("Copy magnet link", "Magnet-Link kopieren")} onPress={copy} hitSlop={4}
                    style={COPY_PLACE} className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                    <Copy size={18} color={colors.smTextSubtle} />
                </Pressable>}
            </View>
            {hasHead && <Text numberOfLines={2} className={cn("text-[13px] leading-[18px] text-sm-text-subtle", hasMagnet && "pr-3")}>{name}</Text>}
            {/* numbers and tags flow as one text, each fact whole; the icon stands at the first line */}
            <View className={cn("flex-row items-start gap-1.5", hasMagnet && "pr-3")}>
                <View className="h-[18px]"><SeedBars health={facts.health} /></View>
                <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-sm-text-muted" style={DIGITS}>
                    {/* "Best match" leads the flow instead of a row of its own: the one card is a line shorter */}
                    {best && <Text className="text-[13px] font-semibold leading-[18px] text-sm-accent">{`★ ${whole(marks[0]!)}`}</Text>}
                    {(best ? " · " : "") + factsFlow(facts, tags)}
                </Text>
            </View>
        </View>
    </Pressable>
})
