/** Only published stable universal APKs from this app's own repository are eligible (AppReleasePolicy.kt). */
export const REPOSITORY = "Lampe332/seanime-mobile"
export const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`

export type ReleaseAsset = { name: string, url: string, size: number, digest: string }
export type Release = { tag: string, body: string, assets: ReleaseAsset[], draft: boolean, prerelease: boolean }
export type Update = { version: string, release: Release, asset: ReleaseAsset }

export const asset = (name: string, url: string, size: number = 0, digest: string = ""): ReleaseAsset => ({ name, url, size, digest })

function version(value: string): number[] | null {
    const clean = value.startsWith("v") ? value.slice(1) : value
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(clean)) return null
    const parts = clean.split(".").map(Number)
    // Kotlin's toIntOrNull: beyond Int it is no version
    return parts.every(part => Number.isSafeInteger(part) && part <= 2_147_483_647) ? parts : null
}

export function compareVersions(a: string, b: string): number {
    const left = version(a)
    const right = version(b)
    if (!left || !right) return 0
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
    return 0
}

export function selectUpdate(current: string, releases: Release[]): Update | null {
    if (!version(current)) return null
    let best: Update | null = null
    for (const release of releases) {
        if (release.draft || release.prerelease || !version(release.tag) || compareVersions(release.tag, current) <= 0) continue
        const v = release.tag.startsWith("v") ? release.tag.slice(1) : release.tag
        const name = `Seanime-Mobile-${v}.apk`
        const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag}/${name}`
        const found = release.assets.find(it => it.name === name && it.url === expected && it.url.startsWith("https:"))
        if (!found) continue
        if (!best || compareVersions(v, best.version) > 0) best = { version: v, release, asset: found }
    }
    return best
}

/** GitHub's release list (JSON) → releases; a missing flag counts as draft/prerelease, so it is never offered. */
export function parseReleases(json: unknown): Release[] {
    if (!Array.isArray(json)) throw new Error("GitHub answered without a release list")
    return json.map((release: any) => ({
        tag: String(release?.tag_name ?? ""),
        body: String(release?.body ?? ""),
        draft: release?.draft !== false,
        prerelease: release?.prerelease !== false,
        assets: (Array.isArray(release?.assets) ? release.assets : []).map((it: any) =>
            asset(String(it?.name ?? ""), String(it?.browser_download_url ?? ""), Number(it?.size) || 0, String(it?.digest ?? ""))),
    }))
}
