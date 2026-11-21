// geschrieben nach: App-Typen Anime_LocalFile/Anime_LocalFileMetadata/Anime_LocalFileParsedData/Anime_EntryLibraryData/Anime_LibraryCollection/Anime_UnknownGroup/Anime_UnmatchedGroup (src/api/generated/types.ts), Endpunkt-Beschreibungen in endpoint.types.ts (UpdateLocalFiles, UpdateLocalFileData, DeleteLocalFiles, LocalFileBulkAction, AnimeEntryBulkAction, AnimeEntryManualMatch), App-Code library-phone.tsx, anime-entry-phone-menu.tsx, anime-entry-page.tsx, library-explorer-phone.tsx (Aktionen lock/unlock/ignore/unignore/unmatch/toggle-lock), Form der Aufzeichnung library.recorded.json/home.recorded.json (libraryData, localFiles), eigenem $habari (extensions/helpers/prelude/habari.js, §4j) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { eq, inArray } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { anilistMedia, localFiles } from "../database/schema"
import { CoreError } from "../errors"
import { parse } from "../extensions/helpers/prelude/habari"
import type { CoreEnvironment, CoreRequest } from "../registry"
// used inside deleteLocalFiles only (scan.ts imports this file too)
import { libraryFolders } from "./scan"

/*
 * The user's own video files (area `library`, phase 5b-1, docs/EIGENER-KERN.md §4p): one row per file in `local_files`,
 * filled by the scan (scan.ts). Here: what a file's name says, which anime it belongs to (own rule below), the forms
 * the screens read (`Anime_LocalFile`, `libraryData`, the episodes of an anime's page) and the changes the screens make
 * (lock, ignore, unmatch, set the episode, match by hand). Deleting files removes them from the device (4.3.1).
 *
 * Matching rule (own): a title is made plain (accents off, lower case, "&" → "and", everything but letters and digits
 * a space) and a season sign is taken out of it ("season 2", "2nd season", "s2", a last single digit 2–9). The file's
 * title (else the title of its nearest folder) is held against every title of every candidate (romaji, English,
 * native, the one the user prefers, synonyms): the same plain title scores 1, else the Dice coefficient of the letter
 * pairs. A season above 1 adds 0.2 to a candidate with the same season and takes 0.2 from every other; without a
 * season, a candidate with a season of 2 or more loses 0.2. The best candidate counts from 0.8 on; on a tie the one
 * first in the candidates (the user's lists come first) wins.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "database" | "now" | "pause">
export type LocalFileRow = typeof localFiles.$inferSelect

export const VIDEO_EXTENSIONS = new Set(["mkv", "mp4", "avi", "webm", "m4v", "mov", "wmv", "flv", "ts", "m2ts", "mpg", "mpeg", "ogm", "rmvb", "3gp"])
export const MATCH_AT = 0.8

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)

type Habari = {
    title?: string, release_group?: string, season_number?: string[], part_number?: string[], episode_number?: string[],
    episode_title?: string, year?: string, anime_type?: string[]
}

/** What a file's or folder's name says, in the screens' form (`Anime_LocalFileParsedData`), and the kind words in it */
export function readName(name: string): { parsed: Json, kinds: string[] } {
    const found = parse(name) as Habari
    const ranged = (list: string[] | undefined) => (list && list.length > 1 ? list : undefined)
    const parsed = JSON.parse(JSON.stringify({
        original: name,
        title: found.title || undefined,
        releaseGroup: found.release_group || undefined,
        season: found.season_number?.[0],
        seasonRange: ranged(found.season_number),
        part: found.part_number?.[0],
        partRange: ranged(found.part_number),
        episode: found.episode_number?.[0],
        episodeRange: ranged(found.episode_number),
        episodeTitle: found.episode_title || undefined,
        year: found.year || undefined,
    })) as Json
    return { parsed, kinds: (found.anime_type ?? []).map(kind => kind.toLowerCase()) }
}

