import type { Extension_Extension, Extension_InvalidExtension, ExtensionRepo_UpdateData } from "@/api/generated/types"
import {
    useFetchExternalExtensionData,
    useGetExtensionPayload,
    useGetExtensionUserConfig,
    useGrantPluginPermissions,
    useInstallExternalExtension,
    useInstallExternalExtensionRepository,
    useReloadExternalExtension,
    useSaveExtensionUserConfig,
    useSetExternalExtensionDisabled,
    useUninstallExternalExtension,
    useUpdateExtensionCode,
} from "@/api/hooks/extensions.hooks"
import { Notice, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { SelectField } from "@/components/ui/select/select"
import { Dialog, Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, tr } from "@/lib/app-language"
import { openInAppBrowser } from "@/lib/helpers/browser"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import * as Clipboard from "expo-clipboard"
import { Image } from "expo-image"
import capitalize from "lodash/capitalize"
import Book from "lucide-react-native/icons/book"
import Check from "lucide-react-native/icons/check"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste"
import Code from "lucide-react-native/icons/code"
import Download from "lucide-react-native/icons/download"
import Globe from "lucide-react-native/icons/globe"
import Power from "lucide-react-native/icons/power"
import RefreshCcw from "lucide-react-native/icons/refresh-ccw"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import Search from "lucide-react-native/icons/search"
import Settings2 from "lucide-react-native/icons/settings-2"
import ShieldCheck from "lucide-react-native/icons/shield-check"
import Store from "lucide-react-native/icons/store"
import Trash2 from "lucide-react-native/icons/trash"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native"
import {
    extensionLanguageLabel, extensionMeta, extensionTypeLabel, invalidReasonLabel, isExtensionIconUrl, parsePermissionDescription, sortExtensions,
} from "../_lib/extensions-phone"
import { lineDiff, normalizeDiffCode, userConfigValues } from "../_lib/extensions-screen"

/*
 * The Extensions tab's sheets (web extensions-phone-sheets.tsx, extension-user-config.tsx, extension-code.tsx +
 * extensions-phone.css `.mex-*`): one installed extension with everything it can do, a marketplace extension with its
 * install action, adding from a link or a repository, its preferences and its code. The sheet's title is the name; the
 * icon and the type line open the body (the native Sheet takes a text title).
 */

/** Android's monospace face for code (Inter has none; Tailwind's font-mono stack does not resolve on Android) */
const MONO = { fontFamily: "monospace" } as const

/** Grants a plugin's permissions in two steps: the first request makes the server send a challenge over the websocket, the second answers it. */
function usePluginPermissionGrant(id: string | undefined) {
    const { mutate: grantPluginPermissions, isPending } = useGrantPluginPermissions()
    const pendingGrantRef = React.useRef(false)

    useWebsocketMessageListener<string>({
        type: "grant-plugin-permission-check",
        onMessage: message => {
            // message format: {extensionId}$$${challengeID}:{code}
            if (!!id && message.startsWith(id) && pendingGrantRef.current) {
                pendingGrantRef.current = false
                const token = message.split("$$$")?.[1] || ""
                grantPluginPermissions({ id, clientId: "CODE:" + token })
            }
        },
    })

    function grant() {
        if (!id) return void toast.error(tr("Extension has no ID", "Die Erweiterung hat keine ID"))
        pendingGrantRef.current = true
        grantPluginPermissions({ id, clientId: "" })
    }

    return { grant, isGranting: isPending }
}

/** `.mex-icon`: the extension's own picture on a quiet tile, else its first letter */
export function ExtensionIcon({ extension, large }: { extension: Extension_Extension | undefined, large?: boolean }) {
    const icon = extension?.icon
    // the picture that failed to load; another icon gets its own try
    const [failedIcon, setFailedIcon] = React.useState<string>()
    const failed = !!icon && failedIcon === icon
    const size = large ? 48 : 44
    return (
        <View style={{ width: size, height: size }} className="items-center justify-center overflow-hidden rounded-surface-sm bg-sm-surface-control">
            {isExtensionIconUrl(icon) && !failed
                ? <Image source={{ uri: icon }} style={{ width: size, height: size }} contentFit="cover" onError={() => setFailedIcon(icon)} accessibilityIgnoresInvertColors />
                : <Text className="text-lg font-bold text-sm-text-muted">{(extension?.name?.trim()[0] ?? "?").toUpperCase()}</Text>}
        </View>
    )
}

export function SpinnerIcon({ size = 20, color }: { size?: number, color?: string }) {
    return <ActivityIndicator size={size > 20 ? "large" : "small"} color={color ?? colors.smTextMuted} />
}

type IconType = React.ComponentType<{ size?: number, color?: string }>

/** `.mex-action`: icon, label with a note (warning tone for "needs setup"), chevron; a spinner while it works */
export function SheetAction({ icon: Icon, label, note, tone, busy, disabled, onPress }: {
    icon: IconType
    label: string
    note?: string
    tone?: "danger" | "warning"
    busy?: boolean
    disabled?: boolean
    onPress: () => void
}) {
    const iconColor = tone === "danger" ? colors.smDanger : colors.smTextMuted
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={note ? `${label}, ${note}` : label} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
            disabled={disabled || busy} onPress={onPress}
            className={cn("min-h-[52px] w-full flex-row items-center gap-3.5 bg-sm-surface-raised px-4 py-2 active:bg-sm-surface-control", (disabled || busy) && "opacity-55")}>
            <View className="w-6 items-center">{busy ? <SpinnerIcon color={iconColor} /> : <Icon size={20} color={iconColor} />}</View>
            <View className="min-w-0 flex-1 gap-px">
                <Text className={cn("text-[15px]", tone === "danger" && "text-sm-danger")}>{label}</Text>
                {!!note && <Text className={cn("text-[13px] leading-[18px]", tone === "warning" ? "font-semibold text-sm-warning" : "text-sm-text-muted")}>{note}</Text>}
            </View>
            <ChevronRight size={18} color={colors.smTextSubtle} />
        </Pressable>
    )
}

