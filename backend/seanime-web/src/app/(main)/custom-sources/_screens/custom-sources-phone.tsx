import { useCustomSourceListAnime, useCustomSourceListManga } from "@/api/hooks/custom_source.hooks"
import { useListCustomSourceExtensions } from "@/api/hooks/extensions.hooks"
import {
    FORMAT_LABELS,
    PhoneCoverCard,
    PhoneEmpty,
    PhoneHeader,
    PhoneLoading,
    PhoneNotice,
    PhoneScreen,
    PhoneSearchField,
    PhoneSelect,
    PhoneTabs,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { __customSources_paramsAtom, __customSources_providerAtom } from "@/app/(main)/custom-sources/custom-sources.atom"
import { SeaLink } from "@/components/shared/sea-link"
import { useTr } from "@/lib/app-language"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { useAtom } from "jotai/react"
import React from "react"
import { LuChevronLeft, LuChevronRight } from "react-icons/lu"
import "./custom-sources-phone.css"

/**
 * Custom sources on Android phones: a source's anime or manga as the phone tabs' cover grid, a title search, the source
 * and the type as the screen's only controls, and pages as Previous / Next under the grid.
 */
export function CustomSourcesPhone() {
    const t = useTr()
    const router = useRouter()
    const providerParam = useSearchParams().get("provider")
    const serverStatus = useServerStatus()
    const { data: sources, isLoading: sourcesLoading } = useListCustomSourceExtensions()
    const [params, setParams] = useAtom(__customSources_paramsAtom)
    const [provider, setProvider] = useAtom(__customSources_providerAtom)
    const [search, setSearch] = React.useState(params.search)
    const source = sources?.find(s => s.id === provider)
    const anime = !!source?.settings?.supportsAnime
    const manga = !!source?.settings?.supportsManga
    const type = params.type === "anime" && !anime && manga ? "manga" : params.type === "manga" && !manga && anime ? "anime" : params.type
    const query = { provider: provider || "", search: params.search, page: params.page, perPage: 30 }
    const animeQuery = useCustomSourceListAnime(query, { enabled: !!source && type === "anime" && anime })
    const mangaQuery = useCustomSourceListManga(query, { enabled: !!source && type === "manga" && manga })
    const { data, isLoading, isError, refetch } = type === "anime" ? animeQuery : mangaQuery

    // The source from the link, else the one used last, else the first
    React.useEffect(() => {
        if (!sources?.length) return
        setProvider(current => sources.find(s => s.id === providerParam)?.id ?? sources.find(s => s.id === current)?.id ?? sources[0].id)
    }, [sources, providerParam])
    React.useEffect(() => setSearch(params.search), [params.search])

    const update = (change: Partial<typeof params>) => setParams(draft => {
        Object.assign(draft, { page: 1, ...change })
    })
    const media = (data?.media ?? []) as any[]
    const pages = Math.max(1, data?.totalPages ?? 1)
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const facts = source ? [source.name, data ? t(`${media.length} on this page`, `${media.length} auf dieser Seite`) : "", pages > 1 ? t(`page ${params.page} of ${pages}`, `Seite ${params.page} von ${pages}`) : ""]
        .filter(Boolean).join(" · ") : undefined

    return <PhoneScreen screen="custom-sources">
        <PhoneHeader title={t("Custom sources", "Eigene Quellen")} facts={facts} />
        {sourcesLoading ? <PhoneLoading label={t("Loading sources", "Quellen werden geladen")} layout={["tabs", "grid"]} />
            : !sources?.length ? <PhoneEmpty title={t("No custom sources", "Keine eigenen Quellen")} data-custom-sources-none
                    text={t("Custom sources are extensions that bring anime or manga from outside AniList. Add one under Extensions.",
                        "Eigene Quellen sind Erweiterungen, die Anime oder Manga von außerhalb AniList bringen. Füge eine unter Erweiterungen hinzu.")}>
                    <SeaLink href="/extensions" className="ps-primary">{t("Open extensions", "Erweiterungen öffnen")}</SeaLink>
                </PhoneEmpty>
                : <>
                    <div className="pcs-tools">
                        {sources.length > 1 && <PhoneSelect id="pcs-source" label={t("Source", "Quelle")} value={provider ?? ""} data-custom-sources-source
                            options={sources.map(s => ({ value: s.id, label: s.name }))} onChange={value => {
                                setProvider(value)
                                router.replace(`?provider=${encodeURIComponent(value)}`)
                                update({})
                            }} />}
                        {anime && manga && <PhoneTabs variant="segment" label={t("Type", "Art")} value={type} onChange={value => update({ type: value as "anime" | "manga" })}
                            tabs={[{ value: "anime", label: t("Anime", "Anime") }, { value: "manga", label: t("Manga", "Manga") }]} data-custom-sources-type />}
                        <PhoneSearchField t={t} value={search} onChange={setSearch} placeholder={t("Search titles", "Titel suchen")} onSubmit={() => update({ search })}
                            data-custom-sources-search />
                    </div>
                    {isLoading ? <PhoneLoading label={t("Loading titles", "Titel werden geladen")} layout={["grid"]} />
                        : isError ? <PhoneNotice text={t(`${source?.name ?? "The source"} did not answer.`, `${source?.name ?? "Die Quelle"} hat nicht geantwortet.`)} data-custom-sources-error>
                                <button type="button" className="ps-text-action" onClick={() => refetch()}>{t("Try again", "Nochmal versuchen")}</button>
                            </PhoneNotice>
                            : !media.length ? <PhoneEmpty title={params.search ? t("Nothing found", "Nichts gefunden") : t("Nothing here yet", "Hier ist noch nichts")}
                                    text={params.search ? t("Try another title.", "Versuch einen anderen Titel.") : undefined} data-custom-sources-empty />
                                : <>
                                    <div className="ps-grid" data-custom-sources-grid>
                                        {media.map((item, index) => <PhoneCoverCard key={`${item.id}-${index}`} media={item} type={type} blurAdult={blurAdult}
                                            meta={[item.format ? t(...(FORMAT_LABELS[item.format] ?? [item.format, item.format])) : "", item.startDate?.year].filter(Boolean).join(" · ")} />)}
                                    </div>
                                    {pages > 1 && <nav className="pcs-pages" aria-label={t("Pages", "Seiten")}>
                                        <button type="button" className="ps-secondary" disabled={params.page <= 1} onClick={() => update({ page: params.page - 1 })} data-custom-sources-prev>
                                            <LuChevronLeft aria-hidden />{t("Previous", "Zurück")}</button>
                                        <span>{params.page} / {pages}</span>
                                        <button type="button" className="ps-secondary" disabled={params.page >= pages} onClick={() => update({ page: params.page + 1 })} data-custom-sources-next>
                                            {t("Next", "Weiter")}<LuChevronRight aria-hidden /></button>
                                    </nav>}
                                </>}
                </>}
    </PhoneScreen>
}
