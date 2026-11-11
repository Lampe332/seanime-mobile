import type { Translate } from "@/lib/app-language"
import { LANGUAGES_LIST } from "@/main/manga/_lib/language-map"
import type { PlayerTrack } from "./player-logic"

/*
 * Names of audio and subtitle tracks in the player menu. mpv gives each track a language code (`lang`: "chi", "zh-CN",
 * "jpn" …) and the file's own title (`title`). The old player showed the title and the language name next to it
 * (web video-core-subtitle-menu `moreInfo`), so a track titled "Chinese - (China)" read "Chinese (Chinese - (China))".
 * Rule: when the title already names the language (its name in English, German or the language itself, or one of its
 * codes as a word: "chi", "zho", "zh-CN"), the title alone is the name; otherwise "Language · Title".
 * Own table instead of Intl.DisplayNames: Hermes does not ship it.
 */

type Language = { codes: string[], en: string, de: string, native?: string }

// The languages anime releases carry, with ISO 639-1 and both ISO 639-2 codes (B and T).
const LANGUAGES: Language[] = [
    { codes: ["ja", "jpn", "jp"], en: "Japanese", de: "Japanisch", native: "日本語" },
    { codes: ["en", "eng"], en: "English", de: "Englisch" },
    { codes: ["de", "ger", "deu"], en: "German", de: "Deutsch" },
    { codes: ["zh", "chi", "zho", "chs", "cht", "cmn", "yue"], en: "Chinese", de: "Chinesisch", native: "中文" },
    { codes: ["fr", "fre", "fra"], en: "French", de: "Französisch", native: "Français" },
    { codes: ["es", "spa"], en: "Spanish", de: "Spanisch", native: "Español" },
    { codes: ["it", "ita"], en: "Italian", de: "Italienisch", native: "Italiano" },
    { codes: ["pt", "por"], en: "Portuguese", de: "Portugiesisch", native: "Português" },
    { codes: ["ru", "rus"], en: "Russian", de: "Russisch", native: "Русский" },
    { codes: ["ko", "kor"], en: "Korean", de: "Koreanisch", native: "한국어" },
    { codes: ["ar", "ara"], en: "Arabic", de: "Arabisch", native: "العربية" },
    { codes: ["pl", "pol"], en: "Polish", de: "Polnisch", native: "Polski" },
    { codes: ["nl", "dut", "nld"], en: "Dutch", de: "Niederländisch", native: "Nederlands" },
    { codes: ["tr", "tur"], en: "Turkish", de: "Türkisch", native: "Türkçe" },
    { codes: ["sv", "swe"], en: "Swedish", de: "Schwedisch", native: "Svenska" },
    { codes: ["no", "nor", "nb", "nob"], en: "Norwegian", de: "Norwegisch", native: "Norsk" },
    { codes: ["da", "dan"], en: "Danish", de: "Dänisch", native: "Dansk" },
    { codes: ["fi", "fin"], en: "Finnish", de: "Finnisch", native: "Suomi" },
    { codes: ["cs", "cze", "ces"], en: "Czech", de: "Tschechisch", native: "Čeština" },
    { codes: ["hu", "hun"], en: "Hungarian", de: "Ungarisch", native: "Magyar" },
    { codes: ["ro", "rum", "ron"], en: "Romanian", de: "Rumänisch", native: "Română" },
    { codes: ["el", "gre", "ell"], en: "Greek", de: "Griechisch", native: "Ελληνικά" },
    { codes: ["he", "heb"], en: "Hebrew", de: "Hebräisch", native: "עברית" },
    { codes: ["hi", "hin"], en: "Hindi", de: "Hindi", native: "हिन्दी" },
    { codes: ["id", "ind"], en: "Indonesian", de: "Indonesisch", native: "Bahasa Indonesia" },
    { codes: ["ms", "may", "msa"], en: "Malay", de: "Malaiisch", native: "Bahasa Melayu" },
    { codes: ["th", "tha"], en: "Thai", de: "Thailändisch", native: "ไทย" },
    { codes: ["vi", "vie"], en: "Vietnamese", de: "Vietnamesisch", native: "Tiếng Việt" },
    { codes: ["uk", "ukr"], en: "Ukrainian", de: "Ukrainisch", native: "Українська" },
    { codes: ["fil", "tl", "tgl"], en: "Filipino", de: "Filipino" },
    { codes: ["ca", "cat"], en: "Catalan", de: "Katalanisch", native: "Català" },
    { codes: ["bg", "bul"], en: "Bulgarian", de: "Bulgarisch", native: "Български" },
    { codes: ["hr", "hrv"], en: "Croatian", de: "Kroatisch", native: "Hrvatski" },
    { codes: ["sr", "srp"], en: "Serbian", de: "Serbisch", native: "Српски" },
    { codes: ["sk", "slo", "slk"], en: "Slovak", de: "Slowakisch", native: "Slovenčina" },
    { codes: ["fa", "per", "fas"], en: "Persian", de: "Persisch", native: "فارسی" },
]

const BY_CODE = new Map(LANGUAGES.flatMap(language => language.codes.map(code => [code, language] as const)))

// "und" (undetermined), "mul", "zxx": mpv's way of saying it does not know
const NO_LANGUAGE = new Set(["und", "mul", "zxx", "mis", "unknown"])

function primaryCode(lang: string) {
    return lang.trim().toLowerCase().split(/[-_]/)[0] ?? ""
}

function findLanguage(lang: string) {
    return BY_CODE.get(primaryCode(lang))
}

/** "jpn" → "Japanese"/"Japanisch", "zh-CN" → "Chinese"; unknown codes as upper case, none → "". */
export function trackLanguageName(lang: string | undefined, t: Translate) {
    const code = primaryCode(lang ?? "")
    if (!code || NO_LANGUAGE.has(code)) return ""
    const language = findLanguage(code)
    if (language) return t(language.en, language.de)
    return LANGUAGES_LIST[code]?.name || (lang ?? "").trim().toUpperCase()
}

function words(text: string) {
    // separators spelled out instead of \p{L}: Hermes' support for Unicode property classes is not something to rely on
    return text.toLowerCase().split(/[\s\-_.,;:()[\]{}/\\|+&!?"'#*~<>=@]+/).filter(Boolean)
}

/** Does the title already say which language it is (name in any of our forms, or one of its codes as a word)? */
export function titleNamesLanguage(title: string, lang: string | undefined) {
    const code = primaryCode(lang ?? "")
    if (!title.trim() || !code || NO_LANGUAGE.has(code)) return false
    const lower = title.toLowerCase()
    const language = findLanguage(code)
    const names = language ? [language.en, language.de, language.native] : [LANGUAGES_LIST[code]?.name]
    if (names.some(name => name && lower.includes(name.toLowerCase()))) return true
    const codes = new Set(language ? language.codes : [code])
    return words(title).some(word => codes.has(word))
}

/** The name in the player menu: "Chinese - (China)", "English · Signs & Songs", "Japanese", "Track 3". */
export function trackDisplayName(track: Pick<PlayerTrack, "id" | "lang" | "title">, t: Translate) {
    const title = track.title.trim()
    const language = trackLanguageName(track.lang, t)
    if (!title) return language || t(`Track ${track.id}`, `Spur ${track.id}`)
    if (!language || titleNamesLanguage(title, track.lang) || title.toLowerCase() === language.toLowerCase()) return title
    return `${language} · ${title}`
}
