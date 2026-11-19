import type { SyncResult } from "@/core/account/sync"
import { accountPhase, syncedAgo } from "@/lib/account/account-view"
import type { Translate } from "@/lib/app-language"

/*
 * The More panel without React: the profile head on top (AniList and the Seanime account) and where "Customize Home" sits.
 */

export type MoreProfileInput = {
    /** the AniList viewer; null without AniList (no user, or the local stand-in account `isSimulated`) */
    anilist: { name: string, avatar: string | null } | null
    account: { loaded: boolean, signedIn: boolean, hasKey: boolean, email: string | null, lastSyncAt: number | null }
    /** the secured storage did not answer at start (accountLoadFailedAtom) */
    loadFailed: boolean
    lastResult: Pick<SyncResult, "state"> | null
    now: number
}

export type MoreProfile = {
    /** the AniList name, or the invitation to sign in */
    title: string
    /** AniList's avatar; null shows the neutral one */
    avatar: string | null
    /** the Seanime account: "you@mail.com · Synced 2 min ago", "Sync between your devices", or why it is missing */
    line: string | null
    lineTone: "muted" | "warning"
}

/** The profile head of the More panel; a tap on it opens Settings › Account */
export function moreProfile(t: Translate, input: MoreProfileInput): MoreProfile {
    const name = input.anilist?.name.trim()
    const head = {
        title: name || t("Sign in to AniList", "Bei AniList anmelden"),
        avatar: (name && input.anilist?.avatar) || null,
    }
    const { account } = input
    if (!account.loaded) {
        return input.loadFailed
            ? { ...head, line: t("Couldn't load your account", "Konto konnte nicht geladen werden"), lineTone: "warning" }
            : { ...head, line: null, lineTone: "muted" }
    }
    const phase = accountPhase({ loaded: true, signedIn: account.signedIn, hasKey: account.hasKey, lastResult: input.lastResult })
    if (phase === "signed-out") return { ...head, line: t("Sync between your devices", "Zwischen deinen Geräten synchronisieren"), lineTone: "muted" }
    const synced = syncedAgo(t, account.lastSyncAt, Math.max(input.now, account.lastSyncAt ?? 0))
    return { ...head, line: [account.email, synced].filter(Boolean).join(" · "), lineTone: "muted" }
}

/** Icons a Home head may carry at most: Search, Plugins, Playlists, Library and Customize, 48dp each */
const HOME_HEAD_MAX_ACTIONS = 5
const HEAD_ACTION = 48
/** The title's room beside the icons: "Startseite" / "Главная" at 28dp bold plus the 12dp gap */
const HOME_TITLE_ROOM = 172
/** The head's side padding (px-4 on both sides) */
const HOME_HEAD_PADDING = 32

/**
 * Whether "Customize" stays in Home's head or moves into the More panel (Nick, 4.2.0): a phone whose window cannot hold
 * the title and all five icons in one line (S22: 360dp) lists it in More instead, in both places alike whatever the
 * library shows, so it does not jump between the two. The tablet head shows each action as a word pill and wraps; its
 * More panel never lists Customize.
 */
export function customizeInHomeHead(layout: { rail: boolean, windowWidth: number }) {
    if (layout.rail) return true
    return layout.windowWidth - HOME_HEAD_PADDING >= HOME_TITLE_ROOM + HOME_HEAD_MAX_ACTIONS * HEAD_ACTION
}