/** Which episode a file is: main, special (`S1`) or opening/ending (`OP1`, `ED1`) */
export function fileMetadataOf(parsed: Json, kinds: string[], media: Json | null): { episode: number, anidbEpisode: string, type: string } {
    const number = Number.parseInt(String(parsed.episode ?? ""), 10)
    const n = Number.isInteger(number) && number > 0 ? number : 1
    if (kinds.some(kind => kind === "op" || kind === "ncop")) return { episode: n, anidbEpisode: `OP${n}`, type: "nc" }
    if (kinds.some(kind => kind === "ed" || kind === "nced")) return { episode: n, anidbEpisode: `ED${n}`, type: "nc" }
    const series = !media || !["MOVIE", "OVA", "SPECIAL"].includes(String(media.format))
    if (series && kinds.some(kind => ["sp", "specials", "ova", "ovas", "oad", "oads", "oav", "oavs"].includes(kind))) {
        return { episode: n, anidbEpisode: `S${n}`, type: "special" }
    }
    if (Number.isInteger(number) && number > 0) return { episode: number, anidbEpisode: String(number), type: "main" }
    // no number: a film or a single episode is episode 1; one file of a series without a number is a special
    if (!media || whole(media.episodes) <= 1) return { episode: 1, anidbEpisode: "1", type: "main" }
    return { episode: 1, anidbEpisode: "S1", type: "special" }
}

/** A title made plain for comparing (rule above) */
export function plainTitle(text: string): string {
    return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ")
        .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, " ").trim()
}

const SEASON_SIGNS = [/\b(?:season|saison|staffel)\s*(\d+)\b/, /\b(\d+)(?:st|nd|rd|th)\s+season\b/, /\bs(\d{1,2})\b/, /\s([2-9])$/]

/** A plain title without its season sign, and that season (0: none) */
export function seasonOf(plain: string): { base: string, season: number } {
    for (const sign of SEASON_SIGNS) {
        const found = sign.exec(plain)
        if (found) return { base: (plain.slice(0, found.index) + plain.slice(found.index + found[0].length)).replace(/\s+/g, " ").trim(), season: Number(found[1]) }
    }
    return { base: plain, season: 0 }
}

function pairs(text: string): string[] {
    const tight = text.replace(/ /g, "")
    const list: string[] = []
    for (let at = 0; at < tight.length - 1; at++) list.push(tight.slice(at, at + 2))
    return list
}

function dice(a: string, b: string): number {
    const left = pairs(a)
    const right = pairs(b)
    if (!left.length || !right.length) return 0
    const counts = new Map<string, number>()
    for (const pair of left) counts.set(pair, (counts.get(pair) ?? 0) + 1)
    let same = 0
    for (const pair of right) {
        const count = counts.get(pair) ?? 0
        if (count > 0) {
            same++
            counts.set(pair, count - 1)
        }
    }
    return (2 * same) / (left.length + right.length)
}

/** How well a file's title fits one title of a candidate (rule above) */
export function titleScore(fileTitle: string, fileSeason: number, candidateTitle: string): number {
    const file = seasonOf(plainTitle(fileTitle))
    const candidate = seasonOf(plainTitle(candidateTitle))
    if (!file.base || !candidate.base) return 0
    const base = file.base === candidate.base ? 1 : dice(file.base, candidate.base)
    const season = fileSeason || file.season
    if (season >= 2) return base + (candidate.season === season ? 0.2 : -0.2)
    return base - (candidate.season >= 2 ? 0.2 : 0)
}

function titlesOf(media: Json): string[] {
    const title = isRecord(media.title) ? media.title : {}
    return [title.romaji, title.english, title.native, title.userPreferred, ...(Array.isArray(media.synonyms) ? media.synonyms : [])]
        .filter((text): text is string => typeof text === "string" && text.trim() !== "")
}

