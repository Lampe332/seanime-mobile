import type { Extension_Extension } from "@/api/generated/types"
import { useGetMarketplaceExtensions, useInstallExternalExtension } from "@/api/hooks/extensions.hooks"
import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { LoadingRows, Notice, RowGroup, SearchField, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Select } from "@/components/ui/select/select"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { appLanguageAtom, type Translate } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { LANGUAGES_LIST } from "@/main/manga/_lib/language-map"
import NetInfo from "@react-native-community/netinfo"
import { pressTourTarget, TOUR_TARGETS, useTourTarget } from "@/main/_features/tour/tour-targets"
import { atom, useAtom, useAtomValue } from "jotai"
import Check from "lucide-react-native/icons/check"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Download from "lucide-react-native/icons/download"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import { extensionMeta, shortRepositoryUrl } from "../_lib/extensions-phone"
import { isWebUrl, marketplaceView, OVERVIEW_ROWS } from "../_lib/extensions-screen"
import { DEFAULT_MARKETPLACE_URL, marketplaceUrlAtom } from "../_lib/marketplace.atoms"
import { ExtensionIcon, MarketplaceSheet, UrlField } from "./extensions-phone-sheets"

/** The marketplace's type filter; the Installed tab's "Add" actions and `/extensions?type=` open it on a type. */
export const __extensions_marketTypeAtom = atom("all")

/**
 * Phone marketplace (web extensions-phone-marketplace.tsx): the repository with its reload and change actions (the
 * community repository is a link to its .json), type chips with counts, search and content language, then the
 * extensions as rows with one install button each. Installing only happens on the user's tap.
 * `tourOn` (the tab is on screen): the setup tour points at the repository button, the type chips, the first install
 * buttons and the repository sheet with its Save.
 */
