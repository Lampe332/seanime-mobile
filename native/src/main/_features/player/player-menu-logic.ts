import type { Translate } from "@/lib/app-language"
import type { VideoCoreSettings } from "@/main/_features/video-core/video-core.atoms"
import type { SkipSegment } from "./player-logic"

/*
 * Values and mappings of the 2.0.32 player settings (video-core-settings-menu.tsx) for the native player: the option
 * lists, their summaries, and how the subtitle styles, "Stronger colours" and the chapter bar become mpv properties.
 */

/** Phone language choices; codes match the defaults and the matching of the track pick (PHONE_LANGUAGES). */
export const PHONE_LANGUAGES = [
    { en: "Japanese", de: "Japanisch", codes: "jpn,jp,jap,japanese" },
    { en: "German", de: "Deutsch", codes: "de,ger,deu,german" },
    { en: "English", de: "Englisch", codes: "en,eng,english" },
]

/** "Japanese / English" (subtitles / audio), "Custom" for a list that is none of the three */
export function languageSummary(settings: Pick<VideoCoreSettings, "preferredSubtitleLanguage" | "preferredAudioLanguage">, t: Translate) {
    const name = (codes: string) => {
        const match = PHONE_LANGUAGES.find(l => l.codes === codes)
        return match ? t(match.en, match.de) : t("Custom", "Eigene")
    }
    return `${name(settings.preferredSubtitleLanguage)} / ${name(settings.preferredAudioLanguage)}`
}

/** How many entries a comma-separated list holds, "None" when empty (phoneListSummary) */
export function listSummary(value: string, t: Translate) {
    const count = value.split(",").filter(entry => entry.trim()).length
    return count ? String(count) : t("None", "Keine")
}

/**
 * `@container (max-width: 16em)` on `.vc-phone-group-rows` (16px text): a group this narrow (landscape phone, three
 * columns of 256dp) drops the row icons and pushes values and switches to the right edge.
 */
export function narrowRows(groupWidth: number | undefined) {
    return groupWidth !== undefined && groupWidth <= 256
}

/**
 * Where the landscape menu sits (video-core-phone-settings.css + media-core-menu.tsx): up to 50rem wide, centred under the
 * tapped button 4dp below it, shifted back inside the screen; a tablet keeps 16dp to the edges (`collisionPadding`), which
 * also comes off the height it may take (Radix's available height), never more than the screen less 1rem.
 */
export function landscapeMenuPlacement(screen: { width: number, height: number }, anchor: { x: number, y: number, width: number, height: number } | null, isTablet: boolean) {
    const edge = isTablet ? 16 : 0
    const width = Math.min(800, screen.width - 16)
    const top = anchor ? anchor.y + anchor.height + 4 : 8
    const center = anchor ? anchor.x + anchor.width / 2 : screen.width / 2
    const left = Math.min(Math.max(edge, center - width / 2), screen.width - width - edge)
    const maxHeight = Math.min(screen.height - top - edge, screen.height - 16)
    return { width, top, left, maxHeight }
}

/** `.vc-phone-row-value`: at most 45 % of the row; tablet.css lets two-language values take 62 % */
export function rowValueMaxWidth(isTablet: boolean) {
    return isTablet ? "62%" : "45%"
}

/**
 * `.vc-phone-row-label` (`flex: 1 1 6em`, 90dp at 15dp): in a wrapping row the browser breaks the line when the label's
 * 6em and the value do not fit, so the value moves under the label. Yoga lays a Text's basis out as 0 for that decision and
 * squeezed the label instead ("Languag|es" next to the tablet's 62 % value "English / Japanese"); the minimum width makes
 * Yoga break the line at the same point.
 */
export const ROW_LABEL_STYLE = { flexGrow: 1, flexShrink: 1, flexBasis: 90, minWidth: 90 } as const

/* ── Speed ─────────────────────────────────────────────────────────────── */

export const SPEED_MIN = 0.25
export const SPEED_MAX = 2
export const SPEED_STEP = 0.05
export const SPEED_PRESETS = [0.5, 1, 1.2, 1.5, 2]

/** − / + on the speed page: 0.05 steps between 0.25x and 2x, without float dust */
export function stepSpeed(rate: number, delta: number) {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round((rate + delta) * 100) / 100))
}

/* ── Subtitle and caption styles ───────────────────────────────────────── */

