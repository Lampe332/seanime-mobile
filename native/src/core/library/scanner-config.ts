// geschrieben nach: Seanime-Original github.com/5rahim/seanime internal/library/scanner/config.go, matcher.go, hydrator.go (Schema und Regeln, gelesen 25.11.2026); kein Server-Quelltext übernommen
/*
 * The scanner rules of the settings (`library.scannerConfig`), in the original's form (Seanime, internal/library/scanner/
 * config.go, matcher.go, hydrator.go):
 *   { matching: { rules: [{ pattern, mediaId }] },
 *     hydration: { rules: [{ pattern, mediaId, files: [{ filename, isRegex, episode, aniDbEpisode, type }] }] } }
 * Matching: `pattern` is a regex on the file's full path, it gives a file without an anime that anime. Hydration: `pattern`
 * is a regex on the file's name (and `mediaId`, when set, must be the file's); a fitting file rule sets episode, AniDB
 * episode and type. `$1`, `$2` … are the groups of the regex, `episode` may be a little sum ("$1-12"), `aniDbEpisode` may
 * hold `{calc(…)}`. Read tolerantly: empty or broken text is no rules, a broken rule is left out and named in `problems`.
 * Go's `(?i)` at the start becomes the flag "i". Against freezing: at most 200 rules, patterns of at most 500 characters.
 */

type Json = Record<string, unknown>

export const MAX_RULES = 200
export const MAX_PATTERN = 500

export type FileMeta = { episode: number, anidbEpisode: string, type: string }
export type MatchingRule = { pattern: RegExp, mediaId: number }
export type HydrationFile = { name: string, regex: RegExp | null, episode: string, aniDbEpisode: string, type: string }
export type HydrationRule = { pattern: RegExp, mediaId: number, files: HydrationFile[] }
export type ScannerConfig = { matching: MatchingRule[], hydration: HydrationRule[], problems: string[] }

const TYPES = new Set(["main", "special", "nc"])
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === "string" ? value : "")

/** A Go pattern as a JS regex; a reason instead when it is too long or not valid */
function compile(pattern: string): RegExp | string {
    if (pattern.length > MAX_PATTERN) return `pattern longer than ${MAX_PATTERN} characters`
    const ignoreCase = pattern.startsWith("(?i)")
    try {
        return new RegExp(ignoreCase ? pattern.slice(4) : pattern, ignoreCase ? "i" : "")
    }
    catch (error) {
        return `invalid pattern (${error instanceof Error ? error.message : String(error)})`
    }
}

/** The rules of the settings' text; never throws */
export function readScannerConfig(value: unknown): ScannerConfig {
    const config: ScannerConfig = { matching: [], hydration: [], problems: [] }
    if (typeof value !== "string" || value.trim() === "") return config
    let root: unknown
    try {
        root = JSON.parse(value)
    }
    catch (error) {
        config.problems.push(`not valid JSON (${error instanceof Error ? error.message : String(error)})`)
        return config
    }
    if (!isRecord(root)) {
        config.problems.push("the rules must be a JSON object")
        return config
    }
    let count = 0
    const room = () => {
        if (count >= MAX_RULES) return false
        count++
        return true
    }
    const listOf = (part: string): unknown[] => {
        const section = root[part]
        if (section === undefined || section === null) return []
        if (!isRecord(section) || (section.rules !== undefined && section.rules !== null && !Array.isArray(section.rules))) {
            config.problems.push(`${part}: "rules" must be a list`)
            return []
        }
        return Array.isArray(section.rules) ? section.rules : []
    }
    const idOf = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)

    listOf("matching").forEach((rule, at) => {
        const name = `matching rule ${at + 1}`
        if (!isRecord(rule)) return void config.problems.push(`${name}: not an object`)
        const mediaId = idOf(rule.mediaId)
        if (!text(rule.pattern) || !mediaId) return void config.problems.push(`${name}: needs a pattern and a mediaId`)
        if (!room()) return void config.problems.push(`${name}: more than ${MAX_RULES} rules, left out`)
        const pattern = compile(text(rule.pattern))
        if (typeof pattern === "string") return void config.problems.push(`${name}: ${pattern}`)
        config.matching.push({ pattern, mediaId })
    })

    listOf("hydration").forEach((rule, at) => {
        const name = `hydration rule ${at + 1}`
        if (!isRecord(rule)) return void config.problems.push(`${name}: not an object`)
        if (!text(rule.pattern)) return void config.problems.push(`${name}: needs a pattern`)
        if (!room()) return void config.problems.push(`${name}: more than ${MAX_RULES} rules, left out`)
        const pattern = compile(text(rule.pattern))
        if (typeof pattern === "string") return void config.problems.push(`${name}: ${pattern}`)
        const files: HydrationFile[] = []
        ;(Array.isArray(rule.files) ? rule.files : []).forEach((item, n) => {
            const fileName = `${name}, file ${n + 1}`
            if (!isRecord(item) || !text(item.filename)) return void config.problems.push(`${fileName}: needs a filename`)
            if (!room()) return void config.problems.push(`${fileName}: more than ${MAX_RULES} rules, left out`)
            const type = text(item.type)
            if (type && !TYPES.has(type)) return void config.problems.push(`${fileName}: type must be main, special or nc`)
            let regex: RegExp | null = null
            if (item.isRegex === true) {
                const compiled = compile(text(item.filename))
                if (typeof compiled === "string") return void config.problems.push(`${fileName}: ${compiled}`)
                regex = compiled
            }
            const episode = text(item.episode).trim()
            const aniDbEpisode = text(item.aniDbEpisode).trim()
            if (episode.length > MAX_PATTERN || aniDbEpisode.length > MAX_PATTERN) return void config.problems.push(`${fileName}: episode too long`)
            files.push({ name: text(item.filename), regex, episode, aniDbEpisode, type })
        })
        if (!Array.isArray(rule.files) || files.length === 0) config.problems.push(`${name}: no usable files`)
        config.hydration.push({ pattern, mediaId: idOf(rule.mediaId), files })
    })
    return config
}

