import type { AL_BaseAnime } from "@/api/generated/types"
import { useAnilistListAnime } from "@/api/hooks/anilist.hooks"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useRemoveMediaServerMapping, useSaveMediaServerMapping } from "@/api/hooks/mediaserver.hooks"
import { ActionRow, FORMAT_LABELS, PickRow, RowGroup, SearchField } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { toast } from "@/components/ui/toast/toast-store"
import { Muted, Text } from "@/components/ui/text/text"
import { useDebounce } from "@/hooks/use-debounce"
import { plural, type Translate, useTr } from "@/lib/app-language"
import { useThemeColors } from "@/lib/theme/appearance"
import { accentInput } from "@/lib/theme/tokens"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import {
    type MatchSubject,
    matchItemId,
    offsetFromFirstEpisode,
    parseFirstEpisode,
    ruleKind,
    startFirstEpisode,
} from "@/main/entry/_lib/media-server-match"
import { Image } from "expo-image"
import CircleOff from "lucide-react-native/icons/circle-off"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import React from "react"
import { TextInput, View } from "react-native"

/*
 * "Change match" of a media server series, from the anime page's More (and its "From <server>" chip) or a series of
 * Settings › Media server › Not matched: which series it is and how it is matched now, the anime (suggestion or the
 * picked one, a search, an AniList ID), the whole series or one season, where server episode 1 lands on AniList, and
 * "Belongs to nothing" / "Back to automatic". Built like the unmatched files' sheet (library-phone.tsx).
 */

type Picked = { id: number, title: string, cover?: string, note?: string }

const animeTitle = (media?: AL_BaseAnime) => media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || ""

function animeNote(t: Translate, media: AL_BaseAnime) {
    const format = media.format ? t(...(FORMAT_LABELS[media.format] ?? [media.format, media.format])) : ""
    return [format, media.startDate?.year, media.episodes ? plural(t, media.episodes, ["1 episode", "{0} episodes"], ["1 Folge", "{0} Folgen"]) : ""].filter(Boolean).join(" · ")
}

