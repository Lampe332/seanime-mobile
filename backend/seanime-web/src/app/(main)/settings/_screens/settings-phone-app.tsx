import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useListAnimeEntryEpisodeTabExtensions } from "@/api/hooks/extensions.hooks"
import { PhoneSwitch, PhoneTabs } from "@/app/(main)/_features/phone-screen/phone-screen"
import { useStartMobileTutorial } from "@/app/(main)/_features/tour/mobile-tutorial"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import {
    ConfirmSheet,
    LinkRow,
    SelectRow,
    SettingsGroup,
    SettingSwitch,
    ThemeSwitch,
    useSaveSetting,
    useSettingValue,
    useThemeValue,
} from "@/app/(main)/settings/_screens/settings-phone-kit"
import { AppLanguage, appLanguageAtom, syncAppLanguageToAndroid, Translate } from "@/lib/app-language"
import { useQueryClient } from "@tanstack/react-query"
import { useAtom } from "jotai"
import React from "react"
import { toast } from "sonner"

/** App: episodes, anime, language, extensions, local account, metadata. */
export function SettingsAppSection({ t }: { t: Translate }) {
    const status = useServerStatus()
    const isSimulated = !!status?.user?.isSimulated
    const hideSpoilers = useThemeValue("hideAnimeSpoilers")
    const adult = useSettingValue("anilist.enableAdultContent", false)
    const cacheDisabled = useSettingValue("anilist.disableCacheLayer", false)
    const startTutorial = useStartMobileTutorial()

    return <>
        <SettingsGroup id="app-episodes" title={t("Episodes", "Folgen")}>
            <SettingSwitch path="library.autoUpdateProgress" label={t("Update progress automatically", "Fortschritt automatisch speichern")}
                note={t("Marks an episode as watched once you have seen 80 % of it.", "Setzt eine Folge auf gesehen, sobald du 80 % davon geschaut hast.")} />
            <SettingSwitch path="library.enableWatchContinuity" label={t("Watch history", "Wiedergabeverlauf")}
                note={t("Remembers where you stopped and resumes there.", "Merkt sich, wo du aufgehört hast, und setzt dort fort.")} />
            <DefaultSourceSelect t={t} />
        </SettingsGroup>

        <SettingsGroup id="app-anime" title={t("Anime", "Anime")}>
            <ThemeSwitch field="hideAnimeSpoilers" label={t("Hide spoilers", "Spoiler verbergen")}
                note={t("Episode pictures and texts stay hidden until you get there.", "Bilder und Texte von Folgen bleiben verborgen, bis du dort bist.")} />
            {hideSpoilers && <>
                <ThemeSwitch field="hideAnimeSpoilerThumbnails" label={t("Hide pictures", "Bilder verbergen")} data-settings-sub />
                <ThemeSwitch field="hideAnimeSpoilerTitles" label={t("Hide titles", "Titel verbergen")} data-settings-sub />
                <ThemeSwitch field="hideAnimeSpoilerDescriptions" label={t("Hide descriptions", "Beschreibungen verbergen")} data-settings-sub />
                <ThemeSwitch field="hideAnimeSpoilerSkipNextEpisode" label={t("Show the next episode", "Nächste Folge zeigen")}
                    note={t("Starts hiding from the episode after the next one.", "Verbirgt erst ab der übernächsten Folge.")} data-settings-sub />
            </>}
            <SettingSwitch path="anilist.hideAudienceScore" label={t("Hide audience score", "Publikumswertung verbergen")}
                note={t("Shows the score only when you tap it.", "Zeigt die Wertung erst, wenn du darauf tippst.")} />
            <SettingSwitch path="anilist.enableAdultContent" label={t("Adult content", "Inhalte für Erwachsene")}
                note={t("When off, adult titles are hidden from search and your library.", "Wenn aus, sind Titel für Erwachsene in Suche und Bibliothek verborgen.")} />
            {adult && <SettingSwitch path="anilist.blurAdultContent" label={t("Blur adult covers", "Cover für Erwachsene verwischen")} data-settings-sub />}
        </SettingsGroup>

        <LanguageGroup t={t} />

        <SettingsGroup id="app-extensions" title={t("Extensions", "Erweiterungen")}>
            <SettingSwitch path="library.enableExtensionSecureMode" label={t("Secure mode", "Sicherer Modus")}
                note={t("Asks before an extension does something sensitive, even with permission.", "Fragt nach, bevor eine Erweiterung etwas Heikles tut, auch mit Berechtigung.")} />
            <LinkRow label={t("Show the setup tutorial", "Einrichtungs-Tutorial zeigen")}
                note={t("How to add a repository and install a streaming source.", "Wie du ein Repository hinzufügst und eine Streaming-Quelle installierst.")}
                onClick={() => startTutorial()} data-settings-tutorial />
        </SettingsGroup>

        <LocalAccountGroup t={t} isSimulated={isSimulated} />

        <SettingsGroup id="app-metadata" title={t("Metadata", "Metadaten")}>
            <SettingSwitch path="anilist.disableCacheLayer" label={t("Turn off AniList caching", "AniList-Zwischenspeicher ausschalten")}
                note={t("The cache keeps the app usable while AniList is down.", "Der Zwischenspeicher hält die App nutzbar, wenn AniList ausfällt.")} />
            {!cacheDisabled && <CacheOnlySwitch t={t} />}
            <SettingSwitch path="library.useFallbackMetadataProvider" label={t("Fallback episode metadata", "Ersatzquelle für Folgendaten")}
                note={t("Loads episode details from another source.", "Lädt Folgendetails aus einer anderen Quelle.")} />
        </SettingsGroup>
    </>
}

