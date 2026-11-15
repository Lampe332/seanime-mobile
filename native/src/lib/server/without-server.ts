// geschrieben nach: docs/EIGENER-KERN.md §4p (Phase 5c-1: die App ohne ihren Server) und dem App-Code in native/src (Adressen, die direkt zum Server gingen); kein Server-Quelltext

/*
 * Addresses on the app's own server (files, pictures, subtitles, logs) while the app runs without it (phase 5c-1, test
 * and scratch app only): there is nothing behind them, so they are left out or fail at once with these words.
 */

/** The words every failure carries while the app runs without its server */
export const NEEDS_THE_SERVER = "needs the server, the app runs without it"

/** A subtitle or file of a stream: a whole address (http, file://) stays; a path on the server is null, there is none */
export function streamFileAddress(address: string): string | null {
    if (address.startsWith("http") || address.startsWith("file://")) return address
    return null
}

/**
 * For a query that runs in the background, on no screen of its own (phase 5c-2): asked only while the server runs, so
 * without it there is no request and no "needs the server" toast. A screen that shows the result keeps its error way.
 */
export function onlyWithServer(enabled = true): boolean {
    void enabled
    return false
}

/** The error of something only the server could do; the app runs without it */
export function withoutServerError(what: string): Error {
    return new Error(`${what} ${NEEDS_THE_SERVER}`)
}