function Cover({ src }: { src?: string }) {
    return (
        <View className="aspect-[2/3] w-11 overflow-hidden rounded-[8px] bg-sm-surface-control">
            {!!src && <Image cachePolicy="memory-disk" source={src} contentFit="cover" style={{ width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />}
        </View>
    )
}

/** The core's answer status of a failed call */
const statusOf = (error: unknown) => (error as { response?: { status?: unknown } } | null)?.response?.status

function failureText(t: Translate, error: unknown): string {
    switch (statusOf(error)) {
        case 400:
            return t("This match does not work. Check the anime and the episode number.", "Diese Zuordnung geht nicht. Prüfe den Anime und die Folgennummer.")
        case 404:
            return t("The server no longer has this series. Read the server again in Settings › Media server.",
                "Der Server hat diese Serie nicht mehr. Lies den Server unter Einstellungen › Medienserver neu ein.")
        default:
            return t("The match could not be saved. Try again.", "Die Zuordnung ließ sich nicht speichern. Versuch es noch mal.")
    }
}

function ruleText(t: Translate, rule: MatchSubject["rule"]): string {
    switch (ruleKind(rule)) {
        case "manual": return t("Matched by hand", "Von Hand zugeordnet")
        case "title": return t("Matched automatically by its title, not certain", "Automatisch über den Titel zugeordnet, nicht sicher")
        case "numbers": return t("Matched automatically by its numbers", "Automatisch über die Nummern zugeordnet")
        default: return t("Not matched", "Nicht zugeordnet")
    }
}

/** The season a match made by hand is on, so the sheet opens on it; else the whole series */
function startSeason(subject: MatchSubject): string | null {
    if (subject.seasons.length < 2) return null
    return subject.mappings.find(row => subject.seasons.some(season => season.id === row.itemId))?.itemId ?? null
}

export function MediaServerMatchSheet({ subject, open, onOpenChange, cover }: {
    subject: MatchSubject
    open: boolean
    onOpenChange: (open: boolean) => void
    /** the current title's cover (the anime page) */
    cover?: string
}) {
    const t = useTr()
    const colors = useThemeColors()
    const serverStatus = useServerStatus()
    const [anime, setAnime] = React.useState<Picked | null>(null)
    const [seasonId, setSeasonId] = React.useState<string | null>(null)
    const [firstEpisode, setFirstEpisode] = React.useState("1")
    const [query, setQuery] = React.useState("")
    const search = useDebounce(query.trim(), 400)
    const asId = /^\d+$/.test(search) ? Number(search) : 0

    const { data: results, isFetching: searching } = useAnilistListAnime({
        search, page: 1, perPage: 8, isAdult: serverStatus?.settings?.anilist?.enableAdultContent ? undefined : false,
    }, open && search.length > 1 && !asId)
    const { data: byId, isFetching: loadingId } = useGetAnimeEntry(open && asId ? asId : null)
    // the sheet says why under the fields, in the app's language: no toast with the core's English text
    const save = useSaveMediaServerMapping(() => undefined)
    const remove = useRemoveMediaServerMapping(() => undefined)
    const busy = save.isPending || remove.isPending

    // Opening (or another series) starts from what counts now
    const openKey = `${open}:${subject.seriesId}`
    const [seenKey, setSeenKey] = React.useState("")
    if (seenKey !== openKey) {
        setSeenKey(openKey)
        const season = startSeason(subject)
        setAnime(subject.title ? { id: subject.title.id, title: subject.title.title, cover } : null)
        setSeasonId(season)
        setFirstEpisode(String(startFirstEpisode(subject, matchItemId(subject, season))))
        setQuery("")
    }
    // an earlier failure is not shown again (reset outside the render: it updates the mutations' observers)
    const forgetFailure = React.useEffectEvent(() => {
        save.reset()
        remove.reset()
    })
    React.useEffect(() => forgetFailure(), [openKey])

    const itemId = matchItemId(subject, seasonId)
    const episode = parseFirstEpisode(firstEpisode)
    const error = save.error ?? remove.error
    const choices: Picked[] = search
        ? (asId ? (byId?.media ? [byId.media] : []) : (results?.Page?.media?.filter((m): m is AL_BaseAnime => !!m) ?? []))
            .map(media => ({ id: media.id, title: animeTitle(media) || String(media.id), cover: media.coverImage?.medium || media.coverImage?.large, note: animeNote(t, media) }))
        : (anime ? [anime] : [])
    const loading = search ? (asId ? loadingId : searching) : false
    const part = seasonId ? subject.seasons.find(season => season.id === seasonId)?.name : undefined

    const done = (message: string) => {
        toast.success(message)
        onOpenChange(false)
    }
    const pickSeason = (id: string | null) => {
        setSeasonId(id)
        setFirstEpisode(String(startFirstEpisode(subject, matchItemId(subject, id))))
    }
    const saveMatch = () => {
        if (!anime || episode === null) return
        remove.reset()
        save.mutate({ itemId, mediaId: anime.id, episodeOffset: offsetFromFirstEpisode(episode) }, { onSuccess: () => done(t("Match saved", "Zuordnung gespeichert")) })
    }
    const belongsToNothing = () => {
        remove.reset()
        save.mutate({ itemId, mediaId: 0, episodeOffset: 0 }, { onSuccess: () => done(t("Left out of your library", "Aus deiner Bibliothek genommen")) })
    }
    const backToAutomatic = () => {
        save.reset()
        Promise.all(subject.mappings.map(row => remove.mutateAsync({ itemId: row.itemId })))
            .then(() => done(t("Matched automatically again", "Wieder automatisch zugeordnet")))
            .catch(() => undefined)
    }

    return (
        <Sheet title={t("Change match", "Zuordnung ändern")} open={open} onOpenChange={onOpenChange} className="min-h-[78%]"
            footer={<Button wrapperClassName="flex-1" disabled={!anime || episode === null || busy} onPress={saveMatch}>
                {save.isPending ? t("Saving…", "Wird gespeichert…") : part ? t(`Save match for ${part}`, `Zuordnung für ${part} speichern`) : t("Save match", "Zuordnung speichern")}
            </Button>}>
            <View accessible className="gap-0.5 rounded-surface bg-sm-surface-raised px-4 py-3">
                <Text className="text-[15px] font-semibold">{subject.year ? `${subject.name} (${subject.year})` : subject.name}</Text>
                <Muted>{[ruleText(t, subject.rule), plural(t, subject.episodes, ["1 episode", "{0} episodes"], ["1 Folge", "{0} Folgen"])].join(" · ")}</Muted>
            </View>

            <SheetGroup title={t("Which anime is it?", "Welcher Anime ist es?")}
                note={search ? undefined : t("Search by title or enter an AniList ID.", "Suche nach Titel oder gib eine AniList-ID ein.")}>
                <SearchField value={query} onChangeText={setQuery} placeholder={t("Title or AniList ID", "Titel oder AniList-ID")} />
                {loading && !choices.length
                    ? <Muted accessibilityRole="progressbar">{t("Looking…", "Suche…")}</Muted>
                    : !choices.length
                        ? <Muted>{search ? t("Nothing found. Try another title.", "Nichts gefunden. Versuch einen anderen Titel.")
                            : t("No suggestion for this series. Search above.", "Kein Vorschlag für diese Serie. Such oben.")}</Muted>
                        : <RowGroup>
                            {choices.map(choice => <PickRow key={choice.id} radio checked={anime?.id === choice.id} onPress={() => setAnime(choice)}
                                media={<Cover src={choice.cover} />} label={choice.title} note={choice.note} />)}
                        </RowGroup>}
            </SheetGroup>

            {subject.seasons.length > 1 && <SheetGroup title={t("Which part?", "Welcher Teil?")}
                note={t("Pick a season when only that one belongs to this anime.", "Wähl eine Staffel, wenn nur sie zu diesem Anime gehört.")}>
                <RowGroup>
                    <PickRow radio checked={!seasonId} onPress={() => pickSeason(null)} label={t("Whole series", "Ganze Serie")}
                        note={plural(t, subject.episodes, ["1 episode", "{0} episodes"], ["1 Folge", "{0} Folgen"])} />
                    {subject.seasons.map(season => <PickRow key={season.id} radio checked={seasonId === season.id} onPress={() => pickSeason(season.id)}
                        label={season.name || t(`Season ${season.index ?? "?"}`, `Staffel ${season.index ?? "?"}`)}
                        note={plural(t, season.episodes, ["1 episode", "{0} episodes"], ["1 Folge", "{0} Folgen"])} />)}
                </RowGroup>
            </SheetGroup>}

            <SheetGroup title={t("Episodes", "Folgen")}
                note={t("Change it when the server counts on from an earlier season, for example 13 for a second season that starts at episode 13.",
                    "Ändere sie, wenn der Server ab einer früheren Staffel weiterzählt, zum Beispiel 13 für eine zweite Staffel, die bei Folge 13 beginnt.")}>
                <View className="gap-1.5">
                    <Text className="text-[13px] font-medium text-sm-text-muted">{t("Episode 1 on the server is AniList episode", "Folge 1 auf dem Server ist bei AniList Folge")}</Text>
                    <TextInput {...accentInput} value={firstEpisode} onChangeText={v => setFirstEpisode(v.replace(/[^0-9]/g, ""))} placeholder="1" keyboardType="number-pad"
                        placeholderTextColor={colors.smTextSubtle} accessibilityLabel={t("Episode 1 on the server is AniList episode", "Folge 1 auf dem Server ist bei AniList Folge")}
                        className="min-h-12 rounded-surface-sm bg-sm-surface-raised px-4 font-sans text-base text-sm-text" />
                    {episode === null && <Text accessibilityRole="alert" className="text-sm text-sm-danger">{t("Enter an episode number of 1 or more.", "Gib eine Folgennummer ab 1 ein.")}</Text>}
                </View>
                {!!error && <Text accessibilityRole="alert" className="text-sm leading-[19px] text-sm-danger">{failureText(t, error)}</Text>}
            </SheetGroup>

            <SheetGroup title={t("Other options", "Weitere Möglichkeiten")}>
                <RowGroup>
                    <ActionRow icon={CircleOff} label={part ? t(`${part} belongs to nothing`, `${part} gehört zu nichts`) : t("Belongs to nothing", "Gehört zu nichts")} disabled={busy}
                        note={t("Keeps it out of your library, for extras or series that are not on AniList.", "Hält sie aus deiner Bibliothek heraus, für Extras oder Serien, die es bei AniList nicht gibt.")}
                        onPress={belongsToNothing} />
                    {subject.mappings.length > 0 && <ActionRow icon={RotateCcw} label={remove.isPending ? t("Resetting…", "Wird zurückgesetzt…") : t("Back to automatic", "Zurück zu automatisch")}
                        disabled={busy} note={t("Forgets what you set by hand; the app matches it by itself again.", "Vergisst, was du von Hand eingestellt hast; die App ordnet wieder selbst zu.")}
                        onPress={backToAutomatic} />}
                </RowGroup>
            </SheetGroup>
        </Sheet>
    )
}