/** `.mex-block`: what needs doing (permissions, an error, an update) with its actions underneath */
export function Block({ title, tone, children, actions }: { title: string, tone?: "warning" | "danger", children?: React.ReactNode, actions?: React.ReactNode }) {
    return (
        <View className="gap-2 rounded-surface bg-sm-surface-raised p-4">
            <Text className={cn("text-base font-bold leading-[21.6px]", tone === "warning" && "text-sm-warning", tone === "danger" && "text-sm-danger")}>{title}</Text>
            {children}
            {!!actions && <View className="mt-1.5 flex-row flex-wrap gap-2">{actions}</View>}
        </View>
    )
}

export function BlockText({ children, className }: { children: React.ReactNode, className?: string }) {
    return <Text className={cn("text-sm leading-[21px] text-sm-text-muted", className)}>{children}</Text>
}

/** Type and meta line under the sheet's title (`.mex-sheet-meta`, .8125rem muted): the sheet's description, the icon sits in the title */
function sheetHeadLine(extension: Extension_Extension, t: Translate) {
    return [extensionTypeLabel(extension.type, t), extensionMeta(extension, t)].filter(Boolean).join(" · ")
}

/** `.mex-facts`: label left, value right; links and long IDs on their own line, read from the left */
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
    return (
        <View className="gap-0.5 overflow-hidden rounded-surface">
            {facts.filter(([, value]) => !!value).map(([label, value]) => {
                const long = value.length > 28
                return (
                    <View key={label} className="flex-row flex-wrap justify-between gap-x-4 gap-y-0.5 bg-sm-surface-raised px-4 py-3">
                        {/* the page's line height 1.5: dt 19.5, dd 21 (a row is 45dp, the value sits 1.5dp lower) */}
                        <Text className="text-[13px] leading-[19.5px] text-sm-text-muted">{label}</Text>
                        <Text selectable className={cn(long ? "w-full text-[13px] leading-[19.5px]" : "ml-auto text-right text-sm leading-[21px]")}>{value}</Text>
                    </View>
                )
            })}
        </View>
    )
}

