import React from "react"

/** Same levels as the web logger; Logcat shows no colours, so the level is written out instead of chalk colours. */
export const logger = (prefix: string, silence?: boolean) => {
    const log = (level: string, enabled = !silence) => (...data: any[]) => {
        if (enabled) console.log(`[${prefix}] ${level}`, ...data)
    }
    const warn = log("warn")
    return {
        info: log("info"),
        warning: warn,
        warn,
        success: log("success"),
        error: log("error"),
        trace: log("trace", !silence && __DEV__),
    }
}

/*
 * The last lines the app and its core wrote to Logcat, kept in memory only for the diagnostic report (settings → Logs
 * & cache, lib/diagnostics). Never stored; the report filters private data out when it is made (diagnostic-report.ts).
 */
export const LOG_LINES = 300
const LINE_CHARS = 400
const logLines: string[] = []

function logText(value: unknown): string {
    if (typeof value === "string") return value
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (value === undefined || typeof value === "function") return String(value)
    try {
        return (JSON.stringify(value) ?? String(value)).slice(0, LINE_CHARS)
    }
    catch {
        return String(value)
    }
}

/** One line as the report shows it: UTC time, the level for warnings and errors, the text cut to a sensible length */
export function logLineOf(level: string, data: unknown[], now: number): string {
    const text = data.map(logText).join(" ").replace(/\s*\n\s*/g, " ")
    const marked = level === "warn" || level === "error" ? `${level} ${text}` : text
    return `${new Date(now).toISOString().slice(11, 23)} ${marked}`.slice(0, LINE_CHARS)
}

export function keepLogLine(line: string): void {
    logLines.push(line)
    if (logLines.length > LOG_LINES) logLines.splice(0, logLines.length - LOG_LINES)
}

/** The newest `count` lines, oldest first */
export function recentLogLines(count = LOG_LINES): string[] {
    return logLines.slice(-count)
}

let keepingConsole = false

/** From now on every console line (logger above, the core's `[Core]` lines) also lands in the kept lines; once per app */
export function keepConsoleLines(): void {
    if (keepingConsole) return
    keepingConsole = true
    for (const level of ["log", "info", "warn", "error"] as const) {
        const original = console[level].bind(console)
        console[level] = (...data: unknown[]) => {
            try {
                keepLogLine(logLineOf(level, data, Date.now()))
            }
            catch {
                // a line that cannot be kept is still written
            }
            original(...data)
        }
    }
}

export function useLatestFunction<T extends (...args: any[]) => any>(callback: T): T {
    const callbackRef = React.useRef(callback)

    React.useLayoutEffect(() => {
        callbackRef.current = callback
    }, [callback])

    return React.useCallback(((...args: Parameters<T>): ReturnType<T> => {
        return callbackRef.current(...args)
    }) as T, [])
}
