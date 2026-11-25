import { Asset } from "expo-asset"
import { anime4kShaderFiles, anime4kShaderOption, type Anime4kMode, type Anime4kShader } from "./player-anime4k"

/*
 * The bundled shader files (Metro assets, metro.config.js "glsl"). mpv needs a real file path: expo-asset's
 * downloadAsync copies a release build's res/raw resource (or the dev server's file) into the cache folder and
 * returns its file:// URI (expo-asset AssetModule.kt downloadAsync); a cleared cache is copied again on the next call.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles an asset only through require() */
const SHADER_MODULES: Record<Anime4kShader, number> = {
    "Anime4K_Clamp_Highlights.glsl": require("../../../../assets/shaders/anime4k/Anime4K_Clamp_Highlights.glsl"),
    "Anime4K_Restore_CNN_S.glsl": require("../../../../assets/shaders/anime4k/Anime4K_Restore_CNN_S.glsl"),
    "Anime4K_Restore_CNN_M.glsl": require("../../../../assets/shaders/anime4k/Anime4K_Restore_CNN_M.glsl"),
    "Anime4K_Upscale_CNN_x2_S.glsl": require("../../../../assets/shaders/anime4k/Anime4K_Upscale_CNN_x2_S.glsl"),
    "Anime4K_Upscale_CNN_x2_M.glsl": require("../../../../assets/shaders/anime4k/Anime4K_Upscale_CNN_x2_M.glsl"),
    "Anime4K_AutoDownscalePre_x2.glsl": require("../../../../assets/shaders/anime4k/Anime4K_AutoDownscalePre_x2.glsl"),
    "Anime4K_AutoDownscalePre_x4.glsl": require("../../../../assets/shaders/anime4k/Anime4K_AutoDownscalePre_x4.glsl"),
}
/* eslint-enable @typescript-eslint/no-require-imports */

async function localShaderUri(shader: Anime4kShader): Promise<string | null> {
    try {
        const asset = await Asset.fromModule(SHADER_MODULES[shader]).downloadAsync()
        return asset.localUri
    } catch {
        return null
    }
}

/**
 * The mpv options for a mode, set with the open options before a file plays. Never rejects: a shader that cannot be
 * provided gives an empty list and the episode plays without shaders.
 */
export async function anime4kOpenOptions(mode: Anime4kMode): Promise<[string, string][]> {
    const uris = await Promise.all(anime4kShaderFiles(mode).map(localShaderUri))
    return [anime4kShaderOption(uris)]
}
