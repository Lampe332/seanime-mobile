// geschrieben nach: docs/EIGENER-KERN.md §4r (Phase 7a: bewusst entfernt), Aufzeichnung der Server-Antworten vom 13.11.2026 (nur die Form: EXTENSIONS.GetPluginSettings, ListDevelopmentModeExtensions, ListAnimeEntryEpisodeTabExtensions) und den Adressen in src/api/generated/endpoints.ts; kein Server-Quelltext
import { CoreError } from "../errors"
import type { CoreRoute } from "../registry"

/*
 * What the app gives up while it runs without its server (phase 7a): plugins, Discord, issue reports and Nakama's cloud
 * rooms are not built in the core. With the server they stay exactly as before; these answers are given only while the
 * app runs without it (`withoutServer` in registry.ts), so reading is quiet and empty, changing says clearly why not.
 */

/** The words a change of something given up carries, after what it is */
export const NOT_WITHOUT_THE_SERVER = "not available without the server"

function notAvailable(what: string): () => Promise<never> {
    return async () => {
        throw new CoreError(`${what} ${NOT_WITHOUT_THE_SERVER}`, 503)
    }
}

export const REMOVED_ROUTES: CoreRoute[] = [
    // plugins: none run, none are pinned or granted, no plugin gives an episode tab, none is in development
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/plugin-settings", answer: async () => ({ pinnedTrayPluginIds: [], pluginGrantedPermissions: {} }) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list/development", answer: async () => null },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list/anime-entry-episode-tabs", answer: async () => null },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/plugin-settings/pinned-trays", answer: notAvailable("Plugins are") },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/plugin-permissions/grant", answer: notAvailable("Plugins are") },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/playground/run", answer: notAvailable("The extension playground is") },
    // Nakama's cloud rooms (seanime.app): none to be had; the guest's connection to a host on a PC is not touched here
    { area: "settings", method: "GET", endpoint: "/api/v1/nakama/room/available", answer: async () => false },
    { area: "settings", method: "POST", endpoint: "/api/v1/nakama/room/create", answer: notAvailable("Cloud rooms are") },
    { area: "settings", method: "POST", endpoint: "/api/v1/nakama/room/disconnect", answer: notAvailable("Cloud rooms are") },
    // Discord: Android has no Discord to tell, so telling it is done at once
    { area: "settings", method: "POST", endpoint: "/api/v1/discord/presence/manga", answer: async () => true },
    { area: "settings", method: "POST", endpoint: "/api/v1/discord/presence/cancel", answer: async () => true },
    // issue reports: written by the server from its own logs
    { area: "settings", method: "POST", endpoint: "/api/v1/report/issue", answer: notAvailable("Issue reports are") },
    { area: "settings", method: "GET", endpoint: "/api/v1/report/issue/download", answer: notAvailable("Issue reports are") },
    // phase 7f, custom sources: their media get numbers from the server, and their pages need it; none listed
    { area: "extensions", method: "POST", endpoint: "/api/v1/custom-source/provider/list/anime", answer: async () => ({ media: [], page: 1, totalPages: 0, total: 0 }) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/custom-source/provider/list/manga", answer: async () => ({ media: [], page: 1, totalPages: 0, total: 0 }) },
    // filler lists: read by the server from an outside website
    { area: "library", method: "POST", endpoint: "/api/v1/metadata-provider/filler", answer: notAvailable("Filler lists are") },
    { area: "library", method: "DELETE", endpoint: "/api/v1/metadata-provider/filler", answer: notAvailable("Filler lists are") },
    // a debrid download into a folder: the server waits for the service and fetches the files into the library
    { area: "debrid", method: "POST", endpoint: "/api/v1/debrid/torrents", answer: notAvailable("Debrid downloads into a folder are") },
    // tracking an external player: the server's playback manager follows it
    { area: "playback", method: "POST", endpoint: "/api/v1/playback-manager/manual-tracking/start", answer: notAvailable("Tracking an external player is") },
]
