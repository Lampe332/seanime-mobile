// geschrieben nach: docs/EIGENER-KERN.md §4k (Downloads) und der öffentlichen Quelle von react-native-webview 14.0.1 (Android, DownloadListener); eigene Prüfungen

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Under Node there is no WebView to start a download in. What can be checked here: the patch puts the guard in front of
 * everything the download listener does, the prop reaches the native view (spec, view config, both view managers), and
 * only the hidden browser sets it.
 */
const root = join(__dirname, "..", "..", "..")
const patch = readFileSync(join(root, "patches", "react-native-webview+14.0.1.patch"), "utf8")
const added = patch.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).join("\n")

describe("downloads in the hidden browser", () => {
    it("are stopped before the listener builds a request, asks for a permission or starts the download manager", () => {
        const listener = patch.slice(patch.indexOf("webView.setDownloadListener(DownloadListener"))
        const guard = listener.indexOf("if (webView.downloadsDisabled)")
        expect(guard).toBeGreaterThan(0)
        expect(listener.indexOf("return@DownloadListener", guard)).toBeGreaterThan(guard)
        expect(guard).toBeLessThan(listener.indexOf("getNativeModule(RNCWebViewModule::class.java)"))
    })

    it("can be switched off by a prop that reaches the native view", () => {
        expect(added).toMatch(/public boolean downloadsDisabled = false;/)
        expect(added).toMatch(/fun setDownloadsDisabled\(viewWrapper: RNCWebViewWrapper, value: Boolean\)/)
        expect(added.match(/@ReactProp\(name = "downloadsDisabled"\)/g)).toHaveLength(2)
        expect(added).toMatch(/downloadsDisabled\?: boolean;/)
        expect(added).toMatch(/downloadsDisabled:true/)
    })

    it("are off only in the hidden browser", () => {
        const hidden = readFileSync(join(__dirname, "hidden-browser.tsx"), "utf8")
        expect(hidden).toMatch(/^\s+downloadsDisabled$/m)
        for (const other of ["src/main", "src/app", "src/components"]) {
            expect(grepTree(join(root, other))).toEqual([])
        }
    })
})

function grepTree(folder: string): string[] {
    const found: string[] = []
    for (const name of readdirSync(folder)) {
        const path = join(folder, name)
        if (statSync(path).isDirectory()) found.push(...grepTree(path))
        else if (/\.tsx?$/.test(name) && readFileSync(path, "utf8").includes("downloadsDisabled")) found.push(path)
    }
    return found
}
