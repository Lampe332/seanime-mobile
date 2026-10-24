import { describe, expect, it } from "vitest"
import { upath } from "./upath"

describe("upath", () => {
    describe("core functions", () => {
        describe("join", () => {
            it("should join paths correctly", () => {
                expect(upath.join("a", "b", "c")).toBe("a/b/c")
                expect(upath.join("/a", "b", "c")).toBe("/a/b/c")
                expect(upath.join("a", "/b", "c")).toBe("a/b/c")
                expect(upath.join("")).toBe(".")
                expect(upath.join("a", "")).toBe("a")
                expect(upath.join("a/", "b")).toBe("a/b")
                expect(upath.join("a//", "b")).toBe("a/b")
                expect(upath.join("a", "..", "b")).toBe("b")
                expect(upath.join("a/b", "..")).toBe("a")
            })

            it("should handle Windows-style paths", () => {
                expect(upath.join("a\\b", "c")).toBe("a/b/c")
                expect(upath.join("a", "b\\c")).toBe("a/b/c")
                expect(upath.join("C:", "b\\c")).toBe("C:/b/c")
            })
        })

        describe("normalize", () => {
            it("should normalize paths correctly", () => {
                expect(upath.normalize("a/b/c")).toBe("a/b/c")
                expect(upath.normalize("/a/b/c")).toBe("/a/b/c")
                expect(upath.normalize("a//b/c")).toBe("a/b/c")
                expect(upath.normalize("a/b/../c")).toBe("a/c")
                expect(upath.normalize("/a/b/../c")).toBe("/a/c")
                expect(upath.normalize("a/b/./c")).toBe("a/b/c")
                expect(upath.normalize("a/b/c/")).toBe("a/b/c/")
                expect(upath.normalize("a/b/c//")).toBe("a/b/c/")
                expect(upath.normalize("")).toBe(".")
                expect(upath.normalize(".")).toBe(".")
                expect(upath.normalize("..")).toBe("..")
            })

            it("should handle special cases", () => {
                expect(upath.normalize("/")).toBe("/")
                expect(upath.normalize("//")).toBe("//")
                expect(upath.normalize("//server/share")).toBe("//server/share")
                expect(upath.normalize("a/../..")).toBe("..")
                expect(upath.normalize("/a/../..")).toBe("/")
            })
        })

        describe("isAbsolute", () => {
            it("should identify absolute paths", () => {
                expect(upath.isAbsolute("/a/b")).toBe(true)
                expect(upath.isAbsolute("/a")).toBe(true)
                expect(upath.isAbsolute("/")).toBe(true)
                expect(upath.isAbsolute("//server/share")).toBe(true)
                expect(upath.isAbsolute("C:\\a\\b")).toBe(true)
            })

            it("should identify relative paths", () => {
                expect(upath.isAbsolute("a/b")).toBe(false)
                expect(upath.isAbsolute(".")).toBe(false)
                expect(upath.isAbsolute("..")).toBe(false)
                expect(upath.isAbsolute("")).toBe(false)
            })
        })

        describe("dirname", () => {
            it("should get directory path correctly", () => {
                expect(upath.dirname("/a/b/c")).toBe("/a/b")
                expect(upath.dirname("/a/b")).toBe("/a")
                expect(upath.dirname("/a")).toBe("/")
                expect(upath.dirname("a/b")).toBe("a")
                expect(upath.dirname("a")).toBe(".")
                expect(upath.dirname(".")).toBe(".")
                expect(upath.dirname("")).toBe(".")
            })

            it("should handle trailing slashes", () => {
                expect(upath.dirname("/a/b/c/")).toBe("/a/b")
                expect(upath.dirname("a/b/")).toBe("a")
            })
        })

        describe("basename", () => {
            it("should extract basename correctly", () => {
                expect(upath.basename("/a/b/c")).toBe("c")
                expect(upath.basename("/a/b/c/")).toBe("c")
                expect(upath.basename("/a/b")).toBe("b")
                expect(upath.basename("/a")).toBe("a")
                expect(upath.basename("a/b")).toBe("b")
                expect(upath.basename("a")).toBe("a")
                expect(upath.basename(".")).toBe(".")
                expect(upath.basename("")).toBe("")
            })

            it("should handle extensions", () => {
                expect(upath.basename("/a/b/c.txt")).toBe("c.txt")
                expect(upath.basename("/a/b/c.txt", ".txt")).toBe("c")
                expect(upath.basename("a.txt", ".txt")).toBe("a")
                expect(upath.basename(".txt", ".txt")).toBe("")
                expect(upath.basename(".bashrc")).toBe(".bashrc")
                expect(upath.basename(".bashrc", ".bashrc")).toBe("")
            })

            it("should handle trailing slashes", () => {
                expect(upath.basename("/a/b/c/")).toBe("c")
                expect(upath.basename("a/b/")).toBe("b")
            })
        })

    })

    describe("extra functions", () => {
        describe("normalizeSafe", () => {
            it("should normalize paths safely", () => {
                expect(upath.normalizeSafe("./a/b/c")).toBe("./a/b/c")
                expect(upath.normalizeSafe("./a/../b")).toBe("./b")
                expect(upath.normalizeSafe("//server/share")).toBe("//server/share")
                expect(upath.normalizeSafe("//./path")).toBe("//./path")
            })
        })
    })
})
