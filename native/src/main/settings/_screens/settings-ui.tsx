import { type Translate } from "@/lib/app-language"
import { ANIME_COLLECTION_SORTING_OPTIONS, CONTINUE_WATCHING_SORTING_OPTIONS, MANGA_COLLECTION_SORTING_OPTIONS } from "@/lib/helpers/filtering"
import { __navigationPreloadModeAtom, type NavigationPreloadMode } from "@/lib/navigation-preload-settings"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
import { useIsSimulatedUser } from "@/main/_hooks/use-server-status"
import {
    SelectRow,
    LocalSwitch,
    SettingsGroup,
    SwatchRow,
    TextSettingRow,
    ThemeSwitch,
    useSaveTheme,
    useSettingValue,
    useThemeValue,
    validateImageLink,
} from "@/main/settings/_components/settings-kit"
import { opacityOptions } from "@/main/settings/_lib/settings-phone"
import { showStatusBarAtom } from "@/lib/status-bar-setting"
import { cardSizeAtom } from "@/lib/card-size-setting"
import type { CardSize } from "@/components/shared/cover-layout"
import { useAtom } from "jotai"
import { accentColorAtom, amoledAtom } from "@/lib/theme/appearance"
import { ACCENT_IDS, buildPalette, DEFAULT_ACCENT, isAccentId } from "@/lib/theme/palette"

/*
 * Appearance (settings-phone-ui.tsx). Only what the native screens read is here (as the settings audit asked: no switch
 * without effect). Waiting for their reader (Karte §9, E2 2.12): custom colours beyond the accent presets,
 * background image (no native CustomBackgroundImage yet), classic episode cards, blur effects, and on tablets episode
 * summaries / file names. Custom CSS has no meaning without a
 * WebView (🗑️). Removed in the audit and not coming back: blurred background on anime pages, the banner on tablets, episode
 * summaries / file names on phones.
 */

/** German names of the sorting options (the shared lists only carry English ones). */
const SORTING_DE: Record<string, string> = {
    "Aired recently": "Zuletzt ausgestrahlt",
    "Aired oldest": "Am frühesten ausgestrahlt",
    "Aired recently and not up-to-date": "Zuletzt ausgestrahlt, nicht aktuell",
    "Aired oldest and not up-to-date": "Am frühesten ausgestrahlt, nicht aktuell",
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
    "Highest progress": "Höchster Fortschritt",
    "Lowest progress": "Geringster Fortschritt",
    "Started recently": "Zuletzt begonnen",
    "Oldest start date": "Am frühesten begonnen",
    "Released recently": "Zuletzt erschienen",
    "Oldest release": "Am frühesten erschienen",
    "Most recent watch": "Zuletzt geschaut",
    "Least recent watch": "Am längsten nicht geschaut",
    "Title": "Titel (A–Z)",
    "Title (Z-A)": "Titel (Z–A)",
    "Date added (newest first)": "Zuletzt hinzugefügt",
    "Last updated": "Zuletzt geändert",
}

