import type { Extension_Extension } from "@/api/generated/types"
import { useGetMarketplaceExtensions, useInstallExternalExtension } from "@/api/hooks/extensions.hooks"
import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { LoadingRows, Notice, RowGroup, SearchField, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Select } from "@/components/ui/select/select"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { appLanguageAtom, type Translate } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { LANGUAGES_LIST } from "@/main/manga/_lib/language-map"
import NetInfo from "@react-native-community/netinfo"
import { pressTourTarget, TOUR_TARGETS, useTourTarget } from "@/main/_features/tour/tour-targets"
import { useDebounce } from "@/hooks/use-debounce"
import * as Clipboard from "expo-clipboard"
import { atom, useAtom, useAtomValue } from "jotai"
import Check from "lucide-react-native/icons/check"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste"
import Download from "lucide-react-native/icons/download"
import Plus from "lucide-react-native/icons/plus"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import Store from "lucide-react-native/icons/store"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import { extensionMeta, shortRepositoryUrl } from "../_lib/extensions-phone"
import { marketplaceView, OVERVIEW_ROWS } from "../_lib/extensions-screen"
import { marketplaceLink, marketplacePreview, rememberMarketplace, sameMarketplace, storedMarketplace } from "../_lib/marketplace-link"
import { DEFAULT_MARKETPLACE_URL, marketplaceUrlAtom, recentMarketplacesAtom } from "../_lib/marketplace.atoms"
import { ExtensionIcon, MarketplaceSheet, SheetAction, UrlField } from "./extensions-phone-sheets"

/** The marketplace's type filter; the Installed tab's "Add" actions and `/extensions?type=` open it on a type. */
export const __extensions_marketTypeAtom = atom("all")

/**
 * Phone marketplace (web extensions-phone-marketplace.tsx): the marketplace in use with its reload and change actions
 * (another one is added by pasting its link), type chips with counts, search and content language, then the
 * extensions as rows with one install button each. Installing only happens on the user's tap.
 * `tourOn` (the tab is on screen): the setup tour points at the add/change button, the type chips, the first install
 * buttons and the add sheet with its Add.
 */
/**
 * A tab pane that stays mounted while the other tab shows. display "none" would take its native views down and build them
 * again on the next switch (10-20 ms on the UI thread per tap); out of the flow, see-through, untouchable and hidden from
 * screen readers it costs nothing. Both panes belong in one wrapper without padding: the hidden pane's left/right 0 count
 * from the padding edge, and a different width would measure all of its text again on every switch.
 */
export function tabPaneProps(shown: boolean) {
    return shown ? SHOWN_PANE : HIDDEN_PANE
}
const SHOWN_PANE = { importantForAccessibility: "auto", accessibilityElementsHidden: false } as const
const HIDDEN_PANE = {
    style: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0, pointerEvents: "none" },
    importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true,
} as const