/** The candidate that fits a file's title best from MATCH_AT on, else null; `near` gets the others worth showing */
export function bestMatch(fileTitle: string, season: number, candidates: Json[], near?: Json[]): { media: Json, score: number } | null {
    let best: { media: Json, score: number } | null = null
    for (const media of candidates) {
        const score = Math.max(0, ...titlesOf(media).map(title => titleScore(fileTitle, season, title)))
        if (near && score >= 0.5 && score < MATCH_AT && near.length < 3) near.push(media)
        if (!best || score > best.score) best = { media, score }
    }
    return best && best.score >= MATCH_AT ? best : null
}

/** A row as the screens read a file (`Anime_LocalFile`) */
export function asLocalFile(row: LocalFileRow): Json {
    return {
        path: row.path,
        name: row.name,
        parsedInfo: row.parsed,
        parsedFolderInfo: row.folders,
        metadata: { episode: row.episode, aniDBEpisode: row.anidbEpisode, type: row.type },
        locked: row.locked,
        ignored: row.ignored,
        mediaId: row.mediaId,
    }
}

export async function allFiles(database: CoreDatabase): Promise<LocalFileRow[]> {
    const rows = await inOrder(database, () => database.select().from(localFiles))
    return rows.sort((a, b) => a.path.localeCompare(b.path))
}

/** The files of one anime that count (not ignored), main episodes first by number */
export async function filesOf(database: CoreDatabase, mediaId: number): Promise<LocalFileRow[]> {
    const rows = await inOrder(database, () => database.select().from(localFiles).where(eq(localFiles.mediaId, mediaId)))
    const order = (row: LocalFileRow) => (row.type === "main" ? 0 : row.type === "special" ? 1 : 2)
    return rows.filter(row => !row.ignored).sort((a, b) => order(a) - order(b) || a.episode - b.episode || a.path.localeCompare(b.path))
}

function folderOf(path: string): string {
    const at = path.lastIndexOf("/")
    return at > 0 ? path.slice(0, at) : path
}

/** `libraryData` of an anime with files (`Anime_EntryLibraryData`) */
export function libraryDataOf(files: LocalFileRow[], progress: number): Json {
    const main = files.filter(file => file.type === "main")
    let shared = files.length ? folderOf(files[0].path) : ""
    for (const file of files) while (shared && !(file.path.startsWith(shared + "/"))) shared = shared.includes("/") ? shared.slice(0, shared.lastIndexOf("/")) : ""
    return {
        allFilesLocked: files.length > 0 && files.every(file => file.locked),
        sharedPath: shared,
        unwatchedCount: main.filter(file => file.episode > progress).length,
        mainFileCount: main.length,
    }
}

/**
 * A file as an episode of an anime's page: a main episode takes what the core knows of that number (`known`, built by
 * library.ts from the metadata), a special or opening/ending stands alone
 */
export function episodeOfFile(file: LocalFileRow, media: Json, known: Json[]): Json {
    const fileMetadata = { episode: file.episode, aniDBEpisode: file.anidbEpisode, type: file.type }
    const localFile = asLocalFile(file)
    const same = file.type === "main" ? known.find(episode => episode.episodeNumber === file.episode) : undefined
    if (same) return { ...same, localFile, fileMetadata }
    return {
        type: file.type,
        displayTitle: file.type === "main" ? `Episode ${file.episode}` : file.type === "special" ? `Special ${file.episode}` : file.anidbEpisode,
        episodeTitle: "",
        episodeNumber: file.episode,
        aniDBEpisode: file.anidbEpisode,
        absoluteEpisodeNumber: file.episode,
        progressNumber: file.type === "main" ? file.episode : 0,
        localFile,
        isDownloaded: false,
        episodeMetadata: { hasImage: false },
        fileMetadata,
        isInvalid: false,
        baseAnime: media,
        _isNakamaEpisode: false,
    }
}

/** The title the lists keep for an anime, or null */
export async function listMedia(database: CoreDatabase, mediaId: number): Promise<Json | null> {
    const rows = await inOrder(database, () => database.select({ content: anilistMedia.content }).from(anilistMedia)
        .where(eq(anilistMedia.anilistId, mediaId)))
    const content = rows.find(row => isRecord(row.content))?.content
    return isRecord(content) ? content : null
}

