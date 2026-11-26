import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useIncognito, useSetAppSwitches } from "@/api/hooks/app-switches.hooks"
import { useLogout } from "@/api/hooks/auth.hooks"
import { useListAnimeEntryEpisodeTabExtensions } from "@/api/hooks/extensions.hooks"
import { useGetMobileOfflineSnapshot, useMobileOfflineSettings } from "@/api/hooks/mobile_offline.hooks"
import { toast } from "@/components/ui/toast/toast-store"
import { useAiringNotificationsSetting, useChapterNotificationsSetting, useTestAiringNotification } from "@/lib/airing/airing-hooks"
import { usageCountEnabledAtom } from "@/lib/account/usage-ping-app"
import { appLockEnabledAtom, setAppLockEnabled } from "@/lib/app-lock/app-lock"
import { confirmWithDeviceLock, useHasDeviceLock } from "@/lib/device-lock"
import { APP_LANGUAGES, appLanguageAtom, asAppLanguage, type Translate } from "@/lib/app-language"
import { hapticsEnabledAtom, hasVibrator, playSound, soundsEnabledAtom } from "@/lib/feedback"
import { resetNavigation } from "@/lib/nav/nav-store"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useStartMobileTutorial } from "@/main/_features/tour/mobile-tutorial"
import { BackupGroup } from "@/main/settings/_components/backup-group"
import { NavigationEditor } from "@/main/settings/_components/navigation-editor"
import { AiringRows, ChapterRow, FeedbackGroup, WidgetsGroup, WifiOnlyRow } from "@/main/settings/_components/settings-app-services"
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
import { Platform } from "react-native"
import { requestPinWidget } from "react-native-android-widget"

/**
 * Privacy: the app lock and the usage count in one group (two groups both titled "Privacy" shared one chip, which led to
 * the lower one). App lock (lib/app-lock): turning it on and off both ask the device's own lock. Without one it cannot be
 * turned on; a switch left on after the device lock was removed can still be turned off (confirmWithDeviceLock answers true).
 */
function PrivacyGroup({ t }: { t: Translate }) {
    const [enabled] = useAtom(appLockEnabledAtom)
    const [usageCount, setUsageCount] = useAtom(usageCountEnabledAtom)
    const hasLock = useHasDeviceLock()
    const unavailable = hasLock === false && !enabled
    const toggle = async (next: boolean) => {
        const prompt = next ? t("Turn on the app lock", "App-Sperre einschalten") : t("Turn off the app lock", "App-Sperre ausschalten")
        if (await confirmWithDeviceLock(prompt)) setAppLockEnabled(next)
    }
    return (
        <SettingsGroup title={t("Privacy", "Datenschutz")}>
            <LocalSwitch label={t("App lock", "App-Sperre")} checked={enabled} onCheckedChange={next => void toggle(next)}
                defaultChecked={false} scope="device" disabled={hasLock === undefined || unavailable}
                note={unavailable
                    ? t("Set up a screen lock or fingerprint on this device first.", "Richte zuerst eine Displaysperre oder einen Fingerabdruck auf diesem Gerät ein.")
                    : t("Asks for your fingerprint, face or screen lock when the app starts and after a minute away.",
                        "Fragt nach Fingerabdruck, Gesicht oder Displaysperre, wenn die App startet und nach einer Minute im Hintergrund.")} />
            <LocalSwitch label={t("Send anonymous usage count", "Anonyme Nutzungszählung senden")} checked={usageCount} onCheckedChange={setUsageCount} defaultChecked
                note={t(
                    "Once a day the app sends a random ID and its version, so we know how many people use it. No account, no email, no IP is stored.",
                    "Einmal am Tag sendet die App eine zufällige ID und ihre Version, damit wir wissen, wie viele sie nutzen. Kein Konto, keine E-Mail, keine IP wird gespeichert.",
                )} />
        </SettingsGroup>
    )
}

/*
 * App (settings-phone-app.tsx): episodes (with E4's new-episode notifications and Wi-Fi-only downloads), anime, language,
 * feedback, extensions, local account, metadata, navigation, AniList sign-out. The E4 rows are in settings-app-services.tsx.
 * "Show the setup tutorial" starts the tour (2.16).
 */