function AboutText({ extension, t }: { extension: Extension_Extension, t: Translate }) {
    return <>
        {!!extension.description && <Text className="leading-[23px]">{extension.description}</Text>}
        {!!extension.notes && (
            <View className="gap-1">
                <Text className="text-sm font-bold">{t("Notes", "Hinweise")}</Text>
                <Text className="text-sm leading-[21px] text-sm-text-muted">{extension.notes}</Text>
            </View>
        )}
    </>
}

/** What the sheet of one extension can open over itself: its preferences or its code (all, read-only or a diff) */
export type ExtensionSubSheet = { kind: "preferences" } | { kind: "code", readOnly: boolean, diff?: string }

export type ExtensionSheetProps = {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    extension: Extension_Extension
    /** set when the extension failed to load or waits for permissions */
    invalid?: Extension_InvalidExtension
    userConfigError?: Extension_InvalidExtension
    updateData?: ExtensionRepo_UpdateData
    disabled?: boolean
    unsafe?: boolean
    /** opens preferences or code; the page closes this sheet meanwhile and opens it again after */
    onSubSheet: (sheet: ExtensionSubSheet) => void
}

/** Everything about one installed extension: what needs doing first (permissions, errors, an update), then its actions and facts. */
export function ExtensionSheet(props: ExtensionSheetProps) {
    const { t, extension, invalid, userConfigError, updateData, disabled, unsafe, onSubSheet } = props
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

    const announce = React.useRef(false)
    React.useEffect(() => {
        if (!latest || !announce.current) return
        announce.current = false
        if (latest.version !== extension.version) toast.success(t(`Version ${latest.version} is available`, `Version ${latest.version} ist verfügbar`))
        else toast.info(t("This extension is up to date", "Diese Erweiterung ist aktuell"))
    }, [latest, extension.version, t])

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

    return (
        <Sheet open={props.open} onOpenChange={props.onOpenChange} title={extension.name || extension.id} titleIcon={<ExtensionIcon extension={extension} large />} description={sheetHeadLine(extension, t)} dense>

            {waitsForPermission && (
                <Block tone="warning" title={t("Permissions required", "Erlaubnis nötig")} actions={<>
                    <Button intent="secondary" wrapperClassName="grow" onPress={() => onSubSheet({ kind: "code", readOnly: true })}>{t("View code", "Code ansehen")}</Button>
                    <Button wrapperClassName="grow-[2]" loading={isGranting} leftIcon={<ShieldCheck size={18} color="#ffffff" />} onPress={grant}>{t("Grant permissions", "Erlauben")}</Button>
                </>}>
                    <BlockText>{t(`${extension.name} asks for these permissions:`, `${extension.name} möchte diese Rechte:`)}</BlockText>
                    <View className="gap-2 rounded-surface-sm bg-sm-surface-sunken p-3">
                        {parsePermissionDescription(invalid?.pluginPermissionDescription).map((line, index) => line.kind === "item"
                            ? <View key={index} className="gap-px"><Text className="text-sm font-semibold">{line.label}</Text>{!!line.value && <BlockText>{line.value}</BlockText>}</View>
                            : <Text key={index} className={cn("text-sm leading-[21px]", line.kind === "warning" ? "font-semibold text-sm-warning" : "text-sm-text-muted")}>{line.text}</Text>)}
                    </View>
                    {unsafe && <Text className="text-[13px] leading-[19.5px] text-sm-warning">{t("This plugin relies on unsafe flags. Seanime can't guarantee that it is safe to use.",
                        "Dieses Plugin braucht unsichere Flags. Seanime kann nicht garantieren, dass es sicher ist.")}</Text>}
                </Block>
            )}

            {broken && (
                <Block tone="danger" title={invalidReasonLabel(invalid?.code, t)}>
                    <BlockText>{t("Seanime could not load this extension. If you aren't sure what this means, contact its author.",
                        "Seanime konnte diese Erweiterung nicht laden. Wenn du nicht weißt, was das heißt, frag ihren Autor.")}</BlockText>
                    {!!invalid?.reason && (
                        <ScrollView nestedScrollEnabled style={{ maxHeight: 192 }} className="rounded-surface-sm bg-sm-surface-sunken" contentContainerClassName="p-3">
                            <Text selectable style={MONO} className="text-xs leading-[18px] text-sm-danger">{invalid.reason}</Text>
                        </ScrollView>
                    )}
                    {!!invalid?.path && <Text selectable className="text-xs text-sm-text-subtle">{invalid.path}</Text>}
                </Block>
            )}

            {!!newVersion && !builtin && (
                <Block title={t(`Version ${newVersion} is available`, `Version ${newVersion} ist verfügbar`)} actions={<>
                    {!!diff && <Button intent="secondary" wrapperClassName="grow" onPress={() => onSubSheet({ kind: "code", readOnly: true, diff })}>{t("View changes", "Änderungen")}</Button>}
                    <Button wrapperClassName="grow-[2]" loading={updating} leftIcon={<Download size={18} color="#ffffff" />} onPress={installUpdate}>{t("Update", "Aktualisieren")}</Button>
                </>}>
                    {!!extension.version && <BlockText>{t(`Installed: ${extension.version}`, `Installiert: ${extension.version}`)}</BlockText>}
                    {unsafe && <Text className="text-[13px] leading-[19.5px] text-sm-warning">{t("Uses unsafe flags: check the changes before you update.", "Nutzt unsichere Flags: prüf die Änderungen vor dem Update.")}</Text>}
                </Block>
            )}

            {disabled && (
                <View className="rounded-surface bg-sm-surface-raised px-4 py-3">
                    <BlockText>{t("Turned off. Turn it on to use it again.", "Ausgeschaltet. Schalte sie ein, um sie wieder zu nutzen.")}</BlockText>
                </View>
            )}

            <AboutText extension={extension} t={t} />

            <RowGroup>
                {!!extension.userConfig && !invalid && <SheetAction icon={Settings2} label={t("Preferences", "Einstellungen")} onPress={() => onSubSheet({ kind: "preferences" })}
                    note={userConfigError ? t("Needs setup before it can be used", "Muss eingerichtet werden") : undefined} tone={userConfigError ? "warning" : undefined} />}
                {extension.type === "custom-source" && !invalid && !disabled && <SheetAction icon={Search} label={t("Browse this source", "Quelle durchsuchen")}
                    onPress={() => {
                        props.onOpenChange(false)
                        router.push(`/custom-sources?provider=${encodeURIComponent(extension.id)}`)
                    }} />}
                {manageable && !!extension.manifestURI && <SheetAction icon={RefreshCcw} label={t("Check for updates", "Nach Updates suchen")} busy={checking}
                    onPress={() => {
                        announce.current = true
                        fetchLatest({ manifestUri: extension.manifestURI })
                    }} />}
                {!builtin && !disabled && !waitsForPermission && <SheetAction icon={RotateCw} label={t("Reload", "Neu laden")} busy={reloading}
                    onPress={() => reload({ id: extension.id })} />}
                {!builtin && !waitsForPermission && <SheetAction icon={Code} label={t("Code", "Code")} note={t("View and edit", "Ansehen und bearbeiten")}
                    onPress={() => onSubSheet({ kind: "code", readOnly: false })} />}
                {!!extension.readme && <SheetAction icon={Book} label={t("Documentation", "Dokumentation")} onPress={() => openInAppBrowser(extension.readme!)} />}
                {!!extension.website && <SheetAction icon={Globe} label={t("Website", "Website")} onPress={() => openInAppBrowser(extension.website!)} />}
                {manageable && !invalid && <SheetAction icon={Power} label={disabled ? t("Turn on", "Einschalten") : t("Turn off", "Ausschalten")} busy={toggling} disabled={busy}
                    onPress={() => setDisabled({ id: extension.id, disabled: !disabled })} />}
                {manageable && <SheetAction icon={Trash2} label={t("Uninstall", "Deinstallieren")} tone="danger" busy={uninstalling} disabled={busy}
                    onPress={() => setConfirmOpen(true)} />}
            </RowGroup>

            <FactList extension={extension} t={t} />

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t(`Uninstall ${extension.name}?`, `${extension.name} deinstallieren?`)}
                description={t("Its code and preferences are removed. This can't be undone.", "Code und Einstellungen werden entfernt. Das lässt sich nicht rückgängig machen.")}
                footer={<>
                    <Button intent="secondary" onPress={() => setConfirmOpen(false)}>{t("Cancel", "Abbrechen")}</Button>
                    <Button intent="danger" onPress={() => {
                        setConfirmOpen(false)
                        uninstall({ id: extension.id }, { onSuccess: () => props.onOpenChange(false) })
                    }}>{t("Uninstall", "Deinstallieren")}</Button>
                </>} />
        </Sheet>
    )
}

