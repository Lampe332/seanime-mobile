import { describe, expect, it, vi } from "vitest"

// native modules cannot load in Node; the file name rule needs none of them
vi.mock("expo-document-picker", () => ({}))
vi.mock("expo-file-system", () => ({}))
vi.mock("expo-sharing", () => ({}))
vi.mock("@/components/ui/toast/toast-store", () => ({ toast: { error: () => undefined } }))
vi.mock("@/lib/app-language", () => ({ tr: (en: string) => en }))

const { exportFileName } = await import("./file-transfer")

describe("exportFileName", () => {
    it("keeps only the last path segment", () => {
        expect(exportFileName("seanime-2026-11-10.log")).toBe("seanime-2026-11-10.log")
        expect(exportFileName("/data/user/0/app/files/logs/server.log")).toBe("server.log")
        expect(exportFileName("C:\\Users\\x\\export.json")).toBe("export.json")
        expect(exportFileName("../../databases/seanime.db")).toBe("seanime.db")
    })

    it("never names the export folder or the folder above it", () => {
        expect(exportFileName("..")).toBe("seanime-export")
        expect(exportFileName(".")).toBe("seanime-export")
        expect(exportFileName("logs/..")).toBe("seanime-export")
        expect(exportFileName("a\\..")).toBe("seanime-export")
        expect(exportFileName(" .. ")).toBe("seanime-export")
    })

    it("is never empty and at most 180 characters", () => {
        expect(exportFileName("")).toBe("seanime-export")
        expect(exportFileName("folder/")).toBe("seanime-export")
        expect(exportFileName("x".repeat(300))).toHaveLength(180)
    })
})
