import { useIsSimulatedUser, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import {
    LinkRow,
    SelectRow,
    SettingsGroup,
    TextSettingRow,
    ThemeSwitch,
    useSaveTheme,
    useSettingValue,
    useThemeValue,
    validateImageLink,
} from "@/app/(main)/settings/_screens/settings-phone-kit"
import { useCustomCSS } from "@/components/shared/custom-css-provider"
import { Translate } from "@/lib/app-language"
import { ANIME_COLLECTION_SORTING_OPTIONS, CONTINUE_WATCHING_SORTING_OPTIONS, MANGA_COLLECTION_SORTING_OPTIONS } from "@/lib/helpers/filtering"
import { __navigationPreloadModeAtom, NavigationPreloadMode } from "@/lib/navigation-preload-settings"
import { THEME_COLOR_BANK } from "@/lib/theme/theme-bank"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
import { colord } from "colord"
import { useAtom } from "jotai"
import React from "react"
import { toast } from "sonner"

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

/** Opacity choices in steps of 5, plus a stored value between them. */
function opacityOptions(current: number) {
    const steps = Array.from({ length: 20 }, (_, i) => (i + 1) * 5)
    return [...new Set([...steps, current])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value} %` }))
}

/** Appearance: colours, background image and banner, sorting, cards and episodes, preloading, custom CSS. */
export function SettingsUISection({ t }: { t: Translate }) {
    return <>
        <ColoursGroup t={t} />
        <ImagesGroup t={t} />
        <SortingGroup t={t} />
        <SettingsGroup id="ui-cards" title={t("Cards and episodes", "Karten und Folgen")}>
            <ThemeSwitch field="showAnimeUnwatchedCount" label={t("Unwatched episodes on anime cards", "Ungesehene Folgen auf Anime-Karten")} />
            <ThemeSwitch field="showMangaUnreadCount" label={t("Unread chapters on manga cards", "Ungelesene Kapitel auf Manga-Karten")} />
            <ThemeSwitch field="useLegacyEpisodeCard" label={t("Classic episode cards", "Klassische Folgenkarten")} />
            <ThemeSwitch field="hideEpisodeCardDescription" label={t("Hide episode summaries", "Folgenbeschreibungen verbergen")} />
            <ThemeSwitch field="hideDownloadedEpisodeCardFilename" label={t("Hide file names of episodes", "Dateinamen von Folgen verbergen")} />
            <ThemeSwitch field="disableCarouselAutoScroll" label={t("Stop carousels from scrolling by themselves", "Karussells nicht selbst weiterlaufen lassen")} />
            <ThemeSwitch field="smallerEpisodeCarouselSize" label={t("Smaller episode cards in carousels", "Kleinere Folgenkarten in Karussells")} />
            <ThemeSwitch field="enableBlurringEffects" label={t("Blur effects", "Unschärfe-Effekte")}
                note={t("Can slow down some phones.", "Kann manche Handys verlangsamen.")} />
            <ThemeSwitch field="enableMediaPageBlurredBackground" label={t("Blurred background on anime pages", "Verwischter Hintergrund auf Anime-Seiten")}
                note={t("Can slow down some phones.", "Kann manche Handys verlangsamen.")} />
        </SettingsGroup>
        <PreloadGroup t={t} />
        <CustomCSSGroup t={t} />
    </>
}

function ColoursGroup({ t }: { t: Translate }) {
    const save = useSaveTheme()
    const enabled = useThemeValue("enableColorSettings")
    const background = useThemeValue("backgroundColor")
    const accent = useThemeValue("accentColor")
    const choose = (patch: { backgroundColor?: string, accentColor?: string }) => {
        if (patch.backgroundColor && colord(patch.backgroundColor).isLight()) {
            toast.error(t("Seanime only supports dark backgrounds.", "Seanime unterstützt nur dunkle Hintergründe."))
            return
        }
        void save({ enableColorSettings: true, ...patch })
    }
    return <SettingsGroup id="ui-colours" title={t("Colours", "Farben")}>
        <PhoneSwitch label={t("Custom colours", "Eigene Farben")} checked={enabled} data-theme-field="enableColorSettings"
            note={t("Turning them off reloads the app.", "Ausschalten lädt die App neu.")}
            onChange={async checked => {
                // As on the desktop page: the colours of the running page only reset with a reload
                if (await save({ enableColorSettings: checked }) && !checked) window.location.reload()
            }} />
        {enabled && <>
            <div className="pst-swatches" role="group" aria-label={t("Colour presets", "Farbvorlagen")} data-settings-colour-presets>
                {THEME_COLOR_BANK.map(preset => {
                    const chosen = background === preset.backgroundColor && accent === preset.accentColor
                    return <button key={preset.name} type="button" aria-pressed={chosen} data-preset={preset.name}
                        onClick={() => choose({ backgroundColor: preset.backgroundColor, accentColor: preset.accentColor })}>
                        <span className="pst-swatch" style={{ background: preset.backgroundColor }} aria-hidden />
                        <span className="pst-swatch" style={{ background: preset.accentColor }} aria-hidden />
                        {preset.name}
                    </button>
                })}
            </div>
            <ColourRow label={t("Background colour", "Hintergrundfarbe")} value={background} onPick={value => choose({ backgroundColor: value })} field="backgroundColor" />
            <ColourRow label={t("Accent colour", "Akzentfarbe")} value={accent} onPick={value => choose({ accentColor: value })} field="accentColor" />
        </>}
    </SettingsGroup>
}

/** Android's colour dialog; saves once the dialog is confirmed (change), not on every move (input). */
function ColourRow({ label, value, onPick, field }: { label: string, value: string, onPick: (value: string) => void, field: string }) {
    const input = React.useRef<HTMLInputElement>(null)
    const latest = React.useRef(onPick)
    latest.current = onPick
    const id = React.useId()
    const hex = colord(value).isValid() ? colord(value).toHex().slice(0, 7) : "#000000"
    // The input is new for every stored colour (key), so it starts on it
    React.useEffect(() => {
        const el = input.current
        if (!el) return
        const change = () => latest.current(el.value)
        el.addEventListener("change", change)
        return () => el.removeEventListener("change", change)
    }, [hex])
    return <label className="pst-colour" htmlFor={id}>
        <span className="pst-row-text"><span>{label}</span><small>{hex}</small></span>
        <input ref={input} id={id} type="color" defaultValue={hex} key={hex} data-theme-field={field} />
    </label>
}

function ImagesGroup({ t }: { t: Translate }) {
    const save = useSaveTheme()
    const background = useThemeValue("libraryScreenCustomBackgroundImage")
    const backgroundOpacity = useThemeValue("libraryScreenCustomBackgroundOpacity")
    const banner = useThemeValue("libraryScreenCustomBannerImage")
    const bannerPosition = useThemeValue("libraryScreenCustomBannerPosition")
    const bannerOpacity = useThemeValue("libraryScreenCustomBannerOpacity")
    const none = t("None", "Keins")
    // An opacity never set is stored as 0, which would draw the new image invisibly: it gets the default with the image
    const visible = (field: "libraryScreenCustomBackgroundOpacity" | "libraryScreenCustomBannerOpacity", opacity: number) =>
        opacity > 0 ? {} : { [field]: THEME_DEFAULT_VALUES[field] }
    return <SettingsGroup id="ui-images" title={t("Background and banner", "Hintergrund und Banner")}
        note={t("Images come from a link: the app cannot add files to the server's image folder.",
            "Bilder kommen über einen Link: Die App kann keine Dateien in den Bilderordner des Servers legen.")}>
        <TextSettingRow t={t} label={t("Background image", "Hintergrundbild")} value={background} empty={none} type="url" placeholder="https://…"
            note={t("Shown behind your lists, dimmed on other pages. Leave empty for none.", "Erscheint hinter deinen Listen, auf anderen Seiten gedämpft. Leer lassen für keins.")}
            validate={validateImageLink(t)} data-theme-field="libraryScreenCustomBackgroundImage"
            onApply={value => void save({ libraryScreenCustomBackgroundImage: value.trim(), ...visible("libraryScreenCustomBackgroundOpacity", backgroundOpacity) })} />
        {!!background && <SelectRow id="pst-background-opacity" label={t("Background image opacity", "Deckkraft des Hintergrundbilds")}
            value={String(backgroundOpacity)} options={opacityOptions(backgroundOpacity)} data-theme-field="libraryScreenCustomBackgroundOpacity"
            onChange={value => void save({ libraryScreenCustomBackgroundOpacity: Number(value) })} />}
        <TextSettingRow t={t} label={t("Banner image", "Bannerbild")} value={banner} empty={none} type="url" placeholder="https://…"
            note={t("Shown at the top of some pages. Leave empty for none.", "Erscheint oben auf manchen Seiten. Leer lassen für keins.")}
            validate={validateImageLink(t)} data-theme-field="libraryScreenCustomBannerImage"
            onApply={value => void save({ libraryScreenCustomBannerImage: value.trim(), ...visible("libraryScreenCustomBannerOpacity", bannerOpacity) })} />
        {!!banner && <>
            <TextSettingRow t={t} label={t("Banner position", "Bannerausschnitt")} value={bannerPosition} empty="50% 50%" placeholder="50% 50%"
                note={t("Which part of the image shows, as \"horizontal vertical\", e.g. 50% 20%.", "Welcher Teil des Bilds zu sehen ist, als „waagrecht senkrecht“, z. B. 50% 20%.")}
                onApply={value => void save({ libraryScreenCustomBannerPosition: value.trim() })} data-theme-field="libraryScreenCustomBannerPosition" />
            <SelectRow id="pst-banner-opacity" label={t("Banner opacity", "Deckkraft des Banners")} value={String(bannerOpacity)}
                options={opacityOptions(bannerOpacity)} data-theme-field="libraryScreenCustomBannerOpacity"
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
    return <SettingsGroup id="ui-sorting" title={t("Sorting", "Sortierung")}
        note={needsHistory ? t("\"Most recent watch\" needs the watch history (App).", "„Zuletzt geschaut“ braucht den Wiedergabeverlauf (App).") : undefined}>
        <SelectRow id="pst-sort-continue" label={t("Continue watching", "Weiterschauen")} value={continueWatching} data-theme-field="continueWatchingDefaultSorting"
            options={CONTINUE_WATCHING_SORTING_OPTIONS.map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ continueWatchingDefaultSorting: value })} />
        <SelectRow id="pst-sort-anime" label={t("Anime library", "Anime-Bibliothek")} value={animeLibrary} data-theme-field="animeLibraryCollectionDefaultSorting"
            options={ANIME_COLLECTION_SORTING_OPTIONS.filter(option => !option.value.includes("END")).map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ animeLibraryCollectionDefaultSorting: value })} />
        <SelectRow id="pst-sort-manga" label={t("Manga library", "Manga-Bibliothek")} value={mangaLibrary} data-theme-field="mangaLibraryCollectionDefaultSorting"
            options={MANGA_COLLECTION_SORTING_OPTIONS.filter(option => !option.value.includes("END")).map(option => ({ value: option.value, label: label(option) }))}
            onChange={value => void save({ mangaLibraryCollectionDefaultSorting: value })} />
    </SettingsGroup>
}

function PreloadGroup({ t }: { t: Translate }) {
    const [mode, setMode] = useAtom(__navigationPreloadModeAtom)
    const simulated = useIsSimulatedUser()
    return <SettingsGroup id="ui-preload" title={t("Loading pages", "Seiten laden")}>
        <SelectRow id="pst-preload" label={t("Load anime pages ahead", "Anime-Seiten vorab laden")} disabled={simulated} value={simulated ? "disable" : mode}
            note={simulated ? t("Off without an AniList account, because of AniList's request limits.", "Ohne AniList-Konto aus, wegen der Anfragegrenzen von AniList.")
                : t("Only on this phone. Loading ahead reaches AniList's request limit sooner.", "Nur auf diesem Handy. Vorab laden erreicht die Anfragegrenze von AniList schneller.")}
            options={[
                { value: "disable", label: t("Off", "Aus") },
                { value: "default", label: t("When touched", "Bei Berührung") },
                { value: "faster", label: t("When touched, sooner", "Bei Berührung, früher") },
                { value: "viewport", label: t("When on screen", "Sobald sichtbar") },
            ]}
            onChange={value => setMode(value as NavigationPreloadMode)} data-settings-preload />
    </SettingsGroup>
}

/** Mobile custom CSS: stored on the server, applied to this phone when saved here or with "Apply to this phone". */
function CustomCSSGroup({ t }: { t: Translate }) {
    const status = useServerStatus()
    const save = useSaveTheme()
    const mobileCSS = useThemeValue("mobileCustomCSS")
    const { customCSS, setCustomCSS } = useCustomCSS()
    const stored = { customCSS: status?.themeSettings?.customCSS || "", mobileCustomCSS: status?.themeSettings?.mobileCustomCSS || "" }
    const differs = stored.customCSS !== customCSS.customCSS || stored.mobileCustomCSS !== customCSS.mobileCustomCSS
    return <SettingsGroup id="ui-css" title={t("Custom CSS", "Eigenes CSS")}
        note={t("If it breaks the screen, remove it here or clear the app's storage.", "Falls es die Anzeige zerstört, entferne es hier oder lösche den Speicher der App.")}>
        <TextSettingRow t={t} label={t("Custom CSS for phones", "Eigenes CSS für Handys")} value={mobileCSS} empty={t("None", "Keins")} multiline
            display={value => t(`${value.split("\n").length} lines`, `${value.split("\n").length} Zeilen`)} placeholder=".class { … }"
            note={t("Applies on every phone that takes it over.", "Gilt auf jedem Handy, das es übernimmt.")}
            onApply={async value => {
                if (await save({ mobileCustomCSS: value })) setCustomCSS({ customCSS: stored.customCSS, mobileCustomCSS: value })
            }} data-theme-field="mobileCustomCSS" />
        {differs && <LinkRow label={t("Apply to this phone", "Auf diesem Handy übernehmen")}
            note={t("This phone uses a different CSS than the one stored on the server.", "Dieses Handy nutzt ein anderes CSS als das auf dem Server gespeicherte.")}
            onClick={() => setCustomCSS(stored)} data-settings-apply-css />}
    </SettingsGroup>
}
