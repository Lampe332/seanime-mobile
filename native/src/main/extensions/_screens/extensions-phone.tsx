import type { ExtensionRepo_AllExtensions, Extension_Extension } from "@/api/generated/types"
import { useGetAllExtensions, useInstallExternalExtension } from "@/api/hooks/extensions.hooks"
import { PhoneEmpty, PhoneSection, useLastData } from "@/components/shared/phone-cards"
import { LoadingRows, Notice, RowGroup, SearchField, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover/popover"
import { useStartMobileTutorial } from "@/main/_features/tour/mobile-tutorial"
import { TOUR_TARGETS } from "@/main/_features/tour/tour-targets"
import { useIsFocused } from "expo-router"
import { useAtom, useSetAtom } from "jotai"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Download from "lucide-react-native/icons/download"
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical"
import GraduationCap from "lucide-react-native/icons/graduation-cap"
import Plus from "lucide-react-native/icons/plus"
import RefreshCcw from "lucide-react-native/icons/refresh-ccw"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { extensionMeta, getInstalledOverview, invalidReasonLabel } from "../_lib/extensions-phone"
import { type ExtensionSelection, findSelection, installedExtensionIds } from "../_lib/extensions-screen"
import { __extensions_currentPageAtom } from "../_lib/marketplace.atoms"
import { __extensions_marketTypeAtom, MarketplacePhone } from "./extensions-phone-marketplace"
import {
    AddExtensionSheet, ExtensionCodeSheet, ExtensionIcon, ExtensionPreferencesSheet, ExtensionSheet, type ExtensionSubSheet,
} from "./extensions-phone-sheets"

/** Search appears once the list is long enough to need it. */
const SEARCH_FROM = 8

/*
 * The Extensions tab (web extensions-phone.tsx + extensions-phone.css): a quiet title with the update check and "Add" as
 * icon actions, Installed and Marketplace as tabs, updates and problems first, then one list per type. Each extension
 * opens one sheet with all of its actions; preferences and code open over it (the page closes the sheet meanwhile and
 * opens it again after). Tablet: the type lists stand in two columns (tablet.css `.mex-panel`). The ⋮ menu replays the
 * setup tour (2.16); the Playground (a desktop code runner) is not here, see docs §9.
 */
export function ExtensionsPhone({ page: initialPage, marketType }: { page?: "installed" | "marketplace", marketType?: string }) {
    const t = useTr()
    const router = useRouter()
    const { rail } = useTabletLayout()
    // the setup tour points only at the tab on screen
    const focused = useIsFocused()
    const startTutorial = useStartMobileTutorial()
    const [page, setPage] = useAtom(__extensions_currentPageAtom)
    const setMarketType = useSetAtom(__extensions_marketTypeAtom)

    // A link (Torrent sheet, Online tab: "Find more providers") chooses the tab and the marketplace's type
    React.useEffect(() => {
        if (marketType) {
            setMarketType(marketType)
            setPage("marketplace")
        } else if (initialPage) {
            setPage(initialPage)
        }
    }, [initialPage, marketType, setMarketType, setPage])

    const [withUpdates, setWithUpdates] = React.useState(false)
    const query = useGetAllExtensions(withUpdates)
    // Checking for updates is a new request; the list stays on screen meanwhile instead of turning into a spinner.
    const all: ExtensionRepo_AllExtensions | undefined = useLastData(query.data)
    const loading = !all && query.isPending
    const failed = !all && query.isError
    const checking = withUpdates && query.isFetching

    const [search, setSearch] = React.useState("")
    const [selectedId, setSelectedId] = React.useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [subSheet, setSubSheet] = React.useState<ExtensionSubSheet | null>(null)
    const [addOpen, setAddOpen] = React.useState(false)
    const [addKey, setAddKey] = React.useState(0)

    const overview = React.useMemo(() => getInstalledOverview(all, search), [all, search])
    const selection = React.useMemo(() => findSelection(all, selectedId), [all, selectedId])
    const installedIds = React.useMemo(() => installedExtensionIds(all), [all])

    // An uninstalled extension closes its sheet: without a selection the sheets below are not rendered.

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
    }, [withUpdates, query.isFetching, query.data, query.isError, t])

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
    const openSubSheet = (sheet: ExtensionSubSheet) => {
        setSheetOpen(false)
        setSubSheet(sheet)
    }
    const closeSubSheet = (open: boolean) => {
        if (open) return
        setSubSheet(null)
        if (selection) setSheetOpen(true)
    }
    const openMarketplace = (type: string) => {
        setMarketType(type)
        setPage("marketplace")
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
    const attention = [...overview.permissions, ...overview.broken]
    // Tablet: two columns once there are two type lists (tablet.css .mex-panel:has(> .mex-section + .mex-section))
    const twoColumns = rail && overview.groups.length + (attention.length ? 1 : 0) > 1
    const columnClass = twoColumns ? "w-[48.5%]" : "w-full"

    return (
        <PhoneScreen title={t("Extensions", "Erweiterungen")} subtitle={facts} actions={<>
            <Button intent="icon" accessibilityLabel={checking ? t("Checking for updates", "Updates werden geprüft") : t("Check for updates", "Nach Updates suchen")}
                disabled={checking || loading} onPress={checkForUpdates}>
                {checking ? <ActivityIndicator size="small" color={colors.smTextMuted} /> : <RefreshCcw size={22} color={colors.smTextMuted} />}
            </Button>
            <Button intent="icon" accessibilityLabel={t("Add extensions", "Erweiterungen hinzufügen")} onPress={() => {
                setAddKey(key => key + 1)
                setAddOpen(true)
            }}>
                <Plus size={22} color={colors.smTextMuted} />
            </Button>
            <Popover>
                <PopoverTrigger asChild>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("More actions", "Weitere Aktionen")}
                        className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                        <EllipsisVertical size={22} color={colors.smTextMuted} />
                    </Pressable>
                </PopoverTrigger>
                <PopoverContent align="end">
                    <PopoverClose asChild>
                        <Pressable accessibilityRole="menuitem" onPress={() => startTutorial({ fromExtensions: true })}
                            className="min-h-12 flex-row items-center gap-3 rounded-[10px] px-3 active:bg-sm-surface-control">
                            <GraduationCap size={18} color={colors.smTextMuted} />
                            <Text className="text-[15px]">{t("Setup tour", "Einrichtungs-Tour")}</Text>
                        </Pressable>
                    </PopoverClose>
                </PopoverContent>
            </Popover>
        </>}>
            <Tabs variant="pills" value={installed ? "installed" : "marketplace"} onValueChange={value => setPage(value as "installed" | "marketplace")}
                items={[
                    { value: "installed", label: t("Installed", "Installiert") + (overview.attention > 0 ? " •" : ""), count: all ? overview.total : undefined },
                    { value: "marketplace", label: t("Marketplace", "Marktplatz"), tourTarget: focused ? TOUR_TARGETS.marketplaceTab : undefined },
                ]} />

            {!installed ? <MarketplacePhone t={t} installedIds={installedIds} tourOn={focused} />
                : failed ? (
                    <Notice text={t("Your extensions could not be loaded.", "Deine Erweiterungen konnten nicht geladen werden.")}>
                        <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void query.refetch()} />
                    </Notice>
                ) : loading ? <LoadingRows label={t("Loading extensions", "Erweiterungen werden geladen")} count={5} />
                    : <>
                        {overview.safeUpdates.length > 0 && (
                            <View className="gap-3.5 rounded-surface bg-sm-surface-raised p-4">
                                <View className="gap-1">
                                    <Text className="text-base font-bold">{overview.safeUpdates.length === 1 ? t("1 update available", "1 Update verfügbar")
                                        : t(`${overview.safeUpdates.length} updates available`, `${overview.safeUpdates.length} Updates verfügbar`)}</Text>
                                    <Muted>{overview.safeUpdates.map(update => findSelection(all, update.extensionID)?.extension.name || update.extensionID).join(", ")}</Muted>
                                    {overview.updates > overview.safeUpdates.length && <Muted>{t("Plugins with unsafe flags are updated one by one from their sheet.",
                                        "Plugins mit unsicheren Flags aktualisierst du einzeln über ihr Blatt.")}</Muted>}
                                </View>
                                <Button loading={updatingAll} leftIcon={<Download size={18} color="#ffffff" />} onPress={() => void updateAll()}>{t("Update all", "Alle aktualisieren")}</Button>
                            </View>
                        )}

                        {overview.total >= SEARCH_FROM && <SearchField value={search} onChangeText={setSearch} placeholder={t("Search installed extensions", "Installierte Erweiterungen durchsuchen")} />}

                        <View className={cn("gap-5", twoColumns && "flex-row flex-wrap justify-between")}>
                            {attention.length > 0 && (
                                <PhoneSection className={columnClass} title={t("Needs attention", "Braucht Aufmerksamkeit")} count={attention.length}>
                                    <RowGroup>
                                        {attention.map(item => {
                                            const permission = item.code === "plugin_permissions_not_granted"
                                            return <InstalledRow key={item.id} t={t} id={item.id} extension={item.extension} onOpen={openExtension}
                                                flag={permission ? t("Needs your permission", "Braucht deine Erlaubnis") : invalidReasonLabel(item.code, t)}
                                                tone={permission ? "warning" : "danger"} />
                                        })}
                                    </RowGroup>
                                </PhoneSection>
                            )}

                            {overview.groups.map(group => (
                                <PhoneSection key={group.key} className={columnClass} title={t(group.en, group.de)} count={group.items.length}
                                    action={group.key === "custom-source"
                                        ? <TextAction label={t("Browse", "Durchsuchen")} onPress={() => router.push("/custom-sources")} />
                                        : group.key !== "disabled" ? <TextAction label={`+ ${t("Add", "Hinzufügen")}`} onPress={() => openMarketplace(group.key)}
                                            accessibilityLabel={t(`Add ${group.en.toLowerCase()}`, `${group.de} hinzufügen`)} /> : undefined}>
                                    {group.items.length === 0 && (
                                        <View className="items-start gap-3 rounded-surface bg-sm-surface-raised p-4">
                                            <Text className="text-sm leading-[21px] text-sm-text-muted">{group.key === "onlinestream-provider"
                                                ? t("No streaming source yet. Episodes can only be streamed with one.", "Noch keine Streaming-Quelle. Ohne sie lassen sich keine Folgen streamen.")
                                                : t("No manga source yet. Chapters can only be read and downloaded with one.", "Noch keine Manga-Quelle. Ohne sie lassen sich keine Kapitel lesen oder laden.")}</Text>
                                            <Button onPress={() => openMarketplace(group.key)}>
                                                {group.key === "onlinestream-provider" ? t("Find a streaming source", "Streaming-Quelle finden") : t("Find a manga source", "Manga-Quelle finden")}
                                            </Button>
                                        </View>
                                    )}
                                    {group.items.length > 0 && (
                                        <RowGroup>
                                            {group.items.map(extension => {
                                                const update = all?.hasUpdate?.find(item => item.extensionID === extension.id)
                                                const setup = all?.invalidUserConfigExtensions?.some(item => item.id === extension.id)
                                                return <InstalledRow key={extension.id} t={t} id={extension.id} extension={extension} onOpen={openExtension} dim={group.key === "disabled"}
                                                    flag={setup ? t("Needs setup", "Muss eingerichtet werden") : update ? t(`Update to ${update.version}`, `Update auf ${update.version}`) : undefined}
                                                    tone={setup ? "warning" : update ? "accent" : undefined} />
                                            })}
                                        </RowGroup>
                                    )}
                                </PhoneSection>
                            ))}
                        </View>

                        {nothingFound && (
                            <PhoneEmpty title={t("No extension matches", "Keine Erweiterung passt")} text={t("The search looks at names, descriptions and IDs.", "Die Suche prüft Namen, Beschreibungen und IDs.")}>
                                <Button intent="secondary" onPress={() => setSearch("")}>{t("Clear search", "Suche leeren")}</Button>
                            </PhoneEmpty>
                        )}
                    </>}

            {!!selection && <SelectionSheets t={t} selection={selection} open={sheetOpen} onOpenChange={setSheetOpen} subSheet={subSheet}
                onSubSheet={openSubSheet} onSubSheetChange={closeSubSheet} />}
            {/* a new key per opening: the links and found extensions of the last visit are gone (web: reset on close) */}
            <AddExtensionSheet key={addKey} t={t} open={addOpen} onOpenChange={setAddOpen} installedIds={installedIds}
                onBrowseMarketplace={() => {
                    setAddOpen(false)
                    setPage("marketplace")
                }} />
        </PhoneScreen>
    )
}

