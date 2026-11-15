// geschrieben nach: App-Code anilist-login-mobile.tsx und settings-app.tsx (Anmelden mit dem Token aus AniLists Anmeldeseite, Abmelden), auth.hooks.ts (die Antwort ist der Status), Aufzeichnung api vom 13.11.2026 (STATUS.GetStatus: Felder von user.viewer), öffentliche AniList-Doku (Viewer) und docs/EIGENER-KERN.md §4c/§4p; kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { account, anilistAnswers, anilistListEntries } from "../database/schema"
import { CoreError } from "../errors"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { startStatus } from "../start/start"
import { keepLocalListsAside } from "./changes"
import { askAnilist, clientFor } from "./client"

/*
 * Signing in and out of AniList (area `anilist`, phase 5a-3, docs/EIGENER-KERN.md §4p). The token goes to the device's
 * secured storage as in the move (§4c), the user's name and viewer to the core's `account` row. The server still does
 * the work of the areas that are off, so it is told as well while it listens (its failure does not stop the core). A
 * change of account forgets the kept lists of the old one. The throw-away app (`onlyAccount`) signs in its test account
 * only. Both answer the status (start/start.ts).
 */

type Json = Record<string, unknown>

export const LOGIN_VIEWER = "query LoginViewer { Viewer { id name avatar { large medium } isBlocked options { displayAdultContent airingNotifications profileColor } } }"
export const OTHER_ACCOUNT_REFUSED = "this app may only sign in its test account on AniList"

function tokenOf(body: unknown): string {
    const token = typeof body === "object" && body !== null ? (body as Json).token : undefined
    if (typeof token !== "string" || token.trim() === "") throw new CoreError("missing token", 400)
    return token.trim()
}

async function forgetLists(environment: CoreEnvironment) {
    const database = await environment.database()
    await inOrder(database, async () => {
        await database.delete(anilistListEntries)
        await database.delete(anilistAnswers)
    })
}

/** POST /api/v1/auth/login: `{ token }` */
export async function login(request: CoreRequest, environment: CoreEnvironment): Promise<unknown> {
    const token = tokenOf(request.body)
    if (!environment.keepSecret) throw new CoreError("the secured storage is not available here")
    const viewer = (await askAnilist(clientFor({ ...environment, secret: async () => token }), LOGIN_VIEWER, {})).Viewer as Json | null | undefined
    if (typeof viewer?.id !== "number" || typeof viewer.name !== "string") throw new CoreError("not logged in to AniList", 401)
    const only = environment.onlyAccount?.() ?? null
    if (only !== null && viewer.id !== only) throw new CoreError(OTHER_ACCOUNT_REFUSED, 403)
    const database = await environment.database()
    const [before] = await inOrder(database, () => database.select({ username: account.username }).from(account).where(eq(account.id, 1)))
    const now = environment.now()
    if (before && before.username !== viewer.name) await forgetLists(environment)
    // from the local account: its lists are put aside before AniList's replace them, for "Upload local lists"
    else if (!before) await keepLocalListsAside(database, now)
    const { id: _id, ...shown } = viewer
    await inOrder(database, () => database.insert(account).values({ id: 1, username: viewer.name as string, viewer: JSON.stringify(shown), createdAt: now, changedAt: now })
        .onConflictDoUpdate({ target: account.id, set: { username: viewer.name as string, viewer: JSON.stringify(shown), changedAt: now } }))
    await environment.keepSecret(ACCOUNT_TOKEN_SECRET, token)
    return startStatus(environment)
}

/** POST /api/v1/auth/logout */
export async function logout(_request: CoreRequest, environment: CoreEnvironment): Promise<unknown> {
    if (!environment.keepSecret) throw new CoreError("the secured storage is not available here")
    const database = await environment.database()
    await inOrder(database, () => database.delete(account))
    await forgetLists(environment)
    await environment.keepSecret(ACCOUNT_TOKEN_SECRET, null)
    return startStatus(environment)
}
