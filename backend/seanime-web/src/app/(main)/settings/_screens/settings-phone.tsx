import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useCheckForUpdates } from "@/api/hooks/releases.hooks"
import { PhoneHeader, PhoneIconButton, PhoneLoading, PhoneScreen, usePhoneBack } from "@/app/(main)/_features/phone-screen/phone-screen"
import { updateModalOpenAtom as webUpdateModalOpenAtom } from "@/app/(main)/_features/update/update-modal"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { SettingsAppSection } from "@/app/(main)/settings/_screens/settings-phone-app"
import { LinkRow, SettingsGroup, SettingSwitch, SheetCountContext } from "@/app/(main)/settings/_screens/settings-phone-kit"
import { SettingsLibrarySection } from "@/app/(main)/settings/_screens/settings-phone-library"
import { SettingsLogsSection } from "@/app/(main)/settings/_screens/settings-phone-logs"
import { SettingsMangaSection, SettingsNakamaSection, SettingsOnlinestreamSection } from "@/app/(main)/settings/_screens/settings-phone-more"
import { SettingsPlaybackSection } from "@/app/(main)/settings/_screens/settings-phone-playback"
import { SettingsUISection } from "@/app/(main)/settings/_screens/settings-phone-ui"
import { getAndroidAppVersion } from "@/lib/android-app"
import { Translate, useTr } from "@/lib/app-language"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { IconType } from "react-icons"
import { LuArrowLeft, LuBookKey, LuBookOpen, LuChevronRight, LuCirclePlay, LuGlobe, LuInfo, LuLibrary, LuPalette, LuUsers, LuWandSparkles } from "react-icons/lu"
import { toast } from "sonner"
import "./settings-phone.css"

export type SettingsSectionId = "seanime" | "ui" | "playback" | "library" | "onlinestream" | "manga" | "nakama" | "logs" | "about"

const SECTIONS: { id: SettingsSectionId, icon: IconType, title: [string, string], summary: [string, string] }[] = [
    { id: "seanime", icon: LuWandSparkles, title: ["App", "App"], summary: ["Episodes, spoilers, language, extensions, metadata", "Folgen, Spoiler, Sprache, Erweiterungen, Metadaten"] },
    { id: "ui", icon: LuPalette, title: ["Appearance", "Darstellung"], summary: ["Colours, background image, sorting, cards", "Farben, Hintergrundbild, Sortierung, Karten"] },
    { id: "playback", icon: LuCirclePlay, title: ["Playback", "Wiedergabe"], summary: ["Player for your files, external player, next episode", "Player für deine Dateien, externer Player, nächste Folge"] },
    { id: "library", icon: LuLibrary, title: ["Local library", "Lokale Bibliothek"], summary: ["Folders, scanning, export", "Ordner, Scannen, Export"] },
    { id: "onlinestream", icon: LuGlobe, title: ["Online streaming", "Online-Streaming"], summary: ["Streaming and your anime lists", "Streaming und deine Anime-Listen"] },
    { id: "manga", icon: LuBookOpen, title: ["Manga", "Manga"], summary: ["Reading progress, default source, local folder", "Lesefortschritt, Standardquelle, lokaler Ordner"] },
    { id: "nakama", icon: LuUsers, title: ["Nakama", "Nakama"], summary: ["Connect to a Nakama host", "Mit einem Nakama-Host verbinden"] },
    { id: "logs", icon: LuBookKey, title: ["Logs & cache", "Logs & Cache"], summary: ["Server logs, cache, recording an issue", "Server-Logs, Cache, Fehler aufzeichnen"] },
    { id: "about", icon: LuInfo, title: ["About", "Über"], summary: ["Version and updates", "Version und Updates"] },
]

/** ?tab= of the desktop page (links, tours) to the phone section that holds it; tabs of hidden features open the list. */
const TAB_SECTIONS: Record<string, SettingsSectionId> = {
    seanime: "seanime", local: "seanime", ui: "ui", playback: "playback", "external-player-link": "playback", "media-player": "playback",
    mediastream: "playback", library: "library", onlinestream: "onlinestream", manga: "manga", nakama: "nakama", logs: "logs", about: "about",
}

/**
 * The open area is remembered for this history entry (by its router key): switching the preload mode swaps the router (main.tsx) and
 * turning custom colours off reloads the app, and the page should come back on the same area. A new visit to /settings has a new key
 * and opens the list. Kept out of history.state, since writing it there makes the router load the page again.
 */
const SECTION_KEY = "sea-settings-section:"

function historyKey() {
    const key = window.history.state?.__TSR_key ?? window.history.state?.key
    return key ? SECTION_KEY + key : null
}

function sectionInHistory(): SettingsSectionId | null {
    const key = historyKey()
    if (!key) return null
    try {
        const id = sessionStorage.getItem(key)
        return SECTIONS.find(item => item.id === id)?.id ?? null
    }
    catch {
        return null
    }
}

/**
 * Android phone settings: a list of areas, each opening its page in the same screen. Every change saves at once (no Save button
 * at the end of a long page, nothing lost on leaving); Android Back closes an open sheet first, then the page, then the screen.
 * Only settings that work in the app are here: desktop players, transcoding, torrents, Discord, sidebar and keyboard settings
 * stay on the desktop page.
 */
