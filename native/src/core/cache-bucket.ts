// geschrieben nach: der Adresse FILECACHE.RemoveFileCacheBucket in src/api/generated/endpoints.ts (DELETE /api/v1/filecache/bucket, Feld `bucket`, Antwort true) und dem, was der Kern selbst behält (manga/manga.ts, streams/onlinestream.ts); kein Server-Quelltext
import { CoreError } from "./errors"
import { forgetMangaCache } from "./manga/manga"
import { forgetStreamCache } from "./streams/onlinestream"

/**
 * DELETE /api/v1/filecache/bucket (Settings → Logs & cache): empties what the core keeps of the sources, the manga
 * bucket (chapter lists and pages) or the online stream bucket (episode lists and stream links), for every entry.
 */
export async function removeCacheBucket(body: unknown): Promise<true> {
    const bucket = typeof body === "object" && body !== null ? (body as { bucket?: unknown }).bucket : undefined
    if (bucket === "manga") forgetMangaCache()
    else if (bucket === "onlinestream") forgetStreamCache()
    else throw new CoreError(`unknown cache bucket: ${String(bucket)}`, 400)
    return true
}
