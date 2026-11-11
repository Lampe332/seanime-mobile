import type { Anime_LibraryCollectionEntry, Anime_Playlist, Anime_PlaylistEpisode, Anime_WatchType } from "@/api/generated/types"
import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useCreatePlaylist, useDeletePlaylist, useGetPlaylistEpisodes, useGetPlaylists, useUpdatePlaylist } from "@/api/hooks/playlist.hooks"
import { Notice, SearchField, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { useHasDebridService, useHasOnlineStreaming, useHasTorrentStreaming } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import Check from "lucide-react-native/icons/check"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronUp from "lucide-react-native/icons/chevron-up"
import Pencil from "lucide-react-native/icons/pencil"
import Play from "lucide-react-native/icons/play"
import Plus from "lucide-react-native/icons/plus"
import Trash2 from "lucide-react-native/icons/trash"
import { PlaySolidIcon } from "@/components/shared/legacy-icons"
import React from "react"
import { ActivityIndicator, Pressable, TextInput, View } from "react-native"
import { usePlaylistManager } from "../_containers/global-playlist-manager"
import {
    createPlaylistMutationGate, MAX_PLAYLIST_EPISODES, movePlaylistEpisode, playlistAnimeChoices, playlistLibraryCollection, samePlaylistEpisode, selectPlaylistEpisodes,
    togglePlaylistEpisode,
} from "../lib/mobile-playlist-state"
import { usePlaylistEditorManager } from "../lib/playlist-editor-manager"

/*
 * Playlists (web playlists/_components/mobile-playlists.tsx + mobile-playlists.css `.mp-*`, playlist-list-modal.tsx): one
 * sheet in steps. List (play or edit each playlist, create one) → editor (name, episodes in order with up/down/remove and
 * the source of streamed episodes) → anime (search and Current/Paused/Planning/All) → episodes (pick, select all) or
 * delete. Nothing is stored until "Save playlist"; a failed save keeps the draft. Opened from Home's header and from a
 * card's long press ("Add to playlist": straight to that anime's episodes).
 */

type Step = "list" | "editor" | "anime" | "episodes" | "delete"
type Draft = { dbId?: number, name: string, episodes: Anime_PlaylistEpisode[] }

function episodeLabel(ep: Anime_PlaylistEpisode, t: Translate) {
    return ep.episode?.baseAnime?.format === "MOVIE" ? t("Movie", "Film") : `${t("Episode", "Episode")} ${ep.episode?.episodeNumber ?? "?"}`
}

function Thumbnail({ src }: { src?: string }) {
    const [failed, setFailed] = React.useState<string>()
    return (
        <View className="h-14 w-11 items-center justify-center overflow-hidden rounded-[9px] bg-sm-surface-control">
            {src && failed !== src ? <Image source={{ uri: src }} style={{ width: 44, height: 56 }} contentFit="cover" onError={() => setFailed(src)} />
                : <Play size={18} color={colors.smTextSubtle} />}
        </View>
    )
}

function RoundAction({ label, icon: Icon, disabled, onPress }: { label: string, icon: React.ComponentType<{ size?: number, color?: string }>, disabled?: boolean, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
            className={cn("h-11 w-11 items-center justify-center rounded-full bg-sm-surface-control active:bg-sm-accent-soft", disabled && "opacity-40")}>
            <Icon size={20} color={colors.smText} />
        </Pressable>
    )
}

export function MobilePlaylists() {
    const t = useTr()
    const manager = usePlaylistEditorManager()
    const { data: library, isLoading: libraryLoading } = useGetLibraryCollection()
    const collection = React.useMemo(() => playlistLibraryCollection(library), [library])
    const { data: playlists, isLoading, isError, refetch } = useGetPlaylists()
    const create = useCreatePlaylist()
    const update = useUpdatePlaylist()
    const remove = useDeletePlaylist()
    const { startPlaylist } = usePlaylistManager()
    const [step, setStep] = React.useState<Step>("list")
    const [draft, setDraft] = React.useState<Draft>({ name: "", episodes: [] })
    const [category, setCategory] = React.useState("CURRENT")
    const [search, setSearch] = React.useState("")
    const [media, setMedia] = React.useState<Anime_LibraryCollectionEntry | null>(null)
    const [error, setError] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [gate] = React.useState(createPlaylistMutationGate)
    const { hasTorrentStreaming } = useHasTorrentStreaming()
    const { hasDebridService } = useHasDebridService()
    const { hasOnlineStreaming } = useHasOnlineStreaming()
    const options = [
        ...(hasTorrentStreaming ? [{ value: "torrent", label: t("Torrent streaming", "Torrent-Streaming") }] : []),
        ...(hasDebridService ? [{ value: "debrid", label: t("Debrid streaming", "Debrid-Streaming") }] : []),
        ...(hasOnlineStreaming ? [{ value: "online", label: t("Online streaming", "Online-Streaming") }] : []),
    ]
    const defaultWatchType = (hasTorrentStreaming ? "torrent" : hasDebridService ? "debrid" : "") as Anime_WatchType
    const entries = React.useMemo(() => playlistAnimeChoices(collection, category, search), [collection, category, search])

    // "Add to playlist" of an anime that is neither in the library nor watched (playlist-list-modal.tsx)
    const selected = manager.selectedMedia
    const known = !selected || libraryLoading || !collection || !!collection.lists?.some(list => list.entries?.some(e => e?.mediaId === selected))
    const { setModalOpen, setSelectedMedia } = manager
    React.useEffect(() => {
        if (known) return
        toast.warning(t("This anime is not in your library or currently watching collection.", "Dieser Anime ist nicht in deiner Bibliothek oder unter „Aktuell“."))
        setSelectedMedia(null)
        setModalOpen(false)
    }, [known, t, setSelectedMedia, setModalOpen])

    const reset = () => {
        setStep("list")
        setMedia(null)
        setError("")
        setSearch("")
    }
    function close(open: boolean) {
        if (busy) return
        manager.setModalOpen(open)
        if (!open) {
            reset()
            manager.setSelectedMedia(null)
            manager.setEpisodeToAdd(null)
        }
    }
    function openEditor(playlist?: Anime_Playlist) {
        setDraft({ dbId: playlist?.dbId, name: playlist?.name ?? "", episodes: (playlist?.episodes ?? []).map(n => ({ ...n, watchType: n.watchType || defaultWatchType })) })
        setError("")
        const entry = collection?.lists?.flatMap(n => n.entries ?? []).find(n => n?.mediaId === manager.selectedMedia)
        setMedia(entry ?? null)
        setStep(entry ? "episodes" : "editor")
    }
    function back() {
        if (busy) return
        setError("")
        if (step === "episodes") setStep("anime")
        else if (step === "anime" || step === "delete") setStep("editor")
        else if (step === "editor") setStep("list")
        else close(false)
    }
    async function persist(deleting = false) {
        if (!deleting && (!draft.name.trim() || !draft.episodes.length)) {
            setError(t("Enter a name and select at least one episode.", "Name eingeben und mindestens eine Episode auswählen."))
            return
        }
        try {
            await gate(async () => {
                setBusy(true)
                setError("")
                try {
                    if (deleting && draft.dbId !== undefined) await remove.mutateAsync({ dbId: draft.dbId })
                    else {
                        const values = { name: draft.name, episodes: draft.episodes.map(e => ({ ...e, isNakama: e.episode?._isNakamaEpisode ?? false })) }
                        if (draft.dbId !== undefined) await update.mutateAsync({ ...values, dbId: draft.dbId })
                        else await create.mutateAsync(values)
                    }
                    setStep("list")
                    manager.setSelectedMedia(null)
                    manager.setEpisodeToAdd(null)
                } finally {
                    setBusy(false)
                }
            })
        } catch {
            setError(t("Could not save the change. Your draft is still here. Try again.", "Änderung konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten. Erneut versuchen."))
        }
    }

    const title = step === "list" ? t("Playlists", "Playlists") : step === "anime" ? t("Add episodes", "Episoden hinzufügen")
        : step === "episodes" ? t("Select episodes", "Episoden auswählen") : step === "delete" ? t("Delete playlist?", "Playlist löschen?")
            : draft.dbId !== undefined ? t("Edit playlist", "Playlist bearbeiten") : t("New playlist", "Neue Playlist")
    const subtitle = step === "episodes" ? (media?.media?.title?.userPreferred || media?.media?.title?.romaji)
        : step !== "list" ? `${draft.episodes.length} / ${MAX_PLAYLIST_EPISODES} ${t("episodes", "Episoden")}` : undefined

    const footer = step === "list"
        ? <Button size="lg" wrapperClassName="flex-1" disabled={libraryLoading} onPress={() => openEditor()}>
            {manager.selectedMedia ? t("Add to new playlist", "Zu neuer Playlist hinzufügen") : t("Create playlist", "Playlist erstellen")}
        </Button>
        : step === "editor"
            ? <Button size="lg" wrapperClassName="flex-1" disabled={!draft.name.trim() || !draft.episodes.length} loading={busy} onPress={() => void persist()}>{t("Save playlist", "Playlist speichern")}</Button>
            : step === "episodes" || step === "anime"
                ? <Button size="lg" wrapperClassName="flex-1" onPress={() => setStep("editor")}>{`${t("Review selection", "Auswahl übernehmen")} · ${draft.episodes.length}`}</Button>
                : <>
                    <Button intent="secondary" size="lg" wrapperClassName="flex-1" disabled={busy} onPress={back}>{t("Cancel", "Abbrechen")}</Button>
                    <Button intent="danger" size="lg" wrapperClassName="flex-1" loading={busy} onPress={() => void persist(true)}>{t("Delete", "Löschen")}</Button>
                </>

    return (
        <Sheet open={manager.isModalOpen && known} onOpenChange={close} title={title} description={subtitle} footer={footer} workspace>
            {step !== "list" && <View className="-mt-2 items-start"><Button intent="text" className="-ml-2" leftIcon={<ChevronLeft size={18} color={colors.smAccent} />} onPress={back}>{t("Back", "Zurück")}</Button></View>}
            {!!error && <View accessibilityRole="alert" className="rounded-surface-sm border border-[#a85a6c] bg-[#3a1d24] p-3"><Text className="text-[#ffe2e8]">{error}</Text></View>}

            {step === "list" && <View className="gap-3">
                {isLoading && <ActivityIndicator color={colors.smAccent} />}
                {isError && <Notice text={t("Could not load playlists.", "Playlists konnten nicht geladen werden.")}><TextAction label={t("Retry", "Erneut versuchen")} onPress={() => void refetch()} /></Notice>}
                {!isLoading && !isError && !playlists?.length && (
                    <View className="items-center gap-3 px-3 py-8">
                        <PlaySolidIcon size={44} color={colors.smAccent} />
                        <Text className="font-semibold">{t("No playlists yet", "Noch keine Playlists")}</Text>
                        <Muted className="text-center">{t("Combine episodes from your anime into a playlist.", "Stelle Episoden deiner Anime zu einer Playlist zusammen.")}</Muted>
                    </View>
                )}
                {playlists?.map(playlist => (
                    <View key={playlist.dbId} className="flex-row items-center gap-3 rounded-surface bg-sm-surface-raised p-3">
                        <Thumbnail src={playlist.episodes?.[0]?.episode?.baseAnime?.coverImage?.large} />
                        <View className="min-w-0 flex-1 gap-1">
                            <Text className="font-semibold">{playlist.name}</Text>
                            <Text className="text-[13px] text-sm-text-muted">{playlist.episodes?.length ?? 0} {t("episodes", "Episoden")}</Text>
                        </View>
                        <View className="flex-row gap-1">
                            <RoundAction label={`${manager.selectedMedia ? t("Add to", "Hinzufügen zu") : t("Edit", "Bearbeiten")}: ${playlist.name}`}
                                icon={manager.selectedMedia ? Plus : Pencil} onPress={() => openEditor(playlist)} />
                            {!manager.selectedMedia && <RoundAction label={`${t("Play", "Abspielen")}: ${playlist.name}`} icon={Play} disabled={!playlist.episodes?.length}
                                onPress={() => {
                                    startPlaylist(playlist)
                                    close(false)
                                }} />}
                        </View>
                    </View>
                ))}
            </View>}

            {step === "editor" && <View className="gap-3">
                <View className="gap-2">
                    <Text className="text-sm text-sm-text-muted">{t("Name", "Name")}</Text>
                    <TextInput value={draft.name} onChangeText={name => setDraft(prev => ({ ...prev, name }))} accessibilityLabel={t("Name", "Name")} autoComplete="off"
                        className="min-h-12 rounded-surface-sm border border-sm-line-strong bg-sm-surface-sunken px-3.5 font-sans text-base text-sm-text" />
                </View>
                <Button intent="secondary" leftIcon={<Plus size={18} color={colors.smText} />} disabled={draft.episodes.length >= MAX_PLAYLIST_EPISODES} onPress={() => setStep("anime")}>
                    {t("Add episodes", "Episoden hinzufügen")}
                </Button>
                {!draft.episodes.length && <Muted>{t("Select anime, then choose episodes. Saving is the final step.", "Wähle Anime und danach Episoden. Erst Speichern übernimmt den Entwurf.")}</Muted>}
                {draft.episodes.map((ep, i) => (
                    <View key={`${ep.episode?.baseAnime?.id}-${ep.episode?.aniDBEpisode}-${i}`} className="overflow-hidden rounded-surface border border-sm-line bg-sm-surface-raised">
                        <View className="flex-row items-center gap-3 p-3">
                            <Text className="w-6 text-center text-sm text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{i + 1}</Text>
                            <View className="min-w-0 flex-1 gap-1">
                                <Text numberOfLines={2} className="text-[13px] text-sm-text-muted">{ep.episode?.baseAnime?.title?.userPreferred || ep.episode?.baseAnime?.title?.romaji}</Text>
                                <Text className="font-semibold">{episodeLabel(ep, t)}{ep.isCompleted ? ` · ${t("Watched", "Gesehen")}` : ""}</Text>
                                {!!ep.episode?.localFile && <Text className="text-[13px] text-sm-text-muted">{ep.episode.localFile.name}</Text>}
                            </View>
                        </View>
                        <View className="flex-row flex-wrap items-center gap-2 px-3 pb-3">
                            <RoundAction label={t("Move episode up", "Episode nach oben")} icon={ChevronUp} disabled={i === 0}
                                onPress={() => setDraft(prev => ({ ...prev, episodes: movePlaylistEpisode(prev.episodes, i, -1) }))} />
                            <RoundAction label={t("Move episode down", "Episode nach unten")} icon={ChevronDown} disabled={i === draft.episodes.length - 1}
                                onPress={() => setDraft(prev => ({ ...prev, episodes: movePlaylistEpisode(prev.episodes, i, 1) }))} />
                            <RoundAction label={t("Remove episode", "Episode entfernen")} icon={Trash2}
                                onPress={() => setDraft(prev => ({ ...prev, episodes: prev.episodes.filter((_, index) => index !== i) }))} />
                            {!ep.episode?.localFile && !ep.isNakama && !!options.length && (
                                <View className="min-w-[144px] flex-1">
                                    <Select value={ep.watchType || defaultWatchType || undefined} placeholder={t("Choose source", "Quelle wählen")} accessibilityLabel={t("Playback source", "Wiedergabequelle")}
                                        options={options} onValueChange={value => setDraft(prev => ({
                                            ...prev, episodes: prev.episodes.map((n, index) => index === i ? { ...n, watchType: value as Anime_WatchType } : n),
                                        }))} />
                                </View>
                            )}
                        </View>
                    </View>
                ))}
                {draft.dbId !== undefined && <Button intent="secondary" disabled={busy} labelClassName="text-sm-danger" onPress={() => setStep("delete")}>{t("Delete playlist", "Playlist löschen")}</Button>}
                <Button intent="text" onPress={back}>{t("Discard draft", "Entwurf verwerfen")}</Button>
            </View>}

            {step === "anime" && <View className="gap-3">
                <SearchField value={search} onChangeText={setSearch} placeholder={t("Search anime…", "Anime suchen…")} />
                {!search.trim() && <Select value={category} onValueChange={setCategory} placeholder={t("Collection", "Sammlung")} accessibilityLabel={t("Collection", "Sammlung")}
                    options={[{ value: "CURRENT", label: t("Current", "Aktuell") }, { value: "PAUSED", label: t("Paused", "Pausiert") },
                        { value: "PLANNING", label: t("Planning", "Geplant") }, { value: "-", label: t("All", "Alle") }]} />}
                {libraryLoading && <ActivityIndicator color={colors.smAccent} />}
                {!libraryLoading && !entries.length && <Muted>{t("No anime found in this collection.", "Keine Anime in dieser Sammlung gefunden.")}</Muted>}
                {entries.map(entry => (
                    <Pressable key={entry.mediaId} accessibilityRole="button" onPress={() => {
                        setMedia(entry)
                        setStep("episodes")
                    }} className="flex-row items-center gap-3 rounded-surface bg-sm-surface-raised p-3 active:bg-sm-surface-control">
                        <Thumbnail src={entry.media?.coverImage?.large} />
                        <View className="min-w-0 flex-1 gap-1">
                            <Text numberOfLines={2} className="font-semibold">{entry.media?.title?.userPreferred || entry.media?.title?.romaji}</Text>
                            <Text className="text-[13px] text-sm-text-muted">{draft.episodes.filter(n => n.episode?.baseAnime?.id === entry.mediaId).length} {t("selected", "ausgewählt")}
                                {entry.libraryData ? ` · ${t("Local", "Lokal")}` : ""}</Text>
                        </View>
                        <Plus size={20} color={colors.smTextMuted} />
                    </Pressable>
                ))}
            </View>}

            {step === "episodes" && !!media && <EpisodeSelection t={t} entry={media} episodes={draft.episodes} defaultWatchType={defaultWatchType}
                onChange={episodes => setDraft(prev => ({ ...prev, episodes }))} />}

            {step === "delete" && (
                <View className="items-center gap-3 px-3 py-8">
                    <Trash2 size={44} color={colors.smAccent} />
                    <Text className="font-semibold">{draft.name}</Text>
                    <Muted className="text-center">{t("This deletes this playlist. Your anime and episode files are kept.", "Diese Playlist wird gelöscht. Deine Anime und Episodendateien bleiben erhalten.")}</Muted>
                </View>
            )}
        </Sheet>
    )
}

function EpisodeSelection({ t, entry, episodes, onChange, defaultWatchType }: {
    t: Translate
    entry: Anime_LibraryCollectionEntry
    episodes: Anime_PlaylistEpisode[]
    onChange: (episodes: Anime_PlaylistEpisode[]) => void
    defaultWatchType: Anime_WatchType
}) {
    const { data, isLoading, isError, refetch } = useGetPlaylistEpisodes(entry.mediaId)
    const { episodeToAdd, selectedMedia, setEpisodeToAdd } = usePlaylistEditorManager()
    const available = React.useMemo(() => (data ?? []).filter(n => !!n.episode).slice()
        .sort((a, b) => a.episode!.progressNumber - b.episode!.progressNumber).map(n => ({ ...n, watchType: n.watchType || defaultWatchType })), [data, defaultWatchType])

    // The episode an "Add to playlist" brought along is picked once its list is here
    React.useEffect(() => {
        if (!data || !episodeToAdd || selectedMedia !== entry.mediaId) return
        const found = available.find(n => n.episode?.aniDBEpisode === episodeToAdd)
        if (found && !episodes.some(n => samePlaylistEpisode(n, found))) onChange(togglePlaylistEpisode(episodes, found))
        setEpisodeToAdd(null)
    }, [data, episodeToAdd, selectedMedia, entry.mediaId, available, episodes, onChange, setEpisodeToAdd])

    const allSelected = available.length > 0 && available.every(ep => episodes.some(n => samePlaylistEpisode(n, ep)))
    const selectedCount = available.filter(ep => episodes.some(n => samePlaylistEpisode(n, ep))).length
    const limit = () => toast.error(t(`A playlist can contain up to ${MAX_PLAYLIST_EPISODES} episodes.`, `Eine Playlist kann höchstens ${MAX_PLAYLIST_EPISODES} Episoden enthalten.`))
    return (
        <View className="gap-3">
            <View className="flex-row flex-wrap items-center justify-between gap-3">
                <Text accessibilityLiveRegion="polite" className="text-sm font-semibold">{selectedCount} / {available.length} {t("selected", "ausgewählt")}</Text>
                <Button intent="secondary" disabled={!available.length} onPress={() => {
                    if (!allSelected && available.length - selectedCount > MAX_PLAYLIST_EPISODES - episodes.length) limit()
                    onChange(selectPlaylistEpisodes(episodes, available))
                }}>{allSelected ? t("Deselect all", "Alle abwählen") : t("Select all", "Alle auswählen")}</Button>
            </View>
            {isLoading && <ActivityIndicator color={colors.smAccent} />}
            {isError && <Notice text={t("Could not load episodes.", "Episoden konnten nicht geladen werden.")}><TextAction label={t("Retry", "Erneut versuchen")} onPress={() => void refetch()} /></Notice>}
            {!isLoading && !isError && !available.length && <Muted>{t("No episodes found.", "Keine Episoden gefunden.")}</Muted>}
            {available.map((ep, i) => {
                const checked = episodes.some(n => samePlaylistEpisode(n, ep))
                return (
                    <Pressable key={`${ep.episode?.aniDBEpisode}-${i}`} accessibilityRole="checkbox" accessibilityState={{ checked }}
                        onPress={() => {
                            if (!checked && episodes.length >= MAX_PLAYLIST_EPISODES) return limit()
                            onChange(togglePlaylistEpisode(episodes, ep))
                        }}
                        className={cn("min-h-[68px] flex-row items-center gap-3 rounded-surface p-3", checked ? "border border-sm-accent-line bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                        <View className={cn("h-[26px] w-[26px] items-center justify-center rounded-[7px] border", checked ? "border-sm-accent bg-sm-accent" : "border-sm-line-strong")}>
                            {checked && <Check size={16} color="#111111" strokeWidth={3} />}
                        </View>
                        <View className="min-w-0 flex-1 gap-1">
                            <Text className="font-semibold">{episodeLabel(ep, t)}</Text>
                            {!!ep.episode?.localFile && <Text className="text-[13px] text-sm-text-muted">{ep.episode.localFile.name}</Text>}
                        </View>
                    </Pressable>
                )
            })}
        </View>
    )
}