export function MarketplacePhone({ t, installedIds, tourOn, active = true }: { t: Translate, installedIds: Set<string>, tourOn: boolean, active?: boolean }) {
    const [url, setUrl] = useAtom(marketplaceUrlAtom)
    const appLanguage = useAtomValue(appLanguageAtom)
    const { data, isPending, isError, isFetching, refetch } = useGetMarketplaceExtensions(url)
    const [type, setType] = useAtom(__extensions_marketTypeAtom)
    const [language, setLanguage] = React.useState("all")
    const [search, setSearch] = React.useState("")
    const [repoOpen, setRepoOpen] = React.useState(false)
    // a new key per opening: the sheet starts without the last visit's link
    const [repoKey, setRepoKey] = React.useState(0)
    const [recent, setRecent] = useAtom(recentMarketplacesAtom)
    const [selected, setSelected] = React.useState<Extension_Extension | null>(null)
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [offline, setOffline] = React.useState(false)
    // hidden behind Installed it starts over as a newly opened marketplace did: no search, all languages, no sheet
    const [shownActive, setShownActive] = React.useState(active)
    if (shownActive !== active) {
        setShownActive(active)
        if (!active) {
            setSearch("")
            setLanguage("all")
            setSheetOpen(false)
            setRepoOpen(false)
        }
    }
    const isDefault = url === DEFAULT_MARKETPLACE_URL

    const view = React.useMemo(() => marketplaceView(data, { type, language, search }, appLanguage, isDefault), [data, type, language, search, appLanguage, isDefault])
    // the repository step points at "Add repository" while the notice shows, else at "Change"
    const missing = view.missing.length > 0
    const changeRef = useTourTarget(tourOn && !missing ? TOUR_TARGETS.changeRepo : null)
    const addRef = useTourTarget(tourOn && missing ? TOUR_TARGETS.changeRepo : null, "add")

    // The error names a missing connection (web: navigator.onLine)
    React.useEffect(() => {
        if (!isError) return
        void NetInfo.fetch().then(state => setOffline(state.isConnected === false))
    }, [isError])

    const openRepository = () => {
        setRepoKey(key => key + 1)
        setRepoOpen(true)
    }
    // the marketplace left behind stays one tap away, also one added before the list of recent ones existed
    const chooseMarketplace = (next: string) => {
        setRecent(rememberMarketplace(rememberMarketplace(recent, url), next))
        setUrl(storedMarketplace(next))
        setRepoOpen(false)
        toast.success(sameMarketplace(next, DEFAULT_MARKETPLACE_URL) ? t("Using the official marketplace", "Offizieller Marktplatz wird genutzt") : t("Marketplace added", "Marktplatz hinzugefügt"))
    }
    const resetFilters = () => {
        setType("all")
        setLanguage("all")
        setSearch("")
    }
    const openSheet = React.useCallback((extension: Extension_Extension) => {
        setSelected(extension)
        setSheetOpen(true)
    }, [])

    return (
        <View className="gap-5" {...tabPaneProps(active)}>
            <View accessibilityLabel={t("Marketplace", "Marktplatz")} className="min-h-[68px] flex-row items-center gap-1 rounded-surface bg-sm-surface-raised py-2 pl-4 pr-2">
                <View className="min-w-0 flex-1 gap-px">
                    <Text numberOfLines={1} className="font-semibold">{isDefault ? t("Official marketplace", "Offizieller Marktplatz") : shortRepositoryUrl(url)}</Text>
                    {!!data && <Text className="text-xs text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                        {view.usable.length === 1 ? t("1 extension", "1 Erweiterung") : t(`${view.usable.length} extensions`, `${view.usable.length} Erweiterungen`)}
                    </Text>}
                </View>
                <Button intent="icon" accessibilityLabel={t("Reload marketplace", "Marktplatz neu laden")} disabled={isFetching} onPress={() => void refetch()}>
                    {isFetching ? <ActivityIndicator size="small" color={colors.smTextMuted} /> : <RotateCw size={22} color={colors.smTextMuted} />}
                </Button>
                <View ref={changeRef} collapsable={false}>
                    <TextAction label={t("Change", "Ändern")} onPress={() => {
                        if (!missing) pressTourTarget(TOUR_TARGETS.changeRepo)
                        openRepository()
                    }} />
                </View>
            </View>

            {missing && (
                <View className="gap-3 rounded-surface bg-sm-surface-raised p-4">
                    <View className="gap-1">
                        <Text className="text-base font-bold">{view.missing.length > 1 ? t("No streaming or manga sources here", "Hier gibt es keine Streaming- oder Manga-Quellen")
                            : view.missing[0].type === "manga-provider" ? t("No manga sources here", "Hier gibt es keine Manga-Quellen")
                                : t("No streaming sources here", "Hier gibt es keine Streaming-Quellen")}</Text>
                        <Text className="text-sm leading-[21px] text-sm-text-muted">{t("Add a community marketplace with its link.", "Füge einen Community-Marktplatz über seinen Link hinzu.")}</Text>
                    </View>
                    <View ref={addRef} collapsable={false} className="flex-row"><Button wrapperClassName="flex-1" leftIcon={<Plus size={18} color={colors.onBrand} />} onPress={() => {
                        pressTourTarget(TOUR_TARGETS.changeRepo)
                        openRepository()
                    }}>{t("Add marketplace", "Marktplatz hinzufügen")}</Button></View>
                </View>
            )}

            {view.usable.length > 0 && (
                <View className="gap-3">
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 grow-0" contentContainerClassName="gap-2 px-4"
                        accessibilityLabel={t("Type", "Art")} accessibilityRole="tablist">
                        {view.chips.map(chip => <TypeChip key={chip.type} t={t} chip={chip} chosen={type === chip.type} tourOn={tourOn} onPress={() => setType(chip.type)} />)}
                    </ScrollView>
                    <View className="flex-row flex-wrap gap-2">
                        <View className="min-w-[192px] flex-1"><SearchField value={search} onChangeText={setSearch} placeholder={t("Search", "Suchen")} /></View>
                        {view.languages.length > 1 && (
                            <View className="min-w-[144px] flex-1">
                                <Select value={language} onValueChange={setLanguage} placeholder={t("All languages", "Alle Sprachen")} accessibilityLabel={t("Content language", "Sprache der Inhalte")}
                                    options={[{ value: "all", label: t("All languages", "Alle Sprachen") }, ...view.languages.map(code => ({
                                        value: code, label: code === "multi" ? t("Multiple languages", "Mehrere Sprachen") : LANGUAGES_LIST[code]?.nativeName || code.toUpperCase(),
                                    }))]} />
                            </View>
                        )}
                    </View>
                </View>
            )}

            {isError && !data ? (
                <Notice text={offline ? t("No internet connection, so the marketplace could not be loaded.", "Keine Internetverbindung, deshalb konnte der Marktplatz nicht geladen werden.")
                    : t("The marketplace could not be loaded.", "Der Marktplatz konnte nicht geladen werden.")}>
                    <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void refetch()} />
                    <TextAction label={t("Change marketplace", "Marktplatz ändern")} onPress={openRepository} />
                </Notice>
            ) : isPending ? <LoadingRows label={t("Loading the marketplace", "Marktplatz wird geladen")} count={5} />
                : view.usable.length === 0 ? (
                    <PhoneEmpty title={t("No extensions in this marketplace", "Keine Erweiterungen in diesem Marktplatz")}
                        text={t("It has nothing the phone app can use.", "Er enthält nichts, was die Handy-App nutzen kann.")}>
                        <Button intent="secondary" onPress={openRepository}>{t("Change marketplace", "Marktplatz ändern")}</Button>
                    </PhoneEmpty>
                ) : view.groups.length === 0 ? (view.typeMissing ? (
                    <PhoneEmpty title={t(`${view.typeMissing.noneEn} in this marketplace`, `${view.typeMissing.noneDe} in diesem Marktplatz`)}
                        text={t("Other marketplaces have them.", "Andere Marktplätze haben sie.")}>
                        <Button intent="secondary" onPress={openRepository}>{t("Add marketplace", "Marktplatz hinzufügen")}</Button>
                    </PhoneEmpty>
                ) : (
                    <PhoneEmpty title={t("No extensions match", "Keine Erweiterung passt")} text={t("Try another type, language or search.", "Versuch eine andere Art, Sprache oder Suche.")}>
                        {view.filtered && <Button intent="secondary" onPress={resetFilters}>{t("Reset filters", "Filter zurücksetzen")}</Button>}
                    </PhoneEmpty>
                )) : view.groups.map(group => (
                    <PhoneSection key={group.type} title={t(group.en, group.de)} action={<Muted style={{ fontVariant: ["tabular-nums"] }}>{group.items.length}</Muted>}
                        note={group.type === "custom-source" ? t("Custom sources let you browse media beyond AniList. They don't stream; that needs a streaming source.",
                            "Eigene Quellen zeigen Titel über AniList hinaus. Sie streamen nicht, dafür braucht es eine Streaming-Quelle.") : undefined}>
                        <RowGroup>
                            {(view.overview ? group.items.slice(0, OVERVIEW_ROWS) : group.items).map(extension => (
                                <MarketRow key={extension.id} t={t} extension={extension} installed={installedIds.has(extension.id)} onOpen={openSheet} tourOn={tourOn} />
                            ))}
                            {view.overview && group.items.length > OVERVIEW_ROWS && (
                                <Pressable accessibilityRole="button" onPress={() => setType(group.type)}
                                    className="min-h-[52px] flex-row items-center justify-between gap-3 bg-sm-surface-raised px-4 py-2 active:bg-sm-surface-control">
                                    <Text className="font-semibold text-sm-accent">{t(`Show all ${group.items.length}`, `Alle ${group.items.length} zeigen`)}</Text>
                                    <ChevronRight size={18} color={colors.smAccent} />
                                </Pressable>
                            )}
                        </RowGroup>
                    </PhoneSection>
                ))}

            <AddMarketplaceSheet key={repoKey} t={t} open={repoOpen} onOpenChange={setRepoOpen} current={url} recent={recent} installedIds={installedIds} onUse={chooseMarketplace} />
            {!!selected && <MarketplaceSheet t={t} open={sheetOpen} onOpenChange={setSheetOpen} extension={selected} installed={installedIds.has(selected.id)} />}
        </View>
    )
}

