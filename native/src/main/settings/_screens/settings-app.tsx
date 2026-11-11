import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useLogout } from "@/api/hooks/auth.hooks"
import { useListAnimeEntryEpisodeTabExtensions } from "@/api/hooks/extensions.hooks"
import { useGetMobileOfflineSnapshot, useMobileOfflineSettings } from "@/api/hooks/mobile_offline.hooks"
import { Tabs } from "@/components/ui/tabs/tabs"
import { toast } from "@/components/ui/toast/toast-store"
import { useAiringNotificationsSetting, useTestAiringNotification } from "@/lib/airing/airing-hooks"
import { type AppLanguage, appLanguageAtom, type Translate } from "@/lib/app-language"
import { hapticsEnabledAtom, hasVibrator, playSound, soundsEnabledAtom } from "@/lib/feedback"
import { resetNavigation } from "@/lib/nav/nav-store"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useStartMobileTutorial } from "@/main/_features/tour/mobile-tutorial"
import { NavigationEditor } from "@/main/settings/_components/navigation-editor"
import { AiringRows, FeedbackGroup, WifiOnlyRow } from "@/main/settings/_components/settings-app-services"
import {
    ConfirmSheet,
    LinkRow,
    LocalSwitch,
    SelectRow,
    SettingsGroup,
    SettingSwitch,
    ThemeSwitch,
    useSaveSetting,
    useSettingValue,
    useThemeValue,
} from "@/main/settings/_components/settings-kit"
import { useQueryClient } from "@tanstack/react-query"
import { useAtom } from "jotai"
import React from "react"
import { View } from "react-native"

/*
 * App (settings-phone-app.tsx): episodes (with E4's new-episode notifications and Wi-Fi-only downloads), anime, language,
 * feedback, extensions, local account, metadata, navigation, account. The E4 rows are in settings-app-services.tsx.
 * "Show the setup tutorial" starts the tour (2.16).
 */
export function SettingsAppSection({ t }: { t: Translate }) {
    const status = useServerStatus()
    const startTutorial = useStartMobileTutorial()
    const isSimulated = !!status?.user?.isSimulated
    const hideSpoilers = useThemeValue("hideAnimeSpoilers")
    const adult = useSettingValue("anilist.enableAdultContent", false)
    const cacheDisabled = useSettingValue("anilist.disableCacheLayer", false)

    return <>
        <SettingsGroup title={t("Episodes", "Folgen")}>
            <SettingSwitch path="library.autoUpdateProgress" label={t("Update progress automatically", "Fortschritt automatisch speichern")}
                note={t("Marks an episode as watched once you have seen 80 % of it.", "Setzt eine Folge auf gesehen, sobald du 80 % davon geschaut hast.")} />
            <SettingSwitch path="library.enableWatchContinuity" label={t("Watch history", "Wiedergabeverlauf")}
                note={t("Remembers where you stopped and resumes there.", "Merkt sich, wo du aufgehört hast, und setzt dort fort.")} />
            <DefaultSourceSelect t={t} />
            <AppServiceRows t={t} />
        </SettingsGroup>

        <SettingsGroup title={t("Anime", "Anime")}>
            <ThemeSwitch field="hideAnimeSpoilers" label={t("Hide spoilers", "Spoiler verbergen")}
                note={t("Episode pictures and texts stay hidden until you get there.", "Bilder und Texte von Folgen bleiben verborgen, bis du dort bist.")} />
            {hideSpoilers && <>
                <ThemeSwitch field="hideAnimeSpoilerThumbnails" label={t("Hide pictures", "Bilder verbergen")} sub />
                <ThemeSwitch field="hideAnimeSpoilerTitles" label={t("Hide titles", "Titel verbergen")} sub />
                <ThemeSwitch field="hideAnimeSpoilerDescriptions" label={t("Hide descriptions", "Beschreibungen verbergen")} sub />
                <ThemeSwitch field="hideAnimeSpoilerSkipNextEpisode" label={t("Show the next episode", "Nächste Folge zeigen")}
                    note={t("Starts hiding from the episode after the next one.", "Verbirgt erst ab der übernächsten Folge.")} sub />
            </>}
            <SettingSwitch path="anilist.hideAudienceScore" label={t("Hide audience score", "Publikumswertung verbergen")}
                note={t("Shows the score only when you tap it.", "Zeigt die Wertung erst, wenn du darauf tippst.")} />
            <SettingSwitch path="anilist.enableAdultContent" label={t("Adult content", "Inhalte für Erwachsene")}
                note={t("When off, adult titles are hidden from search and your library.", "Wenn aus, sind Titel für Erwachsene in Suche und Bibliothek verborgen.")} />
            {adult && <SettingSwitch path="anilist.blurAdultContent" label={t("Blur adult covers", "Cover für Erwachsene verwischen")} sub />}
        </SettingsGroup>

        <LanguageGroup t={t} />
        <AppFeedbackGroup t={t} />

        <SettingsGroup title={t("Extensions", "Erweiterungen")}>
            <SettingSwitch path="library.enableExtensionSecureMode" label={t("Secure mode", "Sicherer Modus")}
                note={t("Asks before an extension does something sensitive, even with permission.", "Fragt nach, bevor eine Erweiterung etwas Heikles tut, auch mit Berechtigung.")} />
            <LinkRow label={t("Show the setup tutorial", "Einrichtungs-Tutorial zeigen")}
                note={t("How to add a repository and install a streaming source.", "Wie du ein Repository hinzufügst und eine Streaming-Quelle installierst.")}
                onPress={() => startTutorial()} />
        </SettingsGroup>

        <LocalAccountGroup t={t} isSimulated={isSimulated} />

        <SettingsGroup title={t("Metadata", "Metadaten")}>
            <SettingSwitch path="anilist.disableCacheLayer" label={t("Turn off AniList caching", "AniList-Zwischenspeicher ausschalten")}
                note={t("The cache keeps the app usable while AniList is down.", "Der Zwischenspeicher hält die App nutzbar, wenn AniList ausfällt.")} />
            {!cacheDisabled && <CacheOnlySwitch t={t} />}
            <SettingSwitch path="library.useFallbackMetadataProvider" label={t("Fallback episode metadata", "Ersatzquelle für Folgendaten")}
                note={t("Loads episode details from another source.", "Lädt Folgendetails aus einer anderen Quelle.")} />
        </SettingsGroup>

        <NavigationGroup t={t} />
        {!isSimulated && !!status?.user && <AccountGroup t={t} />}
    </>
}

