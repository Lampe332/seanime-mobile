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

/* Platform Utilities */

/**
 * Guesses if the platform is a mobile one (iOS or Android).
 *
 * @returns Determines if current platform is mobile (Guess)
 */
export function isMobile(): boolean {
    let userAgent = ""

    if (navigator.userAgent) {
        userAgent = navigator.userAgent
    }

    if (/iPhone|iPad|iPod|Android/.test(userAgent)) {
        // This is Android, iOS, or iPad < 13.
        return true
    }

    /*
     * Starting with iOS 13 on iPad, the user agent string no longer has the
     * word "iPad" in it.  It looks very similar to desktop Safari.  This seems
     * to be intentional on Apple's part.
     * See: https://forums.developer.apple.com/thread/119186
     *
     * So if it's an Apple device with multi-touch support, assume it's a mobile
     * device.  If some future iOS version starts masking their user agent on
     * both iPhone & iPad, this clause should still work.  If a future
     * multi-touch desktop Mac is released, this will need some adjustment.
     */
    return isApple() && navigator.maxTouchPoints > 1
}
