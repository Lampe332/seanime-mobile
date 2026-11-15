// geschrieben nach: goja_plugin_types/core.d.ts ($scannerUtils: normalizeTitle, extractPartNumber, extractSeasonNumber, extractYear, compareTitles, findBestMatch, getSignificantTokens, buildSearchQuery, buildAdvancedQuery, sanitizeQuery, buildSeasonQuery, buildPartQuery, buildSmartSearchTitles und ihre Beschreibungen); eigene Regeln, keine Vorlage

/*
 * $scannerUtils: title helpers for extensions that search a site by an anime's titles. The contract describes what
 * each function does (macrons, possessives, separators, format words, season/part/year, colon and dash splitting);
 * the rules below are the app's own reading of that description.
 */

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }
const ROMAN_OF = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

/** Words that say what kind of release it is, not what it is called */
const FORMAT_WORDS = new Set(["tv", "ova", "ona", "oad", "special", "specials", "movie", "film", "the movie", "bd", "bluray", "uncut", "uncensored"])
/** Words too common to tell two titles apart */
const NOISE_WORDS = new Set(["the", "a", "an", "and", "of", "in", "on", "to", "wo", "ga", "season", "part", "cour", "tv", "anime", "series"])

function ordinal(n) {
    const tens = n % 100
    if (tens >= 11 && tens <= 13) return `${n}th`
    return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`
}

function roman(n) {
    return ROMAN_OF[n] ?? String(n)
}

/** Lowercase, no accents or macrons (ō → o), possessives and apostrophes gone, separators as spaces */
function plain(title) {
    return String(title ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/['’`]s\b/g, "s")
        .replace(/['’`]/g, "")
        .replace(/&/g, " and ")
        .replace(/[:;,.!?\-–—_/\\|~()[\]{}"“”«»・☆★♪]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function extractPartNumber(title) {
    const t = plain(title)
    let m = /\b(?:part|cour)\s*(\d{1,2})\b/.exec(t)
    if (m) return Number(m[1])
    m = /\b(?:part|cour)\s+(i{1,3}|iv|v|vi{0,3}|ix|x)\b/.exec(t)
    if (m) return ROMAN[m[1]]
    m = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:part|cour)\b/.exec(t)
    if (m) return Number(m[1])
    return -1
}

function extractSeasonNumber(title) {
    const raw = String(title ?? "")
    let m = /(\d{1,2})\s*期/.exec(raw)
    if (m) return Number(m[1])
    const t = plain(raw)
    m = /\bseason\s*(\d{1,2})\b/.exec(t)
    if (m) return Number(m[1])
    m = /\bs(\d{1,2})(?:\s*e\d+)?\b/.exec(t)
    if (m) return Number(m[1])
    m = /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/.exec(t)
    if (m) return Number(m[1])
    m = /\bseason\s+(i{1,3}|iv|v|vi{0,3}|ix|x)\b/.exec(t)
    if (m) return ROMAN[m[1]]
    // a roman numeral of two letters or more at the end (Overlord II); a lone "i", "v" or "x" is too often a word
    m = /\s(ii|iii|iv|vi|vii|viii|ix)$/.exec(t)
    if (m) return ROMAN[m[1]]
    // a small number at the end (Konosuba 2), not after a word that makes it something else
    m = /(?:^|\s)(\S+)\s(\d{1,2})$/.exec(t)
    if (m && !/^(?:part|cour|no|episode|ep|vol|volume|chapter|number|movie|film)$/.test(m[1])) {
        const n = Number(m[2])
        if (n >= 2 && n <= 20) return n
    }
    return -1
}

function extractYear(title) {
    const m = /(?:^|[^\d])((?:19[4-9]|20[0-9])\d)(?!\d)/.exec(String(title ?? ""))
    return m ? Number(m[1]) : -1
}

/** The title without the marks of season, part, year and format */
function withoutMarks(t) {
    return ` ${t} `
        .replace(/\s\d{1,2}(?:st|nd|rd|th)\s+(?:season|part|cour)\s/g, " ")
        .replace(/\s(?:season|part|cour)\s*(?:\d{1,2}|i{1,3}|iv|v|vi{0,3}|ix|x)\s/g, " ")
        .replace(/\ss\d{1,2}(?:\s*e\d+)?\s/g, " ")
        .replace(/\s(?:19[4-9]|20[0-9])\d\s/g, " ")
        .replace(/\s\d{1,2}\s*期\s/g, " ")
        .replace(/\sthe movie\s/g, " ")
        .split(" ")
        .filter(word => word && !FORMAT_WORDS.has(word))
        .join(" ")
        .trim()
}

function normalizeTitle(title) {
    const original = String(title ?? "")
    const normalized = plain(original)
    const season = extractSeasonNumber(original)
    const part = extractPartNumber(original)
    const year = extractYear(original)
    let cleanBaseTitle = withoutMarks(normalized)
    // a season said only by a number or numeral at the end (Konosuba 2, Overlord II) goes from the base title too
    if (season > 0 && !/\bseason\b|\bs\d/.test(normalized)) cleanBaseTitle = cleanBaseTitle.replace(/\s(?:\d{1,2}|ii|iii|iv|vi|vii|viii|ix)$/, "").trim()
    const tokens = cleanBaseTitle.split(" ").filter(word => word && !NOISE_WORDS.has(word))
    const kinds = normalized.split(" ")
    const isMain = season <= 1 && part <= 1 && !kinds.some(word => ["ova", "ona", "oad", "special", "specials", "movie", "film", "recap"].includes(word))
    return { original, normalized, cleanBaseTitle, denoisedTitle: tokens.join(" "), tokens, season, part, year, isMain }
}

function getSignificantTokens(title) {
    return normalizeTitle(title).tokens
}

/** Weighted token match: longer words count more, numbers count as words; 1 for the same title */
function compareTitles(title1, title2) {
    const a = normalizeTitle(title1)
    const b = normalizeTitle(title2)
    if (!a.normalized || !b.normalized) return 0
    if (a.normalized === b.normalized) return 1
    const wa = a.tokens.length ? a.tokens : a.cleanBaseTitle.split(" ").filter(Boolean)
    const wb = b.tokens.length ? b.tokens : b.cleanBaseTitle.split(" ").filter(Boolean)
    const weight = word => Math.min(word.length, 8)
    const total = [...wa, ...wb].reduce((sum, word) => sum + weight(word), 0)
    if (total === 0) return 0
    const left = [...wb]
    let shared = 0
    for (const word of wa) {
        const at = left.indexOf(word)
        if (at < 0) continue
        left.splice(at, 1)
        shared += 2 * weight(word)
    }
    let ratio = shared / total
    // the same name with another season or part is another entry
    if (a.season > 0 && b.season > 0 && a.season !== b.season) ratio *= 0.8
    if (a.part > 0 && b.part > 0 && a.part !== b.part) ratio *= 0.9
    return Math.max(0, Math.min(1, ratio))
}

function findBestMatch(target, candidates) {
    let best = ""
    let score = -1
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const s = compareTitles(target, candidate)
        if (s > score) {
            score = s
            best = String(candidate)
        }
    }
    return best
}

function sanitizeQuery(query) {
    return String(query ?? "").replace(/[()|"*~^[\]{}!+\\:<>=&]+/g, " ").replace(/\s+/g, " ").trim()
}

function buildSearchQuery(title) {
    const { tokens, cleanBaseTitle } = normalizeTitle(title)
    return (tokens.length ? tokens.join(" ") : cleanBaseTitle).trim()
}

function alternatives(list) {
    const seen = new Set()
    const out = []
    for (const item of list) {
        const q = sanitizeQuery(item)
        if (!q || seen.has(q.toLowerCase())) continue
        seen.add(q.toLowerCase())
        out.push(q)
    }
    if (out.length === 0) return ""
    return out.length === 1 ? out[0] : `(${out.join(" | ")})`
}

function buildAdvancedQuery(titles) {
    return alternatives(Array.isArray(titles) ? titles : [])
}

/** The title as words for a query: separators to spaces, case kept */
function queryBase(title) {
    return String(title ?? "").replace(/[:;,/\\|~_]+/g, " ").replace(/\s+/g, " ").trim()
}

function buildSeasonQuery(title, season) {
    const base = queryBase(title)
    const n = Math.trunc(Number(season))
    if (!(n > 1)) return base
    return alternatives([`${base} S${String(n).padStart(2, "0")}`, `${base} Season ${n}`, `${base} ${ordinal(n)} Season`])
}

function buildPartQuery(title, part) {
    const base = queryBase(title)
    const n = Math.trunc(Number(part))
    if (!(n > 1)) return base
    return alternatives([`${base} Part ${n}`, `${base} Part ${roman(n)}`, `${base} ${ordinal(n)} Cour`])
}

function buildSmartSearchTitles(titles) {
    let season = -1
    let part = -1
    const full = []
    const short = []
    for (const title of Array.isArray(titles) ? titles : []) {
        if (typeof title !== "string" || !title.trim()) continue
        const n = normalizeTitle(title)
        if (season < 0 && n.season > 0) season = n.season
        if (part < 0 && n.part > 0) part = n.part
        if (n.cleanBaseTitle) full.push(n.cleanBaseTitle)
        // the name before a colon or a spaced dash, as a shorter variant (sequels and arcs share it)
        const head = /^(.+?)\s*(?::|\s[-–—]\s)/.exec(title.normalize("NFKD"))
        if (head) {
            const shorter = withoutMarks(plain(head[1]))
            if (shorter.length >= 4 && shorter !== n.cleanBaseTitle) short.push(shorter)
        }
    }
    const seen = new Set()
    const unique = []
    for (const t of [...full, ...short]) {
        if (seen.has(t)) continue
        seen.add(t)
        unique.push(t)
    }
    return { titles: unique, season, part }
}

export const scannerUtils = Object.freeze({
    normalizeTitle,
    extractPartNumber,
    extractSeasonNumber,
    extractYear,
    compareTitles,
    findBestMatch,
    getSignificantTokens,
    buildSearchQuery,
    buildAdvancedQuery,
    sanitizeQuery,
    buildSeasonQuery,
    buildPartQuery,
    buildSmartSearchTitles,
})
