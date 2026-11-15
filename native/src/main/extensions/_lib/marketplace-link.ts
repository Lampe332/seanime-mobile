// geschrieben nach: dem Marktplatz-Format des Kerns (core/extensions/manage/manage.ts marketplaceExtensions: eine JSON-Liste unter
// einer http(s)-Adresse, die offizielle als `marketplace.json` im Hauptordner ihres GitHub-Repos) und den Link-Formen von GitHub
// (github.com/<owner>/<repo>[/blob|raw|tree/<ref>/<pfad>], raw.githubusercontent.com/<owner>/<repo>[/refs/heads]/<ref>/<pfad>)

import type { Extension_Extension } from "@/api/generated/types"
import { DEFAULT_MARKETPLACE_URL as OFFICIAL_MARKETPLACE_URL } from "@/core/extensions/manage/manage"
import { isMarketplaceExtension } from "./extensions-phone"
import { isWebUrl } from "./extensions-screen"

/*
 * The marketplace link the user pastes or types: found in copied text, a GitHub page turned into the raw file the core
 * can read, and compared with the marketplaces the app already knows.
 */

/** Marketplaces remembered for a one-tap switch back */
export const RECENT_MARKETPLACES = 4

/**
 * The marketplace address in pasted text, or null: the first http(s) link, a GitHub file page as its raw file, a GitHub
 * repository (or folder) as its `marketplace.json`, the file name the official marketplace uses.
 */
export function marketplaceLink(input: string): string | null {
    const found = input.match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[).,;:!?\]]+$/, "")
    if (!found || !isWebUrl(found)) return null
    const github = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:\/(blob|raw|tree)\/([^?#]+?))?\/?(?:[?#].*)?$/i.exec(found)
    if (!github) return found
    const [, owner, name, kind, rest] = github
    const repo = `https://raw.githubusercontent.com/${owner}/${name.replace(/\.git$/i, "")}`
    if (!kind) return `${repo}/HEAD/marketplace.json`
    if (kind.toLowerCase() === "tree") return `${repo}/${rest}/marketplace.json`
    return `${repo}/${rest}`
}

/** One spelling per marketplace: the official one for "" (the app's default), https, raw files without `refs/heads/` */
function marketplaceKey(url: string) {
    const link = url.trim() || OFFICIAL_MARKETPLACE_URL
    const parts = /^https?:\/\/([^/?#]+)(.*)$/i.exec(link)
    const lowerHost = (parts ? parts[1] : link).toLowerCase()
    const path = parts ? parts[2] : ""
    const cleanPath = (lowerHost === "raw.githubusercontent.com" ? path.replace(/^(\/[^/]+\/[^/]+)\/refs\/heads\//, "$1/") : path).replace(/\/+$/, "")
    return `https://${lowerHost}${cleanPath}`
}

/** A raw GitHub file as repository, branch and file path; null for any other link */
function rawGithubParts(key: string) {
    const parts = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)(\/.*)$/.exec(key)
    return parts ? { repo: parts[1].toLowerCase(), ref: parts[2], file: parts[3] } : null
}

/**
 * Both links name the same marketplace ("" is the official one). `HEAD` is the repository's default branch, which a
 * pasted GitHub repository link becomes (marketplaceLink): it matches the same file on any branch of that repository.
 */
export function sameMarketplace(a: string, b: string) {
    const keyA = marketplaceKey(a)
    const keyB = marketplaceKey(b)
    if (keyA === keyB) return true
    const rawA = rawGithubParts(keyA)
    const rawB = rawGithubParts(keyB)
    return !!rawA && !!rawB && rawA.repo === rawB.repo && rawA.file === rawB.file && (rawA.ref === "HEAD" || rawB.ref === "HEAD")
}

/** What the app stores for a marketplace: "" for the official one, the link otherwise */
export function storedMarketplace(url: string) {
    return sameMarketplace(url, "") ? "" : url.trim()
}

/** The recent marketplaces after using `url`: it first, no duplicates, never the official one, at most RECENT_MARKETPLACES */
export function rememberMarketplace(recent: string[], url: string): string[] {
    const kept = recent.filter(item => !!item.trim() && !sameMarketplace(item, url) && !sameMarketplace(item, ""))
    return (sameMarketplace(url, "") ? kept : [url.trim(), ...kept]).slice(0, RECENT_MARKETPLACES)
}

export type MarketplacePreview = { total: number, streaming: number, manga: number, installed: number }

/** What a marketplace offers the phone app before it is added: its usable extensions, the sources and those already installed */
export function marketplacePreview(data: Extension_Extension[] | undefined, installedIds: Set<string>): MarketplacePreview {
    const usable = (data ?? []).filter(isMarketplaceExtension)
    return {
        total: usable.length,
        streaming: usable.filter(extension => extension.type === "onlinestream-provider").length,
        manga: usable.filter(extension => extension.type === "manga-provider").length,
        installed: usable.filter(extension => installedIds.has(extension.id)).length,
    }
}