/** Default episode source: as on the desktop page; torrent and Debrid streaming once they are turned on (Torrents & debrid). */
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
    return <SelectRow id="pst-default-source" label={t("Default episode source", "Standard-Quelle für Folgen")}
        note={t("Used when you open an anime.", "Wird beim Öffnen eines Anime benutzt.")} value={value} options={shown}
        onChange={next => void save("library.defaultPlaybackSource", next === "-" ? "" : next)} data-setting="library.defaultPlaybackSource" />
}

/** Language of the app's own texts; the app reloads so native screens and notifications follow. */
function LanguageGroup({ t }: { t: Translate }) {
    const [language, setLanguage] = useAtom(appLanguageAtom)
    const choose = (next: string) => {
        if (next === language) return
        setLanguage(next as AppLanguage)
        syncAppLanguageToAndroid(next as AppLanguage)
        window.setTimeout(() => window.location.reload(), 50)
    }
    return <SettingsGroup id="app-language" title={t("Language", "Sprache")}
        note={t("For the app's own screens: tabs, downloads, calendar, player menu.", "Für die eigenen Bildschirme der App: Tabs, Downloads, Kalender, Player-Menü.")}>
        <PhoneTabs label={t("App language", "App-Sprache")} variant="segment" value={language} onChange={choose} data-settings-language
            tabs={[{ value: "en", label: "English" }, { value: "de", label: "Deutsch" }]} />
    </SettingsGroup>
}

function LocalAccountGroup({ t, isSimulated }: { t: Translate, isSimulated: boolean }) {
    const [confirm, setConfirm] = React.useState(false)
    const row = React.useRef<HTMLButtonElement>(null)
    const { mutate: upload, isPending: uploading } = useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.LOCAL.LocalSyncSimulatedDataToAnilist.endpoint,
        method: API_ENDPOINTS.LOCAL.LocalSyncSimulatedDataToAnilist.methods[0],
        mutationKey: [API_ENDPOINTS.LOCAL.LocalSyncSimulatedDataToAnilist.key],
        onSuccess: async () => { toast.success(t("Your local lists are on AniList now", "Deine lokalen Listen sind jetzt auf AniList")) },
        onError: () => { toast.error(t("The lists could not be uploaded to AniList.", "Die Listen konnten nicht zu AniList hochgeladen werden.")) },
    })
    return <SettingsGroup id="app-local" title={t("Local account", "Lokales Konto")}
        note={t("Used when you are not signed in with AniList.", "Wird benutzt, wenn du nicht mit AniList angemeldet bist.")}>
        <SettingSwitch path="library.autoSyncToLocalAccount" disabled={isSimulated} label={t("Back up AniList lists", "AniList-Listen sichern")}
            note={t("Copies your AniList lists to the local account now and then. Local changes since the last copy are replaced.",
                "Kopiert deine AniList-Listen ab und zu ins lokale Konto. Lokale Änderungen seit der letzten Kopie werden ersetzt.")} />
        <LinkRow ref={row} label={uploading ? t("Uploading…", "Wird hochgeladen …") : t("Upload local lists to AniList", "Lokale Listen zu AniList hochladen")}
            disabled={isSimulated || uploading} onClick={() => setConfirm(true)} data-settings-upload-lists />
        <ConfirmSheet t={t} open={confirm} onOpenChange={setConfirm} returnFocusRef={row} title={t("Upload to AniList?", "Zu AniList hochladen?")}
            text={t("Your local Seanime lists will be written to your AniList account.", "Deine lokalen Seanime-Listen werden in dein AniList-Konto geschrieben.")}
            action={t("Upload", "Hochladen")} onConfirm={() => upload()} data-settings-upload-confirm />
    </SettingsGroup>
}

/**
 * Cache-only mode: the server's own state, switched by its toggle endpoint. The server checks AniList every 10 seconds and leaves
 * cache-only mode once AniList answers (cachelayer.go), so the switch asks again as often to show that.
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
        onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnilistCacheLayerStatus.key] }) },
        onError: () => { toast.error(t("The setting could not be saved. Try again.", "Die Einstellung konnte nicht gespeichert werden. Versuch es noch einmal.")) },
    })
    return <PhoneSwitch label={t("Cache-only mode", "Nur Zwischenspeicher")} checked={apiWorking === false} disabled={isLoading || isPending}
        note={t("Uses cached AniList data and sends no requests. Turns on by itself when AniList fails and off again once AniList answers.",
            "Nutzt gespeicherte AniList-Daten und stellt keine Anfragen. Schaltet sich ein, wenn AniList ausfällt, und wieder aus, sobald AniList antwortet.")}
        onChange={() => toggle()} data-settings-cache-only data-settings-sub />
}
