import type { Summary_ScanSummaryFile, Summary_ScanSummaryGroup } from "@/api/generated/types"
import { useGetScanSummaries } from "@/api/hooks/scan_summary.hooks"
import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { LoadingRows, SearchField, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Text } from "@/components/ui/text/text"
import { useDebounce } from "@/hooks/use-debounce"
import { type Translate, useTr } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { __scanner_modalIsOpen } from "@/main/_features/anime-library/library-phone.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useSetAtom } from "jotai"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import CircleAlert from "lucide-react-native/icons/circle-exclamation-point"
import FileVideo from "lucide-react-native/icons/file-play"
import TriangleAlert from "lucide-react-native/icons/triangle-exclamation-point"
import React from "react"
import { Pressable, View } from "react-native"
import { levelOf, logText, matchesQuery, newestScans, plural, readFromName, visibleGroups } from "../_lib/scan-summaries"

/*
 * Scan summaries (web scan-summaries-phone.tsx + .css `.pss-*`): which anime the last scan found and the files it could
 * not match, each file with what was read from its name and the scanner's notes. Older scans in a picker, a filename
 * search over the chosen one (it opens every block that matches). Errors take the danger tone, warnings the accent.
 */

const scanDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function Chevron({ open }: { open: boolean }) {
    return <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}><ChevronDown size={18} color={colors.smTextSubtle} /></View>
}