/** Default episode source: as on the desktop page; torrent and debrid streaming once they are turned on (Torrents & debrid). */
function DefaultSourceSelect({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const status = useServerStatus()
    const stored = useSettingValue<string>("library.defaultPlaybackSource", "")
    const onlinestream = useSettingValue("library.enableOnlinestream", false)
    const torrentstream = !!status?.torrentstreamSettings?.enabled
    const debridstream = !!status?.debridSettings?.enabled
    const { data: episodeTabs } = useListAnimeEntryEpisodeTabExtensions()
    const options = React.useMemo(() => [
        { value: "-", label: t("Automatic", "Automatisch") },
        { value: "library", label: t("Local library", "Lokale Bibliothek") },
        ...(onlinestream ? [{ value: "onlinestream", label: t("Online streaming", "Online-Streaming") }] : []),
        ...(torrentstream ? [{ value: "torrentstream", label: t("Torrent streaming", "Torrent-Streaming") }] : []),
        ...(debridstream ? [{ value: "debridstream", label: t("Debrid streaming", "Debrid-Streaming") }] : []),
        ...Array.from(new Map((episodeTabs ?? []).map(ext => [`ext:${ext.id}`, {
            value: `ext:${ext.id}`,
            label: ext.tabName ? `${ext.tabName} (${ext.name})` : ext.name,
        }])).values()).sort((a, b) => a.label.localeCompare(b.label)),
    ], [episodeTabs, onlinestream, torrentstream, debridstream, t])
    const value = stored || "-"
    const missing = !options.some(option => option.value === value)
    const shown = !missing ? options
        : value.startsWith("ext:") ? [...options, { value, label: t("Unavailable plugin", "Nicht verfügbares Plugin") }]
            : value === "torrentstream" ? [...options, { value, label: t("Torrent streaming (turned off)", "Torrent-Streaming (ausgeschaltet)") }]
                : value === "debridstream" ? [...options, { value, label: t("Debrid streaming (turned off)", "Debrid-Streaming (ausgeschaltet)") }]
                    : options
    return <SelectRow label={t("Default episode source", "Standard-Quelle für Folgen")} note={t("Used when you open an anime.", "Wird beim Öffnen eines Anime benutzt.")}
        value={value} options={shown} onChange={next => void save("library.defaultPlaybackSource", next === "-" ? "" : next)} />
}

/** E4 services in App › Episodes: new-episode notifications (+ test) and Wi-Fi-only episode downloads (Karte §9, 2.12) */
function AppServiceRows({ t }: { t: Translate }) {
    const [airing, setAiring] = useAiringNotificationsSetting()
    const { mutate: testAiring } = useTestAiringNotification()
    const { data: snapshot } = useGetMobileOfflineSnapshot()
    const { mutate: saveOffline } = useMobileOfflineSettings()
    return <>
        <AiringRows t={t} enabled={airing} onChange={setAiring} onTest={() => testAiring(undefined, {
            onSuccess: result => result === "permission"
                ? toast.error(t("Allow notifications for Seanime first.", "Erlaube zuerst Benachrichtigungen für Seanime."))
                : toast.success(t("Test notification sent", "Testbenachrichtigung gesendet")),
        })} />
        {/* the value lives in the Go download queue (queue.json); without its snapshot nothing to show yet */}
        {!!snapshot && <WifiOnlyRow t={t} enabled={snapshot.wifiOnly} onChange={wifiOnly => saveOffline({ wifiOnly })} />}
    </>
}

/** Touch feedback (Feedback.kt); the vibration switch only on devices with a motor (Karte §9, 2.12) */
function AppFeedbackGroup({ t }: { t: Translate }) {
    const [haptics, setHaptics] = useAtom(hapticsEnabledAtom)
    const [sounds, setSounds] = useAtom(soundsEnabledAtom)
    const [vibrator] = React.useState(hasVibrator)
    return <FeedbackGroup t={t} hasVibrator={vibrator} haptics={haptics} onHaptics={setHaptics} sounds={sounds}
        onSounds={enabled => {
            setSounds(enabled)
            if (enabled) playSound("success")
        }} />
}

/**
 * Language of the app's own texts. The web app reloaded so native screens followed; here every text reads the language
 * atom, and the root layout passes it on to the server service's notification.
 */
function LanguageGroup({ t }: { t: Translate }) {
    const [language, setLanguage] = useAtom(appLanguageAtom)
    return <SettingsGroup title={t("Language", "Sprache")}
        note={t("For the app's own screens: tabs, downloads, calendar, player menu.", "Für die eigenen Bildschirme der App: Tabs, Downloads, Kalender, Player-Menü.")}>
        <View className="bg-sm-surface-raised p-2">
            <Tabs variant="segment" value={language} onValueChange={next => setLanguage(next as AppLanguage)}
                items={[{ value: "en", label: "English" }, { value: "de", label: "Deutsch" }]} />
        </View>
    </SettingsGroup>
}

function LocalAccountGroup({ t, isSimulated }: { t: Translate, isSimulated: boolean }) {
    const [confirm, setConfirm] = React.useState(false)
    const { mutate: upload, isPending: uploading } = useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.LOCAL.LocalSyncSimulatedDataToAnilist.endpoint,
        method: API_ENDPOINTS.LOCAL.LocalSyncSimulatedDataToAnilist.methods[0],
        mutationKey: [API_ENDPOINTS.LOCAL.LocalSyncSimulatedDataToAnilist.key],
        onSuccess: async () => {
            toast.success(t("Your local lists are on AniList now", "Deine lokalen Listen sind jetzt auf AniList"))
        },
        onError: () => {
            toast.error(t("The lists could not be uploaded to AniList.", "Die Listen konnten nicht zu AniList hochgeladen werden."))
        },
    })
    return <SettingsGroup title={t("Local account", "Lokales Konto")}
        note={t("Used when you are not signed in with AniList.", "Wird benutzt, wenn du nicht mit AniList angemeldet bist.")}>
        <SettingSwitch path="library.autoSyncToLocalAccount" disabled={isSimulated} label={t("Back up AniList lists", "AniList-Listen sichern")}
            note={t("Copies your AniList lists to the local account now and then. Local changes since the last copy are replaced.",
                "Kopiert deine AniList-Listen ab und zu ins lokale Konto. Lokale Änderungen seit der letzten Kopie werden ersetzt.")} />
        <LinkRow label={uploading ? t("Uploading…", "Wird hochgeladen …") : t("Upload local lists to AniList", "Lokale Listen zu AniList hochladen")}
            disabled={isSimulated || uploading} onPress={() => setConfirm(true)} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Upload to AniList?", "Zu AniList hochladen?")}
            text={t("Your local Seanime lists will be written to your AniList account.", "Deine lokalen Seanime-Listen werden in dein AniList-Konto geschrieben.")}
            action={t("Upload", "Hochladen")} onConfirm={() => upload()} />
    </SettingsGroup>
}

