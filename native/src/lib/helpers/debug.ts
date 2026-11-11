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

export function useLatestFunction<T extends (...args: any[]) => any>(callback: T): T {
    const callbackRef = React.useRef(callback)

    React.useLayoutEffect(() => {
        callbackRef.current = callback
    }, [callback])

    return React.useCallback(((...args: Parameters<T>): ReturnType<T> => {
        return callbackRef.current(...args)
    }) as T, [])
}