function pathsOf(body: unknown): string[] {
    const paths = isRecord(body) ? body.paths : undefined
    if (!Array.isArray(paths) || !paths.every(path => typeof path === "string")) throw new CoreError("paths must be a list of texts", 400)
    return paths as string[]
}

async function change(environment: Environment, paths: string[], fields: (row: LocalFileRow) => Partial<LocalFileRow>): Promise<void> {
    const database = await environment.database()
    for (let at = 0; at < paths.length; at += 50) {
        if (at > 0) await environment.pause("library file changes")
        const rows = await inOrder(database, () => database.select().from(localFiles).where(inArray(localFiles.path, paths.slice(at, at + 50))))
        for (const row of rows) {
            await inOrder(database, () => database.update(localFiles).set({ ...fields(row), changedAt: environment.now() }).where(eq(localFiles.path, row.path)))
        }
    }
}

/** The file's episode again from its name, for an anime (manual match, unmatch) */
async function rederived(database: CoreDatabase, row: LocalFileRow, mediaId: number): Promise<Partial<LocalFileRow>> {
    const { parsed, kinds } = readName(row.name)
    const meta = fileMetadataOf(parsed, kinds, mediaId ? await listMedia(database, mediaId) : null)
    return { mediaId, episode: meta.episode, anidbEpisode: meta.anidbEpisode, type: meta.type }
}

const ACTIONS: Record<string, (row: LocalFileRow) => Partial<LocalFileRow>> = {
    lock: () => ({ locked: true }),
    unlock: () => ({ locked: false }),
    ignore: () => ({ ignored: true, locked: false }),
    unignore: () => ({ ignored: false }),
    unmatch: () => ({ mediaId: 0, locked: false }),
}

/** PATCH /api/v1/library/local-files: an action on the files with these paths → true */
export async function updateLocalFiles(request: CoreRequest, environment: Environment): Promise<boolean> {
    const paths = pathsOf(request.body)
    const action = isRecord(request.body) ? String(request.body.action ?? "") : ""
    const fields = ACTIONS[action]
    if (!fields) throw new CoreError(`unknown action: ${action}`, 400)
    await change(environment, paths, fields)
    return true
}

/** PATCH /api/v1/library/local-file: one file's episode, anime and marks → all files */
export async function updateLocalFileData(request: CoreRequest, environment: Environment): Promise<Json[]> {
    const body = isRecord(request.body) ? request.body : {}
    if (typeof body.path !== "string") throw new CoreError("path must be a text", 400)
    const metadata = isRecord(body.metadata) ? body.metadata : null
    const type = metadata && ["main", "special", "nc"].includes(String(metadata.type)) ? String(metadata.type) : null
    await change(environment, [body.path], () => ({
        ...(typeof body.locked === "boolean" ? { locked: body.locked } : {}),
        ...(typeof body.ignored === "boolean" ? { ignored: body.ignored } : {}),
        ...(typeof body.mediaId === "number" && Number.isInteger(body.mediaId) && body.mediaId >= 0 ? { mediaId: body.mediaId } : {}),
        ...(metadata && Number.isInteger(metadata.episode) && (metadata.episode as number) >= 0 ? { episode: metadata.episode as number } : {}),
        ...(metadata && typeof metadata.aniDBEpisode === "string" ? { anidbEpisode: metadata.aniDBEpisode } : {}),
        ...(type ? { type } : {}),
    }))
    return (await allFiles(await environment.database())).map(asLocalFile)
}

/** A file of the library: inside one of its folders, not the folder itself, no step up (`..`) in its path */
export function insideLibrary(path: string, roots: string[]): boolean {
    if (path.split("/").some(part => part === ".." || part === ".")) return false
    return roots.some(root => root !== "" && path.startsWith(`${root}/`) && path.length > root.length + 1)
}

