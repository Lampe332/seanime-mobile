import { AL_BaseAnime, AL_BaseManga, AL_MediaListStatus, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import { useDeleteAnilistListEntry, useEditAnilistListEntry } from "@/api/hooks/anilist.hooks"
import { useUpdateAnimeEntryRepeat } from "@/api/hooks/anime_entries.hooks"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { useCurrentUser } from "@/app/(main)/_hooks/use-server-status"
import { SeaImage } from "@/components/shared/sea-image"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Disclosure, DisclosureContent, DisclosureItem, DisclosureTrigger } from "@/components/ui/disclosure"
import { defineSchema, Field, Form } from "@/components/ui/form"
import { Modal, ModalProps } from "@/components/ui/modal"
import { NumberInput } from "@/components/ui/number-input"
import { Tooltip } from "@/components/ui/tooltip"
import { normalizeDate } from "@/lib/helpers/date"
import { getImageUrl } from "@/lib/server/assets"
import { useTr } from "@/lib/app-language"
import { TabletLabel } from "@/lib/tablet-ui"
import React from "react"
import { useController, useFormContext } from "react-hook-form"
import { BiListPlus, BiPlus, BiStar, BiTrash } from "react-icons/bi"
import { LuMinus, LuPlus } from "react-icons/lu"
import { TbEdit } from "react-icons/tb"
import { useToggle } from "react-use"
import { z } from "zod"

type AnilistMediaEntryModalProps = {
    mobileEntry?: boolean
    children?: React.ReactNode
    listData?: Anime_EntryListData | Manga_EntryListData
    media?: AL_BaseAnime | AL_BaseManga
    hideButton?: boolean
    type?: "anime" | "manga"
}

const mediaListDataSchema = defineSchema(({ z, presets }) => z.object({
    status: z.custom<AL_MediaListStatus>().nullish(),
    score: z.number().min(0).max(100).nullish(),
    progress: z.number().min(0).nullish(),
    startedAt: presets.datePicker.nullish(),
    completedAt: presets.datePicker.nullish(),
}))

const entryDefaultValues = (listData?: Anime_EntryListData | Manga_EntryListData) => ({
    status: listData?.status,
    score: listData?.score ? listData?.score / 10 : undefined, // Returned score is 0-100
    progress: listData?.progress,
    startedAt: listData?.startedAt ? (normalizeDate(listData?.startedAt)) : undefined,
    completedAt: listData?.completedAt ? (normalizeDate(listData?.completedAt)) : undefined,
})

const progressMaxFor = (media: AL_BaseAnime | AL_BaseManga | undefined, type: "anime" | "manga") => type === "anime"
    ? (!!(media as AL_BaseAnime)?.nextAiringEpisode?.episode
        ? (media as AL_BaseAnime)?.nextAiringEpisode?.episode! - 1
        : ((media as AL_BaseAnime)?.episodes ? (media as AL_BaseAnime).episodes : undefined))
    : (media as AL_BaseManga)?.chapters

function EntryDialog(props: ModalProps & { media?: AL_BaseAnime | AL_BaseManga }) {
    const { title, children, media, ...rest } = props

    return <Modal
        {...rest}
        title={title}
        titleClass="text-xl"
        contentClass={props.contentClass || "max-w-3xl overflow-hidden"}
    >
        {media?.bannerImage && <div
            data-anilist-media-entry-modal-banner-image-container
            className="h-24 w-full flex-none object-cover object-center overflow-hidden absolute left-0 top-0 z-[0]"
        >
            <SeaImage
                data-anilist-media-entry-modal-banner-image
                src={getImageUrl(media?.bannerImage!)}
                alt="banner"
                fill
                quality={80}
                sizes="20rem"
                className="object-cover object-center opacity-5 z-[1]"
            />
            <div
                data-anilist-media-entry-modal-banner-image-bottom-gradient
                className="z-[5] absolute bottom-0 w-full h-[60%] bg-gradient-to-t from-[--background] to-transparent"
            />
        </div>}
        {children}
    </Modal>
}

