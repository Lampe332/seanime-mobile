import type { Locale } from "date-fns"
import { format } from "date-fns/format"
import { de } from "date-fns/locale/de"
import { es } from "date-fns/locale/es"
import { fr } from "date-fns/locale/fr"
import { ja } from "date-fns/locale/ja"
import { ptBR } from "date-fns/locale/pt-BR"
import { ru } from "date-fns/locale/ru"
import { zhCN } from "date-fns/locale/zh-CN"
import { createElement, Fragment, type ReactNode } from "react"

/** The locale tag of each app language, for the few places that still hand one to a native API. */
const LOCALE_TAGS: Record<string, string> = {
    "en": "en-US",
    "de": "de-DE",
    "es": "es",
    "ru": "ru-RU",
    "zh-Hans": "zh-CN",
    "pt-BR": "pt-BR",
    "fr": "fr-FR",
    "ja": "ja-JP",
}

const DATE_FNS_LOCALES: Record<string, Locale> = { de, es, ru, "zh-Hans": zhCN, "pt-BR": ptBR, fr, ja }

export function localeTag(language: string): string {
    return LOCALE_TAGS[language] ?? "en-US"
}

/** date-fns options with the language's locale (English needs none), for formatDistance and the like. */
export function dateFnsLocale(language: string): { locale?: Locale } {
    const locale = DATE_FNS_LOCALES[language]
    return locale ? { locale } : {}
}

/** Pattern order of DATE_PATTERNS. */
const LANGUAGES = ["en", "de", "es", "ru", "zh-Hans", "pt-BR", "fr", "ja"]

/**
 * The date forms of the app, one fixed date-fns pattern per language, taken from what CLDR (Intl in Node) writes for the
 * same fields. No Intl: Hermes on Android formatted zh-CN in the phone's own language ("November 2026" on a German phone).
 */
const DATE_PATTERNS = {
    /** "Friday, October 23", "10月23日星期五" */
    weekdayDayMonth: ["EEEE, MMMM d", "EEEE, d. MMMM", "EEEE, d 'de' MMMM", "EEEE, d MMMM", "M月d日EEEE", "EEEE, d 'de' MMMM", "EEEE d MMMM", "M月d日EEEE"],
    /** "Friday, 23 Oct", "sexta-feira, 23 de out" */
    weekdayDayShortMonth: ["EEEE, d MMM", "EEEE, d. MMM", "EEEE, d MMM", "EEEE, d MMM", "M月d日EEEE", "EEEE, d 'de' MMM", "EEEE d MMM", "M月d日EEEE"],
    /** "Oct 23", "23 окт." */
    dayShortMonth: ["MMM d", "d. MMM", "d MMM", "d MMM", "M月d日", "d 'de' MMM", "d MMM", "M月d日"],
    /** "Fri, Oct 23", "10月23日(金)" */
    shortDay: ["EEE, MMM d", "EEE, d. MMM", "EEE, d MMM", "EEEEEE, d MMM", "M月d日EEE", "EEEEEE, d 'de' MMM", "EEE d MMM", "M月d日(EEE)"],
    /** "Fri, Oct 23, 2026", "2026年10月23日周五" */
    shortDayYear: ["EEE, MMM d, yyyy", "EEE, d. MMM yyyy", "EEE, d MMM yyyy", "EEEEEE, d MMM yyyy 'г'.", "yyyy年M月d日EEE", "EEEEEE, d 'de' MMM 'de' yyyy", "EEE d MMM yyyy", "yyyy年M月d日(EEE)"],
    /** A short weekday: "Fri", "пт", "周五" (Russian and Portuguese take date-fns' shortest form, their EEE is longer) */
    weekday: ["EEE", "EEE", "EEE", "EEEEEE", "EEE", "EEEEEE", "EEE", "EEE"],
    /** "Friday 23", "23日星期五" */
    weekdayDay: ["EEEE d", "EEEE d", "EEEE d", "EEEE, d", "d日EEEE", "EEEE, d", "EEEE d", "d日EEEE"],
    /** The month on its own: "October", "октябрь", "十月" */
    month: ["MMMM", "MMMM", "LLLL", "LLLL", "LLLL", "LLLL", "LLLL", "LLLL"],
    /** "October 2026", "octubre de 2026", "2026年10月" */
    monthYear: ["MMMM yyyy", "MMMM yyyy", "LLLL 'de' yyyy", "LLLL yyyy 'г'.", "yyyy年M月", "LLLL 'de' yyyy", "LLLL yyyy", "yyyy年M月"],
    /** "10/23/2026", "23.10.2026", "2026/10/23" */
    numeric: ["M/d/yyyy", "d.M.yyyy", "d/M/yyyy", "dd.MM.yyyy", "yyyy/M/d", "dd/MM/yyyy", "dd/MM/yyyy", "yyyy/M/d"],
    /** "6:30 PM", "18:30" */
    time: ["h:mm a", "HH:mm", "HH:mm", "HH:mm", "HH:mm", "HH:mm", "HH:mm", "HH:mm"],
    /** "10/23/2026, 6:30 PM", "2026/10/23 18:30" */
    dateTime: ["M/d/yyyy, h:mm a", "d.M.yyyy, HH:mm", "d/M/yyyy, HH:mm", "dd.MM.yyyy, HH:mm", "yyyy/M/d HH:mm", "dd/MM/yyyy, HH:mm", "dd/MM/yyyy HH:mm", "yyyy/M/d HH:mm"],
} satisfies Record<string, string[]>

