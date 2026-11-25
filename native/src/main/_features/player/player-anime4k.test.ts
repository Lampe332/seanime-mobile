import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ANIME4K_CHAINS, anime4kModeOf, anime4kShaderFiles, anime4kShaderOption, mpvShaderPath } from "./player-anime4k"

const dir = "/data/user/0/app/cache"
const uriOf = (file: string) => `file://${dir}/${file}`

describe("Anime4K shader chains", () => {
    it("off sets an empty shader list", () => {
        expect(anime4kShaderFiles("off")).toEqual([])
        expect(anime4kShaderOption(anime4kShaderFiles("off"))).toEqual(["glsl-shaders", ""])
    })

    it("fast is Clamp_Highlights, Restore S, Upscale x2 S joined by mpv's Unix separator", () => {
        const option = anime4kShaderOption(anime4kShaderFiles("fast").map(uriOf))
        expect(option).toEqual(["glsl-shaders", [
            `${dir}/Anime4K_Clamp_Highlights.glsl`,
            `${dir}/Anime4K_Restore_CNN_S.glsl`,
            `${dir}/Anime4K_Upscale_CNN_x2_S.glsl`,
        ].join(":")])
        expect(option[1]).not.toContain(";")
    })

    it("quality is the official Mode A (Fast) chain in its order", () => {
        expect(anime4kShaderOption(anime4kShaderFiles("quality").map(uriOf))[1].split(":").map(path => path.slice(dir.length + 1))).toEqual([
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_M.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_S.glsl",
        ])
    })

    it("a missing file plays without shaders", () => {
        const uris: (string | null)[] = anime4kShaderFiles("quality").map(uriOf)
        uris[2] = null
        expect(anime4kShaderOption(uris)).toEqual(["glsl-shaders", ""])
        expect(anime4kShaderOption([uriOf("a.glsl"), undefined])).toEqual(["glsl-shaders", ""])
    })

    it("only local paths the list can hold reach mpv", () => {
        expect(mpvShaderPath("file:///data/a%20b/x.glsl")).toBe("/data/a b/x.glsl")
        expect(mpvShaderPath("http://10.0.0.2:8081/assets/x.glsl")).toBeNull()
        expect(mpvShaderPath("file:///data/a:b/x.glsl")).toBeNull()
        expect(mpvShaderPath("assets_shaders_x")).toBeNull()
        expect(mpvShaderPath("")).toBeNull()
        expect(anime4kShaderOption([uriOf("a.glsl"), "file:///data/a:b/x.glsl"])).toEqual(["glsl-shaders", ""])
    })

    it("unknown stored values are off", () => {
        expect(anime4kModeOf("quality")).toBe("quality")
        expect(anime4kModeOf("ultra")).toBe("off")
        expect(anime4kModeOf(undefined)).toBe("off")
    })

    it("every chained file and the licence are bundled", () => {
        const assets = join(__dirname, "../../../../assets/shaders/anime4k")
        for (const file of new Set(Object.values(ANIME4K_CHAINS).flat())) expect(existsSync(join(assets, file)), file).toBe(true)
        expect(existsSync(join(assets, "LICENSE"))).toBe(true)
    })
})