export const AnilistMediaEntryModal = (props: AnilistMediaEntryModalProps) => {
    const [open, toggle] = useToggle(false)
    const [repeat, setRepeat] = React.useState<number | "">(0)

    const { children, media, listData, hideButton, type = "anime", mobileEntry, ...rest } = props

    const user = useCurrentUser()
    const tr = useTr()

    const { mutate, isPending: isEditing, isSuccess, reset } = useEditAnilistListEntry(media?.id, type)
    const { mutate: mutateRepeat, isPending: _isPending2 } = useUpdateAnimeEntryRepeat(media?.id)
    const { mutate: deleteEntry, isPending: isDeleting } = useDeleteAnilistListEntry(media?.id, type, () => {
        toggle(false)
    })

    React.useEffect(() => {
        setRepeat(listData?.repeat || 0)
    }, [listData])

    const handleSubmit = React.useCallback((data: z.infer<typeof mediaListDataSchema>) => {
        const normalizedRepeat = repeat === "" ? 0 : repeat
        if (normalizedRepeat !== (listData?.repeat ?? 0)) {
            mutateRepeat({
                mediaId: media?.id || 0,
                repeat: normalizedRepeat,
            })
        }
        mutate({
            mediaId: media?.id || 0,
            status: data.status || "PLANNING",
            score: data.score ? data.score * 10 : 0, // should be 0-100
            progress: data.progress || 0,
            startedAt: data.startedAt ? {
                // @ts-ignore
                day: data.startedAt.getDate(),
                month: data.startedAt.getMonth() + 1,
                year: data.startedAt.getFullYear(),
            } : undefined,
            completedAt: data.completedAt ? {
                // @ts-ignore
                day: data.completedAt.getDate(),
                month: data.completedAt.getMonth() + 1,
                year: data.completedAt.getFullYear(),
            } : undefined,
            type: type,
        })
    }, [repeat, listData?.repeat, media?.id, type, mutate, mutateRepeat])

    if (!user) return null

    return (
        <>
            {!hideButton && <>
                {(!listData) && <Tooltip
                    trigger={<IconButton
                        data-anilist-media-entry-modal-add-button
                        intent="gray-subtle"
                        icon={<BiPlus />}
                        rounded
                        size="sm"
                        loading={isEditing || isDeleting}
                        className={cn({ "hidden": isSuccess })} // Hide button when mutation is successful
                        onClick={() => mutate({
                            mediaId: media?.id || 0,
                            status: "PLANNING",
                            score: 0,
                            progress: 0,
                            startedAt: undefined,
                            completedAt: undefined,
                            type: type,
                        })}
                    />}
                >
                    Add to list
                </Tooltip>}
            </>}

            {!!listData && <EntryDialog
                contentClass={mobileEntry ? "mobile-anime-dialog mobile-anilist-sheet" : undefined}
                open={open}
                onOpenChange={o => toggle(o)}
                title={mobileEntry ? <MobileEntryTitle media={media} /> : (media?.title?.userPreferred ?? undefined)}
                trigger={<span>
                    {!hideButton && <>
                        {!!listData && <IconButton
                            data-anilist-media-entry-modal-edit-button
                            aria-label={tr("Edit list, progress and rating", "Liste, Fortschritt und Wertung bearbeiten")}
                            intent="white-subtle"
                            icon={mobileEntry ? <><TbEdit /><TabletLabel>{tr("Edit", "Bearbeiten")}</TabletLabel></> : <TbEdit />}
                            rounded
                            size="sm"
                            loading={isEditing || isDeleting}
                            onClick={toggle}
                        />}
                    </>}
                </span>}
                media={media}
            >

                {open && mobileEntry && <MobileContent
                    media={media}
                    listData={listData}
                    type={type}
                    repeat={repeat}
                    setRepeat={setRepeat}
                    handleSubmit={handleSubmit}
                    deleteEntry={deleteEntry}
                    isEditing={isEditing}
                    isDeleting={isDeleting}
                />}
                {open && !mobileEntry && <Content
                    open={open}
                    onToggle={toggle}
                    repeat={repeat}
                    setRepeat={setRepeat}
                    handleSubmit={handleSubmit}
                    deleteEntry={deleteEntry}
                    isEditing={isEditing}
                    isDeleting={isDeleting}
                    {...props}
                />}

            </EntryDialog>}
        </>
    )

}