export function SettingsUISection({ t, tablet }: { t: Translate, tablet: boolean }) {
    return <>
        <ColorsGroup t={t} />
        {!tablet && <BannerGroup t={t} />}
        <SortingGroup t={t} />
        <SettingsGroup title={t("Cards and episodes", "Karten und Folgen")}>
            <CardSizeRow t={t} />
            <ThemeSwitch field="showAnimeUnwatchedCount" label={t("Unwatched episodes on anime cards", "Ungesehene Folgen auf Anime-Karten")}
                note={t("A small number on the cover shows how many aired episodes you have not watched yet.",
                    "Eine kleine Zahl auf dem Cover zeigt, wie viele ausgestrahlte Folgen du noch nicht gesehen hast.")} />
            <ThemeSwitch field="showMangaUnreadCount" label={t("Unread chapters on manga cards", "Ungelesene Kapitel auf Manga-Karten")}
                note={t("A small number on the cover shows how many chapters you have not read yet.",
                    "Eine kleine Zahl auf dem Cover zeigt, wie viele Kapitel du noch nicht gelesen hast.")} />
        </SettingsGroup>
        <CarouselGroup t={t} />
        <PreloadGroup t={t} />
        <ScreenGroup t={t} />
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
        note={t("The banner comes from an image link (https://…).", "Das Banner kommt über einen Bildlink (https://…).")}>
        <TextSettingRow label={t("Banner image", "Bannerbild")} value={banner} empty={t("None", "Keins")} keyboardType="url" placeholder="https://…"
            note={t("Shown behind the title on Home. Leave empty for none.", "Erscheint hinter dem Titel auf der Startseite. Leer lassen für keins.")}
            validate={validateImageLink(t)} onApply={value => void save({ libraryScreenCustomBannerImage: value.trim(), ...visible })} />
        {!!banner && <>
            <TextSettingRow label={t("Banner position", "Bannerausschnitt")} value={position} empty="50% 50%" placeholder="50% 50%"
                note={t("Which part of the image shows, as \"horizontal vertical\", e.g. 50% 20%.", "Welcher Teil des Bilds zu sehen ist, als „waagrecht senkrecht“, z. B. 50% 20%.")}
                onApply={value => void save({ libraryScreenCustomBannerPosition: value.trim() })} />
            <SelectRow label={t("Banner opacity", "Deckkraft des Banners")} value={String(opacity)} options={opacityOptions(opacity)}
                note={t("How strongly the image shows behind the title. Lower keeps the title easier to read.",
                    "Wie stark das Bild hinter dem Titel zu sehen ist. Weniger macht den Titel besser lesbar.")}
                defaultValue={String(THEME_DEFAULT_VALUES.libraryScreenCustomBannerOpacity)}
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
            note={t("The order of the row with your next episodes on Home.", "Die Reihenfolge der Reihe mit deinen nächsten Folgen auf der Startseite.")}
            defaultValue={THEME_DEFAULT_VALUES.continueWatchingDefaultSorting}
            options={CONTINUE_WATCHING_SORTING_OPTIONS.map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ continueWatchingDefaultSorting: value })} />
        <SelectRow label={t("Anime library", "Anime-Bibliothek")} value={animeLibrary}
            note={t("The order of \"Anime on this device\" on Home. Your lists keep their own sorting.", "Die Reihenfolge von „Anime auf diesem Gerät“ auf der Startseite. Deine Listen haben ihre eigene Sortierung.")}
            defaultValue={THEME_DEFAULT_VALUES.animeLibraryCollectionDefaultSorting}
            options={ANIME_COLLECTION_SORTING_OPTIONS.filter(option => !option.value.includes("END")).map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ animeLibraryCollectionDefaultSorting: value })} />
        <SelectRow label={t("Manga library", "Manga-Bibliothek")} value={mangaLibrary}
            note={t("The order of the manga in each list of your library.", "Die Reihenfolge der Manga in jeder Liste deiner Bibliothek.")}
            defaultValue={THEME_DEFAULT_VALUES.mangaLibraryCollectionDefaultSorting}
            options={MANGA_COLLECTION_SORTING_OPTIONS.filter(option => !option.value.includes("END")).map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ mangaLibraryCollectionDefaultSorting: value })} />
    </SettingsGroup>
}

/** The grids' covers (cover-layout.ts CARD_SIZE_FACTORS), per device: a phone and a tablet want different sizes. */
function CardSizeRow({ t }: { t: Translate }) {
    const [size, setSize] = useAtom(cardSizeAtom)
    return <SelectRow label={t("Card size", "Kartengröße")} value={size} defaultValue="normal"
        note={t("Covers in your lists, search and downloads. Only on this device.", "Cover in deinen Listen, der Suche und den Downloads. Nur auf diesem Gerät.")}
        options={[
            { value: "small", label: t("Small", "Klein"), note: t("More covers in each row.", "Mehr Cover in jeder Reihe.") },
            { value: "normal", label: t("Normal", "Normal") },
            { value: "large", label: t("Large", "Groß"), note: t("Fewer, bigger covers.", "Weniger, größere Cover.") },
        ]}
        onChange={value => setSize(value as CardSize)} />
}

/** Home's rows that move (home-discover-sections.tsx, continue-watching.tsx). */
function CarouselGroup({ t }: { t: Translate }) {
    const save = useSaveTheme()
    const disabled = useThemeValue("disableCarouselAutoScroll")
    return <SettingsGroup title={t("Home", "Startseite")}>
        <LocalSwitch label={t("Scroll carousels automatically", "Karussells automatisch weiterblättern")} checked={!disabled} defaultChecked
            onCheckedChange={checked => void save({ disableCarouselAutoScroll: !checked })}
            note={t("The trending title and upcoming episodes move on by themselves.", "Der Trend-Titel und die kommenden Folgen wechseln von selbst.")} />
        <ThemeSwitch field="smallerEpisodeCarouselSize" label={t("Smaller episode cards", "Kleinere Folgenkarten")}
            note={t("Continue watching and upcoming episodes show more cards at once.", "Weiterschauen und kommende Folgen zeigen mehr Karten auf einmal.")} />
    </SettingsGroup>
}

