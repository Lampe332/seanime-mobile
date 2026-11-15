// Vitest runs in Node, which cannot load expo-file-system's native module. The app's folders are empty here unless a
// test puts a file into `files` (path as the parts joined with "/", e.g. "document/cache/watch_history.cache").
export const files = new Map<string, string>()

export const Paths = { document: "document", cache: "cache" }

const pathOf = (parts: unknown[]) => parts.map(part => (part instanceof File || part instanceof Directory ? part.uri : String(part))).join("/")

export class Directory {
    readonly uri: string

    constructor(...parts: unknown[]) {
        this.uri = pathOf(parts)
    }

    get exists() {
        return false
    }
}

export class File {
    readonly uri: string

    constructor(...parts: unknown[]) {
        this.uri = pathOf(parts)
    }

    get exists() {
        return files.has(this.uri)
    }

    async text() {
        return files.get(this.uri) ?? ""
    }

    async bytes() {
        return new TextEncoder().encode(files.get(this.uri) ?? "")
    }
}
