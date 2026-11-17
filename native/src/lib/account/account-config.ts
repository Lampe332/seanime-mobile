// geschrieben nach: Plan „Account + Sync“ (Abschnitte 7, 12: api.seanimemobile.com, getrennte Umgebungen) und app-variants.json (Varianten test/scratch/release)

/*
 * Where the app finds the account server. The release always talks to api.seanimemobile.com over HTTPS. The test and
 * scratch builds may name another address in app-variants.json ("accountApi"), e.g. the local server through
 * `adb reverse`; plain http is taken only for this device itself (127.0.0.1, localhost), never for another host.
 * The account client adds "/v1/…" to the address.
 */

export const RELEASE_ACCOUNT_API = "https://api.seanimemobile.com"

const LOCAL_HTTP = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?\/?$/
const HTTPS = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?\/?$/i

/**
 * Run-time check of every account request's address: the release only ever talks https; test and scratch builds also
 * the local server over http on this device (adb reverse). Anything else throws before a byte is sent.
 */
export function checkAccountUrl(variantName: string, url: string): string {
    if (/^https:\/\//i.test(url)) return url
    if (variantName !== "release" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?\//.test(url)) return url
    throw new Error("The account server must be reached over https.")
}

export function accountApiBase(variantName: string, override: string | undefined): string {
    if (variantName === "release" || !override) return RELEASE_ACCOUNT_API
    const address = override.trim()
    if (LOCAL_HTTP.test(address) || HTTPS.test(address)) return address.replace(/\/$/, "")
    return RELEASE_ACCOUNT_API
}
