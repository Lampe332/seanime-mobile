import { Anime_Entry } from "@/api/generated/types"
import {
    useGetOnlinestreamMapping,
    useOnlinestreamManualMapping,
    useOnlinestreamManualSearch,
    useRemoveOnlinestreamMapping,
} from "@/api/hooks/onlinestream.hooks"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { SeaLink } from "@/components/shared/sea-link"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { useTr } from "@/lib/app-language"
import React from "react"
import { BiLinkExternal } from "react-icons/bi"
import { FiSearch } from "react-icons/fi"
import { LuChevronRight } from "react-icons/lu"

type OnlinestreamManualMappingModalProps = {
    entry: Anime_Entry
    provider: string
    children: React.ReactElement
}

export function OnlinestreamManualMappingModal(props: OnlinestreamManualMappingModalProps) {

    const {
        children,
        entry,
        provider,
        ...rest
    } = props

    const t = useTr()

    return (
        <Modal
            title={t("Manual match", "Manuell zuordnen")}
            description={t(`Pick the matching title on ${provider}.`, `Wähle den passenden Titel bei ${provider}.`)}
            trigger={children}
            contentClass="mobile-anime-dialog mobile-download-sheet mobile-match-sheet"
        >
            <MobileContent entry={entry} provider={provider} />
        </Modal>
    )
}

/** Android: current match, one search row with the anime's title filled in, and large result rows. */
function MobileContent({ entry, provider }: { entry: Anime_Entry, provider: string }) {
    const t = useTr()
    const { data: existingMapping, isLoading: mappingLoading } = useGetOnlinestreamMapping({ provider, mediaId: entry.mediaId })
    const { mutate: search, data: searchResults, isPending: searchLoading, isSuccess, isError, reset } = useOnlinestreamManualSearch(entry.mediaId, provider)
    // Providers answer "no results" with an error, so both end in the same hint.
    const searched = isSuccess || isError
    const { mutate: match, isPending: isMatching } = useOnlinestreamManualMapping()
    const { mutate: unmatch, isPending: isUnmatching } = useRemoveOnlinestreamMapping()
    // Provider searches match short titles best: start with the part before the subtitle.
    const [query, setQuery] = React.useState((entry.media?.title?.romaji || entry.media?.title?.userPreferred || "").split(/[:：]/)[0].trim())
    const [dubbed, setDubbed] = React.useState(false)
    const [animeId, setAnimeId] = React.useState<string | null>(null)
    const confirmMatch = useConfirmationDialog({
        title: t("Use this title?", "Diesen Titel verwenden?"),
        description: t("Episodes of this anime will be loaded from the selected title.", "Die Folgen dieses Anime werden vom gewählten Titel geladen."),
        actionText: t("Use title", "Titel verwenden"),
        actionIntent: "primary",
        onConfirm: () => {
            if (!animeId) return
            match({ provider, mediaId: entry.mediaId, animeId })
            reset()
            setAnimeId(null)
        },
    })

    return (
        <div className="mobile-match" data-mobile-manual-match>
            <div className="mobile-match-current" aria-live="polite">
                {mappingLoading ? <LoadingSpinner className="h-6 w-6" /> : existingMapping?.animeId ? <>
                    <div className="min-w-0">
                        <span>{t("Matched to", "Zugeordnet zu")}</span>
                        <strong>{existingMapping.animeId}</strong>
                    </div>
                    <button type="button" className="mobile-match-remove" disabled={isUnmatching} onClick={() => unmatch({ provider, mediaId: entry.mediaId })}>
                        {t("Remove", "Entfernen")}
                    </button>
                </> : <div><span>{t("Currently", "Aktuell")}</span><strong>{t("Automatic match", "Automatische Zuordnung")}</strong></div>}
            </div>

            <form className="mobile-match-search" role="search" onSubmit={e => {
                e.preventDefault()
                if (query.trim()) search({ provider, query: query.trim(), dubbed })
            }}>
                <FiSearch aria-hidden />
                <input value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search" aria-label={t("Title", "Titel")}
                    placeholder={t("Search title", "Titel suchen")} onKeyDown={e => e.stopPropagation()} />
                <button type="submit" disabled={!query.trim() || searchLoading || isMatching}>{t("Search", "Suchen")}</button>
            </form>

            <button type="button" role="switch" aria-checked={dubbed} className="mobile-match-switch" onClick={() => setDubbed(!dubbed)}>
                <span>{t("Search dubs", "Nach Synchro suchen")}<small>{t("Only if the provider lists dubs separately", "Nur wenn der Anbieter Synchro getrennt führt")}</small></span>
                <span className="mobile-match-toggle" aria-hidden />
            </button>

            {searchLoading ? <LoadingSpinner /> : searched && !searchResults?.length ? (
                <p className="mobile-match-empty">{t("No titles found. Try a shorter or English title.", "Keine Titel gefunden. Versuche einen kürzeren oder englischen Titel.")}</p>
            ) : !!searchResults?.length && (
                <ul className="mobile-match-results" aria-label={t("Search results", "Suchergebnisse")}>
                    {searchResults.map(item => <li key={item.id}>
                        <button type="button" onClick={() => {
                            setAnimeId(item.id)
                            React.startTransition(() => confirmMatch.open())
                        }}>
                            <span>{item.title}</span><LuChevronRight aria-hidden />
                        </button>
                        <SeaLink href={item.url} target="_blank" aria-label={t(`Open ${item.title} in browser`, `${item.title} im Browser öffnen`)}>
                            <BiLinkExternal aria-hidden />
                        </SeaLink>
                    </li>)}
                </ul>
            )}
            <ConfirmationDialog {...confirmMatch} />
        </div>
    )
}
