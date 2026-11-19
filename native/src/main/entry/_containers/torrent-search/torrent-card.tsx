import type { Habari_Metadata, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import type { Translate } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import {
    copyMagnet,
    factsHead,
    factsLineWrapped,
    factsSentence,
    magnetLinkOf,
    type SeedHealth,
    torrentFacts,
    whole,
} from "@/main/entry/_containers/torrent-search/_lib/torrent-facts"
import { decodeEntities } from "@/main/entry/_containers/torrent-search/_lib/torrent-search-phone"
import * as Clipboard from "expo-clipboard"
import Check from "lucide-react-native/icons/check"
import Copy from "lucide-react-native/icons/copy"
import SignalHigh from "lucide-react-native/icons/signal-high"
import SignalLow from "lucide-react-native/icons/signal-low"
import SignalZero from "lucide-react-native/icons/signal-zero"
import Star from "lucide-react-native/icons/star"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * One torrent as a card, the same in the stream list, the download list (with a box to pick it) and the download sheet:
 *
 *   SubsPlease · S2 · Ep 5 · v2                                1080p
 *   [SubsPlease] Sousou no Frieren S2 - 05 (1080p) [4277EF46].mkv        (quiet, two lines)
 *   ▮ 332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Nyaa      [copy]
 *   ★ Best match · HEVC · 10bit · BluRay · Dual audio · Multi subs
 *
 * Surfaces step in tone, nothing has a line or a shadow; the one accent is "Best match". A long press (or the copy
 * button, or the screen reader's action) copies the magnet link.
 */

export type TorrentCardMode = "stream" | "pick" | "show"

const HEALTH: Record<SeedHealth, { Icon: typeof SignalHigh, color: string }> = {
    unknown: { Icon: SignalZero, color: colors.smTextSubtle },
    none: { Icon: SignalZero, color: colors.smDanger },
    low: { Icon: SignalLow, color: colors.smWarning },
    good: { Icon: SignalHigh, color: colors.smSuccess },
}

const DIGITS = { fontVariant: ["tabular-nums"] } as const

/** Copies the magnet link and says so in a toast */
export async function copyMagnetWithToast(torrent: HibikeTorrent_AnimeTorrent, t: Translate) {
    const copied = await copyMagnet(torrent, Clipboard.setStringAsync).catch(() => null)
    if (copied) toast.success(t("Magnet link copied", "Magnet-Link kopiert"))
    else toast.error(copied === null ? t("Couldn't copy the magnet link", "Magnet-Link konnte nicht kopiert werden")
        : t("This torrent has no magnet link", "Dieser Torrent hat keinen Magnet-Link"))
}

export const TorrentCard = React.memo(function TorrentCard({ torrent, parsed, t, language, mode, provider, best, cached, checked, disabled, onChoose }: {
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
    /** In the debrid service's cache */
    cached?: boolean
    checked?: boolean
    /** The tap does nothing (a stream without the app's player); the long press still copies */
    disabled?: boolean
    onChoose?: (torrent: HibikeTorrent_AnimeTorrent) => void
}) {
    const facts = React.useMemo(() => torrentFacts(torrent, parsed, t, language, { provider }), [torrent, parsed, t, language, provider])
    const name = React.useMemo(() => decodeEntities(torrent.name), [torrent.name])
    const head = factsHead(facts)
    const hasMagnet = !!magnetLinkOf(torrent)
    const marks = [
        best ? t("[torrent] Best match", "Bester Treffer") : "",
        cached ? t("Cached", "Gecacht") : "",
        torrent.isBestRelease ? t("Best release", "Bestes Release") : "",
    ].filter(Boolean)
    const tags = [...marks.slice(best ? 1 : 0), ...facts.tech]
    const { Icon, color } = HEALTH[facts.health]
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
        className={cn("min-h-14 flex-row items-center gap-3 bg-sm-surface-raised py-2.5 pl-4", hasMagnet ? "pr-1" : "pr-4",
            mode !== "show" && "active:bg-sm-surface-control")}>
        {mode === "pick" && <View className={cn("h-[22px] w-[22px] items-center justify-center rounded-[6px]", checked ? "bg-sm-accent-strong" : "border-2 border-sm-text-subtle")}>
            {checked && <Check size={16} color="#ffffff" strokeWidth={3} />}
        </View>}

        <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-2">
                <Text numberOfLines={head ? 1 : 2} className="min-w-0 flex-1 text-[15px] font-semibold leading-[20px]">{head || name}</Text>
                {!!facts.resolution && <View className="rounded-full bg-sm-surface-control px-2 py-px">
                    <Text className="text-xs font-semibold leading-[18px] text-sm-text" style={DIGITS}>{facts.resolution}</Text>
                </View>}
            </View>
            {!!head && <Text numberOfLines={2} className="text-[13px] leading-[18px] text-sm-text-subtle">{name}</Text>}
            {/* the icon stands at the first line when the facts wrap */}
            <View className="flex-row items-start gap-1.5">
                <View className="h-[18px] justify-center"><Icon size={15} color={color} strokeWidth={2.5} /></View>
                <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-sm-text-muted" style={DIGITS}>{factsLineWrapped(facts)}</Text>
            </View>
            {(best || tags.length > 0) && <View className="flex-row items-start gap-1">
                {best && <View className="h-[18px] justify-center"><Star size={13} color={colors.smAccent} fill={colors.smAccent} /></View>}
                <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-sm-text-muted">
                    {best && <Text className="text-[13px] font-semibold leading-[18px] text-sm-accent">{marks[0]}</Text>}
                    {/* the dot stays at the end of a line when the tags wrap */}
                    {(best && tags.length ? " · " : "") + tags.map(whole).join(" · ")}
                </Text>
            </View>}
        </View>

        {hasMagnet && <Pressable accessibilityRole="button" accessibilityLabel={t("Copy magnet link", "Magnet-Link kopieren")} onPress={copy} hitSlop={4}
            className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
            <Copy size={18} color={colors.smTextSubtle} />
        </Pressable>}
    </Pressable>
})