function PreloadGroup({ t }: { t: Translate }) {
    const [mode, setMode] = useAtom(__navigationPreloadModeAtom)
    const simulated = useIsSimulatedUser()
    return <SettingsGroup title={t("Loading pages", "Seiten laden")}>
        <SelectRow label={t("Load anime pages ahead", "Anime-Seiten vorab laden")} disabled={simulated} value={simulated ? "disable" : mode}
            note={simulated ? t("Off without an AniList account, because of AniList's request limits.", "Ohne AniList-Konto aus, wegen der Anfragegrenzen von AniList.")
                : t("Only on this device. Loading ahead reaches AniList's request limit sooner.", "Nur auf diesem Gerät. Vorab laden erreicht die Anfragegrenze von AniList schneller.")}
            defaultValue={simulated ? undefined : "default"}
            options={[
                {
                    value: "disable", label: t("Off", "Aus"),
                    note: t("A page loads only after you open it. Uses the fewest requests.", "Eine Seite lädt erst, wenn du sie öffnest. Braucht die wenigsten Anfragen."),
                },
                {
                    value: "default", label: t("When touched", "Bei Berührung"),
                    note: t("Starts loading when you rest a finger on a card for a moment.", "Lädt, sobald dein Finger kurz auf einer Karte liegt."),
                },
                {
                    value: "faster", label: t("When touched, sooner", "Bei Berührung, früher"),
                    note: t("Starts loading right when you touch a card. Pages open faster.", "Lädt sofort, wenn du eine Karte berührst. Seiten öffnen schneller."),
                },
                {
                    value: "viewport", label: t("When on screen", "Sobald sichtbar"),
                    note: t("Loads every card you can see. Fastest, and uses the most requests.", "Lädt jede Karte, die du siehst. Am schnellsten, braucht die meisten Anfragen."),
                },
            ]}
            onChange={value => setMode(value as NavigationPreloadMode)} />
    </SettingsGroup>
}

/** Accent colour (synced, a matter of taste) and AMOLED black (this screen only): both switch at once, appearance.ts */
function ColorsGroup({ t }: { t: Translate }) {
    const [accent, setAccent] = useAtom(accentColorAtom)
    const [amoled, setAmoled] = useAtom(amoledAtom)
    const names = {
        violet: t("Violet", "Violett"), blue: t("Blue", "Blau"), green: t("Green", "Grün"),
        pink: t("Pink", "Rosa"), orange: t("Orange", "Orange"), red: t("Red", "Rot"),
    }
    const options = ACCENT_IDS.map(id => ({ value: id, color: buildPalette(id, false).swatch, label: names[id] }))
    return <SettingsGroup title={t("Colors", "Farben")}>
        <SwatchRow label={t("Accent color", "Akzentfarbe")} value={accent} options={options} defaultValue={DEFAULT_ACCENT}
            onChange={value => isAccentId(value) && setAccent(value)} scope="synced"
            note={t("Buttons, switches and highlights across the app.", "Knöpfe, Schalter und Hervorhebungen in der ganzen App.")} />
        <LocalSwitch label={t("AMOLED black", "AMOLED-Schwarz")} checked={amoled} onCheckedChange={setAmoled} defaultChecked={false}
            note={t("True black background that saves power on OLED screens. Only on this device.",
                "Echt schwarzer Hintergrund, spart Strom auf OLED-Bildschirmen. Nur auf diesem Gerät.")} />
    </SettingsGroup>
}

function ScreenGroup({ t }: { t: Translate }) {
    const [show, setShow] = useAtom(showStatusBarAtom)
    return <SettingsGroup title={t("Screen", "Bildschirm")}>
        <LocalSwitch label={t("Show status bar", "Statusleiste anzeigen")} checked={show} onCheckedChange={setShow} defaultChecked={false}
            note={t("Clock and battery at the top. Always hidden in the player. Only on this device.",
                "Uhr und Akku oben. Im Player immer ausgeblendet. Nur auf diesem Gerät.")} />
    </SettingsGroup>
}
