import { tr } from "@/lib/app-language"
import { entryLink } from "@/lib/app-links"
import { atomWithStorage, readStoredJSON, storage } from "@/lib/storage"
import * as BackgroundTask from "expo-background-task"
import * as Notifications from "expo-notifications"
import { AndroidImportance } from "expo-notifications"
import * as TaskManager from "expo-task-manager"
import { Platform } from "react-native"
import { aired, AiringNext, Announced, ANNOUNCE_DELAY_SECONDS, nextCheck, toSchedule } from "./airing-policy"
import { AIRING_QUERY, AiringFetch, anilist, listMedia, resolveUser, userId } from "./anilist-public"

/*
 * New-episode notifications for the anime on the watching list (AiringNotifier.kt). The old app woke itself with an
 * alarm shortly after the next episode and posted then. Here every known next episode is handed to Android as a
 * scheduled notification (expo-notifications, a few minutes after it airs), so it arrives even when the app is closed;
 * each check (app start, every hour or so in the background via expo-background-task, the switch) fetches AniList again
 * and plans anew. Reads the public AniList list like the widget; the user name comes from the local server.
 */

const ENABLED_KEY = "seanime-mobile-airing-notifications"
const NEXT_KEY = "seanime-mobile-airing-next"
const ANNOUNCED_KEY = "seanime-mobile-airing-announced"
const SCHEDULED_KEY = "seanime-mobile-airing-scheduled"
const NEXT_CHECK_KEY = "seanime-mobile-airing-next-check"

const CHANNEL = "new_episodes"
const RETRY_SECONDS = 3600
export const AIRING_TASK = "seanime-airing-check"

export const airingNotificationsAtom = atomWithStorage<boolean>(ENABLED_KEY, true)

export function isAiringEnabled() {
    return readStoredJSON(ENABLED_KEY, true)
}

function readJSON<T>(key: string, fallback: T): T {
    return readStoredJSON<T>(key, fallback)
}

function writeJSON(key: string, value: unknown) {
    storage.set(key, JSON.stringify(value))
}

const identifier = (mediaId: number) => `airing-${mediaId}`
const nowSeconds = () => Math.floor(Date.now() / 1000)

async function canPost() {
    if (Platform.OS !== "android") return false
    return (await Notifications.getPermissionsAsync()).granted
}

async function ensureChannel() {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: tr("New episodes", "Neue Folgen"),
        importance: AndroidImportance.DEFAULT,
    })
}

function content(item: AiringNext, test: boolean): Notifications.NotificationContentInput {
    const text = tr(`Episode ${item.episode} is out`, `Folge ${item.episode} ist erschienen`)
    return {
        title: item.title,
        body: test ? `Test: ${text}` : text,
        // tapping opens the anime page (app-links-handler.tsx); the sample of a test without a known episode opens the app
        data: item.mediaId > 0 ? { url: entryLink(item.mediaId) } : {},
        autoDismiss: true,
    }
}

async function postNow(item: AiringNext, test: boolean) {
    await Notifications.scheduleNotificationAsync({ identifier: identifier(item.mediaId), content: content(item, test), trigger: { channelId: CHANNEL } })
}

async function fetchNext(attempts: number): Promise<AiringNext[]> {
    // the server knows the user while it runs; a background check may come while it does not, then the last name is used
    const name = await resolveUser(attempts, 2000)
    const data = await anilist<AiringFetch>(AIRING_QUERY, { userId: await userId(name) })
    return listMedia(data).map(media => ({
        mediaId: media.id,
        title: media.title.userPreferred,
        episode: media.nextAiringEpisode.episode,
        airingAt: media.nextAiringEpisode.airingAt,
    }))
}

let running: Promise<void> | null = null

/**
 * Announces what aired since the last check and plans the next announcements. [force]: also before the planned time
 * (app start, the switch); [attempts]: how long to wait for a booting server when no user is known yet.
 */
export function checkAiring({ force = false, attempts = 1 }: { force?: boolean, attempts?: number } = {}): Promise<void> {
    if (!running) {
        running = runCheck(force, attempts).finally(() => {
            running = null
        })
    }
    return running
}

