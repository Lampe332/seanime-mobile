import { getAppLanguage, tr } from "@/lib/app-language"
import { storage } from "@/lib/storage"
import React from "react"
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from "react-native-android-widget"
import { anilist, listMedia, NoAniListUserError, resolveUser, UPCOMING_QUERY, UpcomingFetch, userId } from "../airing/anilist-public"
import { REFRESH_ACTION, UpcomingWidget, WIDGET_NAME } from "./upcoming-widget"
import { createWidgetCache, FetchedEntry, stampText } from "./widget-cache"

/*
 * What the widget does (UpcomingAnimeWidget.kt + AnimeListService.kt): redraws use the stored list; a fetch runs when
 * asked (refresh button, the app) or when the list is outdated, not right after a failed one. The list comes from
 * AniList; the local server only tells the user name, and a slow server boot gets about 10 s (40 tries).
 */
const cache = createWidgetCache(storage)

function view() {
    const entries = cache.entries()
    const error = cache.error()
    let note: string | null
    if (entries.length > 0) {
        // a failed or pending refresh keeps the last list, marked with its time
        const outdated = error !== null || !cache.hasValidCache()
        note = outdated ? tr(`As of ${stamp()}`, `Stand ${stamp()}`) : null
    } else if (cache.isLoading()) {
        note = tr("Loading …", "Wird geladen …")
    } else if (error !== null) {
        note = error
    } else if (cache.savedAt() > 0) {
        note = tr("No upcoming episodes on your list", "Keine anstehenden Folgen auf deiner Liste")
    } else {
        note = tr("Nothing here yet", "Noch nichts da")
    }
    return (
        <UpcomingWidget
            title={tr("Upcoming anime", "Demnächst")}
            note={note}
            entries={entries}
            nowSeconds={Math.floor(Date.now() / 1000)}
            episodeText={(episode, time) => tr(`Ep ${episode}: ${time}`, `Folge ${episode}: ${time}`)}
        />
    )
}

function stamp() {
    return stampText(cache.savedAt(), Date.now(), getAppLanguage() === "de")
}

async function fetchUpcoming(): Promise<FetchedEntry[]> {
    const name = await resolveUser(40, 250)
    const data = await anilist<UpcomingFetch>(UPCOMING_QUERY, { userId: await userId(name) })
    return listMedia(data)
        .map(media => ({
            title: media.title.userPreferred,
            episode: media.nextAiringEpisode.episode,
            timeUntil: media.nextAiringEpisode.timeUntilAiring,
            mediaId: media.id,
            coverUrl: media.coverImage?.medium ?? "",
        }))
        .sort((a, b) => a.timeUntil - b.timeUntil)
}

let fetching: Promise<void> | null = null

function fetchIntoCache(): Promise<void> {
    if (!fetching) {
        cache.setLoading(true)
        fetching = fetchUpcoming()
            .then(fresh => cache.save(fresh))
            .catch(error => cache.setError(error instanceof NoAniListUserError
                ? tr("Open Seanime and log in to AniList, then refresh.", "Seanime öffnen und bei AniList anmelden, dann aktualisieren.")
                : tr("No connection. The list updates once you are online.", "Keine Verbindung. Die Liste wird mit Internet aktualisiert.")))
            .finally(() => {
                fetching = null
            })
    }
    return fetching
}

const needsFetch = () => cache.isLoading() || !(cache.hasValidCache() || cache.recentError())

function redrawAll() {
    return requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => view(), widgetNotFound: () => undefined })
}

/** Registered at the entry (index.ts); Android calls it for adds, periodic updates, resizes and the refresh button. */
export async function widgetTaskHandler({ widgetAction, clickAction, renderWidget }: WidgetTaskHandlerProps) {
    if (widgetAction === "WIDGET_DELETED") return
    const refresh = widgetAction === "WIDGET_CLICK" && clickAction === REFRESH_ACTION
    if (widgetAction === "WIDGET_CLICK" && !refresh) return
    if (refresh) cache.clearError()
    if (!refresh && !needsFetch()) {
        renderWidget(view())
        return
    }
    cache.setLoading(true)
    // the last list (or the loading text) right away, the new one once AniList answered
    renderWidget(view())
    await fetchIntoCache()
    await redrawAll()
}

/** The app (root) brings the widget up to date when it starts or the user changes; only fetches when the list is outdated. */
export async function refreshUpcomingWidget({ force = false }: { force?: boolean } = {}) {
    if (force || needsFetch()) await fetchIntoCache()
    await redrawAll()
}
