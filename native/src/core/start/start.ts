// geschrieben nach: Aufzeichnung api vom 13.11.2026 (STATUS.GetStatus: Felder der Antwort und ihre Arten), dem App-Code src/main/client-providers.tsx und server-data-wrapper.tsx und docs/EIGENER-KERN.md §4e/§4s; kein Server-Quelltext

import type { CoreEnvironment } from "../registry"
import { ownSettingsAndLook } from "../settings/settings"
import { statusWithoutServer } from "./without-server"

/*
 * The start of the app (docs/EIGENER-KERN.md §4e). Since stage 8a-1 the app runs without its server; since 8b-3 (§4s)
 * the way with it is gone: the core answers the status alone, nothing is held back and nothing waits.
 */

type Environment = Pick<CoreEnvironment, "database"> & Partial<Pick<CoreEnvironment, "secret">>

/** GET /api/v1/status: settings, look and user are the core's, the rest as without-server.ts keeps it */
export async function startStatus(environment: Environment): Promise<unknown> {
    return statusWithoutServer(environment, await ownSettingsAndLook(await environment.database()))
}

/**
 * The answer to a saved setting (PATCH /api/v1/settings and /settings/path): the status as GET /api/v1/status gives it
 * now. When it cannot be built, the same with `serverReady` false (leftover of stage 2, §4g).
 */
export async function statusAfterSave(environment: Environment): Promise<unknown> {
    try {
        return await startStatus(environment)
    }
    catch {
        const own = await ownSettingsAndLook(await environment.database())
        return { ...await statusWithoutServer(environment, own), serverReady: false }
    }
}
