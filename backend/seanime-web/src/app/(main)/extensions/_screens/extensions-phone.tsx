import { Extension_Extension, Extension_InvalidExtension, ExtensionRepo_AllExtensions } from "@/api/generated/types"
import { useGetAllExtensions, useInstallExternalExtension } from "@/api/hooks/extensions.hooks"
import { useStartMobileTutorial } from "@/app/(main)/_features/tour/mobile-tutorial"
import { __extensions_currentPageAtom } from "@/app/(main)/extensions/_lib/marketplace.atoms"
import { extensionMeta, getInstalledOverview, invalidReasonLabel } from "@/app/(main)/extensions/_lib/extensions-phone"
import { __extensions_marketTypeAtom, MarketplacePhone } from "@/app/(main)/extensions/_screens/extensions-phone-marketplace"
import { AddExtensionSheet, ExtensionIcon, ExtensionSheet, SearchField, Spinner } from "@/app/(main)/extensions/_screens/extensions-phone-sheets"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaLink } from "@/components/shared/sea-link"
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useAtom, useSetAtom } from "jotai/react"
import React from "react"
import { LuChevronRight, LuDownload, LuEllipsisVertical, LuFlaskConical, LuGraduationCap, LuPlus, LuRefreshCcw } from "react-icons/lu"
import { toast } from "sonner"
import "@/components/shared/mobile-surface.css"
import "./extensions-phone.css"

/** Search appears once the list is long enough to need it. */
const SEARCH_FROM = 8

type Selection = {
    extension: Extension_Extension
    invalid?: Extension_InvalidExtension
    userConfigError?: Extension_InvalidExtension
    updateData?: NonNullable<ExtensionRepo_AllExtensions["hasUpdate"]>[number]
    disabled: boolean
    unsafe: boolean
}

function findSelection(all: ExtensionRepo_AllExtensions | undefined, id: string | null): Selection | null {
    if (!all || !id) return null
    const enabled = all.extensions?.find(extension => extension.id === id)
    const disabled = all.disabledExtensions?.find(extension => extension.id === id)
    const invalid = all.invalidExtensions?.find(item => item.id === id)
    const extension = enabled ?? disabled ?? (invalid && { ...invalid.extension, id: invalid.extension?.id || invalid.id, name: invalid.extension?.name || invalid.id })
    if (!extension) return null
    return {
        extension,
        invalid: enabled || disabled ? undefined : invalid,
        userConfigError: all.invalidUserConfigExtensions?.find(item => item.id === id),
        updateData: all.hasUpdate?.find(update => update.extensionID === id),
        disabled: !enabled && !!disabled,
        unsafe: !!all.unsafeExtensions?.[id],
    }
}

/**
 * Android phone Extensions tab in the Home / Manga language: a quiet title with icon actions, Installed and Marketplace
 * as tabs, updates and problems first, then one list per type. Each extension opens one sheet with all of its actions.
 */
