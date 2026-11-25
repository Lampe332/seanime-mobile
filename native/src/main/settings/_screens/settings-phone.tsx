import { APP_UPDATE_QUERY_KEY, useCheckForUpdates } from "@/api/hooks/releases.hooks"
import { LoadingRows } from "@/components/shared/phone-kit"
import { PhoneScreen, usePageBottomPad, usePageTop } from "@/components/shared/phone-screen"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { updateNoticeOpens } from "@/lib/app-updates/update-notice"
import { updateModalOpenAtom } from "@/main/_features/update/mobile-update"
import { haptic } from "@/lib/feedback"
import { openTab } from "@/lib/helpers/browser"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { useThemeColors } from "@/lib/theme/appearance"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { SakuraBurst } from "@/main/settings/_components/sakura-burst"
import { UpdateCheckRow } from "@/main/settings/_components/settings-app-services"
import { InfoRow, LinkRow, SettingsGroup, SettingSwitch } from "@/main/settings/_components/settings-kit"
import { SettingsPage, type SettingsPageFocus } from "@/main/settings/_components/settings-page"
import { SettingsSearch } from "@/main/settings/_components/settings-search"
import { contactHref, DISCORD_INVITE, KOFI_URL, LEGAL, shortLink } from "@/main/settings/_lib/legal"
import { sectionFromTab, SETTINGS_SECTIONS, type SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import type { SettingsSearchDoc } from "@/main/settings/_lib/settings-search"
import { NO_TAPS, secretMessage, TAP_RESET_MS, tapHint, versionTap } from "@/main/settings/_lib/version-taps"
import { SettingsAccountSection } from "@/main/settings/_screens/settings-account"
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
import BookKey from "lucide-react-native/icons/book-key"
import BookOpen from "lucide-react-native/icons/book-open"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import CirclePlay from "lucide-react-native/icons/circle-play"
import CircleUserRound from "lucide-react-native/icons/circle-user-round"
import Globe from "lucide-react-native/icons/globe"
import Heart from "lucide-react-native/icons/heart"
import Info from "lucide-react-native/icons/info"
import Library from "lucide-react-native/icons/library"
import Magnet from "lucide-react-native/icons/magnet"
import Palette from "lucide-react-native/icons/palette"
import Users from "lucide-react-native/icons/users"
import WandSparkles from "lucide-react-native/icons/wand-sparkles"
import React from "react"
import { Keyboard, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * Settings (settings-phone.tsx + .css, tablet.css): a list of areas, each opening its page in the same screen. Every change
 * saves at once (no Save button at the end of a long page, nothing lost on leaving); Android Back closes an open sheet first,
 * then the area, then the screen. Only settings that work in the app are here: desktop players, transcoding, the
 * auto-downloader, Discord, sidebar and keyboard settings stay on the desktop page.
 * Tablet with room for two panes (≥ 720dp): the list of areas on the left and the open area beside it, each scrolling on its
 * own, so the list always stays where it is (settings audit ca7374a/75d7fca).
 */

const SECTIONS: Record<SettingsSectionId, { icon: LucideIcon, titleEn: string, titleDe: string, summaryEn: string, summaryDe: string }> = {
    account: { icon: CircleUserRound, titleEn: "Account", titleDe: "Konto", summaryEn: "Sync settings and watch history between devices", summaryDe: "Einstellungen und Verlauf zwischen Geräten synchronisieren" },
    seanime: { icon: WandSparkles, titleEn: "App", titleDe: "App", summaryEn: "Episodes, language, backup, navigation, AniList", summaryDe: "Folgen, Sprache, Sicherung, Navigation, AniList" },
    ui: { icon: Palette, titleEn: "Appearance", titleDe: "Darstellung", summaryEn: "Sorting, cards, loading pages", summaryDe: "Sortierung, Karten, Seiten laden" },
    playback: { icon: CirclePlay, titleEn: "Playback", titleDe: "Wiedergabe", summaryEn: "Player for your files, external player, next episode", summaryDe: "Player für deine Dateien, externer Player, nächste Folge" },
    library: { icon: Library, titleEn: "Local library", titleDe: "Lokale Bibliothek", summaryEn: "Folders, scanning, matching", summaryDe: "Ordner, Scannen, Zuordnung" },
    onlinestream: { icon: Globe, titleEn: "Online streaming", titleDe: "Online-Streaming", summaryEn: "Streaming and your anime lists", summaryDe: "Streaming und deine Anime-Listen" },
    torrents: { icon: Magnet, titleEn: "Torrents & debrid", titleDe: "Torrents & Debrid", summaryEn: "Providers, torrent streaming, downloads, debrid", summaryDe: "Anbieter, Torrent-Streaming, Downloads, Debrid" },
    manga: { icon: BookOpen, titleEn: "Manga", titleDe: "Manga", summaryEn: "Reading progress, default source", summaryDe: "Lesefortschritt, Standardquelle" },
    nakama: { icon: Users, titleEn: "Nakama", titleDe: "Nakama", summaryEn: "Stream from your PC or home server", summaryDe: "Vom PC oder Home-Server streamen" },
    logs: { icon: BookKey, titleEn: "Cache", titleDe: "Cache", summaryEn: "Diagnostic report, manga and streaming cache", summaryDe: "Fehlerbericht, Manga- und Streaming-Cache" },
    about: { icon: Info, titleEn: "About", titleDe: "Über", summaryEn: "Version, updates, Discord, legal", summaryDe: "Version, Updates, Discord, Rechtliches" },
}

/** The areas as the search names them and shows them in a hit */
const SEARCH_SECTIONS = SETTINGS_SECTIONS.map(id => ({
    id, icon: SECTIONS[id].icon, title: [SECTIONS[id].titleEn, SECTIONS[id].titleDe] as const, summary: [SECTIONS[id].summaryEn, SECTIONS[id].summaryDe] as const,
}))

/** The area a search hit opened and where in it (settings-page.tsx `focus`) */
type SectionFocus = SettingsPageFocus & { section: SettingsSectionId }

const appVersion = () => Constants.expoConfig?.version ?? ""

/** The head line under "Settings": only the app's own version, never the Seanime desktop version */
function versionLine() {
    const app = appVersion()
    return app ? `Seanime Mobile ${app}` : ""
}

export function SettingsPhone() {
    const t = useTr()
    const status = useServerStatus()
    const { tab } = useLocalSearchParams<{ tab?: string }>()
    const setRouteParams = useSetRouteParams()
    const { twoPanes } = useTabletLayout()
    const [section, setSection] = React.useState<SettingsSectionId | null>(() => sectionFromTab(tab))
    // The search word stays while an area is open, so Back from a hit returns to the hits
    const [query, setQuery] = React.useState("")
    const [focus, setFocus] = React.useState<SectionFocus | null>(null)
    // The list's scroll position, kept when an area opens, so Back returns to the same place in the list
    const listOffset = React.useRef(0)
    const [listTop, setListTop] = React.useState(0)
    const open = React.useCallback((id: SettingsSectionId) => {
        setListTop(listOffset.current)
        setFocus(null)
        setSection(id)
    }, [])
    const openHit = React.useCallback((hit: SettingsSearchDoc) => {
        Keyboard.dismiss()
        setListTop(listOffset.current)
        setFocus(previous => ({ section: hit.section, group: hit.group, labels: hit.labels, nonce: (previous?.nonce ?? 0) + 1 }))
        setSection(hit.section)
    }, [])
    const clearQuery = React.useCallback(() => setQuery(""), [])
    const setListOffset = React.useCallback((y: number) => { listOffset.current = y }, [])

    // A link (`/settings?tab=…`) opens its area once, also when the screen is already open (it stays mounted as a tab)
    const [handledTab, setHandledTab] = React.useState(tab)
    if (tab !== handledTab) {
        setHandledTab(tab)
        const target = sectionFromTab(tab)
        if (target) {
            setFocus(null)
            setSection(target)
        }
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
    // Back on the hits empties the search first
    useCloseOnBack(focused && (twoPanes || section === null) && query !== "", clearQuery)

    const shown = section ?? (twoPanes ? SETTINGS_SECTIONS[0] : null)

    if (!status?.settings) {
        return <PhoneScreen title={t("Settings", "Einstellungen")}>
            <LoadingRows label={t("Loading settings", "Einstellungen werden geladen")} count={5} />
        </PhoneScreen>
    }

    const shownFocus = focus && focus.section === shown ? focus : null

    if (twoPanes && shown) return <TwoPanes t={t} shown={shown} onOpen={open} query={query} onQuery={setQuery} onHit={openHit} focus={shownFocus} />

    if (shown) {
        const current = SECTIONS[shown]
        // Keyed by area: a new area starts at its top. Every area with three titled groups or more gets jump chips (settings-page.tsx)
        return <SettingsPage key={shown} icon={current.icon} title={t(current.titleEn, current.titleDe)} summary={t(current.summaryEn, current.summaryDe)}
            onBack={close} focus={shownFocus}>
            <SectionContent id={shown} t={t} onOpen={open} tablet={false} />
        </SettingsPage>
    }

    return <PhoneScreen key="list" title={t("Settings", "Einstellungen")} subtitle={versionLine()}
        initialOffset={listTop} onOffset={setListOffset}>
        <SettingsSearch t={t} sections={SEARCH_SECTIONS} query={query} onQuery={setQuery} onOpen={openHit}>
            <SectionList t={t} onOpen={open} />
        </SettingsSearch>
    </PhoneScreen>
}

/** `.pst-nav`: icon, name, what is inside, chevron; on a tablet the open area is marked and the chevrons go */
function SectionList({ t, onOpen, current, compact, notes = true }: {
    t: Translate
    onOpen: (id: SettingsSectionId) => void
    current?: SettingsSectionId
    /** a tablet landscape under 900dp height: all eleven areas fit without scrolling */
    compact?: boolean
    notes?: boolean
}) {
    const colors = useThemeColors()
    return <View accessibilityLabel={t("Settings areas", "Einstellungsbereiche")} className="gap-0.5 overflow-hidden rounded-surface">
        {SETTINGS_SECTIONS.map(id => {
            const item = SECTIONS[id]
            const Icon = item.icon
            const selected = id === current
            return <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${t(item.titleEn, item.titleDe)}, ${t(item.summaryEn, item.summaryDe)}`}
                onPress={() => onOpen(id)}
                className={cn("w-full flex-row items-center gap-3.5 px-4 active:bg-sm-surface-control",
                    current === undefined ? "min-h-16 py-3" : compact ? "min-h-[52px] py-2" : notes ? "min-h-[60px] py-3" : "min-h-14 py-3",
                    selected ? "bg-sm-surface-control" : "bg-sm-surface-raised")}>
                <Icon size={22} color={colors.smAccent} />
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className={cn("text-base", selected && "font-semibold")}>{t(item.titleEn, item.titleDe)}</Text>
                    {notes && <Muted className={cn("text-[13px]", compact ? "leading-[17.5px]" : "leading-[19px]")}>{t(item.summaryEn, item.summaryDe)}</Muted>}
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
function TwoPanes({ t, shown, onOpen, query, onQuery, onHit, focus }: {
    t: Translate
    shown: SettingsSectionId
    onOpen: (id: SettingsSectionId) => void
    query: string
    onQuery: (query: string) => void
    onHit: (hit: SettingsSearchDoc) => void
    focus: SettingsPageFocus | null
}) {
    const insets = useSafeAreaInsets()
    const paneBottom = usePageBottomPad(insets.bottom + 112)
    const top = usePageTop()
    const { window } = useTabletLayout()
    const wide = window.width >= 1024
    const listWidth = window.width >= 1400 ? 336 : wide ? 304 : 224
    const gap = wide ? 32 : 20
    const open = onOpen
    const current = SECTIONS[shown]
    return <View className="flex-1" style={{ paddingTop: top }}>
        <View className="w-full gap-1 px-4 pb-4 pt-1">
            <Heading>{t("Settings", "Einstellungen")}</Heading>
            <Muted>{versionLine()}</Muted>
        </View>
        <View className="w-full flex-1 flex-row px-4" style={{ gap }}>
            {/* A tap on a hit counts while the keyboard is still up */}
            <ScrollView style={{ width: listWidth, flexGrow: 0 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                <SettingsSearch t={t} sections={SEARCH_SECTIONS} query={query} onQuery={onQuery} onOpen={onHit} compact={!wide}>
                    <SectionList t={t} onOpen={open} current={shown} notes={wide} compact={wide && window.height <= 900} />
                </SettingsSearch>
            </ScrollView>
            {/* Keyed by area: a new area starts at its top (the page also resets the reused native scroll view) */}
            <SettingsPage key={shown} pane icon={current.icon} title={t(current.titleEn, current.titleDe)} summary={t(current.summaryEn, current.summaryDe)}
                bottomPad={paneBottom} focus={focus}>
                <SectionContent id={shown} t={t} onOpen={open} tablet />
            </SettingsPage>
        </View>
    </View>
}

function SectionContent({ id, t, onOpen, tablet }: { id: SettingsSectionId, t: Translate, onOpen: (id: SettingsSectionId) => void, tablet: boolean }) {
    const router = useRouter()
    const extensionsReady = MENU_ENTRIES.some(e => e.id === "extensions" && e.ready)
    switch (id) {
        case "account":
            return <SettingsAccountSection t={t} />
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

/** The app version (ten taps on it: the secret, version-taps.ts), "Look for new versions", "Check for updates now" and Legal. */
function SettingsAboutSection({ t }: { t: Translate }) {
    const app = appVersion()
    const taps = React.useRef(NO_TAPS)
    const [burst, setBurst] = React.useState(0)
    const endBurst = React.useCallback(() => setBurst(0), [])
    const onVersionTap = () => {
        const result = versionTap(taps.current, Date.now())
        taps.current = result.state
        if (result.secret) {
            toast.dismiss(TAP_HINT_TOAST)
            haptic("confirm")
            setBurst(n => n + 1)
        }
        else if (result.remaining !== null) toast(tapHint(result.remaining, t), { id: TAP_HINT_TOAST, duration: TAP_RESET_MS })
    }
    return <>
        {!!app && <SettingsGroup title={t("Version", "Version")}>
            <LinkRow label="Seanime Mobile" value={app} chevron={false} onPress={onVersionTap}
                note={t("The version installed on this device.", "Die auf diesem Gerät installierte Version.")} />
        </SettingsGroup>}
        <SettingsGroup title={t("Updates", "Updates")}>
            <SettingSwitch path="library.disableUpdateCheck" invert defaultChecked label={t("Look for new versions", "Nach neuen Versionen suchen")}
                note={t("Shows a notice when a new app version is out.", "Zeigt einen Hinweis, sobald eine neue App-Version erscheint.")} />
            <UpdateCheck t={t} />
        </SettingsGroup>
        <SettingsGroup title={t("Community", "Community")}
            note={t("Questions, help with setup and news about the app.", "Fragen, Hilfe bei der Einrichtung und Neuigkeiten zur App.")}>
            <LinkRow label="Discord" value={shortLink(DISCORD_INVITE)} onPress={() => openTab(DISCORD_INVITE)}
                note={t("Opens the invite in Discord or your browser.", "Öffnet die Einladung in Discord oder im Browser.")} />
            <LinkRow icon={Heart} label={t("Support Seanime Mobile", "Seanime Mobile unterstützen")}
                note={t("Buy me a coffee on Ko-fi", "Spendier mir einen Kaffee auf Ko-fi")} onPress={() => openTab(KOFI_URL)} />
        </SettingsGroup>
        <LegalGroup t={t} />
        {/* keyed: tapping it out again while it falls starts a new one */}
        {burst > 0 && <SakuraBurst key={burst} message={secretMessage(t)} onDone={endBurst} />}
    </>
}

const TAP_HINT_TOAST = "version-taps"

/** Legal (_lib/legal.ts): who runs the app, then contact, website, privacy policy and imprint, each opened outside the app */
function LegalGroup({ t }: { t: Translate }) {
    return <SettingsGroup title={t("Legal", "Rechtliches")}
        note={t("Unofficial app, built on Seanime by 5rahim. No analytics or tracking. Only an anonymous daily usage count, which you can turn off under App > Privacy.", "Inoffizielle App, gebaut auf Seanime von 5rahim. Keine Analyse, kein Tracking. Nur eine anonyme tägliche Nutzungszählung, die du unter App > Datenschutz abschalten kannst.")}>
        <InfoRow label={LEGAL.name} note={LEGAL.region} />
        <LinkRow label={t("Contact", "Kontakt")} value={LEGAL.email} onPress={() => openTab(contactHref())}
            note={t("Write an email about the app.", "Eine E-Mail zur App schreiben.")} />
        <LinkRow label={t("Website", "Website")} value={shortLink(LEGAL.website)} onPress={() => openTab(LEGAL.website)}
            note={t("The app's website, opens in the browser.", "Die Website der App, öffnet im Browser.")} />
        <LinkRow label={t("Privacy policy", "Datenschutz")} onPress={() => openTab(LEGAL.privacy)}
            note={t("What data the app handles and why.", "Welche Daten die App verarbeitet und warum.")} />
        <LinkRow label={t("Imprint", "Impressum")} onPress={() => openTab(LEGAL.imprint)}
            note={t("Who is responsible for the app.", "Wer für die App verantwortlich ist.")} />
    </SettingsGroup>
}