export const SUBTITLE_FONT_SIZES = [
    { label: "Small", value: 54 },
    { label: "Medium", value: 62 },
    { label: "Large", value: 72 },
    { label: "Extra Large", value: 82 },
]
export const STYLE_COLORS = [
    { label: "White", value: "#FFFFFF" },
    { label: "Black", value: "#000000" },
    { label: "Gray", value: "#808080" },
    { label: "Yellow", value: "#FFD700" },
    { label: "Cyan", value: "#00FFFF" },
    { label: "Pink", value: "#FF69B4" },
    { label: "Purple", value: "#9370DB" },
    { label: "Lime", value: "#00FF00" },
]
export const SUBTITLE_OUTLINES = [
    { label: "None", value: 0 },
    { label: "Small", value: 2 },
    { label: "Medium", value: 3 },
    { label: "Large", value: 4 },
]
export const SUBTITLE_SHADOWS = [
    { label: "None", value: 0 },
    { label: "Small", value: 1 },
    { label: "Medium", value: 2 },
    { label: "Large", value: 3 },
]
/** ASS alpha: 0 = opaque ("100%"), 255 = invisible */
export const SUBTITLE_SHADOW_OPACITIES = [
    { label: "100%", value: 0 },
    { label: "80%", value: 64 },
    { label: "70%", value: 77 },
    { label: "50%", value: 150 },
    { label: "25%", value: 200 },
    { label: "0%", value: 255 },
]
export const CAPTION_FONT_SIZES = [
    { label: "Small", value: 4 },
    { label: "Medium", value: 5 },
    { label: "Large", value: 5.7 },
    { label: "Extra Large", value: 6.1 },
]
export const CAPTION_SHADOWS = [
    { label: "None", value: 0 },
    { label: "Small", value: 2 },
    { label: "Medium", value: 4 },
    { label: "Large", value: 6 },
]
export const CAPTION_BACKGROUND_OPACITIES = [
    { label: "0%", value: 0 },
    { label: "25%", value: 0.25 },
    { label: "50%", value: 0.5 },
    { label: "70%", value: 0.7 },
    { label: "80%", value: 0.8 },
    { label: "100%", value: 1 },
]

type SubtitleLook = Required<Omit<VideoCoreSettings["subtitleCustomization"], "fontName">>
type CaptionLook = Required<VideoCoreSettings["captionCustomization"]>

/** vc_subtitleStylesDefaults */
export const SUBTITLE_LOOK_DEFAULTS: SubtitleLook = {
    enabled: false, fontSize: 62, primaryColor: "#FFFFFF", outlineColor: "#000000", backColor: "#000000", backColorOpacity: 0, outline: 3, shadow: 0,
}
/** vc_captionsStylesDefaults */
export const CAPTION_LOOK_DEFAULTS: CaptionLook = {
    fontSize: 5, textColor: "#FFFFFF", backgroundColor: "#000000", textShadow: 4, textShadowColor: "#000000", backgroundOpacity: 0.7,
}

export function subtitleLook(settings: VideoCoreSettings): SubtitleLook {
    const own = Object.fromEntries(Object.entries(settings.subtitleCustomization ?? {}).filter(([, v]) => v !== undefined))
    return { ...SUBTITLE_LOOK_DEFAULTS, ...own }
}

export function captionLook(settings: VideoCoreSettings): CaptionLook {
    const own = Object.fromEntries(Object.entries(settings.captionCustomization ?? {}).filter(([, v]) => v !== undefined))
    return { ...CAPTION_LOOK_DEFAULTS, ...own }
}

/** The label of a value in one of the option lists, "" for a value the list does not have */
export function optionLabel<T>(options: { label: string, value: T }[], value: T) {
    return options.find(o => o.value === value)?.label ?? ""
}

/** "ass" for styled subtitles, "text" for plain ones (SRT, WebVTT, mov_text); null for picture subtitles (PGS, DVD) */
export type SubtitleKind = "ass" | "text"

export function subtitleKind(codec: string | undefined | null): SubtitleKind | null {
    const c = (codec ?? "").toLowerCase()
    if (c === "ass" || c === "ssa") return "ass"
    if (["subrip", "srt", "webvtt", "vtt", "mov_text", "text", "microdvd", "subviewer", "sami", "realtext", "jacosub", "mpl2", "pjs", "vplayer", "stl"].includes(c)) return "text"
    return null
}

/** Styles in an ASS header (the MKV track's CodecPrivate); 0 when unknown (an online or external file) */
export function assStyleCount(codecPrivate: string | undefined | null) {
    return (codecPrivate ?? "").match(/^Style:/gm)?.length ?? 0
}

