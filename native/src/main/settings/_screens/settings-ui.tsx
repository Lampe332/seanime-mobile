import { type Translate } from "@/lib/app-language"
import { ANIME_COLLECTION_SORTING_OPTIONS, CONTINUE_WATCHING_SORTING_OPTIONS, MANGA_COLLECTION_SORTING_OPTIONS } from "@/lib/helpers/filtering"
import { __navigationPreloadModeAtom, type NavigationPreloadMode } from "@/lib/navigation-preload-settings"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
import { useIsSimulatedUser } from "@/main/_hooks/use-server-status"
import {
    SelectRow,
    SettingsGroup,
    TextSettingRow,
    ThemeSwitch,
    useSaveTheme,
    useSettingValue,
    useThemeValue,
    validateImageLink,
} from "@/main/settings/_components/settings-kit"
import { opacityOptions } from "@/main/settings/_lib/settings-phone"
import { useAtom } from "jotai"

/*
 * Appearance (settings-phone-ui.tsx). Only what the native screens read is here (as the settings audit asked: no switch
 * without effect). Waiting for their reader (Karte §9, E2 2.12): custom colours + presets (the tokens are fixed so far),
 * background image (no native CustomBackgroundImage yet), classic episode cards, carousel auto-scroll, smaller episode
 * cards in carousels, blur effects, and on tablets episode summaries / file names. Custom CSS has no meaning without a
 * WebView (🗑️). Removed in the audit and not coming back: blurred background on anime pages, the banner on tablets, episode
 * summaries / file names on phones.
 */

/** German names of the sorting options (the shared lists only carry English ones). */
const SORTING_DE: Record<string, string> = {
    "Aired recently": "Zuletzt ausgestrahlt",
    "Aired oldest": "Am längsten ausgestrahlt",
    "Aired recently and not up-to-date": "Zuletzt ausgestrahlt, nicht aktuell",
    "Aired oldest and not up-to-date": "Am längsten ausgestrahlt, nicht aktuell",
    "Highest episode number": "Höchste Folgennummer",
    "Lowest episode number": "Niedrigste Folgennummer",
    "Most unwatched episodes": "Meiste ungesehene Folgen",
    "Least unwatched episodes": "Wenigste ungesehene Folgen",
    "Most unread chapters": "Meiste ungelesene Kapitel",
    "Least unread chapters": "Wenigste ungelesene Kapitel",
    "Highest score": "Höchste eigene Bewertung",
    "Lowest score": "Niedrigste eigene Bewertung",
    "Highest audience score": "Höchste Publikumswertung",
    "Lowest audience score": "Niedrigste Publikumswertung",
    "Highest progress": "Meister Fortschritt",
    "Lowest progress": "Wenigster Fortschritt",
    "Started recently": "Zuletzt begonnen",
    "Oldest start date": "Am längsten begonnen",
    "Released recently": "Zuletzt erschienen",
    "Oldest release": "Am längsten erschienen",
    "Most recent watch": "Zuletzt geschaut",
    "Least recent watch": "Am längsten nicht geschaut",
    "Title": "Titel (A–Z)",
    "Title (Z-A)": "Titel (Z–A)",
    "Date added (newest first)": "Zuletzt hinzugefügt",
    "Last updated": "Zuletzt geändert",
}

export function SettingsUISection({ t, tablet }: { t: Translate, tablet: boolean }) {
    return <>
        {!tablet && <BannerGroup t={t} />}
        <SortingGroup t={t} />
        <SettingsGroup title={t("Cards and episodes", "Karten und Folgen")}>
            <ThemeSwitch field="showAnimeUnwatchedCount" label={t("Unwatched episodes on anime cards", "Ungesehene Folgen auf Anime-Karten")} />
            <ThemeSwitch field="showMangaUnreadCount" label={t("Unread chapters on manga cards", "Ungelesene Kapitel auf Manga-Karten")} />
        </SettingsGroup>
        <PreloadGroup t={t} />
    </>
}

/**
 * The banner behind the Home title (home-mobile-header.tsx), phones only: the tablet never shows a banner, so its fields
 * are left out there (settings audit afef206).
 */