/** The sheet of one extension and what it opens over itself */
function SelectionSheets({ t, selection, open, onOpenChange, subSheet, onSubSheet, onSubSheetChange }: {
    t: Translate
    selection: ExtensionSelection
    open: boolean
    onOpenChange: (open: boolean) => void
    subSheet: ExtensionSubSheet | null
    onSubSheet: (sheet: ExtensionSubSheet) => void
    onSubSheetChange: (open: boolean) => void
}) {
    return <>
        <ExtensionSheet key={selection.extension.id} t={t} open={open} onOpenChange={onOpenChange} {...selection} onSubSheet={onSubSheet} />
        {subSheet?.kind === "preferences" && <ExtensionPreferencesSheet t={t} open onOpenChange={onSubSheetChange} extension={selection.extension}
            userConfigError={selection.userConfigError} />}
        {subSheet?.kind === "code" && <ExtensionCodeSheet t={t} open onOpenChange={onSubSheetChange} extension={selection.extension} readOnly={subSheet.readOnly}
            diff={subSheet.diff} />}
    </>
}

function InstalledRow({ t, id, extension, flag, tone, dim, onOpen }: {
    t: Translate
    id: string
    extension: Extension_Extension | undefined
    flag?: string
    tone?: "accent" | "warning" | "danger"
    dim?: boolean
    onOpen: (id: string) => void
}) {
    const meta = extensionMeta(extension, t)
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={[extension?.name || id, flag].filter(Boolean).join(", ")} onPress={() => onOpen(id)}
            className="min-h-[68px] w-full flex-row items-center gap-3.5 bg-sm-surface-raised py-3 pl-4 pr-3 active:bg-sm-surface-control">
            <View style={dim ? { opacity: 0.6 } : undefined}><ExtensionIcon extension={extension} /></View>
            <View style={dim ? { opacity: 0.6 } : undefined} className="min-w-0 flex-1 gap-0.5">
                <Text className="font-semibold leading-[20px]">{extension?.name || id}</Text>
                {!!extension?.description && <Text numberOfLines={1} className="text-[13px] leading-[19px] text-sm-text-muted">{extension.description}</Text>}
                {!!meta && <Text className="text-xs text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{meta}</Text>}
                {!!flag && <Text className={cn("text-xs font-semibold", tone === "accent" ? "text-sm-accent" : tone === "warning" ? "text-sm-warning"
                    : tone === "danger" ? "text-sm-danger" : "text-sm-text-muted")}>{flag}</Text>}
            </View>
            <ChevronRight size={18} color={colors.smTextSubtle} />
        </Pressable>
    )
}