/** A type chip; the setup tour points at Streaming and Manga */
function TypeChip({ t, chip, chosen, tourOn, onPress }: {
    t: Translate
    chip: { type: string, chipEn: string, chipDe: string, count: number }
    chosen: boolean
    tourOn: boolean
    onPress: () => void
}) {
    const target = TOUR_TARGETS.typeChip(chip.type)
    const tourRef = useTourTarget(tourOn ? target : null)
    return (
        <Pressable ref={tourRef} accessibilityRole="tab" accessibilityState={{ selected: chosen }} onPress={() => {
            pressTourTarget(target)
            onPress()
        }} className={`min-h-12 flex-row items-center gap-1.5 rounded-full px-4 ${chosen ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control"}`}>
            <Text className={`text-sm ${chosen ? "font-semibold text-sm-accent" : "font-medium text-sm-text-muted"}`}>{t(chip.chipEn, chip.chipDe)}</Text>
            <Text className={`text-sm ${chosen ? "font-semibold text-sm-accent" : "text-sm-text-subtle"}`} style={{ fontVariant: ["tabular-nums"] }}>{chip.count}</Text>
        </Pressable>
    )
}

const MarketRow = React.memo(function MarketRow({ t, extension, installed, onOpen, tourOn }: { t: Translate, extension: Extension_Extension, installed: boolean, onOpen: (extension: Extension_Extension) => void, tourOn: boolean }) {
    const { mutate: install, isPending } = useInstallExternalExtension()
    // The list only learns about the install from the server's reload event; until then the row keeps the result.
    const [justInstalled, setJustInstalled] = React.useState(false)
    const name = extension.name || extension.id
    // the tour's install steps point at the first install button of their type
    const installTarget = TOUR_TARGETS.install(extension.type)
    const tourRef = useTourTarget(tourOn && !installed && !justInstalled ? installTarget : null)
    return (
        <View className="min-h-[68px] flex-row items-center bg-sm-surface-raised">
            <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => onOpen(extension)}
                className="min-w-0 flex-1 flex-row items-center gap-3.5 self-stretch py-3 pl-4 active:bg-sm-surface-control">
                <ExtensionIcon extension={extension} />
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="font-semibold leading-[20px]">{name}</Text>
                    {!!extension.description && <Text numberOfLines={2} className="text-[13px] leading-[19px] text-sm-text-muted">{extension.description}</Text>}
                    <Text className="text-xs text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{extensionMeta(extension, t)}</Text>
                </View>
            </Pressable>
            {installed || justInstalled ? (
                <View accessibilityRole="image" accessibilityLabel={t(`${name} is installed`, `${name} ist installiert`)} className="mx-2 h-12 w-12 items-center justify-center">
                    <Check size={20} color={colors.smTextSubtle} />
                </View>
            ) : (
                <Pressable ref={tourRef} accessibilityRole="button" accessibilityLabel={t(`Install ${name}`, `${name} installieren`)} disabled={isPending}
                    onPress={() => {
                        pressTourTarget(installTarget)
                        install({ manifestUri: extension.manifestURI }, {
                            onSuccess: () => {
                                setJustInstalled(true)
                                toast.success(t(`Installed ${name}`, `${name} installiert`))
                            },
                        })
                    }}
                    className="mx-2 h-12 w-12 items-center justify-center rounded-full bg-sm-accent-soft active:bg-sm-accent-strong">
                    {isPending ? <ActivityIndicator size="small" color={colors.smAccent} /> : <Download size={20} color={colors.smAccent} />}
                </Pressable>
            )}
        </View>
    )
})

