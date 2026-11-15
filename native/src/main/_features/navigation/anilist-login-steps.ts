// geschrieben nach: eigenem Entwurf – Schritte und Token-Erkennung des AniList-Blatts (anilist-login-mobile.tsx)

/**
 * The AniList sheet's steps, in this order:
 * - `start`: one button opens AniList;
 * - `waiting`: AniList was opened, the app waits for the copied token (it reads the clipboard when the user comes back);
 * - `found`: a token is there, one button connects;
 * - `manual`: the small second way, the token pasted or typed by hand.
 */
export type AnilistLoginStep = "start" | "waiting" | "found" | "manual"

export function anilistLoginStep({ opened, token, manual }: { opened: boolean, token: string | null, manual: boolean }): AnilistLoginStep {
    if (manual) return "manual"
    if (token) return "found"
    return opened ? "waiting" : "start"
}

// AniList's access tokens are JWTs: three base64url parts joined by dots, about a thousand characters long
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/

/**
 * The AniList token in copied text, or null: the token alone (as AniList's PIN page shows it, possibly broken over lines),
 * or an address that carries it (`…#access_token=…&token_type=Bearer`).
 */
export function extractAnilistToken(text: string | null | undefined): string | null {
    let value = (text ?? "").trim()
    if (!value) return null
    const fromUrl = /[#?&]access_token=([^&#\s]+)/.exec(value)
    if (fromUrl) {
        try {
            value = decodeURIComponent(fromUrl[1] ?? "")
        } catch {
            return null
        }
    }
    value = value.replace(/\s+/g, "")
    return JWT.test(value) ? value : null
}

/** What the connect button sends from the hand-made field: a recognised token, else the text as typed (as before). */
export function manualAnilistToken(text: string): string {
    return extractAnilistToken(text) ?? text.trim()
}