export function SettingsAppSection({ t }: { t: Translate }) {
    const status = useServerStatus()
    const startTutorial = useStartMobileTutorial()
    const isSimulated = !!status?.user?.isSimulated
    const hideSpoilers = useThemeValue("hideAnimeSpoilers")
    const adult = useSettingValue("anilist.enableAdultContent", false)
    const cacheDisabled = useSettingValue("anilist.disableCacheLayer", false)
    const incognito = useIncognito()
    const { mutate: setSwitches } = useSetAppSwitches()

    // Defaults: core/settings/shape.ts (SETTINGS_SHAPE, the fresh app) and incognito.ts (off unless stored as true)
    return <>
        <SettingsGroup title={t("Progress", "Fortschritt")}
            note={t("What the app remembers about the episodes you watch.", "Was sich die App über die Folgen merkt, die du schaust.")}>
            <SettingSwitch path="library.autoUpdateProgress" label={t("Update progress automatically", "Fortschritt automatisch speichern")} defaultChecked
                note={t("Marks an episode as watched once you have seen 80% of it.", "Setzt eine Folge auf gesehen, sobald du 80 % davon geschaut hast.")} />
            <SettingSwitch path="library.enableWatchContinuity" label={t("Watch history", "Wiedergabeverlauf")} defaultChecked
                note={t("Remembers where you stopped and resumes there.", "Merkt sich, wo du aufgehört hast, und setzt dort fort.")} />
            <LocalSwitch label={t("Incognito mode", "Inkognito-Modus")} checked={incognito} onCheckedChange={checked => setSwitches({ incognitoMode: checked })}
                defaultChecked={false}
                note={t("While on, nothing you watch or read is added to History or Continue watching, and no progress goes to AniList. Also in the Menu.",
                    "Solange an, landet nichts, was du schaust oder liest, im Verlauf oder bei „Weiterschauen“, und kein Fortschritt geht an AniList. Auch im Menü.")} />
        </SettingsGroup>

        <PrivacyGroup t={t} />

        <SettingsGroup title={t("Episodes", "Folgen")}>
            <DefaultSourceSelect t={t} />
            <WifiOnlySetting t={t} />
        </SettingsGroup>

        <NotificationsGroup t={t} />

        <SettingsGroup title={t("Spoilers", "Spoiler")}
            note={t("Applies to the episodes you have not watched yet.", "Gilt für die Folgen, die du noch nicht gesehen hast.")}>
            <ThemeSwitch field="hideAnimeSpoilers" label={t("Hide spoilers", "Spoiler verbergen")}
                note={t("Episode pictures and texts stay hidden until you get there.", "Bilder und Texte von Folgen bleiben verborgen, bis du dort bist.")} />
            {hideSpoilers && <>
                <ThemeSwitch field="hideAnimeSpoilerThumbnails" label={t("Hide pictures", "Bilder verbergen")} sub
                    note={t("Episode pictures stay covered.", "Folgenbilder bleiben verdeckt.")} />
                <ThemeSwitch field="hideAnimeSpoilerTitles" label={t("Hide titles", "Titel verbergen")} sub
                    note={t("Episode titles stay hidden.", "Folgentitel bleiben verborgen.")} />
                <ThemeSwitch field="hideAnimeSpoilerDescriptions" label={t("Hide descriptions", "Beschreibungen verbergen")} sub
                    note={t("Episode summaries stay hidden.", "Inhaltsangaben der Folgen bleiben verborgen.")} />
                <ThemeSwitch field="hideAnimeSpoilerSkipNextEpisode" label={t("Show the next episode", "Nächste Folge zeigen")}
                    note={t("Starts hiding from the episode after the next one.", "Verbirgt erst ab der übernächsten Folge.")} sub />
            </>}
        </SettingsGroup>

        <SettingsGroup title={t("Content", "Inhalte")}>
            <SettingSwitch path="anilist.hideAudienceScore" label={t("Hide audience score", "Publikumswertung verbergen")} defaultChecked={false}
                note={t("Leaves AniList's score off the Discover cards.", "Blendet die AniList-Wertung auf den Entdecken-Karten aus.")} />
            <SettingSwitch path="anilist.enableAdultContent" label={t("Adult content", "Inhalte für Erwachsene")} defaultChecked={false}
                note={t("When off, adult titles are hidden from search and your library.", "Wenn aus, sind Titel für Erwachsene in Suche und Bibliothek verborgen.")} />
            {adult && <SettingSwitch path="anilist.blurAdultContent" label={t("Blur adult covers", "Cover für Erwachsene verwischen")} sub defaultChecked={false}
                note={t("Covers of adult titles show blurred.", "Cover von Titeln für Erwachsene erscheinen verwischt.")} />}
        </SettingsGroup>

        <LanguageGroup t={t} />
        <NavigationGroup t={t} />
        <AppFeedbackGroup t={t} />
        {Platform.OS === "android" && <WidgetsGroup t={t} onAdd={widget => void addWidget(t, widget)} />}

        <SettingsGroup title={t("Extensions", "Erweiterungen")}>
            <LinkRow label={t("Show the setup tutorial", "Einrichtungs-Tutorial zeigen")}
                note={t("How to add a repository and install a streaming source.", "Wie du ein Repository hinzufügst und eine Streaming-Quelle installierst.")}
                onPress={() => startTutorial()} />
        </SettingsGroup>

        <SettingsGroup title={t("Metadata", "Metadaten")}
            note={t("How the app deals with AniList's data when AniList is slow or down.", "Wie die App mit den Daten von AniList umgeht, wenn AniList langsam ist oder ausfällt.")}>
            <SettingSwitch path="anilist.disableCacheLayer" label={t("Turn off AniList caching", "AniList-Zwischenspeicher ausschalten")} defaultChecked={false}
                note={t("When AniList is down, pages show an error instead of the last saved data.",
                    "Wenn AniList ausfällt, zeigen Seiten einen Fehler statt der zuletzt gespeicherten Daten.")} />
            {!cacheDisabled && <CacheOnlySwitch t={t} />}
        </SettingsGroup>

        <BackupGroup t={t} />
        <LocalAccountGroup t={t} isSimulated={isSimulated} />
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
        {
            value: "-", label: t("Automatic", "Automatisch"),
            note: t("The app picks a source that has episodes for this anime.", "Die App wählt eine Quelle, die Folgen für diesen Anime hat."),
        },
        {
            value: "library", label: t("Local library", "Lokale Bibliothek"),
            note: t("Your files on this device, when the anime has some. Otherwise automatic.",
                "Deine Dateien auf diesem Gerät, wenn der Anime welche hat. Sonst automatisch."),
        },
        ...(onlinestream ? [{
            value: "onlinestream", label: t("Online streaming", "Online-Streaming"),
            note: t("Streams through your online streaming extensions.", "Streamt über deine Online-Streaming-Erweiterungen."),
        }] : []),
        ...(torrentstream ? [{
            value: "torrentstream", label: t("Torrent streaming", "Torrent-Streaming"),
            note: t("Plays a torrent while it downloads.", "Spielt einen Torrent ab, während er lädt."),
        }] : []),
        ...(debridstream ? [{
            value: "debridstream", label: t("Debrid streaming", "Debrid-Streaming"),
            note: t("Streams through your debrid service.", "Streamt über deinen Debrid-Dienst."),
        }] : []),
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
    return <SelectRow label={t("Default episode source", "Standard-Quelle für Folgen")} note={t("The tab an anime page opens on.", "Der Tab, mit dem sich eine Anime-Seite öffnet.")}
        value={value} options={shown} defaultValue="-" onChange={next => void save("library.defaultPlaybackSource", next === "-" ? "" : next)} />
}

