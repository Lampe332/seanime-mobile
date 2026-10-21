import { Extension_Extension } from "@/api/generated/types"
import { useGetMarketplaceExtensions, useInstallExternalExtension } from "@/api/hooks/extensions.hooks"
import {
    extensionMeta,
    filterMarketplace,
    isPhoneExtension,
    PHONE_EXTENSION_TYPES,
    shortRepositoryUrl,
} from "@/app/(main)/extensions/_lib/extensions-phone"
import { DEFAULT_MARKETPLACE_URL, marketplaceUrlAtom } from "@/app/(main)/extensions/_lib/marketplace.atoms"
import { ExtensionIcon, focusSheet, MarketplaceSheet, SearchField, Spinner, UrlField } from "@/app/(main)/extensions/_screens/extensions-phone-sheets"
import { LANGUAGES_LIST } from "@/app/(main)/manga/_lib/language-map"
import { Modal } from "@/components/ui/modal"
import { Translate } from "@/lib/app-language"
import { useSearchParams } from "@/lib/navigation"
import { useAtom } from "jotai/react"
import React from "react"
import { LuCheck, LuChevronDown, LuDownload, LuRotateCw } from "react-icons/lu"
import { toast } from "sonner"

const ALL_TYPES = { type: "all", tabName: "All Types", chipEn: "All", chipDe: "Alle" }

function isWebUrl(value: string) {
    try {
        return ["http:", "https:"].includes(new URL(value.trim()).protocol)
    } catch {
        return false
    }
}

/**
 * Phone marketplace: the repository with its change action, type chips with counts, search and content language,
 * then the extensions as rows with one install button each. Tutorial selectors stay on the same controls as on desktop.
 */
