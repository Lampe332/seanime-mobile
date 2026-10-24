import { getServerBaseUrl } from "@/api/client/server-url"
import { AL_BaseAnime, Anime_Episode, Anime_LocalFileType } from "@/api/generated/types"
import { useUpdateLocalFileData } from "@/api/hooks/localfiles.hooks"
import { useExternalPlayerLink } from "@/app/(main)/_atoms/playback.atoms"
import { EpisodeGridItem } from "@/app/(main)/_features/anime/_components/episode-grid-item"
import { PluginEpisodeGridItemMenuItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { useServerHMACAuth } from "@/app/(main)/_hooks/use-server-status"
import { SeaImage } from "@/components/shared/sea-image"
import { IconButton } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { defineSchema, Field, Form } from "@/components/ui/form"
import { Modal } from "@/components/ui/modal"
import { Separator } from "@/components/ui/separator"
import { useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { atom } from "jotai"
import { createIsolation } from "jotai-scope"
import { memo } from "react"
import { AiFillWarning } from "react-icons/ai"
import { BiDotsHorizontal, BiLockOpenAlt } from "react-icons/bi"
import { MdInfo, MdOutlineOndemandVideo, MdOutlineRemoveDone } from "react-icons/md"
import { RiEdit2Line } from "react-icons/ri"
import { VscVerified } from "react-icons/vsc"
import { useCopyToClipboard } from "react-use"
import { toast } from "sonner"
import { z } from "zod"

const EpisodeItemIsolation = createIsolation()

const __metadataModalIsOpenAtom = atom(false)

export const EpisodeItem = memo(({ episode, media, isWatched, watchedProgress, onPlay, percentageComplete, minutesRemaining, mobileEntry }: {
    mobileEntry?: boolean,
    episode: Anime_Episode,
    media: AL_BaseAnime,
    onPlay?: ({ path, mediaId }: { path: string, mediaId: number }) => void,
    isWatched?: boolean
    watchedProgress?: number
    percentageComplete?: number
    minutesRemaining?: number
}) => {

    const t = useTr()
    const { updateLocalFile, isPending } = useUpdateLocalFileData()
    const [, copyToClipboard] = useCopyToClipboard()

    const { getHMACTokenQueryParam } = useServerHMACAuth()

    const { encodePath } = useExternalPlayerLink()

    function encodeFilePath(filePath: string) {
        if (encodePath) {
            return Buffer.from(filePath).toString("base64")
        }
        return encodeURIComponent(filePath)
    }

    function handleClick() {
        onPlay?.({ path: episode.localFile?.path ?? "", mediaId: media.id })
    }

    return (
        <EpisodeItemIsolation.Provider>
            <EpisodeGridItem
                mobileEntry={mobileEntry}
                media={media}
                image={episode.episodeMetadata?.image}
                onClick={handleClick}
                isInvalid={episode.isInvalid}
                title={episode.displayTitle}
                episodeTitle={episode.episodeTitle}
                fileName={episode.localFile?.name}
                isWatched={episode.progressNumber > 0 && isWatched}
                isFiller={episode.episodeMetadata?.isFiller}
                length={episode.episodeMetadata?.length}
                percentageComplete={percentageComplete}
                minutesRemaining={minutesRemaining}
                episodeNumber={episode.episodeNumber}
                watchedProgress={watchedProgress}
                progressNumber={episode.progressNumber}
                description={episode.episodeMetadata?.summary || episode.episodeMetadata?.overview}
                action={<>
                    {!episode._isNakamaEpisode && <IconButton
                        icon={episode.localFile?.locked ? <VscVerified /> : <BiLockOpenAlt />}
                        intent={episode.localFile?.locked ? "success-basic" : "warning-basic"}
                        size="md"
                        className="hover:opacity-60"
                        loading={isPending}
                        onClick={() => {
                            if (episode.localFile) {
                                updateLocalFile(episode.localFile, {
                                    locked: !episode.localFile?.locked,
                                })
                            }
                        }}
                    />}

                    <DropdownMenu
                        trigger={
                            <IconButton
                                icon={<BiDotsHorizontal />}
                                intent="gray-basic"
                                size="xs"
                            />
                        }
                    >
                        {!episode._isNakamaEpisode && <MetadataModalButton />}
                        {episode.localFile && <DropdownMenuItem
                            onClick={async () => {
                                if (!episode._isNakamaEpisode) {
                                    const endpoint = "/api/v1/mediastream/file?path=" + encodeFilePath(episode.localFile!.path)
                                    const tokenQuery = await getHMACTokenQueryParam("/api/v1/mediastream/file", "&")
                                    copyToClipboard(`${getServerBaseUrl()}${endpoint}${tokenQuery}`)
                                } else {
                                    const endpoint = "/api/v1/nakama/stream?type=file&path=" + Buffer.from(episode.localFile!.path).toString("base64")
                                    const tokenQuery = await getHMACTokenQueryParam("/api/v1/nakama/stream", "&")
                                    copyToClipboard(`${getServerBaseUrl()}${endpoint}${tokenQuery}`)
                                }
                                toast.info(t("Stream URL copied", "Stream-URL kopiert"))
                            }}
                        >
                            <MdOutlineOndemandVideo />
                            {t("Copy stream URL", "Stream-URL kopieren")}
                        </DropdownMenuItem>}

                        {!episode._isNakamaEpisode && <>
                            <PluginEpisodeGridItemMenuItems isDropdownMenu={false} type="library" episode={episode} />

                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="text-[--orange]"
                                onClick={() => {
                                    if (episode.localFile) {
                                        updateLocalFile(episode.localFile, {
                                            mediaId: 0,
                                            locked: false,
                                            ignored: false,
                                        })
                                    }
                                }}
                            >
                                <MdOutlineRemoveDone /> {t("Unmatch", "Zuordnung lösen")}
                            </DropdownMenuItem>
                        </>}
                    </DropdownMenu>

                    {(!!episode.episodeMetadata && (episode.type === "main" || episode.type === "special")) && !!episode.episodeMetadata?.anidbId &&
                        <EpisodeItemInfoModalButton episode={episode} />}
                </>}
            />
            <MetadataModal
                episode={episode}
            />
        </EpisodeItemIsolation.Provider>
    )

})

const localFileMetadataSchema = defineSchema(({ z }) => z.object({
    episode: z.number().min(0),
    aniDBEpisode: z.string().transform(value => value.toUpperCase()),
    type: z.string().min(0),
}))

function MetadataModal({ episode }: { episode: Anime_Episode }) {
    const t = useTr()
    const [isOpen, setIsOpen] = EpisodeItemIsolation.useAtom(__metadataModalIsOpenAtom)

    const { updateLocalFile, isPending } = useUpdateLocalFileData()

    function handleSave(data: z.infer<typeof localFileMetadataSchema>) {
        if (episode.localFile) {
            updateLocalFile(episode.localFile, {
                metadata: {
                    ...episode.localFile?.metadata,
                    type: data.type as Anime_LocalFileType,
                    episode: data.episode,
                    aniDBEpisode: data.aniDBEpisode,
                },
            }, () => {
                setIsOpen(false)
                toast.success(t("Metadata saved", "Metadaten gespeichert"))
            })
        }
    }

    return (
        <Modal
            open={isOpen}
            onOpenChange={() => setIsOpen(false)}

            title={episode.displayTitle}
            titleClass="text-center"
            contentClass="max-w-xl"
        >
            <p className="w-full line-clamp-2 text-sm px-4 text-center py-2 flex-none">{episode.localFile?.name}</p>
            <Form
                schema={localFileMetadataSchema}
                onSubmit={handleSave}
                onError={console.log}
                //@ts-ignore
                defaultValues={{ ...episode.fileMetadata }}
            >
                <Field.Number
                    label={t("Episode number", "Episodennummer")} name="episode"
                    help={t("Relative episode number. If movie, episode number = 1", "Relative Episodennummer. Bei einem Film ist sie 1.")}
                    required
                />
                <Field.Text
                    label={t("AniDB episode", "AniDB-Episode")}
                    name="aniDBEpisode"
                    help={t("Specials typically contain the letter S", "Specials enthalten meist den Buchstaben S")}
                />
                <Field.Select
                    label={t("Type", "Typ")}
                    name="type"
                    options={[
                        { label: t("Main", "Haupt"), value: "main" },
                        { label: "Special", value: "special" },
                        { label: t("NC/Other", "NC/Sonstiges"), value: "nc" },
                    ]}
                />
                <div className="w-full">
                    <Field.Submit role="save" intent="primary" className="w-full" loading={isPending}>{t("Save", "Speichern")}</Field.Submit>
                </div>
            </Form>
        </Modal>
    )
}

function MetadataModalButton() {
    const t = useTr()
    const [, setIsOpen] = EpisodeItemIsolation.useAtom(__metadataModalIsOpenAtom)
    return <DropdownMenuItem onClick={() => setIsOpen(true)}>
        <RiEdit2Line />
        {t("Update metadata", "Metadaten ändern")}
    </DropdownMenuItem>
}

export function EpisodeItemInfoModalButton({ episode }: { episode: Anime_Episode }) {
    const t = useTr()
    return <Modal
        title={episode.displayTitle}
        titleClass="text-xl"
        contentClass="max-w-2xl overflow-hidden"
        trigger={<IconButton
            icon={<MdInfo />}
            className="opacity-30 hover:opacity-100 transform-opacity"
            intent="gray-basic"
            size="xs"
        />}
    >

        {episode.episodeMetadata?.image && <div
            className="h-[8rem] w-full flex-none object-cover object-center overflow-hidden absolute left-0 top-0 z-[0] rounded-t-lg"
        >
            <SeaImage
                src={getImageUrl(episode.episodeMetadata?.image)}
                alt="banner"
                fill
                quality={80}
                sizes="20rem"
                className="object-cover object-center opacity-30"
            />
            <div
                className="z-[5] absolute bottom-0 w-full h-[80%] bg-gradient-to-t from-[--background] to-transparent"
            />
        </div>}

        <div className="space-y-4 z-[5] relative">
            <p className="text-lg line-clamp-2 font-semibold">
                {episode.episodeTitle?.replaceAll("`", "'")}
                {episode.isInvalid && <AiFillWarning />}
            </p>
            <p className="text-[--muted]">
                {episode.episodeMetadata?.airDate || t("Unknown airing date", "Sendedatum unbekannt")} - {episode.episodeMetadata?.length || "N/A"} {t("minutes", "Minuten")}
            </p>
            <p className="text-gray-300">
                {(episode.episodeMetadata?.summary || episode.episodeMetadata?.overview)?.replaceAll("`", "'")
                    ?.replace(/source:.*/gi, "") || t("No summary", "Keine Zusammenfassung")}
            </p>
            <Separator />
            <p className="text-[--muted] line-clamp-2 tracking-wide text-sm">
                {episode.localFile?.parsedInfo?.original}
            </p>
            {
                (!!episode.episodeMetadata?.anidbId) && <>
                    <div className="w-full flex gap-2">
                        <p>{t("AniDB Episode", "AniDB-Episode")}: {episode.fileMetadata?.aniDBEpisode}</p>
                        <a
                            href={"https://anidb.net/episode/" + episode.episodeMetadata?.anidbId + "#layout-footer"}
                            target="_blank"
                            className="hover:underline text-[--muted]"
                        >{t("Open on AniDB", "Auf AniDB öffnen")}
                        </a>
                    </div>
                </>
            }

        </div>

    </Modal>
}
