import { Summary_ScanSummaryFile, Summary_ScanSummaryGroup } from "@/api/generated/types"
import { useGetScanSummaries } from "@/api/hooks/scan_summary.hooks"
import { __scanner_modalIsOpen } from "@/app/(main)/_features/anime-library/_containers/scanner-modal"
import {
    PhoneEmpty,
    PhoneHeader,
    PhoneLoading,
    PhoneScreen,
    PhoneSearchField,
    PhoneSection,
    PhoneSelect,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { useDebounce } from "@/hooks/use-debounce"
import { Translate, useTr } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { useSetAtom } from "jotai/react"
import React from "react"
import { LuChevronDown, LuCircleAlert, LuFileVideo, LuTriangleAlert } from "react-icons/lu"
import "./scan-summaries-phone.css"

/**
 * Scan summaries on Android phones: which anime the last scan found and the files it could not match, each file with
 * what was read from its name and the scanner's notes. Older scans in a picker, a filename search over the chosen one.
 */

const plural = (t: Translate, n: number, en: [string, string], de: [string, string]) => `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`
const scanDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const levelOf = (file: Summary_ScanSummaryFile) => file.logs?.some(log => log.level === "error") ? "error"
    : file.logs?.some(log => log.level === "warning") ? "warning" : undefined
const matches = (file: Summary_ScanSummaryFile, query: string) => !query || !!file.localFile?.path?.toLowerCase().includes(query)

function FileRow({ t, file, open: forced }: { t: Translate, file: Summary_ScanSummaryFile, open?: boolean }) {
    const [open, setOpen] = React.useState(false)
    const id = React.useId()
    const lf = file.localFile
    if (!lf) return null
    const level = levelOf(file)
    const shown = open || !!forced
    const folders = lf.parsedFolderInfo ?? []
    const read: [string, string | undefined][] = [
        [t("Title", "Titel"), [lf.parsedInfo?.title, ...folders.map(f => f.title)].filter(Boolean).join(" · ")],
        [t("Episode", "Folge"), lf.parsedInfo?.episode],
        [t("Season", "Staffel"), [lf.parsedInfo?.season, ...folders.map(f => f.season)].filter(Boolean).join(" · ")],
        [t("Part", "Teil"), [lf.parsedInfo?.part, ...folders.map(f => f.part)].filter(Boolean).join(" · ")],
        [t("Episode title", "Folgentitel"), lf.parsedInfo?.episodeTitle],
    ]
    return <div className="pss-file" data-scan-file={lf.path} data-level={level}>
        <button type="button" className="pss-file-head" aria-expanded={shown} aria-controls={id} onClick={() => setOpen(v => !v)}>
            <span className="pss-file-icon" aria-hidden>{level === "error" ? <LuCircleAlert /> : level === "warning" ? <LuTriangleAlert /> : <LuFileVideo />}</span>
            <span className="ps-action-text"><span>{lf.name || upath.basename(lf.path)}</span>
                <small>{level === "error" ? t("Errors", "Fehler") : level === "warning" ? t("Warnings", "Warnungen") : upath.basename(upath.dirname(lf.path))}</small></span>
            <LuChevronDown className="pss-expand" aria-hidden />
        </button>
        {shown && <div className="pss-file-body" id={id}>
            <p className="pss-path">{lf.path}</p>
            <dl className="pss-read" aria-label={t("Read from the name", "Aus dem Namen gelesen")}>
                {read.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "–"}</dd></div>)}
            </dl>
            {!!file.logs?.length && <ul className="pss-logs">
                {file.logs.map(log => <li key={log.id} data-level={log.level}>
                    {log.message.startsWith("PANIC") ? t("The scanner crashed on this file. Please report it on GitHub.", "Der Scanner ist an dieser Datei abgestürzt. Bitte melde das auf GitHub.") : log.message}
                </li>)}
            </ul>}
        </div>}
    </div>
}