/** E4 services: new-episode notifications (+ test) and new-chapter notifications (Karte §9, 2.12) */
function NotificationsGroup({ t }: { t: Translate }) {
    const [airing, setAiring] = useAiringNotificationsSetting()
    const { mutate: testAiring } = useTestAiringNotification()
    const [chapters, setChapters] = useChapterNotificationsSetting()
    return <SettingsGroup title={t("Notifications", "Benachrichtigungen")}>
        <AiringRows t={t} enabled={airing} onChange={setAiring} onTest={() => testAiring(undefined, {
            onSuccess: result => result === "permission"
                ? toast.error(t("Allow notifications for Seanime Mobile first.", "Erlaube zuerst Benachrichtigungen für Seanime Mobile."))
                : toast.success(t("Test notification sent", "Testbenachrichtigung gesendet")),
        })} />
        <ChapterRow t={t} enabled={chapters} onChange={setChapters} />
    </SettingsGroup>
}

/** Wi-Fi-only episode downloads (E4). The value lives in the download queue (queue.json); without its snapshot nothing to show yet */
function WifiOnlySetting({ t }: { t: Translate }) {
    const { data: snapshot } = useGetMobileOfflineSnapshot()
    const { mutate: saveOffline } = useMobileOfflineSettings()
    if (!snapshot) return null
    return <WifiOnlyRow t={t} enabled={snapshot.wifiOnly} onChange={wifiOnly => saveOffline({ wifiOnly })} />
}

