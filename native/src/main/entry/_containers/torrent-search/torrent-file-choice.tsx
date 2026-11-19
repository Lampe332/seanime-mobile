import { LoadingRows, Notice, RowGroup, TextAction } from "@/components/shared/phone-kit"
import { cn } from "@/components/ui/core/styling"
import { SheetGroup } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import type { Translate } from "@/lib/app-language"
import { chosenBytes, type FileRow, spaceStateOf, toggledFile } from "@/main/entry/_containers/torrent-search/_lib/file-choice"
import { sizeText } from "@/main/entry/_containers/torrent-search/_lib/torrent-facts"
import { PickBox } from "@/main/entry/_containers/torrent-search/torrent-card"
import { Pressable, View } from "react-native"

/*
 * The download sheet's file choice (4.2.0, A2): the video files of one batch torrent with a box each, the chosen size
 * and the free storage under the head (the start button says the size as well). Rows step in tone like the cards; the
 * box is the cards' own (PickBox).
 */

const DIGITS = { fontVariant: ["tabular-nums"] } as const

export function TorrentFileChoice({ t, rows, chosen, onChange, loading, failed, onRetry, free }: {
    t: Translate
    rows: FileRow[]
    chosen: Set<number> | null
    onChange: (chosen: Set<number>) => void
    loading: boolean
    failed: boolean
    onRetry: () => void
    /** The phone's free bytes; null when it cannot say */
    free: number | null
}) {
    if (loading) {
        return <SheetGroup title={t("Files", "Dateien")}
            intro={t("Getting the file list from the people sharing this torrent. This can take up to a minute.",
                "Die Dateiliste kommt von den Leuten, die diesen Torrent teilen. Das kann bis zu einer Minute dauern.")}>
            <LoadingRows label={t("Getting the file list", "Dateiliste wird geladen")} count={3} />
        </SheetGroup>
    }
    if (failed || !chosen || !rows.length) {
        return <SheetGroup title={t("Files", "Dateien")}>
            <Notice text={t("The file list didn't come, so you can't pick files. The download loads the whole torrent.",
                "Die Dateiliste kam nicht, deshalb kannst du keine Dateien wählen. Der Download lädt den ganzen Torrent.")}>
                {failed && <TextAction label={t("Try again", "Erneut versuchen")} onPress={onRetry} />}
            </Notice>
        </SheetGroup>
    }

    const bytes = chosenBytes(rows, chosen)
    const space = spaceStateOf(bytes, free)
    const all = chosen.size === rows.length
    const count = t(`${chosen.size} of ${rows.length} files`, `${chosen.size} von ${rows.length} Dateien`)
    const summary = [count, sizeText(bytes), free !== null ? t(`${sizeText(free)} free`, `${sizeText(free)} frei`) : ""].filter(Boolean).join(" · ")

    return <SheetGroup title={t("Files", "Dateien")}
        action={<TextAction label={all ? t("Select none", "Keine wählen") : t("Select all", "Alle wählen")}
            onPress={() => onChange(new Set(all ? [] : rows.map(row => row.index)))} />}>
        <Text accessibilityLiveRegion="polite" className={cn("-mt-1 text-[13px] leading-[19px]", space === "full" ? "text-sm-danger" : "text-sm-text-muted")} style={DIGITS}>
            {space === "full"
                ? t(`Not enough free space: ${sizeText(bytes)} chosen, ${sizeText(free ?? 0)} free.`, `Nicht genug freier Speicher: ${sizeText(bytes)} gewählt, ${sizeText(free ?? 0)} frei.`)
                : summary}
        </Text>
        <RowGroup>
            {rows.map(row => <FileChoiceRow key={row.index} row={row} checked={chosen.has(row.index)} onPress={() => onChange(toggledFile(chosen, row.index))} />)}
        </RowGroup>
    </SheetGroup>
}

function FileChoiceRow({ row, checked, onPress }: { row: FileRow, checked: boolean, onPress: () => void }) {
    const size = sizeText(row.size)
    return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={[row.title, row.title !== row.name ? row.name : "", size].filter(Boolean).join(", ")}
        onPress={onPress} className="min-h-14 flex-row items-center gap-3 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control">
        <PickBox checked={checked} />
        <View className="min-w-0 flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-[15px] font-semibold leading-[20px]" style={DIGITS}>{row.title}</Text>
            {row.title !== row.name && <Text numberOfLines={1} ellipsizeMode="middle" className="text-[13px] leading-[18px] text-sm-text-subtle">{row.name}</Text>}
        </View>
        {!!size && <Text className="text-[13px] leading-[18px] text-sm-text-muted" style={DIGITS}>{size}</Text>}
    </Pressable>
}
