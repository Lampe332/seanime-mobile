import { Extension_Extension, Extension_InvalidExtension, ExtensionRepo_UpdateData } from "@/api/generated/types"
import {
    useFetchExternalExtensionData,
    useInstallExternalExtension,
    useInstallExternalExtensionRepository,
    useReloadExternalExtension,
    useSetExternalExtensionDisabled,
    useUninstallExternalExtension,
} from "@/api/hooks/extensions.hooks"
import { ExtensionCodeModal } from "@/app/(main)/extensions/_containers/extension-code"
import { ExtensionUserConfigModal } from "@/app/(main)/extensions/_containers/extension-user-config"
import { usePluginPermissionGrant } from "@/app/(main)/extensions/_containers/invalid-extension-card"
import {
    extensionLanguageLabel,
    extensionMeta,
    extensionTypeLabel,
    invalidReasonLabel,
    isExtensionIconUrl,
    parsePermissionDescription,
    sortExtensions,
} from "@/app/(main)/extensions/_lib/extensions-phone"
import { Modal } from "@/components/ui/modal"
import { Translate } from "@/lib/app-language"
import { openTab } from "@/lib/helpers/browser"
import { useRouter } from "@/lib/navigation"
import capitalize from "lodash/capitalize"
import React from "react"
import {
    LuBook,
    LuCheck,
    LuChevronRight,
    LuClipboardPaste,
    LuCode,
    LuDownload,
    LuGlobe,
    LuLoaderCircle,
    LuPower,
    LuRefreshCcw,
    LuRotateCw,
    LuSearch,
    LuSettings2,
    LuShieldCheck,
    LuStore,
    LuTrash2,
    LuX,
} from "react-icons/lu"
import { toast } from "sonner"

/** Sheets take focus themselves on open: a focused field would open the keyboard, a focused row would show its ring. */
export function focusSheet(event: Event) {
    event.preventDefault()
    ;(event.currentTarget as HTMLElement | null)?.focus()
}

export function ExtensionIcon({ extension, large }: { extension: Extension_Extension | undefined, large?: boolean }) {
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => setFailed(false), [extension?.icon])
    const showImage = isExtensionIconUrl(extension?.icon) && !failed
    return <span className="mex-icon" data-large={large || undefined} aria-hidden>
        {showImage ? <img src={extension!.icon} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
            : <span>{(extension?.name?.trim()[0] ?? "?").toUpperCase()}</span>}
    </span>
}

export function Spinner() {
    return <LuLoaderCircle className="mex-spin" aria-hidden />
}

export function SearchField({ t, value, onChange, placeholder, label, ...data }: {
    t: Translate
    value: string
    onChange: (value: string) => void
    placeholder: string
    /** Accessible name when the placeholder is shortened */
    label?: string
} & Record<`data-${string}`, string>) {
    return <span className="mex-search">
        <LuSearch aria-hidden />
        <input type="search" value={value} placeholder={placeholder} aria-label={label || placeholder} enterKeyHint="search" autoComplete="off" autoCorrect="off"
            spellCheck={false} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur() }} {...data} />
        {!!value && <button type="button" className="mex-search-clear" onClick={() => onChange("")} aria-label={t("Clear search", "Suche leeren")}><LuX aria-hidden /></button>}
    </span>
}

type ActionRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: React.ReactNode
    label: string
    note?: string
    tone?: "danger" | "warning"
    busy?: boolean
}

/** A row of the sheet's action list; forwards its ref so dialogs can use it as their trigger. */
const ActionRow = React.forwardRef<HTMLButtonElement, ActionRowProps>(function ActionRow({ icon, label, note, tone, busy, ...props }, ref) {
    return <button ref={ref} type="button" className="mex-action" data-tone={tone} aria-busy={busy || undefined} {...props}>
        <span className="mex-action-icon" aria-hidden>{busy ? <Spinner /> : icon}</span>
        <span className="mex-action-text"><span>{label}</span>{note && <small>{note}</small>}</span>
        <LuChevronRight className="mex-action-chevron" aria-hidden />
    </button>
})

function SheetTitle({ extension }: { extension: Extension_Extension }) {
    return <span className="mex-sheet-title"><ExtensionIcon extension={extension} large /><span>{extension.name || extension.id}</span></span>
}