/**
 * Cache-only mode: the server's own state, switched by its toggle endpoint. The server checks AniList every 10 seconds and
 * leaves cache-only mode once AniList answers (cachelayer.go), so the switch asks again as often to show that.
 */
function CacheOnlySwitch({ t }: { t: Translate }) {
    const queryClient = useQueryClient()
    const { data: apiWorking, isLoading } = useServerQuery<boolean>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.key],
        gcTime: 0,
        refetchInterval: 10_000,
    })
    const { mutate: toggle, isPending } = useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.ANILIST.ToggleAnilistCacheLayerStatus.endpoint,
        method: API_ENDPOINTS.ANILIST.ToggleAnilistCacheLayerStatus.methods[0],
        mutationKey: [API_ENDPOINTS.ANILIST.ToggleAnilistCacheLayerStatus.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.key] })
        },
        onError: () => {
            toast.error(t("The setting could not be saved. Try again.", "Die Einstellung konnte nicht gespeichert werden. Versuch es noch einmal."))
        },
    })
    return <LocalSwitch label={t("Cache-only mode", "Nur Zwischenspeicher")} checked={apiWorking === false} disabled={isLoading || isPending} sub
        note={t("Uses cached AniList data and sends no requests. Turns on by itself when AniList fails and off again once AniList answers.",
            "Nutzt gespeicherte AniList-Daten und stellt keine Anfragen. Schaltet sich ein, wenn AniList ausfällt, und wieder aus, sobald AniList antwortet.")}
        onCheckedChange={() => toggle()} />
}