function Content(props: AnilistMediaEntryModalProps & {
    open: boolean
    onToggle: (open: boolean) => void
    repeat: number | ""
    setRepeat: (repeat: number | "") => void
    handleSubmit: (data: z.infer<typeof mediaListDataSchema>) => void
    deleteEntry: any
    isEditing: boolean
    isDeleting: boolean
}) {
    const {
        children,
        media,
        listData,
        hideButton,
        type = "anime",
        open,
        onToggle,
        repeat,
        setRepeat,
        handleSubmit,
        deleteEntry,
        isEditing,
        isDeleting,
        ...rest
    } = props

    return (
        <>
            {(!!listData) && <Form
                data-anilist-media-entry-modal-form
                schema={mediaListDataSchema}
                onSubmit={handleSubmit}
                className={cn(
                )}
                onError={console.log}
                defaultValues={entryDefaultValues(listData)}
            >
                <div className="flex flex-col sm:flex-row gap-4">
                    <StatusField media={media} type={type} />
                    {media?.status !== "NOT_YET_RELEASED" && <>
                        <Field.Number
                            label="Score"
                            name="score"
                            min={0}
                            max={10}
                            formatOptions={{
                                maximumFractionDigits: 1,
                                minimumFractionDigits: 0,
                                useGrouping: false,
                            }}
                            rightIcon={<BiStar />}
                        />
                        <Field.Number
                            label="Progress"
                            name="progress"
                            min={0}
                            max={progressMaxFor(media, type)}
                            formatOptions={{
                                maximumFractionDigits: 0,
                                minimumFractionDigits: 0,
                                useGrouping: false,
                            }}
                            rightIcon={<BiListPlus />}
                        />
                    </>}
                </div>
                {media?.status !== "NOT_YET_RELEASED" && <div className="flex flex-col sm:flex-row gap-4">
                    <Field.DatePicker
                        label="Start date"
                        name="startedAt"
                        // defaultValue={(state.startedAt && state.startedAt.year) ? parseAbsoluteToLocal(new Date(state.startedAt.year,
                        // (state.startedAt.month || 1)-1, state.startedAt.day || 1).toISOString()) : undefined}
                    />
                    <Field.DatePicker
                        label="Completion date"
                        name="completedAt"
                        // defaultValue={(state.completedAt && state.completedAt.year) ? parseAbsoluteToLocal(new Date(state.completedAt.year,
                        // (state.completedAt.month || 1)-1, state.completedAt.day || 1).toISOString()) : undefined}
                    />

                    <NumberInput
                        name="repeat"
                        label={type === "anime" ? "Total rewatches" : "Total rereads"}
                        min={0}
                        max={1000}
                        value={repeat}
                        onValueChange={(value, valueAsString) => setRepeat(valueAsString === "" ? "" : value)}
                        formatOptions={{
                            maximumFractionDigits: 0,
                            minimumFractionDigits: 0,
                            useGrouping: false,
                        }}
                    />
                </div>}

                <div className="flex w-full items-center justify-between mt-4">
                    <div>
                        <Disclosure type="multiple" defaultValue={["item-2"]}>
                            <DisclosureItem value="item-1" className="flex items-center gap-1">
                                <DisclosureTrigger>
                                    <IconButton
                                        intent="alert-subtle"
                                        icon={<BiTrash />}
                                        rounded
                                        size="md"
                                    />
                                </DisclosureTrigger>
                                <DisclosureContent>
                                    <Button
                                        intent="alert-basic"
                                        rounded
                                        size="md"
                                        loading={isDeleting}
                                        onClick={() => deleteEntry({
                                            mediaId: media?.id!,
                                            type: type,
                                        })}
                                    >Confirm</Button>
                                </DisclosureContent>
                            </DisclosureItem>
                        </Disclosure>
                    </div>

                    <Field.Submit role="save" disableIfInvalid={true} loading={isEditing} disabled={isDeleting}>
                        Save
                    </Field.Submit>
                </div>

                <PluginWebviewSlot slot="after-media-entry-form" />
            </Form>}
        </>
    )
}