function FactList({ extension, t }: { extension: Extension_Extension, t: Translate }) {
    const builtin = extension.manifestURI === "builtin"
    const facts: [string, string][] = [
        [t("Type", "Art"), extensionTypeLabel(extension.type, t)],
        [t("Content language", "Sprache der Inhalte"), extensionLanguageLabel(extension.lang, t)],
        [t("Author", "Autor"), builtin ? "" : extension.author],
        [t("Version", "Version"), extension.version],
        [t("Written in", "Geschrieben in"), extension.language ? capitalize(extension.language) : ""],
        ["ID", extension.id],
        [t("Manifest", "Manifest"), builtin ? "" : extension.manifestURI],
    ]
    return <dl className="mex-facts">
        {facts.filter(([, value]) => !!value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-long={value.length > 28 || undefined}>{value}</dd></div>)}
    </dl>
}

function AboutText({ extension, t }: { extension: Extension_Extension, t: Translate }) {
    return <>
        {!!extension.description && <p className="mex-description">{extension.description}</p>}
        {!!extension.notes && <div className="mex-notes"><h3>{t("Notes", "Hinweise")}</h3><p>{extension.notes}</p></div>}
    </>
}

export type ExtensionSheetProps = {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Puts the focus back on the row that opened the sheet */
    onCloseFocus: () => void
    extension: Extension_Extension
    /** Set when the extension failed to load or waits for permissions */
    invalid?: Extension_InvalidExtension
    userConfigError?: Extension_InvalidExtension
    updateData?: ExtensionRepo_UpdateData
    disabled?: boolean
    unsafe?: boolean
}