export function MarketplacePhone({ t, installedIds }: { t: Translate, installedIds: Set<string> }) {
    const [url, setUrl] = useAtom(marketplaceUrlAtom)
    const { data, isPending, isError, isFetching, refetch } = useGetMarketplaceExtensions(url)
    const [type, setType] = React.useState("all")
    const [language, setLanguage] = React.useState("all")
    const [search, setSearch] = React.useState("")
    const [repoOpen, setRepoOpen] = React.useState(false)
    const [repoDraft, setRepoDraft] = React.useState("")
    const [selected, setSelected] = React.useState<Extension_Extension | null>(null)
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const changeRef = React.useRef<HTMLButtonElement>(null)
    const isDefault = url === DEFAULT_MARKETPLACE_URL

    const searchParams = useSearchParams()
    React.useEffect(() => {
        const value = searchParams.get("type")
        if (value) setType(value)
    }, [searchParams])

    const usable = React.useMemo(() => (data ?? []).filter(isPhoneExtension), [data])
    const languages = React.useMemo(() => [...new Set(usable.map(extension => extension.lang?.toLowerCase()).filter(Boolean) as string[])].sort(), [usable])
    // Chip counts follow the language and the search, so a chip never promises what its list won't show.
    const narrowed = React.useMemo(() => filterMarketplace(usable, { type: "all", language, search }), [usable, language, search])
    const shown = React.useMemo(() => type === "all" ? narrowed : narrowed.filter(extension => extension.type === type), [narrowed, type])
    const groups = PHONE_EXTENSION_TYPES.map(item => ({ ...item, items: shown.filter(extension => extension.type === item.type) })).filter(group => group.items.length > 0)
    const missing = isDefault && !!data ? PHONE_EXTENSION_TYPES.filter(item => item.type === "onlinestream-provider" || item.type === "manga-provider")
        .filter(item => !usable.some(extension => extension.type === item.type)) : []
    const filtered = type !== "all" || language !== "all" || !!search.trim()

    const openRepository = (draft: string) => {
        setRepoDraft(draft)
        setRepoOpen(true)
    }
    const saveRepository = (next: string) => {
        setUrl(next)
        setRepoOpen(false)
        toast.success(next === DEFAULT_MARKETPLACE_URL ? t("Using the official repository", "Offizielles Repository wird genutzt") : t("Repository saved", "Repository gespeichert"))
    }
    const resetFilters = () => {
        setType("all")
        setLanguage("all")
        setSearch("")
    }
    const openSheet = (extension: Extension_Extension) => {
        setSelected(extension)
        setSheetOpen(true)
    }

    return <div className="mex-market" data-marketplace-phone>
        <section className="mex-source" aria-label={t("Repository", "Repository")}>
            <div className="mex-source-text">
                <span>{t("Repository", "Repository")}</span>
                <strong data-marketplace-source>{isDefault ? t("Official repository", "Offizielles Repository") : shortRepositoryUrl(url)}</strong>
                {!!data && <small>{usable.length === 1 ? t("1 extension", "1 Erweiterung") : t(`${usable.length} extensions`, `${usable.length} Erweiterungen`)}</small>}
            </div>
            <button type="button" className="mex-icon-button" onClick={() => void refetch()} disabled={isFetching} aria-busy={isFetching || undefined}
                aria-label={t("Reload repository", "Repository neu laden")} data-marketplace-reload>
                <LuRotateCw className={isFetching ? "mex-spin" : undefined} aria-hidden />
            </button>
            <button ref={changeRef} type="button" className="mex-text-action" data-tour="marketplace-change-repo" onClick={() => openRepository(url)}>
                {t("Change", "Ändern")}
            </button>
        </section>

        {missing.length > 0 && <div className="mex-block" data-marketplace-missing>
            <h3>{missing.length > 1 ? t("No streaming or manga sources here", "Hier gibt es keine Streaming- oder Manga-Quellen")
                : missing[0].type === "manga-provider" ? t("No manga sources here", "Hier gibt es keine Manga-Quellen")
                    : t("No streaming sources here", "Hier gibt es keine Streaming-Quellen")}</h3>
            <p>{t("The official repository no longer lists content sources. Find a community repository online and add its link.",
                "Das offizielle Repository listet keine Inhaltsquellen mehr. Such online nach einem Community-Repository und füge seinen Link hinzu.")}</p>
            <div className="mex-block-actions">
                <button type="button" className="mex-primary" onClick={() => openRepository("")}>{t("Add repository", "Repository hinzufügen")}</button>
            </div>
        </div>}

        {usable.length > 0 && <div className="mex-filters">
            <div className="mex-chips" role="tablist" aria-label={t("Type", "Art")} data-marketplace-type-tabs>
                {[ALL_TYPES, ...PHONE_EXTENSION_TYPES].map(item => {
                    const count = item.type === "all" ? narrowed.length : narrowed.filter(extension => extension.type === item.type).length
                    return <button key={item.type} type="button" role="tab" aria-selected={type === item.type} aria-controls="mex-market-list"
                        data-tab-name={item.tabName} data-marketplace-type={item.type} onClick={() => setType(item.type)}>
                        {t(item.chipEn, item.chipDe)}<span>{count}</span>
                    </button>
                })}
            </div>
            <div className="mex-filter-row">
                <SearchField t={t} value={search} onChange={setSearch} placeholder={t("Search", "Suchen")} label={t("Search the marketplace", "Marktplatz durchsuchen")}
                    data-marketplace-search="" />
                {languages.length > 1 && <span className="mex-select-wrap">
                    <select className="mex-select" value={language} onChange={event => setLanguage(event.target.value)} aria-label={t("Content language", "Sprache der Inhalte")}
                        data-marketplace-language>
                        <option value="all">{t("All languages", "Alle Sprachen")}</option>
                        {languages.map(code => <option key={code} value={code}>{code === "multi" ? t("Multiple languages", "Mehrere Sprachen")
                            : LANGUAGES_LIST[code]?.nativeName || code.toUpperCase()}</option>)}
                    </select>
                    <LuChevronDown aria-hidden />
                </span>}
            </div>
        </div>}

        <div id="mex-market-list" role="tabpanel" className="mex-market-list">
            {isError && !data ? <div className="mex-notice" role="alert" data-marketplace-error>
                    <p>{typeof navigator !== "undefined" && navigator.onLine === false
                        ? t("No internet connection, so the repository could not be loaded.", "Keine Internetverbindung, deshalb konnte das Repository nicht geladen werden.")
                        : t("The repository could not be loaded.", "Das Repository konnte nicht geladen werden.")}</p>
                    <div className="mex-notice-actions">
                        <button type="button" className="mex-text-action" onClick={() => void refetch()}>{t("Try again", "Erneut versuchen")}</button>
                        <button type="button" className="mex-text-action" onClick={() => openRepository(url)}>{t("Change repository", "Repository ändern")}</button>
                    </div>
                </div>
                : isPending ? <div className="mex-loading" aria-busy="true" role="status" aria-label={t("Loading the marketplace", "Marktplatz wird geladen")}>
                        {Array.from({ length: 5 }, (_, i) => <span key={i} className="mex-bone mex-bone-row" />)}
                    </div>
                    : usable.length === 0 ? <div className="mex-empty" data-marketplace-empty>
                            <p>{t("No extensions in this repository", "Keine Erweiterungen in diesem Repository")}</p>
                            <p>{t("It has nothing the phone app can use. Try another repository.", "Es enthält nichts, was die Handy-App nutzen kann. Versuch ein anderes Repository.")}</p>
                            <button type="button" className="mex-secondary" onClick={() => openRepository(url)}>{t("Change repository", "Repository ändern")}</button>
                        </div>
                        : groups.length === 0 ? <div className="mex-empty" data-marketplace-filter-empty>
                                <p>{t("No extensions match", "Keine Erweiterung passt")}</p>
                                <p>{t("Try another type, language or search.", "Versuch eine andere Art, Sprache oder Suche.")}</p>
                                {filtered && <button type="button" className="mex-secondary" onClick={resetFilters}>{t("Reset filters", "Filter zurücksetzen")}</button>}
                            </div>
                            : groups.map(group => <section key={group.type} className="mex-section" aria-labelledby={`mex-market-${group.type}`} data-marketplace-group={group.type}>
                                <div className="mex-section-head">
                                    <h2 id={`mex-market-${group.type}`}>{t(group.en, group.de)}</h2>
                                    <span>{group.items.length}</span>
                                </div>
                                {group.type === "custom-source" && <p className="mex-section-note">{t("Custom sources let you browse media beyond AniList. They don't stream; that needs a streaming source.",
                                    "Eigene Quellen zeigen Titel über AniList hinaus. Sie streamen nicht, dafür braucht es eine Streaming-Quelle.")}</p>}
                                <ul className="mex-list">
                                    {group.items.map(extension => <MarketRow key={extension.id} t={t} extension={extension} installed={installedIds.has(extension.id)} onOpen={openSheet} />)}
                                </ul>
                            </section>)}
        </div>

        <RepositorySheet t={t} open={repoOpen} onOpenChange={setRepoOpen} draft={repoDraft} onDraft={setRepoDraft} isDefault={isDefault}
            returnFocusRef={changeRef} onSave={saveRepository} />
        {!!selected && <MarketplaceSheet t={t} open={sheetOpen} onOpenChange={setSheetOpen} extension={selected} installed={installedIds.has(selected.id)}
            onCloseFocus={() => document.querySelector<HTMLElement>(`[data-marketplace-row="${CSS.escape(selected.id)}"] .mex-row-main`)?.focus()} />}
    </div>
}