/** #RRGGBB with an opacity → mpv's #AARRGGBB */
export function mpvColor(hex: string, opacity = 1) {
    const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, "0")
    return `#${alpha}${hex.replace("#", "")}`.toUpperCase()
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * mpv properties for the subtitle look of the track that plays (2.0.32 "Subtitle styles" / "Caption style"):
 *   ass   the styles override the track's own only when they are switched on and the track has at most one style
 *         (ASS/SSA tracks with several styles keep their look, like the web player's libass); font sizes are the web's
 *         ASS sizes at 1080p, mpv counts at 720p
 *   text  the caption look: size in % of the video height, a box behind the text in the background colour and
 *         opacity (none at 0 %), and the text shadow
 * Every kind keeps the subtitles on the video and scaled with it (plain subtitles otherwise sat in the black bars of a
 * portrait phone and scaled with the window, S22).
 */
export function subtitleLookProperties(settings: VideoCoreSettings, kind: SubtitleKind | null, assStyles: number): [string, string][] {
    const base: [string, string][] = [["sub-use-margins", "no"], ["sub-scale-with-window", "no"], ["sub-margin-y", "34"]]
    if (kind === "text") {
        const c = captionLook(settings)
        const box = c.backgroundOpacity > 0
        return [
            ...base,
            ["sub-ass-override", "scale"],
            ["sub-font-size", String(round1(c.fontSize * 7.2))],
            ["sub-color", mpvColor(c.textColor)],
            ["sub-border-style", box ? "background-box" : "outline-and-shadow"],
            ["sub-back-color", mpvColor(c.backgroundColor, c.backgroundOpacity)],
            // in the box the size is its padding; without a box the text has no outline in the web either
            ["sub-border-size", box ? "3" : "0"],
            ["sub-shadow-offset", String(c.textShadow / 4)],
            ["sub-shadow-color", mpvColor(c.textShadowColor, 0.8)],
        ]
    }
    const s = subtitleLook(settings)
    if (kind === "ass" && s.enabled && assStyles <= 1) {
        return [
            ...base,
            ["sub-ass-override", "force"],
            ["sub-font-size", String(round1(s.fontSize * 0.75))],
            ["sub-color", mpvColor(s.primaryColor)],
            ["sub-border-style", "outline-and-shadow"],
            ["sub-border-color", mpvColor(s.outlineColor)],
            ["sub-border-size", String(s.outline)],
            ["sub-shadow-offset", String(s.shadow)],
            ["sub-shadow-color", mpvColor(s.backColor, 1 - s.backColorOpacity / 255)],
        ]
    }
    return [...base, ["sub-ass-override", "scale"]]
}

/* ── Player appearance ─────────────────────────────────────────────────── */

/**
 * "Stronger colours": the web's CSS filter contrast/saturate/brightness (videoEnhancement, 1.05 / 1.1 / 1.02) as mpv's
 * video equalizer (−100…100, 0 = unchanged).
 */
export function colourProperties(on: boolean, enhancement: VideoCoreSettings["videoEnhancement"]): [string, string][] {
    const level = (factor: number) => String(on && enhancement.enabled ? Math.round((factor - 1) * 100) : 0)
    return [["contrast", level(enhancement.contrast)], ["saturation", level(enhancement.saturation)], ["brightness", level(enhancement.brightness)]]
}

/**
 * The time bar's pieces (media-core-control-bar MediaCoreTimeRangeSegment): one per chapter, cut at the chapter starts
 * of the file or else at the skip segments; `skip` marks a piece that is an opening/ending (highlighted in amber).
 */
export type TimeBarPiece = { start: number, end: number, skip: boolean }

export function timeBarPieces(duration: number, chapterStarts: number[], segments: SkipSegment[]): TimeBarPiece[] {
    if (duration <= 0) return [{ start: 0, end: 0, skip: false }]
    const cuts = chapterStarts.length ? chapterStarts : segments.flatMap(s => [s.start, s.end])
    const inside = cuts.filter(c => c > 0.5 && c < duration - 0.5).sort((a, b) => a - b)
    const bounds = [0, ...inside.filter((c, i) => i === 0 || c - inside[i - 1] > 0.5), duration]
    return bounds.slice(0, -1).map((start, i) => {
        const end = bounds[i + 1]
        return { start, end, skip: segments.some(s => start >= s.start - 0.5 && end <= s.end + 0.5) }
    })
}

/* ── Translate subtitles (2.0.x video-core-settings-menu.tsx "Subtitle Translation") ── */

/** Translation providers; Google needs no key */
export const TRANSLATE_PROVIDERS = [
    { value: "google", label: "Google Free" },
    { value: "deepl", label: "DeepL" },
    { value: "openai", label: "OpenAI" },
    { value: "openai-compatible", label: "OpenAI Compatible" },
]

/** Target languages, the old menu's list and order (DeepL's first, then the ones DeepL lacks) */
export const TRANSLATE_LANGUAGES = [
    { value: "en-US", label: "English (US)" },
    { value: "en-GB", label: "English (UK)" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
    { value: "de", label: "German" },
    { value: "it", label: "Italian" },
    { value: "pt-BR", label: "Portuguese (BR)" },
    { value: "pt-PT", label: "Portuguese (PT)" },
    { value: "ru", label: "Russian" },
    { value: "ja", label: "Japanese" },
    { value: "ko", label: "Korean" },
    { value: "zh-hans", label: "Chinese (Simplified)" },
    { value: "zh-hant", label: "Chinese (Traditional)" },
    { value: "ar", label: "Arabic" },
    { value: "tr", label: "Turkish" },
    { value: "pl", label: "Polish" },
    { value: "nl", label: "Dutch" },
    { value: "sv", label: "Swedish" },
    { value: "nb", label: "Norwegian" },
    { value: "da", label: "Danish" },
    { value: "fi", label: "Finnish" },
    { value: "el", label: "Greek" },
    { value: "cs", label: "Czech" },
    { value: "hu", label: "Hungarian" },
    { value: "ro", label: "Romanian" },
    { value: "id", label: "Indonesian" },
    { value: "uk", label: "Ukrainian" },
    { value: "bg", label: "Bulgarian" },
    { value: "sk", label: "Slovak" },
    { value: "sl", label: "Slovenian" },
    { value: "et", label: "Estonian" },
    { value: "lv", label: "Latvian" },
    { value: "lt", label: "Lithuanian" },
    { value: "hi", label: "Hindi" },
    { value: "bn", label: "Bengali" },
    { value: "ta", label: "Tamil" },
    { value: "te", label: "Telugu" },
    { value: "mr", label: "Marathi" },
    { value: "kn", label: "Kannada" },
    { value: "ml", label: "Malayalam" },
    { value: "pa", label: "Punjabi" },
    { value: "fa", label: "Persian" },
    { value: "ur", label: "Urdu" },
    { value: "sw", label: "Swahili" },
    { value: "af", label: "Afrikaans" },
    { value: "ms", label: "Malay" },
    { value: "hr", label: "Croatian" },
    { value: "sr", label: "Serbian" },
    { value: "he", label: "Hebrew" },
    { value: "th", label: "Thai" },
    { value: "vi", label: "Vietnamese" },
]

/** The server default "en" is not in the list; the stored code is shown then. */
export function translateLanguageLabel(value: string) {
    return TRANSLATE_LANGUAGES.find(l => l.value === value)?.label ?? value
}

/** phoneShort: a long URL or model name in a row value */
export function shortValue(value: string) {
    return value.length > 20 ? `${value.slice(0, 19)}…` : value
}

/** The translation settings as the menu shows them; empty values fall back to these defaults (2.0.x). */
export function translateSettings(media: {
    vcTranslate?: boolean
    vcTranslateProvider?: string
    vcTranslateTargetLanguage?: string
    vcTranslateApiKey?: string
    vcTranslateBaseUrl?: string
    vcTranslateModel?: string
} | null | undefined) {
    const provider = media?.vcTranslateProvider || "google"
    return {
        enabled: media?.vcTranslate ?? false,
        provider,
        target: media?.vcTranslateTargetLanguage || "en",
        hasKey: !!media?.vcTranslateApiKey,
        apiKey: media?.vcTranslateApiKey || "",
        baseUrl: media?.vcTranslateBaseUrl || "http://localhost:1234/v1",
        model: media?.vcTranslateModel || (provider === "openai" ? "gpt-4o-mini" : "local-model"),
        usesOpenAI: provider === "openai" || provider === "openai-compatible",
    }
}

/** What a provider change stores along with it (handleTranslateProviderChange) */
export function translateProviderChanges(provider: string, media: { vcTranslateModel?: string, vcTranslateBaseUrl?: string } | null | undefined): [string, string][] {
    const changes: [string, string][] = [["vcTranslateProvider", provider]]
    const storedModel = media?.vcTranslateModel || ""
    if (provider === "openai" && (!storedModel || storedModel === "local-model")) changes.push(["vcTranslateModel", "gpt-4o-mini"])
    if (provider === "openai-compatible") {
        if (!media?.vcTranslateBaseUrl) changes.push(["vcTranslateBaseUrl", "http://localhost:1234/v1"])
        if (!storedModel) changes.push(["vcTranslateModel", "local-model"])
    }
    return changes
}

/** handleTranslateModelChange: OpenAI never keeps the local default */
export function translateModelValue(provider: string, model: string) {
    return provider === "openai" && (!model || model === "local-model") ? "gpt-4o-mini" : model
}
