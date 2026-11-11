import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import { anilistIdFromMal } from "@/lib/airing/anilist-public"
import { type AppLinkTarget, appLinkTarget, LAUNCHER_SHORTCUTS, sharedTextTarget, shortcutLink } from "@/lib/app-links"
import * as Notifications from "expo-notifications"
import * as QuickActions from "expo-quick-actions"
import { useQuickActionCallback } from "expo-quick-actions/hooks"
import { router } from "expo-router"
import { useShareIntent } from "expo-share-intent"
import React from "react"
import { Platform } from "react-native"

/*
 * Every way into a page from outside (MainActivity.handleWidgetIntent / openMalAnime / publishShortcuts): app links
 * (widget rows, shortcuts, AniList/MyAnimeList pages) arrive through Expo Router's +native-intent.tsx; notification taps,
 * shared text and launcher shortcuts through the hooks below. All end in resolveTarget.
 */

/** Pages that have a native screen (the schedule since E2 2.7); a link to any other opens Home. */
const PAGES_WITH_SCREEN = ["/", "/search", "/android-downloads", "/entry", "/schedule"]

function routeFor(path: string): string {
    const pathname = path.split("?")[0]
    return PAGES_WITH_SCREEN.includes(pathname) ? path : "/"
}

/** The app path for a target; MyAnimeList ids open once AniList knows them. */
export async function resolveTarget(target: AppLinkTarget): Promise<string | null> {
    if (target.kind === "page") return routeFor(target.path)
    const id = await anilistIdFromMal(target.malId)
    if (id === null) {
        toast.error(tr("This anime is not on AniList", "Dieser Anime ist nicht auf AniList"))
        return null
    }
    return `/entry?id=${id}`
}

async function open(target: AppLinkTarget | null) {
    if (!target) return
    const path = await resolveTarget(target)
    if (path) router.push(path as never)
}

/** Long-pressing the launcher icon: search, downloads, schedule (MainActivity.publishShortcuts), in the app's language. */
function useLauncherShortcuts(language: string) {
    React.useEffect(() => {
        if (Platform.OS !== "android") return
        // the launcher limits how often shortcuts change; the last ones stay
        void QuickActions.setItems(LAUNCHER_SHORTCUTS.map(item => ({
            id: item.id,
            title: tr(item.en, item.de),
            icon: item.icon,
            params: { href: shortcutLink(item.path) },
        }))).catch(() => undefined)
    }, [language])
    useQuickActionCallback(action => {
        const href = action.params?.href
        if (typeof href === "string") void open(appLinkTarget(href))
    })
}

/** A tapped notification (new episode, update) opens its page. */
function useNotificationTaps() {
    const response = Notifications.useLastNotificationResponse()
    React.useEffect(() => {
        if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
        const url = response.notification.request.content.data?.url
        if (typeof url === "string") void open(appLinkTarget(url))
        Notifications.clearLastNotificationResponse()
    }, [response])
}

/** "Share → Seanime": the first AniList/MyAnimeList link opens its page, other text is searched as a title. */
function useSharedText() {
    const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent()
    React.useEffect(() => {
        if (!hasShareIntent) return
        void open(sharedTextTarget(shareIntent.text ?? shareIntent.webUrl))
        resetShareIntent()
    }, [hasShareIntent, shareIntent, resetShareIntent])
}

/** Mount once at the app root, inside the router. */
export function useAppLinkSources(language: string) {
    useLauncherShortcuts(language)
    useNotificationTaps()
    useSharedText()
}

/** For +native-intent.tsx: rewrites an incoming system link to the app path it opens. */
export async function redirectAppLink(path: string): Promise<string> {
    try {
        // the router may pass "/open?path=…" without the scheme: the host became the first path segment
        const target = appLinkTarget(/^\/(entry|open)(\?|$)/.test(path) ? `seanime://${path.slice(1)}` : path)
        if (target) return (await resolveTarget(target)) ?? "/"
        // a link of the app that is not one of its pages (or an unknown page) opens Home instead of "not found"
        if (/^(seanime|seanime-native|https?):/i.test(path)) return "/"
        return path
    }
    catch {
        return "/"
    }
}