function MarketRow({ t, extension, installed, onOpen }: { t: Translate, extension: Extension_Extension, installed: boolean, onOpen: (extension: Extension_Extension) => void }) {
    const { mutate: install, isPending } = useInstallExternalExtension()
    // The list only learns about the install from the server's reload event; until then the row keeps the result.
    const [justInstalled, setJustInstalled] = React.useState(false)
    const name = extension.name || extension.id
    return <li className="mex-item" data-marketplace-row={extension.id}>
        <button type="button" className="mex-row-main" onClick={() => onOpen(extension)}>
            <ExtensionIcon extension={extension} />
            <span className="mex-row-text">
                <span className="mex-row-name">{name}</span>
                {!!extension.description && <span className="mex-row-desc" data-lines="2">{extension.description}</span>}
                <span className="mex-row-meta">{extensionMeta(extension, t)}</span>
            </span>
        </button>
        {installed || justInstalled ? <span className="mex-install" data-installed role="img" aria-label={t(`${name} is installed`, `${name} ist installiert`)}>
                <LuCheck aria-hidden />
            </span>
            : <button type="button" className="mex-install" data-tour-install={extension.type} disabled={isPending} aria-label={t(`Install ${name}`, `${name} installieren`)}
                onClick={() => install({ manifestUri: extension.manifestURI }, {
                    onSuccess: response => {
                        setJustInstalled(true)
                        toast.success(response?.message || t("Installed", "Installiert"))
                    },
                })}>
                {isPending ? <Spinner /> : <LuDownload aria-hidden />}
            </button>}
    </li>
}

function RepositorySheet(props: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    draft: string
    onDraft: (value: string) => void
    isDefault: boolean
    returnFocusRef: React.RefObject<HTMLButtonElement | null>
    onSave: (url: string) => void
}) {
    const { t, draft } = props
    const valid = isWebUrl(draft)
    const save = () => { if (valid) props.onSave(draft.trim()) }
    return <Modal open={props.open} onOpenChange={props.onOpenChange} title={t("Repository", "Repository")} contentClass="mex-sheet"
        onOpenAutoFocus={focusSheet} onCloseAutoFocus={event => { event.preventDefault(); props.returnFocusRef.current?.focus() }}>
        <div className="mex-sheet-body" data-marketplace-repo-sheet>
            <p className="mex-sheet-note">{t("Paste the link to a repository's .json file. Its extensions then appear in the marketplace.",
                "Füge den Link zur .json-Datei eines Repositorys ein. Seine Erweiterungen erscheinen dann im Marktplatz.")}</p>
            <UrlField t={t} id="mex-repository" label={t("Repository link", "Repository-Link")} value={draft} onChange={props.onDraft}
                placeholder="https://example.com/index.json" onSubmit={save}
                error={draft.trim() && !valid ? t("Enter a full link that starts with https://", "Gib einen vollständigen Link mit https:// ein") : undefined} />
            <div className="mex-sheet-actions">
                <button type="button" className="mex-secondary" onClick={() => props.onSave(DEFAULT_MARKETPLACE_URL)} disabled={props.isDefault} data-marketplace-repo-default>
                    {t("Use official", "Offizielles nutzen")}
                </button>
                <button type="button" className="mex-primary" onClick={save} disabled={!valid} data-tour="marketplace-repo-save">{t("Save", "Speichern")}</button>
            </div>
        </div>
    </Modal>
}