export function ExtensionsPhone() {
    const t = useTr()
    const router = useRouter()
    const [page, setPage] = useAtom(__extensions_currentPageAtom)
    const startTutorial = useStartMobileTutorial()

    const [withUpdates, setWithUpdates] = React.useState(false)
    const query = useGetAllExtensions(withUpdates)
    // Checking for updates is a new request; the list stays on screen meanwhile instead of turning into a spinner.
    const lastData = React.useRef<ExtensionRepo_AllExtensions | undefined>(undefined)
    if (query.data) lastData.current = query.data
    const all = query.data ?? lastData.current
    const loading = !all && query.isPending
    const failed = !all && query.isError
    const checking = withUpdates && query.isFetching

    const [search, setSearch] = React.useState("")
    const [selectedId, setSelectedId] = React.useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [addOpen, setAddOpen] = React.useState(false)
    const [menuOpen, setMenuOpen] = React.useState(false)
    const addButtonRef = React.useRef<HTMLButtonElement>(null)

    const overview = React.useMemo(() => getInstalledOverview(all, search), [all, search])
    const selection = React.useMemo(() => findSelection(all, selectedId), [all, selectedId])
    const installedIds = React.useMemo(() => new Set([...(all?.extensions ?? []), ...(all?.disabledExtensions ?? [])].map(extension => extension.id)
        .concat((all?.invalidExtensions ?? []).map(item => item.id))), [all])

    // An uninstalled extension closes its sheet.
    React.useEffect(() => {
        if (sheetOpen && all && !selection) setSheetOpen(false)
    }, [sheetOpen, all, selection])

    const announce = React.useRef(false)
    const checkForUpdates = () => {
        announce.current = true
        if (withUpdates) void query.refetch()
        else setWithUpdates(true)
    }
    React.useEffect(() => {
        if (!announce.current || !withUpdates || query.isFetching) return
        announce.current = false
        if (query.isError || !query.data) return void toast.error(t("Could not check for updates", "Updates konnten nicht geprüft werden"))
        const count = getInstalledOverview(query.data, "").updates
        if (count) toast.success(count === 1 ? t("1 update available", "1 Update verfügbar") : t(`${count} updates available`, `${count} Updates verfügbar`))
        else toast.info(t("All extensions are up to date", "Alle Erweiterungen sind aktuell"))
    }, [withUpdates, query.isFetching, query.data, query.isError])

    const { mutateAsync: install } = useInstallExternalExtension()
    const [updatingAll, setUpdatingAll] = React.useState(false)
    const updateAll = async () => {
        setUpdatingAll(true)
        let done = 0
        for (const update of overview.safeUpdates) {
            try {
                await install({ manifestUri: update.manifestURI })
                done++
            } catch { /* the request shows its own error */ }
        }
        setUpdatingAll(false)
        if (done) toast.success(done === 1 ? t("1 extension updated", "1 Erweiterung aktualisiert") : t(`${done} extensions updated`, `${done} Erweiterungen aktualisiert`))
    }

    const openExtension = (id: string) => {
        setSelectedId(id)
        setSheetOpen(true)
    }

    // Switching tabs from far down the page starts the other tab at its top.
    const tabsRef = React.useRef<HTMLDivElement>(null)
    const showPage = (next: "installed" | "marketplace") => {
        setPage(next)
        if ((tabsRef.current?.getBoundingClientRect().top ?? 0) < 0) tabsRef.current?.scrollIntoView({ block: "start" })
    }
    const setMarketType = useSetAtom(__extensions_marketTypeAtom)
    const openMarketplace = (type: string) => {
        setMarketType(type)
        showPage("marketplace")
    }

    const facts = loading ? t("Loading extensions…", "Erweiterungen werden geladen …")
        : failed ? t("Not loaded", "Nicht geladen")
            : [
                `${overview.total} ${t("installed", "installiert")}`,
                overview.updates ? (overview.updates === 1 ? t("1 update", "1 Update") : t(`${overview.updates} updates`, `${overview.updates} Updates`)) : "",
                overview.attention ? (overview.attention === 1 ? t("1 needs attention", "1 braucht Aufmerksamkeit") : t(`${overview.attention} need attention`, `${overview.attention} brauchen Aufmerksamkeit`)) : "",
            ].filter(Boolean).join(" · ")

    const installed = page !== "marketplace"
    const nothingFound = !!search.trim() && !overview.permissions.length && !overview.broken.length && !overview.groups.length

    return <PageWrapper className="mex" data-mobile-extensions="true">
        <header className="mex-header">
            <div className="mex-header-text">
                <h1>{t("Extensions", "Erweiterungen")}</h1>
                <p data-extensions-facts>{facts}</p>
            </div>
            <div className="mex-actions-bar">
                <button type="button" className="mex-icon-button" onClick={checkForUpdates} disabled={checking || loading} aria-busy={checking || undefined}
                    aria-label={checking ? t("Checking for updates", "Updates werden geprüft") : t("Check for updates", "Nach Updates suchen")} data-extensions-check-updates>
                    <LuRefreshCcw className={checking ? "mex-spin" : undefined} aria-hidden />
                </button>
                <button ref={addButtonRef} type="button" className="mex-icon-button" onClick={() => setAddOpen(true)} aria-label={t("Add extensions", "Erweiterungen hinzufügen")}
                    data-extensions-add>
                    <LuPlus aria-hidden />
                </button>
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} className="mex-menu" trigger={
                    <button type="button" className="mex-icon-button" aria-label={t("More actions", "Weitere Aktionen")} data-extensions-menu>
                        <LuEllipsisVertical aria-hidden />
                    </button>}>
                    <DropdownMenuItem onClick={() => startTutorial({ fromExtensions: true })} data-extensions-tutorial>
                        <LuGraduationCap aria-hidden /> {t("Setup tour", "Einrichtungs-Tour")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/extensions/playground")}><LuFlaskConical aria-hidden /> {t("Playground", "Playground")}</DropdownMenuItem>
                </DropdownMenu>
            </div>
        </header>

        <div ref={tabsRef} className="mex-tabs" role="tablist" aria-label={t("Extensions", "Erweiterungen")} data-extensions-page-tabs>
            <button type="button" role="tab" aria-selected={installed} aria-controls="mex-panel" data-tab-name="Installed" onClick={() => showPage("installed")}>
                {t("Installed", "Installiert")}{!!all && <span>{overview.total}</span>}
                {overview.attention > 0 && <span className="mex-tab-dot" role="img" aria-label={t("needs attention", "braucht Aufmerksamkeit")} />}
            </button>
            <button type="button" role="tab" aria-selected={!installed} aria-controls="mex-panel" data-tab-name="Marketplace" onClick={() => showPage("marketplace")}>
                {t("Marketplace", "Marktplatz")}
            </button>
        </div>

        <div id="mex-panel" role="tabpanel" className="mex-panel">
            {!installed ? <MarketplacePhone t={t} installedIds={installedIds} />
                : failed ? <div className="mex-notice" role="alert" data-extensions-error>
                        <p>{t("Your extensions could not be loaded.", "Deine Erweiterungen konnten nicht geladen werden.")}</p>
                        <div className="mex-notice-actions">
                            <button type="button" className="mex-text-action" onClick={() => void query.refetch()}>{t("Try again", "Erneut versuchen")}</button>
                        </div>
                    </div>
                    : loading ? <div className="mex-loading" aria-busy="true" role="status" aria-label={t("Loading extensions", "Erweiterungen werden geladen")}>
                            <span className="mex-bone mex-bone-head" />
                            {Array.from({ length: 3 }, (_, i) => <span key={i} className="mex-bone mex-bone-row" />)}
                            <span className="mex-bone mex-bone-head" />
                            {Array.from({ length: 2 }, (_, i) => <span key={i} className="mex-bone mex-bone-row" />)}
                        </div>
                        : <>
                                {overview.safeUpdates.length > 0 && <section className="mex-updates" aria-labelledby="mex-updates-title" data-extensions-updates>
                                    <div>
                                        <h2 id="mex-updates-title">{overview.safeUpdates.length === 1 ? t("1 update available", "1 Update verfügbar")
                                            : t(`${overview.safeUpdates.length} updates available`, `${overview.safeUpdates.length} Updates verfügbar`)}</h2>
                                        <p>{overview.safeUpdates.map(update => findSelection(all, update.extensionID)?.extension.name || update.extensionID).join(", ")}</p>
                                        {overview.updates > overview.safeUpdates.length && <p>{t("Plugins with unsafe flags are updated one by one from their sheet.",
                                            "Plugins mit unsicheren Flags aktualisierst du einzeln über ihr Blatt.")}</p>}
                                    </div>
                                    <button type="button" className="mex-primary" onClick={updateAll} disabled={updatingAll} data-extensions-update-all>
                                        {updatingAll ? <Spinner /> : <LuDownload aria-hidden />}{t("Update all", "Alle aktualisieren")}
                                    </button>
                                </section>}

                                {overview.total >= SEARCH_FROM && <SearchField t={t} value={search} onChange={setSearch}
                                    placeholder={t("Search installed extensions", "Installierte Erweiterungen durchsuchen")} data-extensions-search="" />}

                                {(overview.permissions.length > 0 || overview.broken.length > 0) && <section className="mex-section" aria-labelledby="mex-attention-title" data-extensions-attention>
                                    <div className="mex-section-head">
                                        <h2 id="mex-attention-title">{t("Needs attention", "Braucht Aufmerksamkeit")}<span>{overview.permissions.length + overview.broken.length}</span></h2>
                                    </div>
                                    <ul className="mex-list">
                                        {[...overview.permissions, ...overview.broken].map(item => {
                                            const permission = item.code === "plugin_permissions_not_granted"
                                            return <InstalledRow key={item.id} t={t} id={item.id} extension={item.extension} onOpen={openExtension}
                                                flag={permission ? t("Needs your permission", "Braucht deine Erlaubnis") : invalidReasonLabel(item.code, t)}
                                                tone={permission ? "warning" : "danger"} />
                                        })}
                                    </ul>
                                </section>}

                                {overview.groups.map(group => <section key={group.key} className="mex-section" aria-labelledby={`mex-group-${group.key}`} data-extensions-group={group.key}>
                                    <div className="mex-section-head">
                                        <h2 id={`mex-group-${group.key}`}>{t(group.en, group.de)}<span>{group.items.length}</span></h2>
                                        {group.key === "custom-source" ? <SeaLink href="/custom-sources" className="mex-text-action">{t("Browse", "Durchsuchen")}</SeaLink>
                                            : group.key !== "disabled" && <button type="button" className="mex-text-action" onClick={() => openMarketplace(group.key)}
                                            data-extensions-add-type={group.key} aria-label={t(`Add ${group.en.toLowerCase()}`, `${group.de} hinzufügen`)}>
                                            <LuPlus aria-hidden />{t("Add", "Hinzufügen")}
                                        </button>}
                                    </div>
                                    {group.items.length === 0 && <div className="mex-missing" data-extensions-missing={group.key}>
                                        <p>{group.key === "onlinestream-provider"
                                            ? t("No streaming source yet. Episodes can only be streamed with one.", "Noch keine Streaming-Quelle. Ohne sie lassen sich keine Folgen streamen.")
                                            : t("No manga source yet. Chapters can only be read and downloaded with one.", "Noch keine Manga-Quelle. Ohne sie lassen sich keine Kapitel lesen oder laden.")}</p>
                                        <button type="button" className="mex-primary" onClick={() => openMarketplace(group.key)}>
                                            {group.key === "onlinestream-provider" ? t("Find a streaming source", "Streaming-Quelle finden") : t("Find a manga source", "Manga-Quelle finden")}
                                        </button>
                                    </div>}
                                    {group.items.length > 0 && <ul className="mex-list" data-dim={group.key === "disabled" || undefined}>
                                        {group.items.map(extension => {
                                            const update = all?.hasUpdate?.find(item => item.extensionID === extension.id)
                                            const setup = all?.invalidUserConfigExtensions?.some(item => item.id === extension.id)
                                            return <InstalledRow key={extension.id} t={t} id={extension.id} extension={extension} onOpen={openExtension}
                                                flag={setup ? t("Needs setup", "Muss eingerichtet werden") : update ? t(`Update to ${update.version}`, `Update auf ${update.version}`) : undefined}
                                                tone={setup ? "warning" : update ? "accent" : undefined} />
                                        })}
                                    </ul>}
                                </section>)}

                                {nothingFound && <div className="mex-empty" data-extensions-search-empty>
                                    <p>{t("No extension matches", "Keine Erweiterung passt")}</p>
                                    <p>{t("The search looks at names, descriptions and IDs.", "Die Suche prüft Namen, Beschreibungen und IDs.")}</p>
                                    <button type="button" className="mex-secondary" onClick={() => setSearch("")}>{t("Clear search", "Suche leeren")}</button>
                                </div>}
                            </>}
        </div>

        {!!selection && <ExtensionSheet key={selection.extension.id} t={t} open={sheetOpen} onOpenChange={setSheetOpen} {...selection}
            onCloseFocus={() => document.querySelector<HTMLElement>(`[data-extension-row="${CSS.escape(selection.extension.id)}"]`)?.focus()} />}
        <AddExtensionSheet t={t} open={addOpen} onOpenChange={setAddOpen} returnFocusRef={addButtonRef} installedIds={installedIds}
            onBrowseMarketplace={() => { setAddOpen(false); setPage("marketplace") }} />
    </PageWrapper>
}

function InstalledRow({ t, id, extension, flag, tone, onOpen }: {
    t: Translate
    id: string
    extension: Extension_Extension | undefined
    flag?: string
    tone?: "accent" | "warning" | "danger"
    onOpen: (id: string) => void
}) {
    const meta = extensionMeta(extension, t)
    return <li>
        <button type="button" className="mex-row" onClick={() => onOpen(id)} data-extension-row={id}>
            <ExtensionIcon extension={extension} />
            <span className="mex-row-text">
                <span className="mex-row-name">{extension?.name || id}</span>
                {!!extension?.description && <span className="mex-row-desc">{extension.description}</span>}
                {!!meta && <span className="mex-row-meta">{meta}</span>}
                {!!flag && <span className="mex-flag" data-tone={tone}>{flag}</span>}
            </span>
            <LuChevronRight className="mex-row-chevron" aria-hidden />
        </button>
    </li>
}
