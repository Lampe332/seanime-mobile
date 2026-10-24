import { getServerBaseUrl } from "@/api/client/server-url"

// Only the removed offline mode rewrote image paths ({{LOCAL_ASSETS}}); the callers can drop this.
export function getImageUrl(path: string) {
    return path
}

export function getAssetUrl(path: string) {
    // A link instead of a file in the assets folder (the Android app cannot add files there)
    if (/^https?:\/\//i.test(path)) return path

    let p = path.replaceAll("\\", "/")

    if (p.startsWith("/")) {
        p = p.substring(1)
    }

    p = encodeURIComponent(p).replace(/\(/g, "%28").replace(/\)/g, "%29")
    return `${getServerBaseUrl()}/assets/${p}`
}