export type DateStyle = keyof typeof DATE_PATTERNS

/** A date in the app language, in one of the app's date forms; English for an unknown language. */
export function formatDate(date: Date, language: string, style: DateStyle): string {
    const index = Math.max(0, LANGUAGES.indexOf(language))
    return format(date, DATE_PATTERNS[style][index], dateFnsLocale(LANGUAGES[index]))
}

/** A clock time: "6:30 PM" in English, "18:30" in the other languages. */
export function formatTime(date: Date, language: string): string {
    return formatDate(date, language, "time")
}

/** Short weekday names from Monday to Sunday, without a trailing dot ("Mo", "lun", "пн", "周一", "月"). */
export function weekdayNames(language: string): string[] {
    if (language === "de") return "Mo Di Mi Do Fr Sa So".split(" ")
    if (!LANGUAGES.includes(language) || language === "en") return "Mo Tu We Th Fr Sa Su".split(" ")
    // 2024-01-01 was a Monday
    return Array.from({ length: 7 }, (_, i) => formatDate(new Date(2024, 0, 1 + i), language, "weekday").replace(/\.$/, ""))
}

/** Thousands and decimal separator of each language, as CLDR has them (Spanish groups from five digits on). */
const NUMBER_SEPARATORS: Record<string, [string, string]> = {
    "de": [".", ","],
    "es": [".", ","],
    "ru": [" ", ","],
    "pt-BR": [".", ","],
    "fr": [" ", ","],
}

/**
 * A number in the language's own writing, rounded to at most `digits` decimals: "1,234.5", "1.234,5", "1 234,5".
 * Own code instead of toLocaleString: Hermes may format with the phone's language instead of the one asked for.
 */
export function formatNumber(value: number, language: string, digits = 0): string {
    const [group, decimal] = NUMBER_SEPARATORS[language] ?? [",", "."]
    const negative = value < 0
    const [whole, fraction = ""] = Math.abs(value).toFixed(digits).split(".")
    const trimmed = fraction.replace(/0+$/, "")
    const grouped = language === "es" && whole.length <= 4 ? whole : whole.replace(/\B(?=(\d{3})+$)/g, group)
    return (negative ? "-" : "") + grouped + (trimmed ? decimal + trimmed : "")
}

/**
 * A translated sentence with {0}, {1}, … filled by React parts (a bold name, an icon), so every language puts them
 * where its grammar wants them: `fillParts(t("Tap {0} to watch.", "Tippe auf {0}, um zu schauen."), <B>…</B>)`.
 */
export function fillParts(text: string, ...parts: ReactNode[]): ReactNode[] {
    return text.split(/\{(\d+)\}/)
        .map((piece, i) => i % 2 === 0 ? piece : createElement(Fragment, { key: i }, parts[Number(piece)]))
        .filter(piece => piece !== "")
}
