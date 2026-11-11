// Posix path helpers that also accept Windows paths (backslashes, drive letters), for paths the server sends.

/** Backslashes become slashes and repeated slashes collapse, except a leading "//" (UNC). */
function toUnix(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/{2,}/g, (match, offset) => offset > 0 ? "/" : match)
}

/** Resolves "." and ".."; an absolute path cannot go above its root. */
function processSegments(segments: string[], isAbsolute: boolean): string[] {
    const res: string[] = []
    for (const segment of segments) {
        if (segment === "." || segment === "") continue
        if (segment !== "..") res.push(segment)
        else if (res.length > 0 && res[res.length - 1] !== "..") res.pop()
        else if (!isAbsolute) res.push("..")
    }
    return res
}

function isAbsolute(p: string): boolean {
    if (typeof p !== "string") return false
    p = toUnix(p)
    return p.startsWith("/") || /^[a-zA-Z]:\//.test(p)
}

function normalize(p: string): string {
    if (typeof p !== "string") return p
    p = toUnix(p)
    if (p.length === 0) return "."

    const absolute = p.startsWith("/")
    const isUNC = p.startsWith("//")
    const hasTrailingSlash = p.endsWith("/") && p.length > 1

    let result = processSegments(p.split("/"), absolute).join("/")
    if (absolute) {
        if (result.length === 0) return isUNC ? "//" : "/"
        result = (isUNC ? "//" : "/") + result
    }
    if (hasTrailingSlash && result !== "." && result !== "/" && result !== "//") result += "/"
    return result.length === 0 ? "." : result
}

function join(...paths: string[]): string {
    const parts = paths.filter(p => typeof p === "string" && p.length > 0)
    return parts.length === 0 ? "." : normalize(parts.map(toUnix).join("/"))
}

function trimTrailingSlashes(p: string, keep: number) {
    let end = p.length
    while (end > keep && p[end - 1] === "/") end--
    return p.substring(0, end)
}

function dirname(p: string): string {
    if (typeof p !== "string") return "."
    p = toUnix(p)
    if (p.length === 0) return "."

    p = trimTrailingSlashes(p, 1)
    const lastSlash = p.lastIndexOf("/")
    if (lastSlash < 0) return "."

    // the last slash belongs to the root ("/a", "//a"): the directory is the root
    let rootEnd = 0
    while (rootEnd < p.length && p[rootEnd] === "/") rootEnd++
    return p.substring(0, lastSlash < rootEnd ? rootEnd : lastSlash)
}

function basename(p: string, ext?: string): string {
    if (typeof p !== "string") return ""
    p = trimTrailingSlashes(toUnix(p), 0)
    const base = p.substring(p.lastIndexOf("/") + 1)
    return ext && base !== "." && base.endsWith(ext) ? base.slice(0, -ext.length) : base
}

/** normalize(), but keeps a leading "./", "//" or "//." that normalizing drops. */
function normalizeSafe(p: string): string {
    if (typeof p !== "string") return p
    const original = toUnix(p)
    const result = normalize(original)

    if (original.startsWith("./") && !result.startsWith("./") && !isAbsolute(result) && result !== "..") {
        return "./" + result
    }
    if (original.startsWith("//./")) {
        const withoutRoot = result.startsWith("//") ? result.substring(2) : result.startsWith("/") ? result.substring(1) : result
        return "//." + (withoutRoot ? "/" + withoutRoot : "")
    }
    if (original.startsWith("//") && !result.startsWith("//")) return "/" + result
    return result
}

export const upath = { join, normalize, isAbsolute, dirname, basename, normalizeSafe }