/**
 * Add a marketplace: one main button that pastes the copied link, then adds it once its preview loaded (what it offers,
 * how many are installed already). The official and earlier marketplaces are one tap each; typing the link is the
 * fallback. A GitHub page or repository link becomes the file the core reads (marketplaceLink).
 */
function AddMarketplaceSheet({ t, open, onOpenChange, current, recent, installedIds, onUse }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    current: string
    recent: string[]
    installedIds: Set<string>
    onUse: (url: string) => void
}) {
    const [draft, setDraft] = React.useState("")
    const link = marketplaceLink(draft)
    const checked = useDebounce(link, 400)
    const duplicate = !!link && sameMarketplace(link, current)
    const ready = !!link && checked === link && !duplicate
    const { data, isFetching, isError } = useGetMarketplaceExtensions(ready ? link : undefined, ready)
    const preview = ready && !isFetching && !isError && data ? marketplacePreview(data, installedIds) : null
    const canAdd = !!preview && preview.total > 0
    const checking = !!link && !duplicate && (!ready || isFetching)
    const known = [...(sameMarketplace(current, "") ? [] : [""]), ...recent.filter(item => !sameMarketplace(item, current))]

    const paste = async () => {
        const found = marketplaceLink((await Clipboard.getStringAsync().catch(() => "")) || "")
        if (found) setDraft(found)
        else toast.info(t("No link in the clipboard", "Kein Link in der Zwischenablage"))
    }
    const add = () => {
        if (!canAdd || !link) return
        pressTourTarget(TOUR_TARGETS.repoSave)
        onUse(link)
    }
    const facts = preview && [
        preview.total === 1 ? t("1 extension", "1 Erweiterung") : t(`${preview.total} extensions`, `${preview.total} Erweiterungen`),
        preview.streaming ? `${preview.streaming} Streaming` : "",
        preview.manga ? `${preview.manga} Manga` : "",
        preview.installed ? t(`${preview.installed} installed`, `${preview.installed} installiert`) : "",
    ].filter(Boolean).join(" · ")

    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={t("Add marketplace", "Marktplatz hinzufügen")} tourTarget={TOUR_TARGETS.repoSheet}
            footer={draft.trim()
                ? <Button size="lg" wrapperClassName="flex-1" disabled={!canAdd} loading={checking} leftIcon={<Plus size={18} color={colors.onBrand} />} onPress={add}>
                    {t("Add", "Hinzufügen")}</Button>
                : <Button size="lg" wrapperClassName="flex-1" leftIcon={<ClipboardPaste size={18} color={colors.onBrand} />} onPress={() => void paste()}>
                    {t("Paste link", "Link einfügen")}</Button>}>
            <View className="gap-2">
                <UrlField t={t} label={t("Link", "Link")} value={draft} onChange={setDraft} placeholder="https://github.com/…" onSubmit={add} pasteInside={false}
                    error={draft.trim() && !link ? t("Enter a full link that starts with https://", "Gib einen vollständigen Link mit https:// ein")
                        : isError && ready && !isFetching ? t("No marketplace found at this link", "Unter diesem Link gibt es keinen Marktplatz") : undefined} />
                {duplicate ? <Muted>{t("This is your marketplace already", "Das ist schon dein Marktplatz")}</Muted>
                    : checking ? <Muted>{t("Checking the link…", "Link wird geprüft …")}</Muted>
                        : preview ? (canAdd ? <Text className="text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{facts}</Text>
                            : <Text className="text-[13px] text-sm-danger">{t("Nothing here the phone app can use", "Nichts darin, was die Handy-App nutzen kann")}</Text>)
                            : null}
            </View>
            {known.length > 0 && (
                <SheetGroup title={t("Switch to", "Wechseln zu")}>
                    <RowGroup>
                        {known.map(item => <SheetAction key={item || "official"} icon={Store} label={item ? shortRepositoryUrl(item) : t("Official marketplace", "Offizieller Marktplatz")}
                            onPress={() => onUse(item)} />)}
                    </RowGroup>
                </SheetGroup>
            )}
        </Sheet>
    )
}