export function MarketplacePhone({ t, installedIds, tourOn }: { t: Translate, installedIds: Set<string>, tourOn: boolean }) {
    const [url, setUrl] = useAtom(marketplaceUrlAtom)
    const appLanguage = useAtomValue(appLanguageAtom)
    const { data, isPending, isError, isFetching, refetch } = useGetMarketplaceExtensions(url)
    const [type, setType] = useAtom(__extensions_marketTypeAtom)
    const [language, setLanguage] = React.useState("all")
    const [search, setSearch] = React.useState("")
    const [repoOpen, setRepoOpen] = React.useState(false)
    const [repoDraft, setRepoDraft] = React.useState("")
    const [selected, setSelected] = React.useState<Extension_Extension | null>(null)
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [offline, setOffline] = React.useState(false)
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

    return (
        <View className="gap-5">
            <View accessibilityLabel={t("Repository", "Repository")} className="min-h-[68px] flex-row items-center gap-1 rounded-surface bg-sm-surface-raised py-2 pl-4 pr-2">
                <View className="min-w-0 flex-1 gap-px">
                    <Text className="text-xs text-sm-text-subtle">{t("Repository", "Repository")}</Text>
                    <Text numberOfLines={1} className="font-semibold">{isDefault ? t("Official repository", "Offizielles Repository") : shortRepositoryUrl(url)}</Text>
                    {!!data && <Text className="text-xs text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                        {view.usable.length === 1 ? t("1 extension", "1 Erweiterung") : t(`${view.usable.length} extensions`, `${view.usable.length} Erweiterungen`)}
                    </Text>}
                </View>
                <Button intent="icon" accessibilityLabel={t("Reload repository", "Repository neu laden")} disabled={isFetching} onPress={() => void refetch()}>
                    {isFetching ? <ActivityIndicator size="small" color={colors.smTextMuted} /> : <RotateCw size={22} color={colors.smTextMuted} />}
                </Button>
                <View ref={changeRef} collapsable={false}>
                    <TextAction label={t("Change", "Ändern")} onPress={() => {
                        if (!missing) pressTourTarget(TOUR_TARGETS.changeRepo)
                        openRepository(url)
                    }} />
                </View>
            </View>

            {missing && (
                <View className="gap-2 rounded-surface bg-sm-surface-raised p-4">
                    <Text className="text-base font-bold">{view.missing.length > 1 ? t("No streaming or manga sources here", "Hier gibt es keine Streaming- oder Manga-Quellen")
                        : view.missing[0].type === "manga-provider" ? t("No manga sources here", "Hier gibt es keine Manga-Quellen")
                            : t("No streaming sources here", "Hier gibt es keine Streaming-Quellen")}</Text>
                    <Text className="text-sm leading-[21px] text-sm-text-muted">{t("The official repository no longer lists content sources. Find a community repository online and add its link.",
                        "Das offizielle Repository listet keine Inhaltsquellen mehr. Such online nach einem Community-Repository und füge seinen Link hinzu.")}</Text>
                    <View ref={addRef} collapsable={false} className="mt-1.5 flex-row"><Button wrapperClassName="flex-1" onPress={() => {
                        pressTourTarget(TOUR_TARGETS.changeRepo)
                        openRepository("")
                    }}>{t("Add repository", "Repository hinzufügen")}</Button></View>
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
                <Notice text={offline ? t("No internet connection, so the repository could not be loaded.", "Keine Internetverbindung, deshalb konnte das Repository nicht geladen werden.")
                    : t("The repository could not be loaded.", "Das Repository konnte nicht geladen werden.")}>
                    <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void refetch()} />
                    <TextAction label={t("Change repository", "Repository ändern")} onPress={() => openRepository(url)} />
                </Notice>
            ) : isPending ? <LoadingRows label={t("Loading the marketplace", "Marktplatz wird geladen")} count={5} />
                : view.usable.length === 0 ? (
                    <PhoneEmpty title={t("No extensions in this repository", "Keine Erweiterungen in diesem Repository")}
                        text={t("It has nothing the phone app can use. Try another repository.", "Es enthält nichts, was die Handy-App nutzen kann. Versuch ein anderes Repository.")}>
                        <Button intent="secondary" onPress={() => openRepository(url)}>{t("Change repository", "Repository ändern")}</Button>
                    </PhoneEmpty>
                ) : view.groups.length === 0 ? (view.typeMissing ? (
                    <PhoneEmpty title={t(`${view.typeMissing.noneEn} in this repository`, `${view.typeMissing.noneDe} in diesem Repository`)}
                        text={t("Other repositories have them. Add one with its link.", "Andere Repositorys haben sie. Füge eines über seinen Link hinzu.")}>
                        <Button intent="secondary" onPress={() => openRepository(url)}>{t("Change repository", "Repository ändern")}</Button>
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

            <RepositorySheet t={t} open={repoOpen} onOpenChange={setRepoOpen} draft={repoDraft} onDraft={setRepoDraft} isDefault={isDefault} onSave={saveRepository} />
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

function MarketRow({ t, extension, installed, onOpen, tourOn }: { t: Translate, extension: Extension_Extension, installed: boolean, onOpen: (extension: Extension_Extension) => void, tourOn: boolean }) {
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
                            onSuccess: response => {
                                setJustInstalled(true)
                                toast.success(response?.message || t("Installed", "Installiert"))
                            },
                        })
                    }}
                    className="mx-2 h-12 w-12 items-center justify-center rounded-full bg-sm-accent-soft active:bg-sm-accent-strong">
                    {isPending ? <ActivityIndicator size="small" color={colors.smAccent} /> : <Download size={20} color={colors.smAccent} />}
                </Pressable>
            )}
        </View>
    )
}

function RepositorySheet({ t, open, onOpenChange, draft, onDraft, isDefault, onSave }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    draft: string
    onDraft: (value: string) => void
    isDefault: boolean
    onSave: (url: string) => void
}) {
    const valid = isWebUrl(draft)
    const save = () => {
        if (valid) onSave(draft.trim())
    }
    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={t("Repository", "Repository")} tourTarget={TOUR_TARGETS.repoSheet}
            description={t("Paste the link to a repository's .json file. Its extensions then appear in the marketplace.",
                "Füge den Link zur .json-Datei eines Repositorys ein. Seine Erweiterungen erscheinen dann im Marktplatz.")}
            footer={<>
                {/* its own width first, like the web's `flex: 1 1 max-content` (flex-1 cut it to "Use offi…" on the phone) */}
                <Button intent="secondary" size="lg" wrapperClassName="grow shrink-0" disabled={isDefault} onPress={() => onSave(DEFAULT_MARKETPLACE_URL)}>{t("Use official", "Offizielles nutzen")}</Button>
                <Button size="lg" wrapperClassName="flex-[2]" disabled={!valid} onPress={() => {
                    pressTourTarget(TOUR_TARGETS.repoSave)
                    save()
                }}>{t("Save", "Speichern")}</Button>
            </>}>
            <UrlField t={t} label={t("Repository link", "Repository-Link")} value={draft} onChange={onDraft} placeholder="https://…/index.json" onSubmit={save}
                error={draft.trim() && !valid ? t("Enter a full link that starts with https://", "Gib einen vollständigen Link mit https:// ein") : undefined} />
        </Sheet>
    )
}
