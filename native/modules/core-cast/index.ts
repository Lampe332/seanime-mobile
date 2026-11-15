// geschrieben nach: öffentlicher Doku von Nitro Modules (NitroModules.createHybridObject); keine Vorlage
import { NitroModules } from "react-native-nitro-modules"
import type { CoreCast, CoreCastLock } from "./src/CoreCast.nitro"

export type { CoreCast, CoreCastLock } from "./src/CoreCast.nitro"

/**
 * The search for TVs (cpp/SsdpSearch.cpp, shared C++) and, under Android, the multicast lock (Kotlin). Used through the
 * core only: src/core/cast/cast.ts, wired in src/api/client/core-cast.ts.
 */
export function coreCast(): CoreCast {
    return NitroModules.createHybridObject<CoreCast>("CoreCast")
}

export function coreCastLock(): CoreCastLock {
    return NitroModules.createHybridObject<CoreCastLock>("CoreCastLock")
}
