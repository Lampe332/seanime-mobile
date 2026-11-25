// geschrieben nach: Plan „Eigener Kern" Stufe 1b (sauberer Migrations-Weg für spätere Stufen) und der SQLite-Doku; kein Server-Quelltext

/*
 * How the database gets its tables, and how it changes with later stages: a list of steps, each taken once, in order,
 * and written down in the table schema_steps.
 *
 * Rules:
 * - A step that has shipped is never edited. A change to the schema is a new step at the end of the list.
 * - Every step is taken inside one transaction: it is either there completely or not at all.
 * - A database that knows a step this app does not know comes from a newer app; it is refused, not touched.
 */

/** Runs one statement; "all" returns the rows as lists of values. What the app and the tests hand the core. */
export type SqlDriver = (sql: string, params: unknown[], method: "run" | "all" | "values" | "get") => Promise<{ rows: unknown[] }>

export type SchemaStep = {
    step: number
    name: string
    statements: string[]
}

export const SCHEMA_STEPS: SchemaStep[] = [
    {
        step: 1,
        name: "settings, appearance, home items",
        statements: [
            `CREATE TABLE settings_sections (
                section TEXT PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE appearance (
                id INTEGER PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE home_items (
                position INTEGER PRIMARY KEY NOT NULL,
                item_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 0,
                options TEXT
            )`,
        ],
    },
    {
        step: 2,
        name: "account, watch positions, move of the server's data",
        statements: [
            `CREATE TABLE account (
                id INTEGER PRIMARY KEY NOT NULL,
                username TEXT NOT NULL,
                viewer TEXT,
                created_at INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE watch_positions (
                media_id INTEGER PRIMARY KEY NOT NULL,
                kind TEXT NOT NULL,
                episode_number INTEGER NOT NULL,
                position_seconds REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                filepath TEXT NOT NULL,
                added_at INTEGER NOT NULL,
                changed_at INTEGER NOT NULL,
                expires_at INTEGER
            )`,
            `CREATE TABLE move_parts (
                part TEXT PRIMARY KEY NOT NULL,
                outcome TEXT NOT NULL,
                count INTEGER NOT NULL,
                detail TEXT NOT NULL,
                leftovers TEXT,
                moved_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 3,
        name: "AniList media, list entries and answers kept for when AniList cannot be reached",
        statements: [
            `CREATE TABLE anilist_media (
                id INTEGER PRIMARY KEY NOT NULL,
                anilist_id INTEGER NOT NULL UNIQUE,
                kind TEXT NOT NULL,
                content TEXT,
                details TEXT,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE anilist_list_entries (
                id INTEGER PRIMARY KEY NOT NULL,
                anilist_id INTEGER NOT NULL,
                media INTEGER NOT NULL REFERENCES anilist_media(id),
                kind TEXT NOT NULL,
                list INTEGER NOT NULL,
                position INTEGER NOT NULL,
                content TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE INDEX anilist_list_entries_kind ON anilist_list_entries (kind, list, position)",
            `CREATE TABLE anilist_answers (
                question TEXT PRIMARY KEY NOT NULL,
                answer TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 4,
        name: "the server's last answers, shown at the start until it is ready",
        statements: [
            `CREATE TABLE server_answers (
                question TEXT PRIMARY KEY NOT NULL,
                answer TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 5,
        name: "changes to the AniList lists that wait to be sent",
        statements: [
            `CREATE TABLE anilist_changes (
                id INTEGER PRIMARY KEY NOT NULL,
                account TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                action TEXT NOT NULL,
                change TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX anilist_changes_title ON anilist_changes (kind, media_id)",
        ],
    },
    {
        step: 6,
        name: "settings of extensions and of their sandboxes",
        statements: [
            `CREATE TABLE extension_user_configs (
                id TEXT PRIMARY KEY NOT NULL,
                version INTEGER,
                "values" TEXT,
                origin TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE extension_sandbox_settings (
                id INTEGER PRIMARY KEY NOT NULL,
                memory_mb INTEGER NOT NULL,
                idle_seconds INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 7,
        name: "what the extensions' getSettings() gave, by code",
        statements: [
            `CREATE TABLE extension_settings (
                id TEXT PRIMARY KEY NOT NULL,
                code_key TEXT NOT NULL,
                settings TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 8,
        name: "online stream: which entry of a provider an anime is, and the move of the server's ones",
        statements: [
            `CREATE TABLE onlinestream_mappings (
                provider TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                anime_id TEXT NOT NULL,
                origin TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX onlinestream_mappings_anime ON onlinestream_mappings (provider, media_id)",
            `CREATE TABLE onlinestream_mapping_move (
                id INTEGER PRIMARY KEY NOT NULL,
                count INTEGER NOT NULL,
                moved_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 9,
        name: "manga: which entry of a provider a manga is, and the move of the server's ones",
        statements: [
            `CREATE TABLE manga_mappings (
                provider TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                manga_id TEXT NOT NULL,
                origin TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX manga_mappings_manga ON manga_mappings (provider, media_id)",
            `CREATE TABLE manga_mapping_move (
                id INTEGER PRIMARY KEY NOT NULL,
                count INTEGER NOT NULL,
                moved_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 10,
        name: "manga: the user's source and filters per manga, the highest chapter numbers, what was taken from the server",
        statements: [
            `CREATE TABLE manga_preferences (
                media_id INTEGER PRIMARY KEY NOT NULL,
                provider TEXT NOT NULL,
                filters TEXT NOT NULL,
                origin TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE manga_chapter_numbers (
                media_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                number INTEGER NOT NULL,
                origin TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX manga_chapter_numbers_manga ON manga_chapter_numbers (media_id, provider)",
            `CREATE TABLE manga_moves (
                part TEXT PRIMARY KEY NOT NULL,
                count INTEGER NOT NULL,
                moved_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 11,
        name: "offline: the saved episodes and the ones on their way, the settings of the downloads",
        statements: [
            `CREATE TABLE offline_items (
                id TEXT PRIMARY KEY NOT NULL,
                media_id INTEGER NOT NULL,
                queue_order INTEGER NOT NULL,
                status TEXT NOT NULL,
                item TEXT NOT NULL,
                source TEXT NOT NULL,
                tries INTEGER NOT NULL,
                retry_at INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            `CREATE TABLE offline_settings (
                id INTEGER PRIMARY KEY NOT NULL,
                wifi_only INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 12,
        name: "manga: the saved chapters and the ones on their way",
        statements: [
            `CREATE TABLE manga_downloads (
                id INTEGER PRIMARY KEY NOT NULL,
                provider TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                chapter_id TEXT NOT NULL,
                chapter_number TEXT NOT NULL,
                chapter TEXT NOT NULL,
                status TEXT NOT NULL,
                folder TEXT NOT NULL,
                pages TEXT NOT NULL,
                error TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX manga_downloads_chapter ON manga_downloads (provider, media_id, chapter_id)",
        ],
    },
    {
        step: 13,
        name: "offline: the take-over of the server's saved episodes, once",
        statements: [
            "CREATE TABLE offline_moves (part TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, moved_at INTEGER NOT NULL)",
        ],
    },
    {
        step: 14,
        name: "manga: chapters the server saved, read from its folder",
        statements: [
            "ALTER TABLE manga_downloads ADD COLUMN old INTEGER NOT NULL DEFAULT 0",
        ],
    },
    {
        step: 15,
        name: "library: episode metadata of a public service, last state per anime",
        statements: [
            `CREATE TABLE episode_metadata (
                anilist_id INTEGER PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 16,
        name: "library: silenced anime and parents of episode metadata",
        statements: [
            `CREATE TABLE silenced_anime (
                anilist_id INTEGER PRIMARY KEY NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )`,
            `CREATE TABLE metadata_parents (
                id INTEGER PRIMARY KEY NOT NULL,
                media_id INTEGER NOT NULL,
                parent_id INTEGER NOT NULL,
                special_offset INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX metadata_parents_media ON metadata_parents (media_id)",
        ],
    },
    {
        step: 17,
        name: "playback: playlists and their move from the server",
        statements: [
            `CREATE TABLE playlists (
                db_id INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                episodes TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )`,
            `CREATE TABLE playlist_move (
                id INTEGER PRIMARY KEY NOT NULL,
                outcome TEXT NOT NULL,
                count INTEGER NOT NULL,
                reason TEXT,
                moved_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 18,
        name: "library: the user's own video files and the summaries of the scans",
        statements: [
            `CREATE TABLE local_files (
                path TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                episode INTEGER NOT NULL,
                anidb_episode TEXT NOT NULL,
                type TEXT NOT NULL,
                locked INTEGER NOT NULL,
                ignored INTEGER NOT NULL,
                size INTEGER NOT NULL,
                parsed TEXT NOT NULL,
                folders TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE INDEX local_files_media ON local_files (media_id)",
            `CREATE TABLE scan_summaries (
                id INTEGER PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 19,
        name: "torrent: the torrent stream settings and the batch last streamed from, per anime",
        statements: [
            `CREATE TABLE torrent_kept (
                key TEXT PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 20,
        name: "other sources: progress and My shows of TVmaze titles, on the device only",
        statements: [
            `CREATE TABLE own_shows (
                media_id INTEGER PRIMARY KEY NOT NULL,
                progress INTEGER NOT NULL,
                listed INTEGER NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
        ],
    },
    {
        step: 21,
        name: "media server: its series as last read, and the titles given to them by hand",
        statements: [
            `CREATE TABLE mediaserver_series (
                server_id TEXT NOT NULL,
                series_id TEXT NOT NULL,
                content TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX mediaserver_series_item ON mediaserver_series (server_id, series_id)",
            `CREATE TABLE mediaserver_mappings (
                server_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                episode_offset INTEGER NOT NULL,
                origin TEXT NOT NULL,
                changed_at INTEGER NOT NULL
            )`,
            "CREATE UNIQUE INDEX mediaserver_mappings_item ON mediaserver_mappings (server_id, item_id)",
        ],
    },
]

/** Takes every step the database has not taken yet. Returns the numbers of the steps taken now. */
export async function bringUpToDate(driver: SqlDriver, now: number, steps: SchemaStep[] = SCHEMA_STEPS): Promise<number[]> {
    await driver(
        "CREATE TABLE IF NOT EXISTS schema_steps (step INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
        [],
        "run",
    )
    const taken = new Set((await driver("SELECT step FROM schema_steps", [], "all")).rows.map(row => Number((row as unknown[])[0])))
    const known = new Set(steps.map(step => step.step))
    const unknown = [...taken].filter(step => !known.has(step))
    if (unknown.length > 0) throw new Error(`the database was written by a newer app (unknown schema step ${unknown.join(", ")})`)

    const takenNow: number[] = []
    for (const step of [...steps].sort((a, b) => a.step - b.step)) {
        if (taken.has(step.step)) continue
        await driver("BEGIN IMMEDIATE", [], "run")
        try {
            for (const statement of step.statements) await driver(statement, [], "run")
            await driver("INSERT INTO schema_steps (step, name, applied_at) VALUES (?, ?, ?)", [step.step, step.name, now], "run")
            await driver("COMMIT", [], "run")
        }
        catch (error) {
            await driver("ROLLBACK", [], "run")
            throw error
        }
        takenNow.push(step.step)
    }
    return takenNow
}
