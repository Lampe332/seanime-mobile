import { APP_UPDATE_QUERY_KEY, useCheckForUpdates } from "@/api/hooks/releases.hooks"
import { LoadingRows } from "@/components/shared/phone-kit"
import { PhoneScreen, usePageTop } from "@/components/shared/phone-screen"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { updateNoticeOpens } from "@/lib/app-updates/update-notice"
import { updateModalOpenAtom } from "@/main/_features/update/mobile-update"
import { openTab } from "@/lib/helpers/browser"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { TABLET_READING_WIDTH } from "@/lib/tablet-ui"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { UpdateCheckRow } from "@/main/settings/_components/settings-app-services"
import { SettingsGroup, SettingSwitch } from "@/main/settings/_components/settings-kit"
import { sectionFromTab, SETTINGS_SECTIONS, type SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import { SettingsAppSection } from "@/main/settings/_screens/settings-app"
import { SettingsLibrarySection } from "@/main/settings/_screens/settings-library"
import { SettingsLogsSection } from "@/main/settings/_screens/settings-logs"
import { SettingsMangaSection, SettingsNakamaSection, SettingsOnlinestreamSection } from "@/main/settings/_screens/settings-more"
import { SettingsPlaybackSection } from "@/main/settings/_screens/settings-playback"
import { SettingsTorrentsSection } from "@/main/settings/_screens/settings-torrents"
import { SettingsUISection } from "@/main/settings/_screens/settings-ui"
import { useQueryClient } from "@tanstack/react-query"
import Constants from "expo-constants"
import { useSetAtom } from "jotai"
import { useIsFocused, useLocalSearchParams } from "expo-router"
import { useSetRouteParams } from "@/lib/route-params"
import type { LucideIcon } from "lucide-react-native"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import BookKey from "lucide-react-native/icons/book-key"
import BookOpen from "lucide-react-native/icons/book-open"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import CirclePlay from "lucide-react-native/icons/circle-play"
import Globe from "lucide-react-native/icons/globe"
import Info from "lucide-react-native/icons/info"
import Library from "lucide-react-native/icons/library"
import Magnet from "lucide-react-native/icons/magnet"
import Palette from "lucide-react-native/icons/palette"
import Users from "lucide-react-native/icons/users"
import WandSparkles from "lucide-react-native/icons/wand-sparkles"
import React from "react"
import { Pressable, ScrollView, type ScrollViewInstance, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * Settings (settings-phone.tsx + .css, tablet.css): a list of areas, each opening its page in the same screen. Every change
 * saves at once (no Save button at the end of a long page, nothing lost on leaving); Android Back closes an open sheet first,
 * then the area, then the screen. Only settings that work in the app are here: desktop players, transcoding, the
 * auto-downloader, Discord, sidebar and keyboard settings stay on the desktop page.
 * Tablet with room for two panes (≥ 720dp): the list of areas on the left and the open area beside it, each scrolling on its
 * own, so the list always stays where it is (settings audit ca7374a/75d7fca).
 */

const SECTIONS: Record<SettingsSectionId, { icon: LucideIcon, title: [string, string], summary: [string, string] }> = {
    seanime: { icon: WandSparkles, title: ["App", "App"], summary: ["Episodes, language, extensions, navigation, account", "Folgen, Sprache, Erweiterungen, Navigation, Konto"] },
    ui: { icon: Palette, title: ["Appearance", "Darstellung"], summary: ["Banner, sorting, cards, loading pages", "Banner, Sortierung, Karten, Seiten laden"] },
    playback: { icon: CirclePlay, title: ["Playback", "Wiedergabe"], summary: ["Player for your files, external player, next episode", "Player für deine Dateien, externer Player, nächste Folge"] },
    library: { icon: Library, title: ["Local library", "Lokale Bibliothek"], summary: ["Folders, scanning, matching", "Ordner, Scannen, Zuordnung"] },
    onlinestream: { icon: Globe, title: ["Online streaming", "Online-Streaming"], summary: ["Streaming and your anime lists", "Streaming und deine Anime-Listen"] },
    torrents: { icon: Magnet, title: ["Torrents & debrid", "Torrents & Debrid"], summary: ["Providers, torrent streaming, downloads, debrid", "Anbieter, Torrent-Streaming, Downloads, Debrid"] },
    manga: { icon: BookOpen, title: ["Manga", "Manga"], summary: ["Reading progress, default source, local folder", "Lesefortschritt, Standardquelle, lokaler Ordner"] },
    nakama: { icon: Users, title: ["Nakama", "Nakama"], summary: ["Stream from your PC or home server", "Vom PC oder Home-Server streamen"] },
    logs: { icon: BookKey, title: ["Logs & cache", "Logs & Cache"], summary: ["Server logs, cache, developer", "Server-Logs, Cache, Entwickler"] },
    about: { icon: Info, title: ["About", "Über"], summary: ["Version and updates", "Version und Updates"] },
}

const appVersion = () => Constants.expoConfig?.version ?? ""

function versionLine(version?: string) {
    const app = appVersion()
    return [version ? `Seanime ${version}` : "", app ? `App ${app}` : ""].filter(Boolean).join(" · ")
}

export function SettingsPhone() {
    const t = useTr()
    const status = useServerStatus()
    const { tab } = useLocalSearchParams<{ tab?: string }>()
    const setRouteParams = useSetRouteParams()
    const { twoPanes } = useTabletLayout()
    const [section, setSection] = React.useState<SettingsSectionId | null>(() => sectionFromTab(tab))

    // A link (`/settings?tab=…`) opens its area once, also when the screen is already open (it stays mounted as a tab)
    const [handledTab, setHandledTab] = React.useState(tab)
    if (tab !== handledTab) {
        setHandledTab(tab)
        const target = sectionFromTab(tab)
        if (target) setSection(target)
    }
    // …and the address goes back to /settings, as on the desktop page, so the same link works again
    React.useEffect(() => {
        if (tab) setRouteParams({ tab: undefined })
    }, [tab, setRouteParams])

    const close = React.useCallback(() => setSection(null), [])
    // With two panes the list and the area stand side by side, so Back leaves the screen. Only while the screen is shown: it
    // stays mounted as a tab, and Back on another page must not close an area here
    const focused = useIsFocused()
    useCloseOnBack(focused && !twoPanes && section !== null, close)

    const shown = section ?? (twoPanes ? SETTINGS_SECTIONS[0] : null)

    if (!status?.settings) {
        return <PhoneScreen title={t("Settings", "Einstellungen")}>
            <LoadingRows label={t("Loading settings", "Einstellungen werden geladen")} count={5} />
        </PhoneScreen>
    }

    if (twoPanes && shown) return <TwoPanes t={t} shown={shown} onOpen={setSection} version={status.version} />

    if (shown) {
        const current = SECTIONS[shown]
        // Keyed by area: a new area starts at its top
        return <PhoneScreen key={shown}>
            <View className="-ml-3 flex-row items-center gap-1 pt-1">
                <Pressable accessibilityRole="button" accessibilityLabel={t("Back to settings", "Zurück zu den Einstellungen")} onPress={close}
                    className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                    <ArrowLeft size={24} color={colors.smText} />
                </Pressable>
                {/* r16: the title size of every page (28/32), not 26 */}
                <Heading accessibilityRole="header" className="min-w-0 flex-1">{t(...current.title)}</Heading>
            </View>
            <SectionContent id={shown} t={t} onOpen={setSection} tablet={false} />
        </PhoneScreen>
    }

    return <PhoneScreen key="list" title={t("Settings", "Einstellungen")} subtitle={versionLine(status.version)}>
        <SectionList t={t} onOpen={setSection} />
    </PhoneScreen>
}

/** `.pst-nav`: icon, name, what is inside, chevron; on a tablet the open area is marked and the chevrons go */
function SectionList({ t, onOpen, current, compact, notes = true }: {
    t: Translate
    onOpen: (id: SettingsSectionId) => void
    current?: SettingsSectionId
    /** a tablet landscape under 900dp height: all ten areas fit without scrolling */
    compact?: boolean
    notes?: boolean
}) {
    return <View accessibilityLabel={t("Settings areas", "Einstellungsbereiche")} className="gap-0.5 overflow-hidden rounded-surface">
        {SETTINGS_SECTIONS.map(id => {
            const item = SECTIONS[id]
            const Icon = item.icon
            const selected = id === current
            return <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${t(...item.title)}, ${t(...item.summary)}`}
                onPress={() => onOpen(id)}
                className={cn("w-full flex-row items-center gap-3.5 px-4 active:bg-sm-surface-control",
                    current === undefined ? "min-h-16 py-3" : compact ? "min-h-[52px] py-2" : notes ? "min-h-[60px] py-3" : "min-h-14 py-3",
                    selected ? "bg-sm-surface-control" : "bg-sm-surface-raised")}>
                <Icon size={22} color={colors.smAccent} />
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className={cn("text-base", selected && "font-semibold")}>{t(...item.title)}</Text>
                    {notes && <Muted className={cn("text-[13px]", compact ? "leading-[17.5px]" : "leading-[19px]")}>{t(...item.summary)}</Muted>}
                </View>
                {current === undefined && <ChevronRight size={18} color={colors.smTextSubtle} />}
            </Pressable>
        })}
    </View>
}

/**
 * Two panes (tablet.css `.pst-panes`): 14rem list from 720dp, 19rem with the notes from 1024dp, 21rem from 1400dp; the
 * open area beside it with its title. The head stays above both.
 */
function TwoPanes({ t, shown, onOpen, version }: { t: Translate, shown: SettingsSectionId, onOpen: (id: SettingsSectionId) => void, version?: string }) {
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const { window } = useTabletLayout()
    const wide = window.width >= 1024
    const listWidth = window.width >= 1400 ? 336 : wide ? 304 : 224
    const gap = wide ? 32 : 20
    const paneRef = React.useRef<ScrollViewInstance>(null)
    const open = (id: SettingsSectionId) => {
        onOpen(id)
        paneRef.current?.scrollTo({ y: 0, animated: false })
    }
    return <View className="flex-1" style={{ paddingTop: top }}>
        <View className="w-full gap-1 px-4 pb-4 pt-1">
            <Heading>{t("Settings", "Einstellungen")}</Heading>
            <Muted>{versionLine(version)}</Muted>
        </View>
        <View className="w-full flex-1 flex-row px-4" style={{ gap }}>
            <ScrollView style={{ width: listWidth, flexGrow: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                <SectionList t={t} onOpen={open} current={shown} notes={wide} compact={wide && window.height <= 900} />
            </ScrollView>
            <ScrollView ref={paneRef} className="flex-1" style={{ maxWidth: window.width >= 1400 ? TABLET_READING_WIDTH : undefined }}
                contentContainerClassName="gap-6" contentContainerStyle={{ paddingBottom: insets.bottom + 112 }}>
                <Text accessibilityRole="header" className="text-[22px] font-bold leading-[27.5px] tracking-[-0.44px]">{t(...SECTIONS[shown].title)}</Text>
                <SectionContent id={shown} t={t} onOpen={open} tablet />
            </ScrollView>
        </View>
    </View>
}

function SectionContent({ id, t, onOpen, tablet }: { id: SettingsSectionId, t: Translate, onOpen: (id: SettingsSectionId) => void, tablet: boolean }) {
    const router = useRouter()
    const extensionsReady = MENU_ENTRIES.some(e => e.id === "extensions" && e.ready)
    switch (id) {
        case "seanime":
            return <SettingsAppSection t={t} />
        case "ui":
            return <SettingsUISection t={t} tablet={tablet} />
        case "playback":
            return <SettingsPlaybackSection t={t} />
        case "library":
            return <SettingsLibrarySection t={t} />
        case "onlinestream":
            return <SettingsOnlinestreamSection t={t} />
        case "torrents":
            return <SettingsTorrentsSection t={t} onOpen={onOpen} onOpenExtensions={extensionsReady ? () => router.push("/extensions") : null} />
        case "manga":
            return <SettingsMangaSection t={t} />
        case "nakama":
            return <SettingsNakamaSection t={t} />
        case "logs":
            return <SettingsLogsSection t={t} />
        case "about":
            return <SettingsAboutSection t={t} />
    }
}

/**
 * "Check for updates now" (E4 updater, works also when Look for new versions is off). A found release becomes the known
 * update (APP_UPDATE_QUERY_KEY, read by the update notice) and opens the update dialog (2.14 `updateModalOpenAtom`) as
 * updateNoticeOpens("manual", …) says; otherwise a toast says the app is current.
 */
function UpdateCheck({ t }: { t: Translate }) {
    const queryClient = useQueryClient()
    const setUpdateOpen = useSetAtom(updateModalOpenAtom)
    const disableUpdateCheck = useServerStatus()?.settings?.library?.disableUpdateCheck
    const { mutate: check, isPending } = useCheckForUpdates()
    return <UpdateCheckRow t={t} checking={isPending} onCheck={() => check(undefined, {
        onSuccess: data => {
            queryClient.setQueryData([APP_UPDATE_QUERY_KEY], data)
            if (updateNoticeOpens("manual", disableUpdateCheck, !!data?.release?.version)) setUpdateOpen(true)
            else toast.success(t("You are on the latest version", "Du nutzt die neueste Version"))
        },
    })} />
}

/** Versions, "Look for new versions", "Check for updates now" and, quietly at the end, Donate. */
function SettingsAboutSection({ t }: { t: Translate }) {
    const status = useServerStatus()
    const app = appVersion()
    return <>
        <SettingsGroup title={t("Version", "Version")}>
            {!!app && <VersionRow label={t("App", "App")} value={app} />}
            <VersionRow label="Seanime" value={[status?.version, status?.versionName].filter(Boolean).join(" ")} />
        </SettingsGroup>
        <SettingsGroup title={t("Updates", "Updates")}>
            <SettingSwitch path="library.disableUpdateCheck" invert label={t("Look for new versions", "Nach neuen Versionen suchen")}
                note={t("Shows a notice when a new app version is out.", "Zeigt einen Hinweis, sobald eine neue App-Version erscheint.")} />
            <UpdateCheck t={t} />
        </SettingsGroup>
        <Pressable accessibilityRole="link" onPress={() => openTab("https://github.com/sponsors/5rahim")}
            className="min-h-12 items-center justify-center self-center px-4">
            <Text className="text-sm text-sm-text-subtle underline">{t("Donate to the Seanime developer", "An den Seanime-Entwickler spenden")}</Text>
        </Pressable>
    </>
}

function VersionRow({ label, value }: { label: string, value: string }) {
    return <View className="flex-row flex-wrap items-baseline justify-between gap-x-4 bg-sm-surface-raised px-4 py-3">
        <Text className="text-sm text-sm-text-muted">{label}</Text>
        <Text className="ml-auto text-right text-base font-semibold">{value}</Text>
    </View>
}