/** Everything about one installed extension: what needs doing first (permissions, errors, an update), then its actions and facts. */
export function ExtensionSheet(props: ExtensionSheetProps) {
    const { t, extension, invalid, userConfigError, updateData, disabled, unsafe } = props
    const router = useRouter()
    const builtin = extension.manifestURI === "builtin"
    const waitsForPermission = invalid?.code === "plugin_permissions_not_granted"
    const broken = !!invalid && !waitsForPermission
    // As on desktop, an extension that failed to load can only be updated or removed when its manifest is known.
    const manageable = !builtin && (!invalid || (!!extension.id && !!extension.manifestURI))

    const { mutate: uninstall, isPending: uninstalling } = useUninstallExternalExtension()
    const { mutate: fetchLatest, data: latest, isPending: checking, reset: resetLatest } = useFetchExternalExtensionData(extension.id)
    const { mutate: reload, isPending: reloading } = useReloadExternalExtension()
    const { mutate: setDisabled, isPending: toggling } = useSetExternalExtensionDisabled()
    const { mutate: install, isPending: updating } = useInstallExternalExtension()
    const { grant, isGranting } = usePluginPermissionGrant(waitsForPermission ? extension.id : undefined)
    const [confirmOpen, setConfirmOpen] = React.useState(false)
    const uninstallRef = React.useRef<HTMLButtonElement>(null)

    const announce = React.useRef(false)
    React.useEffect(() => {
        if (!latest || !announce.current) return
        announce.current = false
        if (latest.version !== extension.version) toast.success(t(`Version ${latest.version} is available`, `Version ${latest.version} ist verfügbar`))
        else toast.info(t("This extension is up to date", "Diese Erweiterung ist aktuell"))
    }, [latest])

    const fetchedNewer = !!latest && latest.version !== extension.version
    const newVersion = fetchedNewer ? latest!.version : updateData?.version
    const diff = updateData?.payload || (fetchedNewer ? latest!.payload : "")
    const busy = uninstalling || toggling

    const installUpdate = () => install({ manifestUri: (fetchedNewer && latest!.manifestURI) || updateData?.manifestURI || extension.manifestURI }, {
        onSuccess: response => {
            toast.success(response?.message || t("Updated", "Aktualisiert"))
            resetLatest()
        },
    })

    return <Modal open={props.open} onOpenChange={props.onOpenChange} contentClass="mex-sheet" title={<SheetTitle extension={extension} />}
        onOpenAutoFocus={focusSheet} onCloseAutoFocus={event => { event.preventDefault(); props.onCloseFocus() }}>
        <div className="mex-sheet-body" data-extension-sheet={extension.id} aria-busy={busy || undefined}>
            <p className="mex-sheet-meta">{[extensionTypeLabel(extension.type, t), extensionMeta(extension, t)].filter(Boolean).join(" · ")}</p>

            {waitsForPermission && <div className="mex-block" data-tone="warning" data-extension-permissions>
                <h3>{t("Permissions required", "Erlaubnis nötig")}</h3>
                <p>{t(`${extension.name} asks for these permissions:`, `${extension.name} möchte diese Rechte:`)}</p>
                <ul className="mex-permissions">
                    {parsePermissionDescription(invalid?.pluginPermissionDescription).map((line, index) => line.kind === "item"
                        ? <li key={index}><strong>{line.label}</strong>{line.value && <span>{line.value}</span>}</li>
                        : <li key={index} data-kind={line.kind}>{line.text}</li>)}
                </ul>
                {unsafe && <p className="mex-warning">{t("This plugin relies on unsafe flags. Seanime can't guarantee that it is safe to use.",
                    "Dieses Plugin braucht unsichere Flags. Seanime kann nicht garantieren, dass es sicher ist.")}</p>}
                <div className="mex-block-actions">
                    <ExtensionCodeModal extension={extension} readOnly>
                        <button type="button" className="mex-secondary">{t("View code", "Code ansehen")}</button>
                    </ExtensionCodeModal>
                    <button type="button" className="mex-primary" onClick={grant} disabled={isGranting} data-extension-grant>
                        {isGranting ? <Spinner /> : <LuShieldCheck aria-hidden />}{t("Grant permissions", "Erlauben")}
                    </button>
                </div>
            </div>}

            {broken && <div className="mex-block" data-tone="danger" data-extension-error>
                <h3>{invalidReasonLabel(invalid?.code, t)}</h3>
                <p>{t("Seanime could not load this extension. If you aren't sure what this means, contact its author.",
                    "Seanime konnte diese Erweiterung nicht laden. Wenn du nicht weißt, was das heißt, frag ihren Autor.")}</p>
                {!!invalid?.reason && <pre className="mex-code">{invalid.reason}</pre>}
                {!!invalid?.path && <p className="mex-path">{invalid.path}</p>}
            </div>}

            {!!newVersion && !builtin && <div className="mex-block" data-extension-update>
                <h3>{t(`Version ${newVersion} is available`, `Version ${newVersion} ist verfügbar`)}</h3>
                {!!extension.version && <p>{t(`Installed: ${extension.version}`, `Installiert: ${extension.version}`)}</p>}
                {unsafe && <p className="mex-warning">{t("Uses unsafe flags: check the changes before you update.", "Nutzt unsichere Flags: prüf die Änderungen vor dem Update.")}</p>}
                <div className="mex-block-actions">
                    {!!diff && <ExtensionCodeModal extension={extension} diff={diff} readOnly>
                        <button type="button" className="mex-secondary">{t("View changes", "Änderungen")}</button>
                    </ExtensionCodeModal>}
                    <button type="button" className="mex-primary" onClick={installUpdate} disabled={updating} data-extension-install-update>
                        {updating ? <Spinner /> : <LuDownload aria-hidden />}{t("Update", "Aktualisieren")}
                    </button>
                </div>
            </div>}

            {disabled && <p className="mex-note">{t("Turned off. Turn it on to use it again.", "Ausgeschaltet. Schalte sie ein, um sie wieder zu nutzen.")}</p>}

            <AboutText extension={extension} t={t} />

            <div className="mex-actions" role="group" aria-label={t("Actions", "Aktionen")}>
                {!!extension.userConfig && !invalid && <ExtensionUserConfigModal phone extension={extension} userConfigError={userConfigError}>
                    <ActionRow icon={<LuSettings2 />} label={t("Preferences", "Einstellungen")} data-extension-action="preferences"
                        note={userConfigError ? t("Needs setup before it can be used", "Muss eingerichtet werden") : undefined} tone={userConfigError ? "warning" : undefined} />
                </ExtensionUserConfigModal>}
                {extension.type === "custom-source" && !invalid && !disabled && <ActionRow icon={<LuSearch />} label={t("Browse this source", "Quelle durchsuchen")}
                    data-extension-action="browse" onClick={() => router.push(`/custom-sources?provider=${encodeURIComponent(extension.id)}`)} />}
                {manageable && !!extension.manifestURI && <ActionRow icon={<LuRefreshCcw />} label={t("Check for updates", "Nach Updates suchen")} busy={checking} disabled={checking}
                    data-extension-action="check" onClick={() => { announce.current = true; fetchLatest({ manifestUri: extension.manifestURI }) }} />}
                {!builtin && !disabled && !waitsForPermission && <ActionRow icon={<LuRotateCw />} label={t("Reload", "Neu laden")} busy={reloading} disabled={reloading}
                    data-extension-action="reload" onClick={() => reload({ id: extension.id })} />}
                {!builtin && !waitsForPermission && <ExtensionCodeModal extension={extension}>
                    <ActionRow icon={<LuCode />} label={t("Code", "Code")} note={t("View and edit", "Ansehen und bearbeiten")} data-extension-action="code" />
                </ExtensionCodeModal>}
                {!!extension.readme && <ActionRow icon={<LuBook />} label={t("Documentation", "Dokumentation")} data-extension-action="readme" onClick={() => openTab(extension.readme)} />}
                {!!extension.website && <ActionRow icon={<LuGlobe />} label={t("Website", "Website")} data-extension-action="website" onClick={() => openTab(extension.website)} />}
                {manageable && !invalid && <ActionRow icon={<LuPower />} label={disabled ? t("Turn on", "Einschalten") : t("Turn off", "Ausschalten")}
                    busy={toggling} disabled={busy} data-extension-action="toggle" onClick={() => setDisabled({ id: extension.id, disabled: !disabled })} />}
                {manageable && <ActionRow ref={uninstallRef} icon={<LuTrash2 />} label={t("Uninstall", "Deinstallieren")} tone="danger" busy={uninstalling} disabled={busy}
                    data-extension-action="uninstall" onClick={() => setConfirmOpen(true)} />}
            </div>

            <FactList extension={extension} t={t} />
        </div>

        <ConfirmSheet t={t} open={confirmOpen} onOpenChange={setConfirmOpen} returnFocusRef={uninstallRef}
            title={t(`Uninstall ${extension.name}?`, `${extension.name} deinstallieren?`)}
            text={t("Its code and preferences are removed. This can't be undone.", "Code und Einstellungen werden entfernt. Das lässt sich nicht rückgängig machen.")}
            action={t("Uninstall", "Deinstallieren")}
            onConfirm={() => {
                setConfirmOpen(false)
                uninstall({ id: extension.id }, { onSuccess: () => props.onOpenChange(false) })
            }} />
    </Modal>
}

