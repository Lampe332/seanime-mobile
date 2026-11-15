// geschrieben nach: docs/EIGENER-KERN.md §4p (Phase 5c-3, Speicher am S22) und der Doku von Hermes (HermesInternal.getInstrumentedStats) und TanStack Query (QueryCache.getAll); kein Server-Quelltext
import { openSandboxCount } from "@/api/client/core-extensions"
import { torrentLoaded } from "@/api/client/core-torrent"
import type { QueryClient } from "@tanstack/react-query"

/*
 * Test link core?memory=report (test and scratch app only): one log line with what the app's JS side holds, to tell
 * the memory with and without the server apart (dumpsys meminfo shows only the process' categories).
 */

const MB = 1024 * 1024

function megabytes(bytes: number | undefined): string {
    return bytes === undefined ? "?" : (bytes / MB).toFixed(1)
}

/** The read answers kept by the screens, as JSON text length per first key part, largest first */
export function queryCacheSizes(queries: { queryKey: readonly unknown[], state: { data: unknown } }[]): { count: number, bytes: number, largest: [string, number][] } {
    const byKey = new Map<string, number>()
    let bytes = 0
    for (const query of queries) {
        let length = 0
        try {
            length = JSON.stringify(query.state.data ?? null)?.length ?? 0
        }
        catch {
            length = 0
        }
        bytes += length
        const key = String(query.queryKey[0] ?? "?")
        byKey.set(key, (byKey.get(key) ?? 0) + length)
    }
    const largest = [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return { count: queries.length, bytes, largest }
}

export async function reportCoreMemory(queryClient: QueryClient): Promise<void> {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal
    const stats = hermes?.getInstrumentedStats?.() ?? {}
    const cache = queryCacheSizes(queryClient.getQueryCache().getAll())
    const largest = cache.largest.map(([key, length]) => `${key} ${megabytes(length)}`).join(", ")
    console.log(`[Core] info memory: hermes heap ${megabytes(stats.js_heapSize)} MB, allocated ${megabytes(stats.js_allocatedBytes)} MB, external ${megabytes(stats.js_externalBytes)} MB, collections ${stats.js_numGCs ?? "?"}; read answers ${cache.count}, ${megabytes(cache.bytes)} MB as JSON (largest: ${largest || "none"}); extension sandboxes open ${openSandboxCount()}; torrent module ${torrentLoaded() ? "loaded" : "not loaded"}`)
}
