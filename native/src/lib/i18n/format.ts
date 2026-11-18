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

/** The locale tag of each app language, for Intl and toLocaleString. */
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

/**
 * A date in the app language. English and German keep their fixed date-fns patterns; the other languages get Intl's
 * own order and words ("viernes, 23 de oct", "10月23日星期五").
 */
export function formatDate(date: Date, language: string, patterns: { en: string, de: string }, options: Intl.DateTimeFormatOptions): string {
    if (language === "de") return format(date, patterns.de, { locale: de })
    if (language === "en" || !(language in LOCALE_TAGS)) return format(date, patterns.en)
    return new Intl.DateTimeFormat(localeTag(language), options).format(date)
}

/** A clock time: "6:30 PM" in English, "18:30" in German, the language's own form elsewhere. */
export function formatTime(date: Date, language: string): string {
    return formatDate(date, language, { en: "h:mm a", de: "HH:mm" }, { hour: "numeric", minute: "2-digit" })
}

/** Short weekday names from Monday to Sunday, without a trailing dot ("Mo", "lun", "пн", "月"). */
export function weekdayNames(language: string): string[] {
    if (language === "de") return "Mo Di Mi Do Fr Sa So".split(" ")
    if (language === "en" || !(language in LOCALE_TAGS)) return "Mo Tu We Th Fr Sa Su".split(" ")
    const formatter = new Intl.DateTimeFormat(localeTag(language), { weekday: "short" })
    // 2024-01-01 was a Monday
    return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 1 + i)).replace(/\.$/, ""))
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
