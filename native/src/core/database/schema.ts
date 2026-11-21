// geschrieben nach: Plan „Eigener Kern" Stufe 1b (eigene Datenbank, eigenes Schema) und der Drizzle-Doku (sqlite-core); kein Server-Quelltext

import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/*
 * The core's own tables, as the queries see them. Only what a stage of the core needs is here; the tables are made by
 * the steps in migrations.ts, and database.test.ts keeps the two in line (same tables, same columns).
 *
 * Times are milliseconds since 1970. Values the app treats as one piece (a section of the settings, the look of the
 * app, the options of a home item) are kept as JSON text.
 */

/** Which steps of migrations.ts this database has taken */
export const schemaSteps = sqliteTable("schema_steps", {
    step: integer("step").primaryKey(),
    name: text("name").notNull(),
    appliedAt: integer("applied_at").notNull(),
})

/** The settings, one row per section ("library", "torrent", …). No rows: the first start has not happened yet. */
export const settingsSections = sqliteTable("settings_sections", {
    section: text("section").primaryKey(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** The look of the app the user chose. One row (id 1) once it was saved for the first time, none before. */
export const appearance = sqliteTable("appearance", {
    id: integer("id").primaryKey(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at").notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** The rows of the home screen in the user's order */
export const homeItems = sqliteTable("home_items", {
    position: integer("position").primaryKey(),
    itemId: text("item_id").notNull(),
    kind: text("kind").notNull(),
    schemaVersion: integer("schema_version").notNull().default(0),
    options: text("options", { mode: "json" }).$type<unknown>(),
})

/** The AniList account the app is signed in with. One row (id 1) or none. The token is not here: it lies in the device's secured storage. */
export const account = sqliteTable("account", {
    id: integer("id").primaryKey(),
    username: text("username").notNull(),
    /** What AniList told about the user, as the text it was stored as (JSON) */
    viewer: text("viewer"),
    createdAt: integer("created_at").notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** Where the user stopped watching, one row per anime (the newest episode watched counts) */
export const watchPositions = sqliteTable("watch_positions", {
    mediaId: integer("media_id").primaryKey(),
    kind: text("kind").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    positionSeconds: real("position_seconds").notNull(),
    durationSeconds: real("duration_seconds").notNull(),
    filepath: text("filepath").notNull(),
    addedAt: integer("added_at").notNull(),
    changedAt: integer("changed_at").notNull(),
    expiresAt: integer("expires_at"),
})

/**
 * A title on AniList (anime or manga), with the core's own number; AniList's number is a field beside it. `content` is
 * the title as the lists last read it, `details` the longer form of the details page. Both stay when AniList is down.
 */
export const anilistMedia = sqliteTable("anilist_media", {
    id: integer("id").primaryKey(),
    anilistId: integer("anilist_id").notNull().unique(),
    kind: text("kind").notNull(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>(),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    changedAt: integer("changed_at").notNull(),
})

/**
 * The user's list entries, as the last complete read of a list collection left them. `list` is the place of the list
 * in the collection (its name and status are kept with the collection's question in anilist_answers), `position` the
 * place of the entry in it. `content` is the entry without its title, which is `media`.
 */
export const anilistListEntries = sqliteTable("anilist_list_entries", {
    id: integer("id").primaryKey(),
    anilistId: integer("anilist_id").notNull(),
    media: integer("media").notNull().references(() => anilistMedia.id),
    kind: text("kind").notNull(),
    list: integer("list").notNull(),
    position: integer("position").notNull(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** The last answer to every other question asked of AniList (a search page, a studio, the statistics), by question */
export const anilistAnswers = sqliteTable("anilist_answers", {
    question: text("question").primaryKey(),
    answer: text("answer", { mode: "json" }).$type<unknown>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/**
 * Changes to the user's AniList lists that AniList has not taken yet (anilist/changes.ts), sent in the order of `id`.
 * One row per title: a later change of the same title is merged into its row. `account` is the user the change belongs
 * to; `change` holds the fields to send and what the entry was before the first unsent change.
 */
export const anilistChanges = sqliteTable("anilist_changes", {
    id: integer("id").primaryKey(),
    account: text("account").notNull(),
    mediaId: integer("media_id").notNull(),
    kind: text("kind").notNull(),
    action: text("action").notNull(),
    change: text("change", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    changedAt: integer("changed_at").notNull(),
}, table => [uniqueIndex("anilist_changes_title").on(table.kind, table.mediaId)])

/**
 * The last answer of the server to the few questions the app's first screens ask (start/start.ts), by address: shown
 * until the server is ready, replaced by every answer it gives
 */
export const serverAnswers = sqliteTable("server_answers", {
    question: text("question").primaryKey(),
    answer: text("answer", { mode: "json" }).$type<unknown>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/**
 * What the user set for an extension (its `userConfig` fields), one row per extension (docs/EIGENER-KERN.md §4l).
 * `origin` "server": taken over once from the server's file cache, `version`/`values` null when the server had nothing;
 * "core": saved by the core. The server's own files are never written.
 */
export const extensionUserConfigs = sqliteTable("extension_user_configs", {
    id: text("id").primaryKey(),
    version: integer("version"),
    values: text("values", { mode: "json" }).$type<Record<string, string>>(),
    origin: text("origin").notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** The limits of the extensions' sandboxes, one row (id 1) once they were set; without it the defaults hold (§4l) */
export const extensionSandboxSettings = sqliteTable("extension_sandbox_settings", {
    id: integer("id").primaryKey(),
    memoryMb: integer("memory_mb").notNull(),
    idleSeconds: integer("idle_seconds").notNull(),
    changedAt: integer("changed_at").notNull(),
})

/**
 * What an extension's `getSettings()` gave, for the code and the user's settings named by `code_key` (§4l, phase 3e-2).
 * The lists answer from here, so that they do not open a sandbox per extension the first time after the app started.
 */
export const extensionSettings = sqliteTable("extension_settings", {
    id: text("id").primaryKey(),
    codeKey: text("code_key").notNull(),
    settings: text("settings", { mode: "json" }).$type<{ value: unknown }>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/**
 * Which entry of an online-stream provider an anime is (§4m, phase 3f-1): chosen by hand (`origin` "core") or taken
 * once from the server's database (`origin` "server"). Without a row the core chooses by the titles each time.
 */
export const onlinestreamMappings = sqliteTable("onlinestream_mappings", {
    provider: text("provider").notNull(),
    mediaId: integer("media_id").notNull(),
    animeId: text("anime_id").notNull(),
    origin: text("origin").notNull(),
    changedAt: integer("changed_at").notNull(),
}, table => [uniqueIndex("onlinestream_mappings_anime").on(table.provider, table.mediaId)])

/**
 * Which entry of a manga provider a manga is (§4n, phase 4a-1): chosen by hand (`origin` "core") or taken once from the
 * server's database (`origin` "server"). Without a row the core chooses by the titles each time.
 */
export const mangaMappings = sqliteTable("manga_mappings", {
    provider: text("provider").notNull(),
    mediaId: integer("media_id").notNull(),
    mangaId: text("manga_id").notNull(),
    origin: text("origin").notNull(),
    changedAt: integer("changed_at").notNull(),
}, table => [uniqueIndex("manga_mappings_manga").on(table.provider, table.mediaId)])

/** The one-time move of the server's manga mappings (one row, id 1): any row, it has run */
export const mangaMappingMove = sqliteTable("manga_mapping_move", {
    id: integer("id").primaryKey(),
    count: integer("count").notNull(),
    movedAt: integer("moved_at").notNull(),
})

/**
 * The source and chapter filters the user chose for a manga (§4n, phase 4a-2): set in the core (`origin` "core") or
 * taken from the server (`origin` "server": the one-time move, or a finished source refresh of the server).
 */
export const mangaPreferences = sqliteTable("manga_preferences", {
    mediaId: integer("media_id").primaryKey(),
    provider: text("provider").notNull(),
    filters: text("filters", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    origin: text("origin").notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** The highest chapter number a provider had for a manga, kept over restarts (§4n, phase 4a-2) */
export const mangaChapterNumbers = sqliteTable("manga_chapter_numbers", {
    mediaId: integer("media_id").notNull(),
    provider: text("provider").notNull(),
    number: integer("number").notNull(),
    origin: text("origin").notNull(),
    changedAt: integer("changed_at").notNull(),
}, table => [uniqueIndex("manga_chapter_numbers_manga").on(table.mediaId, table.provider)])

/** What the manga area took from the server once (`part`: "preferences", "chapter-numbers", "refresh:<job>"): any row, it has run */
export const mangaMoves = sqliteTable("manga_moves", {
    part: text("part").primaryKey(),
    count: integer("count").notNull(),
    movedAt: integer("moved_at").notNull(),
})

/** The one-time move of the server's online-stream mappings (one row, id 1): any row, it has run */
export const onlinestreamMappingMove = sqliteTable("onlinestream_mapping_move", {
    id: integer("id").primaryKey(),
    count: integer("count").notNull(),
    movedAt: integer("moved_at").notNull(),
})

/**
 * The move of the server's data into this database (move/move.ts), one row per part. Any row: the move has run.
 * `leftovers` keeps what the server had stored and no table of the core has a place for yet, unchanged.
 */
export const moveParts = sqliteTable("move_parts", {
    part: text("part").primaryKey(),
    outcome: text("outcome").notNull(),
    count: integer("count").notNull(),
    detail: text("detail", { mode: "json" }).$type<{ extraFields: string[], unfitFields: string[], reason?: string }>().notNull(),
    leftovers: text("leftovers", { mode: "json" }).$type<Record<string, unknown>>(),
    movedAt: integer("moved_at").notNull(),
})

/**
 * The episodes saved for watching without a network and the ones on their way (§4o, phase 4b-B), one row each. `item`
 * is the episode as the screens get it; `source` says how its files are found (asked from the provider each time, or
 * the address the player had open); `tries` and `retry_at` belong to the tries after a failure.
 */
export const offlineItems = sqliteTable("offline_items", {
    id: text("id").primaryKey(),
    mediaId: integer("media_id").notNull(),
    queueOrder: integer("queue_order").notNull(),
    status: text("status").notNull(),
    item: text("item", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    source: text("source", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    tries: integer("tries").notNull(),
    retryAt: integer("retry_at").notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** The one-time take-over of the server's saved episodes (phase 4c, one row per part, "episodes"): any row, it has run */
export const offlineMoves = sqliteTable("offline_moves", {
    part: text("part").primaryKey(),
    count: integer("count").notNull(),
    movedAt: integer("moved_at").notNull(),
})

/** The settings of the downloads (one row, id 1): load only on Wi-Fi */
export const offlineSettings = sqliteTable("offline_settings", {
    id: integer("id").primaryKey(),
    wifiOnly: integer("wifi_only", { mode: "boolean" }).notNull(),
    changedAt: integer("changed_at").notNull(),
})

/**
 * The manga chapters saved on the device and the ones on their way (§4o, phase 4b-C2), one row each. `chapter` is the
 * chapter as the provider listed it, `folder` its folder under the manga folder, `pages` the files of its pages.
 */
export const mangaDownloads = sqliteTable("manga_downloads", {
    id: integer("id").primaryKey(),
    provider: text("provider").notNull(),
    mediaId: integer("media_id").notNull(),
    chapterId: text("chapter_id").notNull(),
    chapterNumber: text("chapter_number").notNull(),
    chapter: text("chapter", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    folder: text("folder").notNull(),
    pages: text("pages", { mode: "json" }).$type<{ index: number, file: string }[]>().notNull(),
    error: text("error").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    /** A chapter the server saved (phase 4c-2): `folder` lies under the server's manga folder, its files stay the server's */
    old: integer("old", { mode: "boolean" }).notNull().default(false),
}, table => [uniqueIndex("manga_downloads_chapter").on(table.provider, table.mediaId, table.chapterId)])

/**
 * The episode metadata of an anime (titles, pictures, air dates of its episodes, mappings to other databases) as the
 * public service last gave it (library/metadata.ts, phase 5a-1), one row per anime by its AniList number
 */
export const episodeMetadata = sqliteTable("episode_metadata", {
    anilistId: integer("anilist_id").primaryKey(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    fetchedAt: integer("fetched_at").notNull(),
})

/**
 * The anime whose missing episodes the user silenced (library/marks.ts, phase 5a-3), one row per anime by its AniList
 * number
 */
export const silencedAnime = sqliteTable("silenced_anime", {
    anilistId: integer("anilist_id").primaryKey(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
})

/**
 * The anime whose episode metadata is the one of another anime, with an offset for its specials (library/marks.ts,
 * phase 5a-3), one row per anime by its AniList number
 */
export const metadataParents = sqliteTable("metadata_parents", {
    id: integer("id").primaryKey(),
    mediaId: integer("media_id").notNull(),
    parentId: integer("parent_id").notNull(),
    specialOffset: integer("special_offset").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
}, table => [uniqueIndex("metadata_parents_media").on(table.mediaId)])

/**
 * The user's playlists (playback/playlists.ts, phase 5a-4), one row each: `episodes` are the playlist's episodes as the
 * screens send and get them (`Anime_PlaylistEpisode`), in their order
 */
export const playlists = sqliteTable("playlists", {
    dbId: integer("db_id").primaryKey(),
    name: text("name").notNull(),
    episodes: text("episodes", { mode: "json" }).$type<Record<string, unknown>[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
})

/** The one move of the server's playlists (playback/playlists.ts): any row means it has run, with its outcome */
export const playlistMove = sqliteTable("playlist_move", {
    id: integer("id").primaryKey(),
    outcome: text("outcome").notNull(),
    count: integer("count").notNull(),
    reason: text("reason"),
    movedAt: integer("moved_at").notNull(),
})

/**
 * The video files found in the user's library folders (library/local-files.ts, phase 5b-1), one row per file by its
 * path on the device: what its name says (`parsed`, `folders`), the anime it belongs to (0: none) and which episode
 */
export const localFiles = sqliteTable("local_files", {
    path: text("path").primaryKey(),
    name: text("name").notNull(),
    mediaId: integer("media_id").notNull(),
    episode: integer("episode").notNull(),
    anidbEpisode: text("anidb_episode").notNull(),
    type: text("type").notNull(),
    locked: integer("locked", { mode: "boolean" }).notNull(),
    ignored: integer("ignored", { mode: "boolean" }).notNull(),
    size: integer("size").notNull(),
    parsed: text("parsed", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    folders: text("folders", { mode: "json" }).$type<Record<string, unknown>[]>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** What each scan found (library/scan.ts, phase 5b-1): `content` is the summary as the screens read it */
export const scanSummaries = sqliteTable("scan_summaries", {
    id: integer("id").primaryKey(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at").notNull(),
})

/**
 * What the torrent area keeps (torrent/torrent.ts, phase 6b-2): `key` is "settings" for the torrent stream settings or
 * "batch:<AniList id>" for the batch an episode of that anime was last streamed from; `content` in the screens' form
 */
export const torrentKept = sqliteTable("torrent_kept", {
    key: text("key").primaryKey(),
    content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    changedAt: integer("changed_at").notNull(),
})

/** A title of another source (TVmaze, negative id), kept on the device only: its progress and whether it is in "My shows" */
export const ownShows = sqliteTable("own_shows", {
    mediaId: integer("media_id").primaryKey(),
    progress: integer("progress").notNull(),
    listed: integer("listed").notNull(),
    changedAt: integer("changed_at").notNull(),
})