/** The anime a matching rule gives a file's full path, or 0 */
export function mediaIdByRule(config: ScannerConfig, path: string): number {
    return config.matching.find(rule => rule.pattern.test(path))?.mediaId ?? 0
}

/** `$1`, `${2}` … replaced by the regex's groups (a missing group is empty, like Go's Expand) */
function expand(template: string, groups: string[]): string {
    return template.replace(/\$(?:\{(\d+)\}|(\d+))/g, (_, braced: string | undefined, plain: string | undefined) => groups[Number(braced ?? plain)] ?? "")
}

/** A small sum of whole numbers: + - * / (also × ÷) and brackets, no eval; null when it is not one */
export function calculate(expression: string): number | null {
    const tokens = expression.replace(/×/g, "*").replace(/÷/g, "/").match(/\d+|[-+*/()]|\S/g) ?? []
    let at = 0
    let depth = 0
    const fail = (): never => {
        throw new Error("not a sum")
    }
    const factor = (): number => {
        const token = tokens[at++]
        if (token === "-") return -factor()
        if (token === "+") return factor()
        if (token === "(") {
            if (++depth > 32) fail()
            const value = sum()
            if (tokens[at++] !== ")") fail()
            depth--
            return value
        }
        if (token !== undefined && /^\d+$/.test(token)) return Number.parseInt(token, 10)
        return fail()
    }
    const product = (): number => {
        let value = factor()
        while (tokens[at] === "*" || tokens[at] === "/") {
            const sign = tokens[at++]
            const right = factor()
            if (sign === "/" && right === 0) fail()
            value = sign === "*" ? value * right : Math.trunc(value / right)
        }
        return value
    }
    const sum = (): number => {
        let value = product()
        while (tokens[at] === "+" || tokens[at] === "-") value = tokens[at++] === "+" ? value + product() : value - product()
        return value
    }
    try {
        if (tokens.length === 0) return null
        const value = sum()
        return at === tokens.length && Number.isSafeInteger(value) ? value : null
    }
    catch {
        return null
    }
}

/**
 * What a hydration rule says of a file (it takes the place of the normal guess); null when no rule fits. Fields the rule
 * leaves empty keep the normal guess; a sum that does not work out is named in `problems` and keeps it too.
 */
export function metaByRule(config: ScannerConfig, file: { name: string, mediaId: number }, normal: FileMeta): { meta: FileMeta, problems: string[] } | null {
    const plain = (value: string) => value.replace(/\\/g, "/").toLowerCase()
    for (const rule of config.hydration) {
        if (!rule.pattern.test(file.name) || (rule.mediaId !== 0 && rule.mediaId !== file.mediaId)) continue
        for (const item of rule.files) {
            const found = item.regex ? item.regex.exec(file.name) : plain(item.name) === plain(file.name) ? [file.name] : null
            if (!found) continue
            const groups = [...found].map(group => group ?? "")
            const meta = { ...normal, type: item.type || normal.type }
            const problems: string[] = []
            if (item.episode) {
                const episode = calculate(expand(item.episode, groups))
                if (episode === null) problems.push(`episode "${item.episode}" gives no number`)
                else {
                    meta.episode = episode
                    if (!item.aniDbEpisode) meta.anidbEpisode = meta.type === "special" ? `S${episode}` : meta.type === "nc" ? normal.anidbEpisode : String(episode)
                }
            }
            if (item.aniDbEpisode) {
                let broken = false
                const value = expand(item.aniDbEpisode, groups).replace(/\{calc\(([^{}]*)\)\}/g, (_, sum: string) => {
                    const result = calculate(sum)
                    if (result === null) broken = true
                    return String(result ?? "")
                })
                if (broken || !value) problems.push(`aniDbEpisode "${item.aniDbEpisode}" gives no episode`)
                else meta.anidbEpisode = value
            }
            return { meta, problems }
        }
    }
    return null
}