function BannerGroup({ t }: { t: Translate }) {
    const save = useSaveTheme()
    const banner = useThemeValue("libraryScreenCustomBannerImage")
    const position = useThemeValue("libraryScreenCustomBannerPosition")
    const opacity = useThemeValue("libraryScreenCustomBannerOpacity")
    // An opacity never set is stored as 0, which would draw the new image invisibly: it gets the default with the image
    const visible = opacity > 0 ? {} : { libraryScreenCustomBannerOpacity: THEME_DEFAULT_VALUES.libraryScreenCustomBannerOpacity }
    return <SettingsGroup title={t("Banner", "Banner")}
        note={t("Images come from a link: the app cannot add files to the server's image folder.",
            "Bilder kommen über einen Link: Die App kann keine Dateien in den Bilderordner des Servers legen.")}>
        <TextSettingRow label={t("Banner image", "Bannerbild")} value={banner} empty={t("None", "Keins")} keyboardType="url" placeholder="https://…"
            note={t("Shown behind the title on Home. Leave empty for none.", "Erscheint hinter dem Titel auf der Startseite. Leer lassen für keins.")}
            validate={validateImageLink(t)} onApply={value => void save({ libraryScreenCustomBannerImage: value.trim(), ...visible })} />
        {!!banner && <>
            <TextSettingRow label={t("Banner position", "Bannerausschnitt")} value={position} empty="50% 50%" placeholder="50% 50%"
                note={t("Which part of the image shows, as \"horizontal vertical\", e.g. 50% 20%.", "Welcher Teil des Bilds zu sehen ist, als „waagrecht senkrecht“, z. B. 50% 20%.")}
                onApply={value => void save({ libraryScreenCustomBannerPosition: value.trim() })} />
            <SelectRow label={t("Banner opacity", "Deckkraft des Banners")} value={String(opacity)} options={opacityOptions(opacity)}
                onChange={value => void save({ libraryScreenCustomBannerOpacity: Number(value) })} />
        </>}
    </SettingsGroup>
}

function SortingGroup({ t }: { t: Translate }) {
    const save = useSaveTheme()
    const continueWatching = useThemeValue("continueWatchingDefaultSorting")
    const animeLibrary = useThemeValue("animeLibraryCollectionDefaultSorting")
    const mangaLibrary = useThemeValue("mangaLibraryCollectionDefaultSorting")
    const watchHistory = useSettingValue("library.enableWatchContinuity", false)
    const label = (option: { label: string }) => t(option.label, SORTING_DE[option.label] ?? option.label)
    const needsHistory = !watchHistory && [continueWatching, animeLibrary].some(value => value.includes("LAST_WATCHED"))
    return <SettingsGroup title={t("Sorting", "Sortierung")}
        note={needsHistory ? t("\"Most recent watch\" needs the watch history (App).", "„Zuletzt geschaut“ braucht den Wiedergabeverlauf (App).") : undefined}>
        <SelectRow label={t("Continue watching", "Weiterschauen")} value={continueWatching}
            options={CONTINUE_WATCHING_SORTING_OPTIONS.map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ continueWatchingDefaultSorting: value })} />
        <SelectRow label={t("Anime library", "Anime-Bibliothek")} value={animeLibrary}
            options={ANIME_COLLECTION_SORTING_OPTIONS.filter(option => !option.value.includes("END")).map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ animeLibraryCollectionDefaultSorting: value })} />
        <SelectRow label={t("Manga library", "Manga-Bibliothek")} value={mangaLibrary}
            options={MANGA_COLLECTION_SORTING_OPTIONS.filter(option => !option.value.includes("END")).map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ mangaLibraryCollectionDefaultSorting: value })} />
    </SettingsGroup>
}

function PreloadGroup({ t }: { t: Translate }) {
    const [mode, setMode] = useAtom(__navigationPreloadModeAtom)
    const simulated = useIsSimulatedUser()
    return <SettingsGroup title={t("Loading pages", "Seiten laden")}>
        <SelectRow label={t("Load anime pages ahead", "Anime-Seiten vorab laden")} disabled={simulated} value={simulated ? "disable" : mode}
            note={simulated ? t("Off without an AniList account, because of AniList's request limits.", "Ohne AniList-Konto aus, wegen der Anfragegrenzen von AniList.")
                : t("Only on this device. Loading ahead reaches AniList's request limit sooner.", "Nur auf diesem Gerät. Vorab laden erreicht die Anfragegrenze von AniList schneller.")}
            options={[
                { value: "disable", label: t("Off", "Aus") },
                { value: "default", label: t("When touched", "Bei Berührung") },
                { value: "faster", label: t("When touched, sooner", "Bei Berührung, früher") },
                { value: "viewport", label: t("When on screen", "Sobald sichtbar") },
            ]}
            onChange={value => setMode(value as NavigationPreloadMode)} />
    </SettingsGroup>
}
