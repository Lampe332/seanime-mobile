/*
 * The media server's address as typed on the settings page. Without a scheme http:// is meant (a Jellyfin at home
 * mostly answers on http://host:8096); the page then warns that the sign-in goes over the network unencrypted.
 */

export type ServerAddress = { ok: true, url: string, unencrypted: boolean } | { ok: false, url: "", unencrypted: false }

const ADDRESS = /^https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** The address the core is given, or not ok when it names no server or has another scheme than http(s) */
export function checkServerAddress(typed: string): ServerAddress {
    const trimmed = typed.trim()
    const withScheme = SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`
    const url = withScheme.replace(/\/+$/, "")
    if (!trimmed || !ADDRESS.test(url)) return { ok: false, url: "", unencrypted: false }
    return { ok: true, url, unencrypted: /^http:\/\//i.test(url) }
}