/** The marketplace's view of one extension, with its install action. */
export function MarketplaceSheet({ t, open, onOpenChange, extension, installed }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    extension: Extension_Extension
    installed: boolean
}) {
    const { mutate: install, isPending: installing } = useInstallExternalExtension()
    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={extension.name || extension.id} titleIcon={<ExtensionIcon extension={extension} large />} description={sheetHeadLine(extension, t)} dense
            footer={installed
                ? <View className="min-h-12 flex-1 flex-row items-center justify-center gap-2"><Check size={18} color={colors.smTextMuted} /><Text className="font-semibold text-sm-text-muted">{t("Installed", "Installiert")}</Text></View>
                : <Button size="lg" wrapperClassName="flex-1" loading={installing} leftIcon={<Download size={18} color="#ffffff" />}
                    onPress={() => install({ manifestUri: extension.manifestURI }, { onSuccess: response => toast.success(response?.message || t("Installed", "Installiert")) })}>
                    {t("Install", "Installieren")}
                </Button>}>
            <AboutText extension={extension} t={t} />
            {(!!extension.readme || !!extension.website) && (
                <RowGroup>
                    {!!extension.readme && <SheetAction icon={Book} label={t("Documentation", "Dokumentation")} onPress={() => openInAppBrowser(extension.readme!)} />}
                    {!!extension.website && <SheetAction icon={Globe} label={t("Website", "Website")} onPress={() => openInAppBrowser(extension.website!)} />}
                </RowGroup>
            )}
            <FactList extension={extension} t={t} />
        </Sheet>
    )
}

