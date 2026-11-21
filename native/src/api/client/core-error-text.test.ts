import { beforeEach, describe, expect, it, vi } from "vitest"
import { type AppLanguage } from "@/lib/app-language"
import { coreErrorText } from "./core-error-text"

const state = vi.hoisted(() => ({ language: "en" }))

// tr() reads the stored app language; the test picks it
vi.mock("@/lib/app-language", async importActual => {
    const actual = await importActual<typeof import("@/lib/app-language")>()
    return { ...actual, tr: (en: string, de: string) => actual.translate(state.language as AppLanguage, en, de) }
})

describe("coreErrorText", () => {
    beforeEach(() => { state.language = "en" })

    it("words the common core errors in the app language", () => {
        state.language = "de"
        expect(coreErrorText("not logged in to AniList")).toBe("Nicht bei AniList angemeldet")
        expect(coreErrorText("no file of the torrent fits episode 7")).toBe("Keine Datei des Torrents passt zu Folge 7")
        state.language = "ru"
        expect(coreErrorText("not logged in to AniList")).toBe("Вход в AniList не выполнен")
        state.language = "zh-Hans"
        expect(coreErrorText("manga provider not found: weebcentral")).toBe("未找到漫画提供方：weebcentral")
    })

    it("words the failed file deletion in the app language, one file and several", () => {
        state.language = "de"
        expect(coreErrorText("1 file could not be deleted")).toBe("1 Datei konnte nicht gelöscht werden")
        expect(coreErrorText("3 files could not be deleted")).toBe("3 Dateien konnten nicht gelöscht werden")
        state.language = "ru"
        expect(coreErrorText("5 files could not be deleted")).toBe("Не удалось удалить файлы: 5")
        state.language = "en"
        expect(coreErrorText("2 files could not be deleted")).toBe("2 files could not be deleted")
    })

    it("keeps English and unknown errors as they are", () => {
        expect(coreErrorText("not logged in to AniList")).toBe("not logged in to AniList")
        state.language = "fr"
        expect(coreErrorText("mediaId is required")).toBe("mediaId is required")
    })
})
