import chalk from "chalk"
import React from "react"

export const logger = (prefix: string, silence?: boolean) => {
    const log = (color: (text: string) => string, enabled = !silence) => (...data: any[]) => {
        if (enabled) console.log(color(`[${prefix}]`) + " ", ...data)
    }
    const warn = log(chalk.yellow)
    return {
        info: log(chalk.blue),
        warning: warn,
        warn,
        success: log(chalk.green),
        error: log(chalk.red),
        trace: log(chalk.bgGray, !silence && import.meta.env.MODE === "development"),
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
