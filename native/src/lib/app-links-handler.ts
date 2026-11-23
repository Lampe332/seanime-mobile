import { toast } from "@/components/ui/toast/toast-store"
import { runCoreSandboxPractice, runCoreSandboxSelfTest } from "@/api/client/core-sandbox"
import { runCoreDownloadSelfTest } from "@/api/client/core-download"
import { reportCoreMemory } from "@/api/client/core-memory"
import { runCoreMangaCheck, runCoreMangaDownloadCheck, runCoreMangaWriteCheck } from "@/api/client/core-manga-check"
import { runCoreInstallCheck, runCoreMappingCheck, runCoreStreamsCheck } from "@/api/client/core-streams-check"
import { coreSendWaitingChanges, cutCoreFromAnilist, nameCoreWriteAccount, repeatCoreMove } from "@/api/client/core-switch"
import { tr } from "@/lib/app-language"
import { takeAppReloadMark } from "@/lib/reload-mark"
import { anilistIdFromMal } from "@/lib/airing/anilist-public"
import { checkChaptersForTest } from "@/lib/updates/chapter-check"
import { queryClient } from "@/main/client-providers"
import { showIntroPreview } from "@/main/_features/getting-started/intro-preview"
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

/** Pages that have a native screen (the schedule since E2 2.7, the manga page for new-chapter notifications, Updates); a link to any other opens Home. */
const PAGES_WITH_SCREEN = ["/", "/search", "/android-downloads", "/entry", "/schedule", "/manga/entry", "/updates"]

function routeFor(path: string): string {
    const pathname = path.split("?")[0]
    return PAGES_WITH_SCREEN.includes(pathname) ? path : "/"
}