function StatusField({ media, type }: {
    media?: AL_BaseAnime | AL_BaseManga
    type: "anime" | "manga"
}) {
    const { setValue } = useFormContext<z.infer<typeof mediaListDataSchema>>()

    const handleChange = (status: AL_MediaListStatus) => {
        setValue("status", status, { shouldDirty: true })

        const episodes = (media as AL_BaseAnime)?.episodes
        if (type === "anime" && status === "COMPLETED" && episodes) {
            setValue("progress", episodes, { shouldDirty: true })
        }
    }

    return <Field.Select
        label="Status"
        name="status"
        onChange={handleChange}
        options={[
            media?.status !== "NOT_YET_RELEASED" ? {
                value: "CURRENT",
                label: type === "anime" ? "Watching" : "Reading",
            } : undefined,
            { value: "PLANNING", label: "Planning" },
            media?.status !== "NOT_YET_RELEASED" ? {
                value: "PAUSED",
                label: "Paused",
            } : undefined,
            media?.status !== "NOT_YET_RELEASED" ? {
                value: "COMPLETED",
                label: "Completed",
            } : undefined,
            media?.status !== "NOT_YET_RELEASED" ? {
                value: "DROPPED",
                label: "Dropped",
            } : undefined,
            media?.status !== "NOT_YET_RELEASED" ? {
                value: "REPEATING",
                label: "Repeating",
            } : undefined,
        ].filter(Boolean)}
    />
}

/* -------------------------------------------------------------------------------------------------
 * Android: compact sheet with the same form, schema, defaults and submit handler as the desktop form.
 * -----------------------------------------------------------------------------------------------*/

function MobileEntryTitle({ media }: { media?: AL_BaseAnime | AL_BaseManga }) {
    const cover = media?.coverImage?.medium || media?.coverImage?.large
    return <span className="mobile-anilist-head">
        {cover && <img loading="lazy" decoding="async" src={getImageUrl(cover)} alt="" className="mobile-anilist-cover" />}
        <span className="mobile-anilist-name">
            <span className="mobile-anilist-title">{media?.title?.userPreferred}</span>
            <span className="mobile-anilist-sub">AniList</span>
        </span>
    </span>
}

function MobileContent(props: {
    media?: AL_BaseAnime | AL_BaseManga
    listData?: Anime_EntryListData | Manga_EntryListData
    type: "anime" | "manga"
    repeat: number | ""
    setRepeat: (repeat: number | "") => void
    handleSubmit: (data: z.infer<typeof mediaListDataSchema>) => void
    deleteEntry: any
    isEditing: boolean
    isDeleting: boolean
}) {
    const { media, listData, type, repeat, setRepeat, handleSubmit, deleteEntry, isEditing, isDeleting } = props
    const t = useTr()
    const released = media?.status !== "NOT_YET_RELEASED"
    const max = progressMaxFor(media, type)
    const total = type === "anime" ? (media as AL_BaseAnime)?.episodes : (media as AL_BaseManga)?.chapters
    if (!listData) return null
    return <Form
        data-anilist-media-entry-modal-form
        schema={mediaListDataSchema}
        onSubmit={handleSubmit}
        onError={console.log}
        defaultValues={entryDefaultValues(listData)}
        className="mobile-anilist-form"
    >
        <MobileStatusChips media={media} type={type} />
        {released && <>
            <div className="mobile-anilist-pair">
                <MobileFormStepper name="progress" label={t("Progress", "Fortschritt")} max={max ?? undefined} suffix={total ? `/ ${total}` : undefined} />
                <MobileFormStepper name="score" label={t("Score", "Bewertung")} max={10} decimals suffix="/ 10" />
            </div>
            <div className="mobile-anilist-pair mobile-anilist-dates">
                <Field.DatePicker label={t("Start date", "Startdatum")} name="startedAt" />
                <Field.DatePicker label={t("Completion date", "Enddatum")} name="completedAt" />
            </div>
            <div className="mobile-anilist-repeat">
                <span id="mobile-anilist-repeat-label">{type === "anime" ? t("Total rewatches", "Wiederholungen") : t("Total rereads", "Erneut gelesen")}</span>
                <Stepper labelId="mobile-anilist-repeat-label" name="repeat" value={repeat === "" ? null : repeat} max={1000} onValue={value => setRepeat(value ?? "")} />
            </div>
        </>}
        <div className="mobile-anilist-actions">
            <Disclosure type="multiple" defaultValue={["item-2"]}>
                <DisclosureItem value="item-1" className="mobile-anilist-delete">
                    <DisclosureTrigger>
                        <IconButton intent="alert-subtle" icon={<BiTrash />} rounded size="md" aria-label={t("Remove from list", "Aus Liste entfernen")} data-anilist-delete />
                    </DisclosureTrigger>
                    <DisclosureContent>
                        <Button intent="alert-basic" rounded size="md" loading={isDeleting} data-anilist-delete-confirm
                            onClick={() => deleteEntry({ mediaId: media?.id!, type: type })}>{t("Confirm", "Bestätigen")}</Button>
                    </DisclosureContent>
                </DisclosureItem>
            </Disclosure>
            <Field.Submit role="save" disableIfInvalid={true} loading={isEditing} disabled={isDeleting}>
                {t("Save", "Speichern")}
            </Field.Submit>
        </div>
        <PluginWebviewSlot slot="after-media-entry-form" />
    </Form>
}