export function SettingsPhone() {
    const t = useTr()
    const status = useServerStatus()
    const router = useRouter()
    const searchParams = useSearchParams()
    const [section, setSection] = React.useState<SettingsSectionId | null>(() => TAB_SECTIONS[searchParams.get("tab") ?? ""] ?? sectionInHistory())
    const [sheets, setSheets] = React.useState(0)
    const countSheets = React.useCallback((delta: number) => setSheets(open => Math.max(0, open + delta)), [])
    const rows = React.useRef(new Map<SettingsSectionId, HTMLButtonElement>())
    const returnTo = React.useRef<SettingsSectionId | null>(section)

    // Again after the deep link's replace, which gives the entry a new key
    React.useEffect(() => {
        const key = historyKey()
        if (!key) return
        try {
            if (section) sessionStorage.setItem(key, section)
            else sessionStorage.removeItem(key)
        }
        catch {}
    }, [section, searchParams])

    // A deep link opens its page once; the address goes back to /settings, as on the desktop page
    React.useEffect(() => {
        const tab = searchParams.get("tab")
        if (!tab) return
        const target = TAB_SECTIONS[tab]
        if (target) setSection(target)
        const params = new URLSearchParams(searchParams)
        params.delete("tab")
        const query = params.toString()
        router.replace(query ? `?${query}` : "/settings", { scroll: false })
    }, [searchParams])

    const open = (id: SettingsSectionId) => {
        returnTo.current = id
        setSection(id)
        window.scrollTo({ top: 0 })
    }
    const close = React.useCallback(() => setSection(null), [])
    usePhoneBack(section !== null && sheets === 0, close)

    // Back on the list puts the focus (and the scroll) on the area that was open
    React.useEffect(() => {
        if (section !== null || !returnTo.current) return
        rows.current.get(returnTo.current)?.focus({ preventScroll: false })
        returnTo.current = null
    }, [section])

    const current = SECTIONS.find(item => item.id === section)

    return <SheetCountContext.Provider value={countSheets}>
        <PhoneScreen screen="settings" data-settings-section={section ?? "home"}>
            {!status?.settings
                ? <PhoneLoading label={t("Loading settings", "Einstellungen werden geladen")} layout={["head", "row", "row", "row", "row"]} />
                : current
                    ? <>
                        <header className="pst-subhead">
                            <PhoneIconButton label={t("Back to settings", "Zurück zu den Einstellungen")} onClick={close} data-settings-back>
                                <LuArrowLeft aria-hidden />
                            </PhoneIconButton>
                            <h1>{t(...current.title)}</h1>
                        </header>
                        <div className="pst-page" data-settings-page={current.id}>
                            <SectionContent id={current.id} t={t} />
                        </div>
                    </>
                    : <>
                        <PhoneHeader title={t("Settings", "Einstellungen")} facts={versionLine(status.version)} />
                        <nav className="pst-nav" aria-label={t("Settings areas", "Einstellungsbereiche")} data-settings-nav>
                            {SECTIONS.map(item => <button key={item.id} type="button" className="pst-nav-row" data-settings-open={item.id}
                                ref={el => { if (el) rows.current.set(item.id, el); else rows.current.delete(item.id) }} onClick={() => open(item.id)}>
                                <item.icon className="pst-nav-icon" aria-hidden />
                                <span className="pst-row-text">
                                    <span>{t(...item.title)}</span>
                                    <small>{t(...item.summary)}</small>
                                </span>
                                <LuChevronRight aria-hidden />
                            </button>)}
                        </nav>
                    </>}
        </PhoneScreen>
    </SheetCountContext.Provider>
}

function versionLine(version?: string) {
    const app = getAndroidAppVersion()
    return [version ? `Seanime ${version}` : "", app ? `App ${app}` : ""].filter(Boolean).join(" · ")
}

function SectionContent({ id, t }: { id: SettingsSectionId, t: Translate }) {
    switch (id) {
        case "seanime":
            return <SettingsAppSection t={t} />
        case "ui":
            return <SettingsUISection t={t} />
        case "playback":
            return <SettingsPlaybackSection t={t} />
        case "library":
            return <SettingsLibrarySection t={t} />
        case "onlinestream":
            return <SettingsOnlinestreamSection t={t} />
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

/** Versions, the app update check and, quietly at the end, Donate. */
function SettingsAboutSection({ t }: { t: Translate }) {
    const status = useServerStatus()
    const queryClient = useQueryClient()
    const setUpdateModalOpen = useSetAtom(webUpdateModalOpenAtom)
    const { mutate: checkForUpdates, isPending: checking } = useCheckForUpdates()
    const app = getAndroidAppVersion()

    return <>
        <SettingsGroup id="about-version" title={t("Version", "Version")}>
            <dl className="ps-facts" data-settings-versions>
                {!!app && <div><dt>{t("App", "App")}</dt><dd>{app}</dd></div>}
                <div><dt>Seanime</dt><dd>{[status?.version, status?.versionName].filter(Boolean).join(" ")}</dd></div>
            </dl>
        </SettingsGroup>
        <SettingsGroup id="about-updates" title={t("Updates", "Updates")}>
            <SettingSwitch path="library.disableUpdateCheck" invert label={t("Look for new versions", "Nach neuen Versionen suchen")}
                note={t("Shows a notice when a new app version is out.", "Zeigt einen Hinweis, sobald eine neue App-Version erscheint.")} />
            <LinkRow label={checking ? t("Checking for updates…", "Suche nach Updates …") : t("Check for updates now", "Jetzt nach Updates suchen")}
                disabled={checking} data-settings-check-updates onClick={() => checkForUpdates(undefined, {
                    onSuccess: data => {
                        if (data?.release) {
                            queryClient.setQueryData([API_ENDPOINTS.RELEASES.GetLatestUpdate.key], data)
                            setUpdateModalOpen(true)
                        } else {
                            toast.success(t("You are running the latest version", "Du nutzt die neueste Version"))
                        }
                    },
                })} />
        </SettingsGroup>
        <a className="pst-quiet-link" href="https://github.com/sponsors/5rahim" target="_blank" rel="noopener noreferrer" data-settings-donate>
            {t("Donate to the Seanime developer", "An den Seanime-Entwickler spenden")}
        </a>
    </>
}