function FileRow({ t, file, forced }: { t: Translate, file: Summary_ScanSummaryFile, forced?: boolean }) {
    const [open, setOpen] = React.useState(false)
    const lf = file.localFile
    if (!lf) return null
    const level = levelOf(file)
    const shown = open || !!forced
    const tone = level === "error" ? colors.smDanger : level === "warning" ? colors.smAccent : colors.smTextMuted
    const Icon = level === "error" ? CircleAlert : level === "warning" ? TriangleAlert : FileVideo
    return (
        <View className="bg-sm-surface-raised">
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: shown }} onPress={() => setOpen(v => !v)}
                className="min-h-14 flex-row items-center gap-3.5 px-4 py-2.5 active:bg-sm-surface-control">
                <Icon size={20} color={tone} />
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-[15px]">{lf.name || upath.basename(lf.path)}</Text>
                    <Text style={{ color: level ? tone : colors.smTextMuted }} className="text-[13px] leading-[18px]">
                        {level === "error" ? t("Errors", "Fehler") : level === "warning" ? t("Warnings", "Warnungen") : upath.basename(upath.dirname(lf.path))}
                    </Text>
                </View>
                <Chevron open={shown} />
            </Pressable>
            {shown && (
                <View className="gap-3 pb-4 pl-[50px] pr-4">
                    <Text selectable className="text-[13px] leading-[19px] text-sm-text-muted">{lf.path}</Text>
                    <View accessibilityLabel={t("Read from the name", "Aus dem Namen gelesen")} className="gap-1.5">
                        {readFromName(file, t).map(([label, value]) => (
                            <View key={label} className="flex-row flex-wrap justify-between gap-x-4">
                                <Text className="text-[13px] leading-[19px] text-sm-text-muted">{label}</Text>
                                <Text className="ml-auto text-right text-[13px] leading-[19px]">{value || "–"}</Text>
                            </View>
                        ))}
                    </View>
                    {!!file.logs?.length && (
                        <View className="gap-1.5">
                            {file.logs.map(log => (
                                <Text key={log.id} className={cn("text-[13px] leading-[19px]", log.level === "error" ? "text-sm-danger" : log.level === "warning" ? "text-sm-accent" : "text-sm-text-muted")}>
                                    {logText(log.message, t)}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>
            )}
        </View>
    )
}

function GroupBlock({ t, group, query }: { t: Translate, group: Summary_ScanSummaryGroup, query: string }) {
    const router = useRouter()
    const [open, setOpen] = React.useState(false)
    const files = group.files?.filter(file => matchesQuery(file, query)) ?? []
    const errors = files.filter(file => levelOf(file) === "error").length
    const warnings = files.filter(file => levelOf(file) === "warning").length
    const shown = open || !!query
    return (
        <View className="gap-0.5">
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: shown }} onPress={() => setOpen(v => !v)}
                className="min-h-[76px] flex-row items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-2.5 pr-4 active:bg-sm-surface-control">
                <View className="h-[60px] w-11 overflow-hidden rounded-[6px] bg-sm-surface-control">
                    {!!group.mediaImage && <Image source={{ uri: group.mediaImage }} style={{ width: 44, height: 60 }} contentFit="cover" />}
                </View>
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text numberOfLines={2} className="font-semibold">{group.mediaTitle}</Text>
                    <Text className="text-[13px] text-sm-text-muted">{[plural(t, files.length, ["file", "files"], ["Datei", "Dateien"]),
                        group.mediaIsInCollection ? t("on your AniList", "auf deiner AniList") : t("not on your AniList", "nicht auf deiner AniList")].join(" · ")}</Text>
                    {(errors > 0 || warnings > 0) && (
                        <View className="flex-row flex-wrap gap-x-3">
                            {errors > 0 && <Text className="text-[13px] font-semibold text-sm-danger">{plural(t, errors, ["error", "errors"], ["Fehler", "Fehler"])}</Text>}
                            {warnings > 0 && <Text className="text-[13px] font-semibold text-sm-accent">{plural(t, warnings, ["warning", "warnings"], ["Warnung", "Warnungen"])}</Text>}
                        </View>
                    )}
                </View>
                <Chevron open={shown} />
            </Pressable>
            {shown && (
                <View className="gap-0.5 bg-sm-surface pl-3">
                    {files.map(file => <FileRow key={file.id} t={t} file={file} forced={!!query} />)}
                    <View className="items-start pl-1"><TextAction label={t("Open anime", "Anime öffnen")} onPress={() => router.push(`/entry?id=${group.mediaId}`)} /></View>
                </View>
            )}
        </View>
    )
}

export function ScanSummariesPhone() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const openScanner = useSetAtom(__scanner_modalIsOpen)
    const { data, isLoading } = useGetScanSummaries()
    const scans = React.useMemo(() => newestScans(data), [data])
    const [chosen, setChosen] = React.useState<string | null>(null)
    const [search, setSearch] = React.useState("")
    const query = useDebounce(search.trim().toLowerCase(), 300)
    const scan = scans.find(item => item.scanSummary!.id === chosen) ?? scans[0]
    const summary = scan?.scanSummary

    const unmatched = (summary?.unmatchedFiles ?? []).filter(file => matchesQuery(file, query))
    const groups = React.useMemo(() => visibleGroups(summary?.groups, query), [summary, query])

    const facts = summary && scan?.createdAt ? [scanDate(scan.createdAt), plural(t, summary.groups?.length ?? 0, ["anime", "anime"], ["Anime", "Anime"]),
        summary.unmatchedFiles?.length ? t(`${summary.unmatchedFiles.length} not matched`, `${summary.unmatchedFiles.length} ohne Anime`) : ""].filter(Boolean).join(" · ") : undefined

    return (
        <PhoneScreen title={t("Scan summaries", "Scan-Berichte")} subtitle={facts}>
            {isLoading ? <LoadingRows label={t("Loading scan summaries", "Scan-Berichte werden geladen")} count={4} />
                : !summary ? (
                    <PhoneEmpty title={t("No scans yet", "Noch keine Scans")}
                        text={t("After a scan you see here which anime each file was matched to and which files were left over.",
                            "Nach einem Scan siehst du hier, welchem Anime jede Datei zugeordnet wurde und welche übrig geblieben sind.")}>
                        {!!serverStatus?.settings?.library?.libraryPath && <Button onPress={() => openScanner(true)}>{t("Scan library", "Bibliothek scannen")}</Button>}
                    </PhoneEmpty>
                ) : <>
                    <View className="gap-2">
                        {scans.length > 1 && <Select value={summary.id} onValueChange={setChosen} placeholder={t("Scan", "Scan")} accessibilityLabel={t("Scan", "Scan")}
                            options={scans.map(item => ({ value: item.scanSummary!.id, label: scanDate(item.createdAt!) }))} />}
                        <SearchField value={search} onChangeText={setSearch} placeholder={t("Search file names", "Dateinamen suchen")} />
                    </View>
                    {!!query && !unmatched.length && !groups.length && <PhoneEmpty title={t("No file matches", "Keine Datei passt")}
                        text={t("Try another part of the file name.", "Versuch einen anderen Teil des Dateinamens.")} />}
                    {unmatched.length > 0 && (
                        <PhoneSection title={t("Not matched", "Ohne Anime")} count={unmatched.length}
                            note={t("The scanner found no anime for these files.", "Für diese Dateien hat der Scanner keinen Anime gefunden.")}>
                            <View className="gap-0.5 overflow-hidden rounded-surface">{unmatched.map(file => <FileRow key={file.id} t={t} file={file} forced={!!query} />)}</View>
                        </PhoneSection>
                    )}
                    {groups.length > 0 && (
                        <PhoneSection title={t("Anime found", "Gefundene Anime")} count={groups.length}>
                            <View className="gap-0.5 overflow-hidden rounded-surface">{groups.map(group => <GroupBlock key={group.id} t={t} group={group} query={query} />)}</View>
                        </PhoneSection>
                    )}
                </>}
        </PhoneScreen>
    )
}
