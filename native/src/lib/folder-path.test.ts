import type { Translate } from "@/lib/app-language"
import { describe, expect, it } from "vitest"
import { accessProblem, androidUserId, folderPickProblemText, treeUriToPath } from "./folder-path"

const tree = (id: string, authority = "com.android.externalstorage.documents") => `content://${authority}/tree/${encodeURIComponent(id)}`

describe("tree URI → server path", () => {
    it("internal storage", () => {
        expect(treeUriToPath("content://com.android.externalstorage.documents/tree/primary%3AAnime%2FSub")).toBe("/storage/emulated/0/Anime/Sub")
        expect(treeUriToPath(tree("primary:Anime"))).toBe("/storage/emulated/0/Anime")
        expect(treeUriToPath(tree("primary:"))).toBe("/storage/emulated/0")
        expect(treeUriToPath(tree("primary:Anime/"))).toBe("/storage/emulated/0/Anime")
        expect(treeUriToPath(tree("primary:Anime/Dr. STONE (2019)"))).toBe("/storage/emulated/0/Anime/Dr. STONE (2019)")
    })

    it("the app's Android user (tablet user 10)", () => {
        expect(treeUriToPath(tree("primary:Anime"), 10)).toBe("/storage/emulated/10/Anime")
        expect(androidUserId("file:///data/user/10/com.seanime.app.native/files/")).toBe(10)
        expect(androidUserId("file:///data/user/0/com.seanime.app.native/files/")).toBe(0)
        expect(androidUserId("file:///data/data/com.seanime.app.native/files/")).toBe(0)
        expect(androidUserId(undefined)).toBe(0)
    })

    it("SD cards, USB drives and the Documents entry", () => {
        expect(treeUriToPath(tree("1A2B-3C4D:Anime"))).toBe("/storage/1A2B-3C4D/Anime")
        expect(treeUriToPath(tree("1A2B-3C4D:"))).toBe("/storage/1A2B-3C4D")
        expect(treeUriToPath(tree("home:Sub"), 10)).toBe("/storage/emulated/10/Documents/Sub")
    })

    it("the tree part of a document URI counts", () => {
        expect(treeUriToPath(`${tree("primary:Anime")}/document/${encodeURIComponent("primary:Anime/x.mkv")}`)).toBe("/storage/emulated/0/Anime")
    })

    it("no path: Downloads, other apps, broken or escaping IDs", () => {
        expect(treeUriToPath("content://com.android.providers.downloads.documents/tree/downloads")).toBeNull()
        expect(treeUriToPath(tree("primary:Anime", "com.google.android.apps.docs.storage"))).toBeNull()
        expect(treeUriToPath(tree("raw:/storage/emulated/0/Download", "com.android.providers.downloads.documents"))).toBeNull()
        expect(treeUriToPath(tree("primary:../../data"))).toBeNull()
        expect(treeUriToPath(tree("Anime"))).toBeNull()
        expect(treeUriToPath(tree("a/b:Anime"))).toBeNull()
        expect(treeUriToPath("content://com.android.externalstorage.documents/tree/primary%3A%E0%A4%A")).toBeNull()
        expect(treeUriToPath("file:///storage/emulated/0/Anime")).toBeNull()
        expect(treeUriToPath("")).toBeNull()
    })
})

describe("server access → problem", () => {
    const ok = { exists: true, readable: true, allFilesAccess: true }
    it("Android 11+ needs All files access first", () => {
        expect(accessProblem(ok)).toBeNull()
        expect(accessProblem({ ...ok, allFilesAccess: false })).toBe("permission")
        expect(accessProblem({ ...ok, exists: false, readable: false })).toBe("missing")
        expect(accessProblem({ ...ok, readable: false })).toBe("unreadable")
        expect(accessProblem(null)).toBe("unavailable")
    })

    it("older Android: the read permission is enough", () => {
        expect(accessProblem({ ...ok, allFilesAccess: false }, false)).toBeNull()
        expect(accessProblem({ ...ok, allFilesAccess: false, readable: false }, false)).toBe("unreadable")
    })

    it("texts: cancelling says nothing", () => {
        const de: Translate = (_, german) => german
        expect(folderPickProblemText("cancelled", de)).toBeNull()
        expect(folderPickProblemText("not-local", de)).toBe("Bitte einen Ordner im internen Speicher oder auf der SD-Karte wählen.")
        expect(folderPickProblemText("permission", de)).toContain("Zugriff auf alle Dateien")
    })
})
