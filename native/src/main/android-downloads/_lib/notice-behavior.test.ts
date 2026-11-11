import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DOWNLOAD_NOTICE_KIND, foregroundNoticeBehavior } from "./notice-behavior"

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sources(path)
        return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : []
    })
}

describe("notifications while the app is open", () => {
    it("lists download notices quietly", () => {
        expect(foregroundNoticeBehavior(DOWNLOAD_NOTICE_KIND)).toEqual({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false })
    })
    it("shows new-episode and test notifications like any other", () => {
        for (const kind of [undefined, null, "", "new-episode"]) {
            expect(foregroundNoticeBehavior(kind)).toEqual({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
        }
    })
    it("has one handler for the whole app (a second one replaced it and hid new-episode notifications)", () => {
        const root = join(__dirname, "../../../..")
        const files = [join(root, "index.ts"), ...sources(join(root, "src"))]
        const setters = files.filter(file => readFileSync(file, "utf8").includes("setNotificationHandler("))
        expect(setters.map(file => file.slice(root.length + 1).replace(/\\/g, "/"))).toEqual(["index.ts"])
    })
})