/** `.mex-field`: a filled link field with the paste button inside, its error under it */
export function UrlField({ t, label, value, onChange, placeholder, onSubmit, error }: {
    t: Translate
    label: string
    value: string
    onChange: (value: string) => void
    placeholder: string
    onSubmit?: () => void
    error?: string
}) {
    const paste = async () => {
        const text = ((await Clipboard.getStringAsync().catch(() => "")) || "").trim()
        if (text) onChange(text)
        else toast.info(t("The clipboard is empty", "Die Zwischenablage ist leer"))
    }
    return (
        <View className="gap-1.5">
            <Text className="text-[13px] font-semibold text-sm-text-muted">{label}</Text>
            <View className="justify-center">
                <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
                    keyboardType="url" autoCapitalize="none" autoCorrect={false} autoComplete="off" returnKeyType="go" onSubmitEditing={onSubmit}
                    style={error ? { borderWidth: 1.5, borderColor: colors.smDanger } : undefined}
                    className="min-h-[52px] rounded-surface bg-sm-surface-raised pl-4 pr-14 font-sans text-[15px] text-sm-text" />
                <Pressable accessibilityRole="button" accessibilityLabel={t("Paste link", "Link einfügen")} onPress={() => void paste()}
                    className="absolute right-0.5 h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                    <ClipboardPaste size={20} color={colors.smTextMuted} />
                </Pressable>
            </View>
            {!!error && <Text className="text-[13px] text-sm-danger">{error}</Text>}
        </View>
    )
}