/** The app path for a target; MyAnimeList ids open once AniList knows them. */
export async function resolveTarget(target: AppLinkTarget): Promise<string | null> {
    if (target.kind === "page") return routeFor(target.path)
    if (target.kind === "core-move") {
        await repeatCoreMove()
        void queryClient.invalidateQueries()
        return null
    }
    if (target.kind === "core-write-account") {
        nameCoreWriteAccount(target.account)
        console.log(`[Core] info the core may change on AniList: ${target.account === null ? "no account named" : `account ${target.account} only`}`)
        return null
    }
    if (target.kind === "core-anilist") {
        cutCoreFromAnilist(!target.reachable)
        console.log(`[Core] info AniList for the core: ${target.reachable ? "reachable" : "cut off (test switch)"}`)
        // connected again: reading the lists sends what waited (core/anilist/changes.ts)
        if (target.reachable) {
            void coreSendWaitingChanges()
            void queryClient.invalidateQueries()
        }
        return null
    }
    if (target.kind === "dev-check-updates") {
        // not waited for; the result is one log line and, when a chapter is found, its notification
        void checkChaptersForTest().then(found => console.log(`[Updates] info test check: ${found} new chapter(s)`), error => console.log(`[Updates] error test check: ${String(error)}`))
        return null
    }
    if (target.kind === "dev-intro") {
        showIntroPreview(true)
        return null
    }
    if (target.kind === "core-memory") {
        // no screen shows this; the result is one log line ([Core] info memory: …)
        void reportCoreMemory(queryClient)
        return null
    }
    if (target.kind === "core-sandbox-selftest") {
        // not waited for: the link is done at once, the result is in the log ([CoreSandbox])
        void runCoreSandboxSelfTest()
        return null
    }
    if (target.kind === "core-sandbox-practice") {
        void runCoreSandboxPractice()
        return null
    }
    if (target.kind === "core-install-check") {
        void runCoreInstallCheck(target.url)
        return null
    }
    if (target.kind === "core-mapping-check") {
        void runCoreMappingCheck(target.mediaId, target.provider, target.query, target.entry)
        return null
    }
    if (target.kind === "core-sodium-selftest") {
        // not waited for: the result is a dialog and the log ([SodiumSelfTest]); the release bundle leaves the file out (metro.config.js)
        void import("./account-sodium-selftest").then(module => module.runAccountSodiumSelfTest())
        return null
    }
    if (target.kind === "core-torrent-selftest") {
        // not waited for: the result is in the log ([CoreTorrent]); loaded here, the test needs the device's modules
        void import("@/api/client/core-torrent-selftest").then(module => module.runCoreTorrentSelfTest(target))
        return null
    }
    if (target.kind === "core-cast-outlet-check") {
        // not waited for: the address and the end of the share are in the log ([CoreCast]); nothing is played
        void import("@/api/client/core-cast").then(module => module.runCoreCastOutletCheck())
        return null
    }
    if (target.kind === "core-cast-check") {
        // not waited for: the TVs found and their answers are in the log ([CoreCast]); nothing is played
        void import("@/api/client/core-cast").then(module => module.runCoreCastCheck())
        return null
    }
    if (target.kind === "core-torrent-search-check") {
        // not waited for: the numbers are in the log ([CoreTorrent]); nothing is added to a torrent session
        void import("@/api/client/core-torrent-search-check").then(module => module.runCoreTorrentSearchCheck(target.mediaId, target.episodeNumber, target.provider))
        return null
    }
    if (target.kind === "core-torrent-client-check") {
        // phase 6f: one step of the torrent client, the numbers in the log ([CoreTorrent]); links run one after another (4.2.0 E)
        void import("@/api/client/core-torrent-client-check").then(module => module.queueCoreTorrentClientCheck(target))
        return null
    }
    if (target.kind === "core-check-refused") {
        console.log(`[Core] info ${target.check} link refused: ${target.reason}`)
        return null
    }
    if (target.kind === "core-torrent-stream-check") {
        // not waited for either: the outlet's answers and the area's part are in the log ([CoreTorrent])
        void import("@/api/client/core-torrent-stream-check").then(module => module.runCoreTorrentStreamCheck(target))
        return null
    }
    if (target.kind === "core-download-selftest") {
        // not waited for: the result is in the log ([CoreDownload])
        void runCoreDownloadSelfTest(target)
        return null
    }
    if (target.kind === "core-offline-check") {
        // not waited for: the result is in the log ([CoreOffline]); loaded here, the check needs the device's modules
        void import("@/api/client/core-offline").then(module => module.runCoreOfflineCheck(target))
        return null
    }
    if (target.kind === "core-offline-remove") {
        void import("@/api/client/core-offline").then(module => module.removeOfflineEpisode(target.id))
        return null
    }
    if (target.kind === "core-offline-list") {
        void import("@/api/client/core-offline").then(module => module.listOfflineEpisodes())
        return null
    }
    if (target.kind === "core-manga-download") {
        // saves (or removes) chapters through the core; the result is in the log ([CoreManga])
        void runCoreMangaDownloadCheck(target.mediaId, target.provider, target.count, target.remove)
        return null
    }
    if (target.kind === "core-manga-write") {
        // writes and puts back at once; the result is in the log ([CoreManga])
        void runCoreMangaWriteCheck(target.mediaId, target.provider)
        return null
    }
    if (target.kind === "core-manga-check") {
        // reads only; the result is in the log ([CoreManga])
        void runCoreMangaCheck(target.mediaId, target.provider, target.query)
        return null
    }
    if (target.kind === "core-streams-check") {
        // reads only; the result is in the log ([CoreStreams])
        void runCoreStreamsCheck(target.mediaIds, target.query, target.searchOnly)
        return null
    }
    if (target.kind === "mal-manga") {
        const mangaId = await anilistIdFromMal(target.malId, "MANGA")
        if (mangaId === null) {
            toast.error(tr("This manga is not on AniList", "Dieser Manga ist nicht auf AniList"))
            return null
        }
        return `/manga/entry?id=${mangaId}`
    }
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
/** This JS start is a reload (account import, backup restore): its launch link was handled before (lib/reload-mark.ts). */
const startedByReload = takeAppReloadMark()

export async function redirectAppLink(path: string, initial = false): Promise<string> {
    if (initial && startedByReload) return "/"
    try {
        // the router may pass "/open?path=…" without the scheme: the host became the first path segment
        const target = appLinkTarget(/^\/(entry|open|core)(\?|$)/.test(path) ? `seanime://${path.slice(1)}` : path)
        if (target) return (await resolveTarget(target)) ?? "/"
        // a link of the app that is not one of its pages (or an unknown page) opens Home instead of "not found"
        if (/^(seanime|seanime-native|seanime-scratch|https?):/i.test(path)) return "/"
        return path
    }
    catch {
        return "/"
    }
}