function MobileStatusChips({ media, type }: { media?: AL_BaseAnime | AL_BaseManga, type: "anime" | "manga" }) {
    const t = useTr()
    const { setValue } = useFormContext<z.infer<typeof mediaListDataSchema>>()
    const { field } = useController<z.infer<typeof mediaListDataSchema>, "status">({ name: "status" })
    const released = media?.status !== "NOT_YET_RELEASED"
    const options = ([
        { value: "CURRENT", label: type === "anime" ? t("Watching", "Schaue ich") : t("Reading", "Lese ich") },
        { value: "COMPLETED", label: t("Completed", "Fertig") },
        { value: "PLANNING", label: t("Planning", "Geplant") },
        { value: "PAUSED", label: t("Paused", "Pausiert") },
        { value: "DROPPED", label: t("Dropped", "Abgebrochen") },
        { value: "REPEATING", label: type === "anime" ? t("Rewatching", "Schaue erneut") : t("Rereading", "Lese erneut") },
    ] as { value: AL_MediaListStatus, label: string }[]).filter(option => released || option.value === "PLANNING")
    // Same side effect as the desktop status select: completing an anime fills its progress.
    const choose = (status: AL_MediaListStatus) => {
        setValue("status", status, { shouldDirty: true })
        const episodes = (media as AL_BaseAnime)?.episodes
        if (type === "anime" && status === "COMPLETED" && episodes) setValue("progress", episodes, { shouldDirty: true })
    }
    return <div className="mobile-anilist-status" role="radiogroup" aria-label={t("Status", "Status")}>
        {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={field.value === option.value}
            data-status={option.value} onClick={() => choose(option.value)}>{option.label}</button>)}
    </div>
}

function MobileFormStepper({ name, label, max, decimals, suffix }: { name: "progress" | "score", label: string, max?: number, decimals?: boolean, suffix?: string }) {
    const { field } = useController<z.infer<typeof mediaListDataSchema>, typeof name>({ name })
    const id = `mobile-anilist-${name}-label`
    return <div className="mobile-anilist-field">
        <span id={id}>{label}</span>
        <Stepper labelId={id} name={name} value={typeof field.value === "number" ? field.value : null} max={max} decimals={decimals} suffix={suffix}
            onValue={value => field.onChange(value)} />
    </div>
}

function Stepper({ value, onValue, min = 0, max, decimals, suffix, labelId, name }: {
    value: number | null, onValue: (value: number | null) => void, min?: number, max?: number, decimals?: boolean, suffix?: string, labelId: string, name: string
}) {
    const t = useTr()
    const clamp = (n: number) => {
        const rounded = decimals ? Math.round(n * 10) / 10 : Math.round(n)
        return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, rounded))
    }
    const [draft, setDraft] = React.useState(value === null ? "" : String(value))
    React.useEffect(() => setDraft(value === null ? "" : String(value)), [value])
    const commit = (text: string) => {
        setDraft(text)
        if (text.trim() === "") return onValue(null)
        const parsed = Number(text.replace(",", "."))
        if (Number.isFinite(parsed)) onValue(clamp(parsed))
    }
    const current = value ?? min
    return <div className="mobile-anilist-stepper" data-stepper={name}>
        <button type="button" aria-label={t("Decrease", "Verringern")} disabled={value === null || current <= min} onClick={() => onValue(clamp(Math.ceil(current) - 1))}><LuMinus /></button>
        <span className="mobile-anilist-value">
            <input aria-labelledby={labelId} inputMode={decimals ? "decimal" : "numeric"} value={draft} placeholder="–"
                onChange={event => commit(event.target.value)} onBlur={() => setDraft(value === null ? "" : String(value))} />
            {suffix && <span aria-hidden>{suffix}</span>}
        </span>
        <button type="button" aria-label={t("Increase", "Erhöhen")} disabled={max !== undefined && current >= max} onClick={() => onValue(clamp(value === null ? min + 1 : Math.floor(current) + 1))}><LuPlus /></button>
    </div>
}
