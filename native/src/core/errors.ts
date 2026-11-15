// geschrieben nach: Aufzeichnung der Server-Antworten vom 13.11.2026 (Fehlerform: HTTP-Status + { "error": "<Text>" })

/**
 * An answer of the core that is an error. It carries what the server put on the wire for an error, a status and a text,
 * so the layer in front of the core (api/client/core-switch.ts) can hand the hooks the error form they already know.
 */
export class CoreError extends Error {
    readonly status: number

    constructor(message: string, status: number = 500) {
        super(message)
        this.name = "CoreError"
        this.status = status
    }
}

export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