/** The app's own bar and Menu (UIBottomNav.kt): which entries sit in the bar and which in the Menu. */
function NavigationGroup({ t }: { t: Translate }) {
    const [editing, setEditing] = React.useState(false)
    const [confirm, setConfirm] = React.useState(false)
    return <SettingsGroup title={t("Navigation", "Navigation")}
        note={t("Which entries sit in the bar and which in the menu.", "Welche Einträge in der Leiste und welche im Menü stehen.")}>
        <LinkRow label={t("Customize navigation", "Navigation anpassen")} onPress={() => setEditing(true)} />
        <LinkRow label={t("Reset navigation", "Navigation zurücksetzen")} tone="danger" onPress={() => setConfirm(true)} />
        <NavigationEditor open={editing} onOpenChange={setEditing} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Reset to defaults?", "Auf Standard zurücksetzen?")}
            text={t("This will restore the default bottom nav and reset your floating menu customizations.",
                "Die Standard-Navigation unten wird wiederhergestellt und deine Anpassungen am schwebenden Menü werden zurückgesetzt.")}
            action={t("Yes", "Ja")} danger onConfirm={resetNavigation} />
    </SettingsGroup>
}

/** Signing out of AniList; the app falls back to the local account. */
function AccountGroup({ t }: { t: Translate }) {
    const [confirm, setConfirm] = React.useState(false)
    const { mutate: logout, isPending } = useLogout()
    return <SettingsGroup title={t("Account", "Konto")}>
        <LinkRow label={t("Sign out", "Abmelden")} tone="danger" disabled={isPending} onPress={() => setConfirm(true)} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Sign out?", "Abmelden?")}
            text={t("Are you sure you want to sign out?", "Möchtest du dich wirklich abmelden?")}
            action={t("Sign out", "Abmelden")} danger onConfirm={() => logout()} />
    </SettingsGroup>
}