/**
 * DELETE /api/v1/library/local-files: the files are deleted from the device, then their entries go (4.3.1; before, only
 * the entries went and the next scan brought the files back, while the screens said "deleted from this device"). Only a
 * file the library knows (a row of `local_files`) inside the library's folders is touched, never a folder. A file that
 * cannot be deleted keeps its entry, and the answer is an error naming how many → the files left.
 */
export async function deleteLocalFiles(request: CoreRequest, environment: CoreEnvironment): Promise<Json[]> {
    const paths = pathsOf(request.body)
    const database = await environment.database()
    if (paths.length === 0) return (await allFiles(database)).map(asLocalFile)
    if (!environment.localFolders) throw new CoreError("the device's folders are not available here", 500)
    const device = await environment.localFolders()
    const roots = await libraryFolders(environment)
    const known = new Set((await inOrder(database, () => database.select({ path: localFiles.path }).from(localFiles).where(inArray(localFiles.path, paths)))).map(row => row.path))
    const gone: string[] = []
    let failed = 0
    for (const path of paths) {
        if (!known.has(path) || !insideLibrary(path, roots)) {
            failed++
            continue
        }
        await environment.pause("library file removal")
        const removed = await device.removeFile(path).catch(() => false)
        if (removed) gone.push(path)
        else failed++
    }
    for (let at = 0; at < gone.length; at += 50) {
        if (at > 0) await environment.pause("library file removal")
        await inOrder(database, () => database.delete(localFiles).where(inArray(localFiles.path, gone.slice(at, at + 50))))
    }
    if (failed > 0) throw new CoreError(failed === 1 ? "1 file could not be deleted" : `${failed} files could not be deleted`, 500)
    return (await allFiles(database)).map(asLocalFile)
}

/** POST /api/v1/library/local-files: lock or unlock every file that belongs to an anime → all files */
export async function bulkLocalFiles(request: CoreRequest, environment: Environment): Promise<Json[]> {
    const action = isRecord(request.body) ? String(request.body.action ?? "") : ""
    if (action !== "lock" && action !== "unlock") throw new CoreError(`unknown action: ${action}`, 400)
    const database = await environment.database()
    const matched = (await allFiles(database)).filter(row => row.mediaId > 0 && !row.ignored).map(row => row.path)
    await change(environment, matched, ACTIONS[action])
    return (await allFiles(database)).map(asLocalFile)
}

/** PATCH /api/v1/library/anime-entry/bulk-action: `toggle-lock` or `unmatch` for the files of one anime → all files */
export async function entryBulkAction(request: CoreRequest, environment: Environment): Promise<Json[]> {
    const body = isRecord(request.body) ? request.body : {}
    const mediaId = whole(body.mediaId)
    if (!mediaId) throw new CoreError("invalid media id", 400)
    const database = await environment.database()
    const files = await filesOf(database, mediaId)
    const paths = files.map(file => file.path)
    if (body.action === "toggle-lock") {
        const lock = !files.every(file => file.locked)
        await change(environment, paths, () => ({ locked: lock }))
    }
    else if (body.action === "unmatch") await change(environment, paths, ACTIONS.unmatch)
    else throw new CoreError(`unknown action: ${String(body.action)}`, 400)
    return (await allFiles(database)).map(asLocalFile)
}

/** POST /api/v1/library/anime-entry/manual-match: these files belong to this anime, episodes again from their names → all files */
export async function manualMatch(request: CoreRequest, environment: Environment): Promise<Json[]> {
    const paths = pathsOf(request.body)
    const mediaId = isRecord(request.body) ? whole(request.body.mediaId) : 0
    if (!mediaId) throw new CoreError("invalid media id", 400)
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(localFiles).where(inArray(localFiles.path, paths)))
    for (const row of rows) {
        const fields = await rederived(database, row, mediaId)
        await inOrder(database, () => database.update(localFiles).set({ ...fields, locked: true, ignored: false, changedAt: environment.now() })
            .where(eq(localFiles.path, row.path)))
    }
    return (await allFiles(database)).map(asLocalFile)
}