/** Adds extensions from a manifest link or a whole repository; the marketplace is one tap away. */
export function AddExtensionSheet({ t, open, onOpenChange, installedIds, onBrowseMarketplace }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    installedIds: Set<string>
    onBrowseMarketplace: () => void
}) {
    const [manifestUrl, setManifestUrl] = React.useState("")
    const [repositoryUrl, setRepositoryUrl] = React.useState("")
    const { mutate: find, data: found, isPending: finding, reset: resetFound } = useFetchExternalExtensionData(null)
    const { mutate: fromRepository, data: repository, isPending: importing, reset: resetRepository } = useInstallExternalExtensionRepository()
    const { mutate: install, isPending: installing } = useInstallExternalExtension()
    // The page gives the sheet a new key per opening, so links and results of the last visit are gone.

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
                onOpenChange(false)
            },
        })
    }
    const listed = sortExtensions(repository?.extensions ?? [])

    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={t("Add extensions", "Erweiterungen hinzufügen")} dense>
            <RowGroup>
                <SheetAction icon={Store} label={t("Browse the marketplace", "Im Marktplatz stöbern")} note={t("Streaming and manga sources, plugins", "Streaming- und Manga-Quellen, Plugins")}
                    onPress={onBrowseMarketplace} />
            </RowGroup>

            <SheetGroup title={t("From a link", "Über einen Link")}>
                <UrlField t={t} label={t("Link to the extension's manifest (.json)", "Link zum Manifest der Erweiterung (.json)")} value={manifestUrl}
                    onChange={value => {
                        setManifestUrl(value)
                        resetFound()
                    }} placeholder="https://…/manifest.json" onSubmit={findManifest} />
                {!found && <Button intent="secondary" loading={finding} onPress={findManifest}>{t("Find extension", "Erweiterung suchen")}</Button>}
                {!!found && (
                    <View className="gap-3 rounded-surface bg-sm-surface-raised p-4">
                        <View className="flex-row items-center gap-3">
                            <ExtensionIcon extension={found} />
                            <View className="min-w-0 flex-1">
                                <Text className="font-semibold">{found.name}</Text>
                                <Text className="text-xs text-sm-text-muted">{[extensionTypeLabel(found.type, t), extensionMeta(found, t)].filter(Boolean).join(" · ")}</Text>
                            </View>
                        </View>
                        {!!found.description && <BlockText>{found.description}</BlockText>}
                        {installedIds.has(found.id)
                            ? <View className="min-h-12 flex-row items-center justify-center gap-2"><Check size={18} color={colors.smTextMuted} /><Text className="font-semibold text-sm-text-muted">{t("Already installed", "Schon installiert")}</Text></View>
                            : <Button loading={installing} leftIcon={<Download size={18} color="#ffffff" />} onPress={() => install({ manifestUri: found.manifestURI }, {
                                onSuccess: response => {
                                    toast.success(response?.message || t("Installed", "Installiert"))
                                    onOpenChange(false)
                                },
                            })}>{t("Install", "Installieren")}</Button>}
                    </View>
                )}
            </SheetGroup>

            <SheetGroup title={t("From a repository", "Aus einem Repository")}
                intro={t("Lists every extension of a repository, then installs them all at once.", "Zeigt alle Erweiterungen eines Repositorys und installiert sie dann auf einmal.")}>
                <UrlField t={t} label={t("Link to the repository (.json)", "Link zum Repository (.json)")} value={repositoryUrl}
                    onChange={value => {
                        setRepositoryUrl(value)
                        resetRepository()
                    }} placeholder="https://…/index.json" onSubmit={() => loadRepository(false)} />
                {!repository && <Button intent="secondary" loading={importing} onPress={() => loadRepository(false)}>{t("Show extensions", "Erweiterungen zeigen")}</Button>}
                {!!repository && (listed.length > 0 ? <>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 288 }} className="rounded-surface" contentContainerClassName="gap-0.5"
                        accessibilityLabel={t("Extensions in the repository", "Erweiterungen im Repository")}>
                        {listed.map(extension => (
                            <View key={extension.id} className="flex-row items-center gap-3 bg-sm-surface-raised px-4 py-2.5">
                                <ExtensionIcon extension={extension} />
                                <View className="min-w-0 flex-1">
                                    <Text className="font-semibold">{extension.name}</Text>
                                    <Text className="text-xs text-sm-text-muted">{extensionTypeLabel(extension.type, t)}</Text>
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                    <Button loading={importing} leftIcon={<Download size={18} color="#ffffff" />} onPress={() => loadRepository(true)}>
                        {t(`Install all ${listed.length}`, `Alle ${listed.length} installieren`)}
                    </Button>
                </> : <Muted>{repository.message || t("This repository has no extensions.", "Dieses Repository hat keine Erweiterungen.")}</Muted>)}
            </SheetGroup>
        </Sheet>
    )
}

