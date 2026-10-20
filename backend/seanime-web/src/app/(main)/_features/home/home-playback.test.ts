import { describe, expect, it, vi } from "vitest"
import type { Anime_Episode } from "@/api/generated/types"
import { resumeHomeEpisode } from "./home-playback"

const episode = { baseAnime: { id: 209983 }, episodeNumber: 11 } as Anime_Episode
describe("Home resume routing", () => {
    it("selects the correct series before navigating through the existing continuation manager", () => {
        let ready: (() => void) | undefined
        const push = vi.fn()
        const select = vi.fn((_id: number, callback: () => void) => { ready = callback })
        resumeHomeEpisode(episode, false, select, push)
        expect(select).toHaveBeenCalledWith(209983, expect.any(Function))
        expect(push).not.toHaveBeenCalled()
        ready!()
        expect(push).toHaveBeenCalledExactlyOnceWith("/entry?id=209983&episode=11")
    })
    it("preserves offline routing", () => {
        const push = vi.fn()
        resumeHomeEpisode(episode, true, (_, ready) => ready(), push)
        expect(push).toHaveBeenCalledExactlyOnceWith("/offline/entry/anime?id=209983")
    })
    it("preserves a configured continuation link", () => {
        const push = vi.fn()
        resumeHomeEpisode(episode, false, (_, ready) => ready(), push, "/custom?id={id}&source=home")
        expect(push).toHaveBeenCalledExactlyOnceWith("/custom?id=209983&source=home")
    })
    it.each([{ baseAnime: undefined }, { ...episode, isInvalid: true }])("does not route an unavailable episode", value => {
        const select = vi.fn(), push = vi.fn()
        resumeHomeEpisode(value as Anime_Episode, false, select, push)
        expect(select).not.toHaveBeenCalled()
        expect(push).not.toHaveBeenCalled()
    })
})