function GroupBlock({ t, group, query }: { t: Translate, group: Summary_ScanSummaryGroup, query: string }) {
    const [open, setOpen] = React.useState(false)
    const id = React.useId()
    const files = group.files?.filter(file => matches(file, query)) ?? []
    const errors = files.filter(file => levelOf(file) === "error").length
    const warnings = files.filter(file => levelOf(file) === "warning").length
    const shown = open || !!query
    return <div className="pss-group" data-scan-group={group.mediaId}>
        <button type="button" className="pss-group-head" aria-expanded={shown} aria-controls={id} onClick={() => setOpen(v => !v)}>
            <span className="ps-list-cover">{!!group.mediaImage && <SeaImage src={group.mediaImage} alt="" fill sizes="3rem" className="object-cover" />}</span>
            <span className="ps-list-text">
                <span className="ps-list-title">{group.mediaTitle}</span>
                <span className="ps-list-meta">{[plural(t, files.length, ["file", "files"], ["Datei", "Dateien"]),
                    group.mediaIsInCollection ? t("on your AniList", "auf deiner AniList") : t("not on your AniList", "nicht auf deiner AniList")].join(" · ")}</span>
                {(errors > 0 || warnings > 0) && <span className="pss-flags">
                    {errors > 0 && <span data-level="error">{plural(t, errors, ["error", "errors"], ["Fehler", "Fehler"])}</span>}
                    {warnings > 0 && <span data-level="warning">{plural(t, warnings, ["warning", "warnings"], ["Warnung", "Warnungen"])}</span>}
                </span>}
            </span>
            <LuChevronDown className="pss-expand" aria-hidden />
        </button>
        {shown && <div className="pss-group-body" id={id}>
            {files.map(file => <FileRow key={file.id} t={t} file={file} open={!!query} />)}
            <SeaLink href={`/entry?id=${group.mediaId}`} className="ps-text-action pss-open">{t("Open anime", "Anime öffnen")}</SeaLink>
        </div>}
    </div>
}

export function ScanSummariesPhone() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const openScanner = useSetAtom(__scanner_modalIsOpen)
    const { data, isLoading } = useGetScanSummaries()
    const scans = React.useMemo(() => (data ?? []).filter(item => !!item.scanSummary?.id && !!item.createdAt).toReversed(), [data])
    const [chosen, setChosen] = React.useState<string | null>(null)
    const [search, setSearch] = React.useState("")
    const query = useDebounce(search.trim().toLowerCase(), 300)
    const scan = scans.find(item => item.scanSummary!.id === chosen) ?? scans[0]
    const summary = scan?.scanSummary

    const unmatched = (summary?.unmatchedFiles ?? []).filter(file => matches(file, query))
    const groups = React.useMemo(() => [...(summary?.groups ?? [])]
            .filter(group => group.files?.some(file => matches(file, query)))
            .sort((a, b) => a.mediaTitle.localeCompare(b.mediaTitle, undefined, { numeric: true })),
        [summary, query])

    const facts = summary && scan?.createdAt ? [scanDate(scan.createdAt), plural(t, summary.groups?.length ?? 0, ["anime", "anime"], ["Anime", "Anime"]),
        summary.unmatchedFiles?.length ? t(`${summary.unmatchedFiles.length} not matched`, `${summary.unmatchedFiles.length} ohne Anime`) : ""].filter(Boolean).join(" · ") : undefined

    return <PhoneScreen screen="scan-summaries">
        <PhoneHeader title={t("Scan summaries", "Scan-Berichte")} facts={facts} />
        {isLoading ? <PhoneLoading label={t("Loading scan summaries", "Scan-Berichte werden geladen")} layout={["tabs", "row", "row", "row"]} />
            : !summary ? <PhoneEmpty title={t("No scans yet", "Noch keine Scans")} data-scan-empty
                    text={t("After a scan you see here which anime each file was matched to and which files were left over.",
                        "Nach einem Scan siehst du hier, welchem Anime jede Datei zugeordnet wurde und welche übrig geblieben sind.")}>
                    {!!serverStatus?.settings?.library?.libraryPath && <button type="button" className="ps-primary" onClick={() => openScanner(true)} data-scan-start>
                        {t("Scan library", "Bibliothek scannen")}</button>}
                </PhoneEmpty>
                : <>
                    <div className="pss-tools">
                        {scans.length > 1 && <PhoneSelect id="pss-scan" label={t("Scan", "Scan")} value={summary.id} onChange={setChosen} data-scan-picker
                            options={scans.map(item => ({ value: item.scanSummary!.id, label: scanDate(item.createdAt!) }))} />}
                        <PhoneSearchField t={t} value={search} onChange={setSearch} placeholder={t("Search file names", "Dateinamen suchen")} data-scan-search />
                    </div>
                    {!!query && !unmatched.length && !groups.length && <PhoneEmpty title={t("No file matches", "Keine Datei passt")}
                        text={t("Try another part of the file name.", "Versuch einen anderen Teil des Dateinamens.")} data-scan-nothing />}
                    {unmatched.length > 0 && <PhoneSection id="pss-unmatched" title={t("Not matched", "Ohne Anime")} count={unmatched.length} data-scan-section="unmatched"
                        note={t("The scanner found no anime for these files.", "Für diese Dateien hat der Scanner keinen Anime gefunden.")}>
                        <div className="pss-files">{unmatched.map(file => <FileRow key={file.id} t={t} file={file} open={!!query} />)}</div>
                    </PhoneSection>}
                    {groups.length > 0 && <PhoneSection id="pss-found" title={t("Anime found", "Gefundene Anime")} count={groups.length} data-scan-section="found">
                        <div className="pss-groups">{groups.map(group => <GroupBlock key={group.id} t={t} group={group} query={query} />)}</div>
                    </PhoneSection>}
                </>}
    </PhoneScreen>
}