function ConfirmSheet(props: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocusRef: React.RefObject<HTMLButtonElement | null>
    title: string
    text: string
    action: string
    onConfirm: () => void
}) {
    return <Modal open={props.open} onOpenChange={props.onOpenChange} title={props.title} contentClass="mex-sheet" onOpenAutoFocus={focusSheet}
        onCloseAutoFocus={event => { event.preventDefault(); props.returnFocusRef.current?.focus() }}>
        <div className="mex-sheet-body" data-extension-confirm>
            <p className="mex-sheet-note">{props.text}</p>
            <div className="mex-sheet-actions">
                <button type="button" className="mex-secondary" onClick={() => props.onOpenChange(false)}>{props.t("Cancel", "Abbrechen")}</button>
                <button type="button" className="mex-primary" data-tone="danger" onClick={props.onConfirm} data-extension-confirm-action>{props.action}</button>
            </div>
        </div>
    </Modal>
}

/** The marketplace's view of one extension, with its install action. */
export function MarketplaceSheet(props: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    onCloseFocus: () => void
    extension: Extension_Extension
    installed: boolean
}) {
    const { t, extension, installed } = props
    const { mutate: install, isPending: installing } = useInstallExternalExtension()
    return <Modal open={props.open} onOpenChange={props.onOpenChange} contentClass="mex-sheet" title={<SheetTitle extension={extension} />}
        onOpenAutoFocus={focusSheet} onCloseAutoFocus={event => { event.preventDefault(); props.onCloseFocus() }}>
        <div className="mex-sheet-body" data-marketplace-sheet={extension.id}>
            <p className="mex-sheet-meta">{[extensionTypeLabel(extension.type, t), extensionMeta(extension, t)].filter(Boolean).join(" · ")}</p>
            <AboutText extension={extension} t={t} />
            {(!!extension.readme || !!extension.website) && <div className="mex-actions">
                {!!extension.readme && <ActionRow icon={<LuBook />} label={t("Documentation", "Dokumentation")} onClick={() => openTab(extension.readme)} />}
                {!!extension.website && <ActionRow icon={<LuGlobe />} label={t("Website", "Website")} onClick={() => openTab(extension.website)} />}
            </div>}
            <FactList extension={extension} t={t} />
            <div className="mex-sheet-actions">
                {installed ? <p className="mex-installed"><LuCheck aria-hidden />{t("Installed", "Installiert")}</p>
                    : <button type="button" className="mex-primary" disabled={installing} data-marketplace-sheet-install
                        onClick={() => install({ manifestUri: extension.manifestURI }, { onSuccess: response => toast.success(response?.message || t("Installed", "Installiert")) })}>
                        {installing ? <Spinner /> : <LuDownload aria-hidden />}{t("Install", "Installieren")}
                    </button>}
            </div>
        </div>
    </Modal>
}