/** The extension's preferences (extension-user-config.tsx): text, switch and select fields, saved together. */
export function ExtensionPreferencesSheet({ t, open, onOpenChange, extension, userConfigError }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    extension: Extension_Extension
    userConfigError?: Extension_InvalidExtension
}) {
    const { data, isLoading, isError } = useGetExtensionUserConfig(extension.id)
    const { mutate: save, isPending } = useSaveExtensionUserConfig()
    // Per extension: the form starts from what this extension saved, never from another one's typed values
    const [values, setValues] = React.useState<Record<string, string>>({})
    const [loaded, setLoaded] = React.useState<typeof data>()
    if (data && loaded !== data) {
        setLoaded(data)
        setValues({ ...data.savedUserConfig?.values })
    }
    const setValue = (name: string, value: string) => setValues(prev => ({ ...prev, [name]: value }))
    const defaultNote = (value?: string) => value ? `${t("Default", "Standard")}: ${value}` : undefined

    return (
        <Sheet dense open={open} onOpenChange={onOpenChange} title={t("Preferences", "Einstellungen")}
            description={`${extension.name} · ${t("You can edit the preferences for this extension here.", "Hier änderst du die Einstellungen dieser Erweiterung.")}`}
            footer={data ? <Button size="lg" wrapperClassName="flex-1" loading={isPending} onPress={() => save({
                id: extension.id, version: data.userConfig?.version || 0, values: userConfigValues(data.userConfig?.fields, values),
            })}>{t("Save", "Speichern")}</Button> : undefined}>
            {isLoading ? <ActivityIndicator color={colors.smAccent} />
                : isError || !data ? <Notice text={t("The preferences could not be loaded.", "Die Einstellungen konnten nicht geladen werden.")} />
                    : <>
                        {!!userConfigError && (
                            <View className="rounded-surface bg-sm-surface-raised px-4 py-3">
                                <Text className="text-sm leading-[21px] text-sm-warning">{userConfigError.reason.includes("user config is missing")
                                    ? t("Fill out the required configuration options.", "Fülle die nötigen Einstellungen aus.") : userConfigError.reason}</Text>
                            </View>
                        )}
                        {data.userConfig?.fields?.map(field => {
                            if (field.type === "switch") return (
                                <View key={field.name} className="gap-1">
                                    <SwitchRow label={field.label} description={defaultNote(field.default)}
                                        checked={values[field.name] ? values[field.name] === "true" : field.default === "true"}
                                        onCheckedChange={checked => setValue(field.name, checked ? "true" : "false")} />
                                </View>
                            )
                            if (field.type === "select" && field.options) return (
                                <View key={field.name} className="gap-1">
                                    <SelectField label={field.label} placeholder={field.label} value={values[field.name] || field.default}
                                        onValueChange={value => setValue(field.name, value)} options={field.options} />
                                    {!!field.default && <Muted>{defaultNote(field.options.find(o => o.value === field.default)?.label ?? "N/A")}</Muted>}
                                </View>
                            )
                            if (field.type === "text") return (
                                <View key={field.name} className="gap-1.5">
                                    <Text className="text-[13px] font-semibold text-sm-text-muted">{field.label}</Text>
                                    <TextInput value={values[field.name] || field.default || ""} onChangeText={value => setValue(field.name, value)} accessibilityLabel={field.label}
                                        autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.smTextSubtle}
                                        className="min-h-12 rounded-surface bg-sm-surface-raised px-4 font-sans text-[15px] text-sm-text" />
                                    {!!field.default && <Muted>{defaultNote(field.default)}</Muted>}
                                </View>
                            )
                            return null
                        })}
                    </>}
        </Sheet>
    )
}