async function runCheck(force: boolean, attempts: number) {
    if (!isAiringEnabled() || Platform.OS !== "android") return
    const now = nowSeconds()
    if (!force && now < (storage.getNumber(NEXT_CHECK_KEY) ?? 0)) return
    let fresh: AiringNext[]
    try {
        fresh = await fetchNext(attempts)
    }
    catch {
        storage.set(NEXT_CHECK_KEY, now + RETRY_SECONDS)
        return
    }
    if (!isAiringEnabled()) return
    const allowed = await canPost()
    if (allowed) await ensureChannel()

    const announced = readJSON<Announced>(ANNOUNCED_KEY, {})
    const scheduled = readJSON<Announced>(SCHEDULED_KEY, {})
    for (const item of aired(readJSON<AiringNext[]>(NEXT_KEY, []), announced, now)) {
        // a planned announcement was delivered by Android at its time; one that was never planned is posted now
        if (scheduled[item.mediaId] !== item.episode && allowed) await postNow(item, false)
        announced[item.mediaId] = item.episode
    }

    await Promise.all(Object.keys(scheduled).map(id => Notifications.cancelScheduledNotificationAsync(identifier(Number(id))).catch(() => undefined)))
    const planned: Announced = {}
    if (allowed) {
        for (const item of toSchedule(fresh, announced, now)) {
            await Notifications.scheduleNotificationAsync({
                identifier: identifier(item.mediaId),
                content: content(item, false),
                trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.DATE,
                    date: Math.max(item.airingAt + ANNOUNCE_DELAY_SECONDS, now + 5) * 1000,
                    channelId: CHANNEL,
                },
            })
            planned[item.mediaId] = item.episode
        }
    }
    writeJSON(NEXT_KEY, fresh)
    writeJSON(ANNOUNCED_KEY, announced)
    writeJSON(SCHEDULED_KEY, planned)
    storage.set(NEXT_CHECK_KEY, nextCheck(fresh, now))
}

async function cancelPlanned() {
    const scheduled = readJSON<Announced>(SCHEDULED_KEY, {})
    await Promise.all(Object.keys(scheduled).map(id => Notifications.cancelScheduledNotificationAsync(identifier(Number(id))).catch(() => undefined)))
    writeJSON(SCHEDULED_KEY, {})
}

/** Background checks run only while the notifications are on. */
export async function syncAiringTask() {
    if (Platform.OS !== "android") return
    const registered = await TaskManager.isTaskRegisteredAsync(AIRING_TASK)
    if (isAiringEnabled() && !registered) await BackgroundTask.registerTaskAsync(AIRING_TASK, { minimumInterval: 60 })
    if (!isAiringEnabled() && registered) await BackgroundTask.unregisterTaskAsync(AIRING_TASK)
}

/** Turning it on asks for the notification permission first (Android 13+). */
export async function setAiringEnabled(enabled: boolean) {
    writeJSON(ENABLED_KEY, enabled)
    await syncAiringTask().catch(() => undefined)
    if (!enabled) {
        await cancelPlanned()
        return
    }
    await Notifications.requestPermissionsAsync()
    await checkAiring({ force: true })
}

/** Shows how an announcement looks, with the next episode of the list when one is known; "permission" when Android does not allow notifications. */
export async function postTestAiring(): Promise<"ok" | "permission"> {
    if (!(await canPost())) {
        const answer = await Notifications.requestPermissionsAsync()
        if (!answer.granted) return "permission"
    }
    await ensureChannel()
    const now = nowSeconds()
    const upcoming = readJSON<AiringNext[]>(NEXT_KEY, []).filter(it => it.airingAt > now).sort((a, b) => a.airingAt - b.airingAt)
    const sample = upcoming[0] ?? { mediaId: 0, title: "Seanime", episode: 1, airingAt: now }
    await Notifications.scheduleNotificationAsync({ content: content(sample, true), trigger: { channelId: CHANNEL } })
    return "ok"
}

/**
 * Registered at the entry (index.ts) so Android can run it without the app open; WorkManager decides the time,
 * the check itself skips until the planned moment (nextCheck).
 */
export function defineAiringTask() {
    if (TaskManager.isTaskDefined(AIRING_TASK)) return
    TaskManager.defineTask(AIRING_TASK, async () => {
        try {
            await checkAiring()
            return BackgroundTask.BackgroundTaskResult.Success
        }
        catch {
            return BackgroundTask.BackgroundTaskResult.Failed
        }
    })
}
