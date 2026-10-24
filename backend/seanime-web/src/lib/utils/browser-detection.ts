/**
 * Check if the user agent of the navigator contains a key.
 *
 * @private
 * @static
 * @param key - Key for which to perform a check.
 * @returns Determines if user agent of navigator contains a key
 */
function userAgentContains(key: string): boolean {
    const userAgent = navigator.userAgent || ""

    return userAgent.includes(key)
}

/* Desktop Browsers */

/**
 * Check if the current platform is from Apple.
 *
 * Returns true on all iOS browsers and on desktop Safari.
 *
 * Returns false for non-Safari browsers on macOS, which are independent of
 * Apple.
 *
 * @returns Determines if current platform is from Apple
 */
export function isApple(): boolean {
    return navigator.vendor.includes("Apple") && !isTizen()
}

/* TV Platforms */

/**
 * Check if the current platform is Tizen.
 *
 * @returns Determines if current platform is Tizen
 */
function isTizen(): boolean {
    return userAgentContains("Tizen")
}