/** Lines shown at once in the code sheet; long payloads load in steps so the sheet opens without a stall */
const CODE_PAGE_LINES = 400

/**
 * The extension's code (extension-code.tsx): all of it to read or edit and save, or an update's changes line by line.
 * CodeMirror is a browser editor; here the code is a monospace field (edit) or text (read, diff).
 */
export function ExtensionCodeSheet({ t, open, onOpenChange, extension, readOnly, diff }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    extension: Extension_Extension
    readOnly: boolean
    diff?: string
}) {
    const { data: payload, isLoading } = useGetExtensionPayload(extension.id)
    const { mutate: updateCode, isPending } = useUpdateExtensionCode()
    const [code, setCode] = React.useState(extension.payload ?? "")
    const [shownLines, setShownLines] = React.useState(CODE_PAGE_LINES)
    // the stored code replaces the manifest's copy once it arrives
    const [loaded, setLoaded] = React.useState<string>()
    if (payload && loaded !== payload) {
        setLoaded(payload)
        setCode(payload)
    }
    const original = payload ?? extension.payload ?? ""
    const changes = React.useMemo(() => diff ? lineDiff(code, diff) : null, [code, diff])
    const lines = React.useMemo(() => changes ? null : normalizeDiffCode(code).split("\n"), [changes, code])

    const save = () => {
        if (isPending || code === original || !code.length) return
        updateCode({ id: extension.id, payload: code })
    }

    const body = changes ?? lines!.map(text => ({ kind: "same" as const, text }))
    const total = body.length
    return (
        <Sheet dense open={open} onOpenChange={onOpenChange} title={diff ? t("Changes", "Änderungen") : t("Code", "Code")}
            description={!readOnly && !diff ? `${extension.name} · ${t("You can edit the code of the extension here.", "Hier kannst du den Code der Erweiterung bearbeiten.")}` : extension.name}
            footer={!readOnly && !diff
                ? <Button size="lg" wrapperClassName="flex-1" loading={isPending} disabled={code === original || !code.length} onPress={save}>{t("Save", "Speichern")}</Button>
                : undefined}>
            {isLoading ? <ActivityIndicator color={colors.smAccent} />
                : !readOnly && !diff
                    ? <TextInput multiline value={code} onChangeText={setCode} accessibilityLabel={t("Code", "Code")} autoCapitalize="none" autoCorrect={false}
                        spellCheck={false} textAlignVertical="top" scrollEnabled={false}
                        style={MONO} className="min-h-60 rounded-surface-sm bg-sm-surface-sunken p-3 text-xs leading-[18px] text-sm-text" />
                    : <View className="overflow-hidden rounded-surface-sm bg-sm-surface-sunken py-2">
                        {body.slice(0, shownLines).map((line, index) => (
                            <Text key={index} selectable style={MONO}
                                className={cn("px-3 text-xs leading-[18px]", line.kind === "add" ? "bg-[rgba(100,160,128,0.14)] text-sm-success"
                                    : line.kind === "del" ? "bg-[rgba(242,167,182,0.1)] text-sm-danger" : "text-sm-text-muted")}>
                                {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : changes ? "  " : ""}{line.text || " "}
                            </Text>
                        ))}
                        {total > shownLines && (
                            <View className="px-1 pt-1">
                                <Button intent="text" onPress={() => setShownLines(n => n + CODE_PAGE_LINES * 2)}>
                                    {t(`Show more (${total - shownLines} lines)`, `Mehr zeigen (${total - shownLines} Zeilen)`)}
                                </Button>
                            </View>
                        )}
                    </View>}
        </Sheet>
    )
}