/** Text from the clipboard: the app's native bridge, else the WebView's own clipboard API (usually blocked). */
export async function readClipboardText() {
    try {
        const native = window.SeanimeAndroid?.readClipboard
        return ((native ? native() : await navigator.clipboard.readText()) || "").trim()
    } catch {
        return ""
    }
}

export function UrlField(props: {
    t: Translate
    id: string
    label: string
    value: string
    onChange: (value: string) => void
    placeholder: string
    onSubmit?: () => void
    error?: string
    inputProps?: React.InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string>
}) {
    const { t, id } = props
    const canPaste = typeof window !== "undefined" && (!!window.SeanimeAndroid?.readClipboard || !!navigator.clipboard?.readText)
    const paste = async () => {
        const text = await readClipboardText()
        if (text) props.onChange(text)
        else toast.info(t("The clipboard is empty", "Die Zwischenablage ist leer"))
    }
    return <div className="mex-field">
        <label htmlFor={id}>{props.label}</label>
        <span className="mex-input-wrap">
            <input id={id} type="url" inputMode="url" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go"
                value={props.value} placeholder={props.placeholder} aria-invalid={!!props.error || undefined} aria-describedby={props.error ? `${id}-error` : undefined}
                onChange={event => props.onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter") props.onSubmit?.() }} {...props.inputProps} />
            {canPaste && <button type="button" className="mex-paste" onClick={paste} aria-label={t("Paste link", "Link einfügen")}><LuClipboardPaste aria-hidden /></button>}
        </span>
        {!!props.error && <p id={`${id}-error`} className="mex-field-error">{props.error}</p>}
    </div>
}

/** Adds extensions from a manifest link or a whole repository; the marketplace is one tap away. */
export function AddExtensionSheet(props: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocusRef: React.RefObject<HTMLButtonElement | null>
    installedIds: Set<string>
    onBrowseMarketplace: () => void
}) {
    const { t, open } = props
    const [manifestUrl, setManifestUrl] = React.useState("")
    const [repositoryUrl, setRepositoryUrl] = React.useState("")
    const { mutate: find, data: found, isPending: finding, reset: resetFound } = useFetchExternalExtensionData(null)
    const { mutate: fromRepository, data: repository, isPending: importing, reset: resetRepository } = useInstallExternalExtensionRepository()
    const { mutate: install, isPending: installing } = useInstallExternalExtension()

    React.useEffect(() => {
        if (open) return
        setManifestUrl("")
        setRepositoryUrl("")
        resetFound()
        resetRepository()
    }, [open])

    const findManifest = () => {
        if (!manifestUrl.trim()) return void toast.warning(t("Paste a link first", "Füge zuerst einen Link ein"))
        find({ manifestUri: manifestUrl.trim() })
    }
    const loadRepository = (installAll: boolean) => {
        if (!repositoryUrl.trim()) return void toast.warning(t("Paste a link first", "Füge zuerst einen Link ein"))
        fromRepository({ repositoryUri: repositoryUrl.trim(), install: installAll }, {
            onSuccess: () => {
                if (!installAll) return
                toast.success(t("Extensions installed", "Erweiterungen installiert"))
                props.onOpenChange(false)
            },
        })
    }
    const listed = sortExtensions(repository?.extensions ?? [])

    return <Modal open={open} onOpenChange={props.onOpenChange} title={t("Add extensions", "Erweiterungen hinzufügen")} contentClass="mex-sheet"
        onOpenAutoFocus={focusSheet} onCloseAutoFocus={event => { event.preventDefault(); props.returnFocusRef.current?.focus() }}>
        <div className="mex-sheet-body" data-extensions-add-sheet>
            <div className="mex-actions">
                <ActionRow icon={<LuStore />} label={t("Browse the marketplace", "Im Marktplatz stöbern")} data-extensions-add-browse
                    note={t("Streaming and manga sources, plugins", "Streaming- und Manga-Quellen, Plugins")} onClick={props.onBrowseMarketplace} />
            </div>

            <section className="mex-sheet-group" aria-labelledby="mex-add-link-title">
                <h3 id="mex-add-link-title">{t("From a link", "Über einen Link")}</h3>
                <UrlField t={t} id="mex-manifest-url" label={t("Link to the extension's manifest (.json)", "Link zum Manifest der Erweiterung (.json)")}
                    value={manifestUrl} onChange={value => { setManifestUrl(value); resetFound() }} placeholder="https://…/manifest.json" onSubmit={findManifest} />
                {!found && <button type="button" className="mex-secondary" onClick={findManifest} disabled={finding} data-extensions-add-find>
                    {finding && <Spinner />}{t("Find extension", "Erweiterung suchen")}
                </button>}
                {!!found && <div className="mex-found" data-extensions-add-found>
                    <div className="mex-found-head">
                        <ExtensionIcon extension={found} />
                        <span><strong>{found.name}</strong><small>{[extensionTypeLabel(found.type, t), extensionMeta(found, t)].filter(Boolean).join(" · ")}</small></span>
                    </div>
                    {!!found.description && <p>{found.description}</p>}
                    {props.installedIds.has(found.id) ? <p className="mex-installed"><LuCheck aria-hidden />{t("Already installed", "Schon installiert")}</p>
                        : <button type="button" className="mex-primary" disabled={installing} data-extensions-add-install
                            onClick={() => install({ manifestUri: found.manifestURI }, {
                                onSuccess: response => {
                                    toast.success(response?.message || t("Installed", "Installiert"))
                                    props.onOpenChange(false)
                                },
                            })}>
                            {installing ? <Spinner /> : <LuDownload aria-hidden />}{t("Install", "Installieren")}
                        </button>}
                </div>}
            </section>

            <section className="mex-sheet-group" aria-labelledby="mex-add-repo-title">
                <h3 id="mex-add-repo-title">{t("From a repository", "Aus einem Repository")}</h3>
                <p className="mex-sheet-note">{t("Lists every extension of a repository, then installs them all at once.",
                    "Zeigt alle Erweiterungen eines Repositorys und installiert sie dann auf einmal.")}</p>
                <UrlField t={t} id="mex-repository-url" label={t("Link to the repository (.json)", "Link zum Repository (.json)")}
                    value={repositoryUrl} onChange={value => { setRepositoryUrl(value); resetRepository() }} placeholder="https://…/index.json"
                    onSubmit={() => loadRepository(false)} />
                {!repository && <button type="button" className="mex-secondary" onClick={() => loadRepository(false)} disabled={importing} data-extensions-add-list>
                    {importing && <Spinner />}{t("Show extensions", "Erweiterungen zeigen")}
                </button>}
                {!!repository && <>
                    {listed.length > 0 ? <ul className="mex-mini-list" aria-label={t("Extensions in the repository", "Erweiterungen im Repository")}>
                        {listed.map(extension => <li key={extension.id}>
                            <ExtensionIcon extension={extension} />
                            <span><strong>{extension.name}</strong><small>{extensionTypeLabel(extension.type, t)}</small></span>
                        </li>)}
                    </ul> : <p className="mex-sheet-note">{repository.message || t("This repository has no extensions.", "Dieses Repository hat keine Erweiterungen.")}</p>}
                    {listed.length > 0 && <button type="button" className="mex-primary" onClick={() => loadRepository(true)} disabled={importing} data-extensions-add-install-all>
                        {importing ? <Spinner /> : <LuDownload aria-hidden />}{t(`Install all ${listed.length}`, `Alle ${listed.length} installieren`)}
                    </button>}
                </>}
            </section>
        </div>
    </Modal>
}