/** AppWidgetManager.requestPinAppWidget through the widget library; false when the launcher cannot pin widgets */
async function addWidget(t: Translate, widgetName: string) {
    const asked = await requestPinWidget({ widgetName }).catch(() => false)
    if (!asked) toast.error(t("Your launcher cannot add widgets from apps. Add it from the home screen instead.",
        "Dein Startbildschirm kann keine Widgets aus Apps hinzufügen. Füge es dort über die Widget-Auswahl hinzu."))
}

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
 * Language of the app's own texts, each named in itself (English, Español, 日本語, …). The web app reloaded so native screens
 * followed; here every text reads the language atom. Eight languages do not fit a segment row, so they are a select.
 */
function LanguageGroup({ t }: { t: Translate }) {
    const [language, setLanguage] = useAtom(appLanguageAtom)
    return <SettingsGroup title={t("Language", "Sprache")}
        note={t("For the app's own screens: tabs, downloads, calendar, player menu.", "Für die eigenen Bildschirme der App: Tabs, Downloads, Kalender, Player-Menü.")}>
        <SelectRow label={t("App language", "App-Sprache")} value={language} options={[...APP_LANGUAGES]}
            note={t("Switches right away, no restart needed.", "Wechselt sofort, ohne Neustart.")}
            onChange={next => setLanguage(asAppLanguage(next) ?? "en")} />
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
        <LinkRow label={uploading ? t("Uploading…", "Wird hochgeladen …") : t("Upload local lists to AniList", "Lokale Listen zu AniList hochladen")}
            disabled={isSimulated || uploading} onPress={() => setConfirm(true)}
            note={isSimulated ? t("Sign in with AniList first.", "Melde dich zuerst bei AniList an.")
                : t("Copies the lists of the local account into your AniList account.", "Kopiert die Listen des lokalen Kontos in dein AniList-Konto.")} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Upload to AniList?", "Zu AniList hochladen?")}
            text={t("Your local Seanime Mobile lists will be written to your AniList account.", "Deine lokalen Seanime-Mobile-Listen werden in dein AniList-Konto geschrieben.")}
            action={t("Upload", "Hochladen")} onConfirm={() => upload()} />
    </SettingsGroup>
}

/**
 * Cache-only mode: the core's own state (core/anilist/cache-only.ts), switched by its toggle endpoint. It turns on by
 * itself when AniList fails and off once AniList answers again, so the switch asks every 10 seconds to show that.
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
        <LinkRow label={t("Customize navigation", "Navigation anpassen")} onPress={() => setEditing(true)}
            note={t("Move entries between the bar and the menu, and change their order.", "Verschiebe Einträge zwischen Leiste und Menü und ändere ihre Reihenfolge.")} />
        <LinkRow label={t("Reset navigation", "Navigation zurücksetzen")} tone="danger" onPress={() => setConfirm(true)}
            note={t("Puts the bar and the menu back as they came with the app.", "Stellt Leiste und Menü so her, wie sie mit der App kamen.")} />
        <NavigationEditor open={editing} onOpenChange={setEditing} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Reset to defaults?", "Auf Standard zurücksetzen?")}
            text={t("This will restore the default navigation and reset your menu customizations.",
                "Die Standard-Navigation wird wiederhergestellt und deine Anpassungen am Menü werden zurückgesetzt.")}
            action={t("Yes", "Ja")} danger onConfirm={resetNavigation} />
    </SettingsGroup>
}

/** Signing out of AniList; the app falls back to the local account. */
function AccountGroup({ t }: { t: Translate }) {
    const [confirm, setConfirm] = React.useState(false)
    const { mutate: logout, isPending } = useLogout()
    // AniList only: the sync account has its own page (Settings › Account) and stays signed in
    return <SettingsGroup title="AniList">
        <LinkRow label={t("Sign out of AniList", "Von AniList abmelden")} tone="danger" disabled={isPending} onPress={() => setConfirm(true)}
            note={t("The app switches to the local account. Your lists stay on AniList.", "Die App wechselt zum lokalen Konto. Deine Listen bleiben auf AniList.")} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Sign out of AniList?", "Von AniList abmelden?")}
            text={t("The app stops using your AniList account and falls back to the local account. Your sync account stays signed in.",
                "Die App nutzt dein AniList-Konto nicht mehr und wechselt zum lokalen Konto. Dein Sync-Konto bleibt angemeldet.")}
            action={t("Sign out", "Abmelden")} danger onConfirm={() => logout()} />
    </SettingsGroup>
}
