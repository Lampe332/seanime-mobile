// geschrieben nach: Mihon FAQ (Inkognito pausiert den Lese-Verlauf, https://mihon.app/docs/faq/library), Mihon „Delete after reading“ (https://mihon.app/changelogs) und dem eigenen Kern settings.ts (Tabelle settings_sections); kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { settingsSections } from "../database/schema"
import { CoreError } from "../errors"
import { type DeleteWatchedMode, DELETE_WATCHED_MODES, deleteWatchedModeOf } from "../offline/auto-delete"
import { type PrefetchCount, PREFETCH_COUNTS, prefetchCountOf } from "../offline/prefetch"
import type { CoreEnvironment, CoreRequest } from "../registry"

/*
 * The app's own switches, not the server's settings (those are recorded and stay as recorded): one row "appSwitches"
 * in settings_sections that the status leaves out (settings.ts readSettings).
 *
 * Incognito mode (Settings › App, the Menu's switch): while it is on, nothing the user watches or reads leaves a trace.
 * The core checks it at every place that writes one by itself: the watch history (playback.ts keep), AniList's progress
 * (playback.ts progressTo; anilist/changes.ts updateProgressOf refuses a body with `auto: true`, the manga reader's auto
 * progress) and the position of a saved episode (offline.ts offlinePosition). What the user sets on purpose ("mark as
 * watched", "+1", the list editor) still goes to AniList. The manga reader's resume page is the app's own and checks the same switch there.
 *
 * "Delete watched episodes" (Downloads): offline/auto-delete.ts. "Download next episodes automatically" (Downloads):
 * offline/prefetch.ts.
 */

export type AppSwitches = { incognitoMode: boolean, deleteWatchedEpisodes: DeleteWatchedMode, prefetchEpisodes: PrefetchCount }

const SECTION = "appSwitches"

type Environment = Pick<CoreEnvironment, "database">

export async function appSwitchesOf(environment: Environment): Promise<AppSwitches> {
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.select().from(settingsSections).where(eq(settingsSections.section, SECTION)))
    const content = row?.content ?? {}
    return {
        incognitoMode: content.incognitoMode === true,
        deleteWatchedEpisodes: deleteWatchedModeOf(content.deleteWatchedEpisodes),
        prefetchEpisodes: prefetchCountOf(content.prefetchEpisodes),
    }
}

export async function incognitoOn(environment: Environment): Promise<boolean> {
    return (await appSwitchesOf(environment)).incognitoMode
}

/** GET /api/v1/app-switches */
export function readAppSwitches(_request: CoreRequest, environment: Environment): Promise<AppSwitches> {
    return appSwitchesOf(environment)
}

/** PATCH /api/v1/app-switches: the fields sent replace the stored ones; answers all switches */
export async function patchAppSwitches(request: CoreRequest, environment: Pick<CoreEnvironment, "database" | "now">): Promise<AppSwitches> {
    const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {}
    const { incognitoMode, deleteWatchedEpisodes, prefetchEpisodes } = body
    if (incognitoMode !== undefined && typeof incognitoMode !== "boolean") throw new CoreError("incognitoMode must be yes or no", 400)
    if (deleteWatchedEpisodes !== undefined && !(DELETE_WATCHED_MODES as readonly unknown[]).includes(deleteWatchedEpisodes)) throw new CoreError("unknown deleteWatchedEpisodes", 400)
    if (prefetchEpisodes !== undefined && !(PREFETCH_COUNTS as readonly unknown[]).includes(prefetchEpisodes)) throw new CoreError("prefetchEpisodes must be 0 to 3", 400)
    const next: AppSwitches = { ...await appSwitchesOf(environment) }
    if (incognitoMode !== undefined) next.incognitoMode = incognitoMode
    if (deleteWatchedEpisodes !== undefined) next.deleteWatchedEpisodes = deleteWatchedEpisodes as DeleteWatchedMode
    if (prefetchEpisodes !== undefined) next.prefetchEpisodes = prefetchEpisodes as PrefetchCount
    const database = await environment.database()
    const values = { section: SECTION, content: next, changedAt: environment.now() }
    await inOrder(database, () => database.insert(settingsSections).values(values)
        .onConflictDoUpdate({ target: settingsSections.section, set: { content: next, changedAt: values.changedAt } }))
    return next
}

/** The error a progress change answers with while incognito mode is on (the screens show it as their toast) */
export const INCOGNITO_ERROR = "Incognito mode is on: progress was not sent to AniList"
