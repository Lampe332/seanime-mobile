// Only the removed offline mode rewrote image paths ({{LOCAL_ASSETS}}); the callers can drop this.
export function getImageUrl(path: string) {
    return path
}

/** A link (http/https) as it is; a file of the server's assets folder is "" (no picture): the app has no server */
export function getAssetUrl(path: string) {
    return /^https?:\/\//i.test(path) ? path : ""
}
