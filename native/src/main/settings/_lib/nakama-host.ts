/**
 * A Nakama host address that is reached without encryption: typed with http:// or without a scheme, which the core
 * reads as http:// (core/nakama/guest.ts hostBase). The password header and the streams then go over the network
 * readable, so the Nakama settings show a hint. Other schemes (https://, a room link) are left alone.
 */
export function isUnencryptedHost(typed: string) {
    const trimmed = typed.trim()
    if (!trimmed) return false
    return /^http:\/\//i.test(trimmed) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
}
