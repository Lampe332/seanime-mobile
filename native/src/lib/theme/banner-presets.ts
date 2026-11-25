import { type BannerSource, resolveBanner } from "@/lib/theme/home-banner"
import { useThemeSettings } from "@/lib/theme/theme-hooks"

/** The pictures for the Home banner that ship with the app (1440×480, no figures, no text), in the order Settings shows them */
export const BANNER_PRESETS = [
    { id: "sakura", en: "Sakura", de: "Kirschblüten", asset: require("../../../assets/images/banners/sakura.webp") as number },
    { id: "night-city", en: "Night city", de: "Stadt bei Nacht", asset: require("../../../assets/images/banners/night-city.webp") as number },
    { id: "sunset-sea", en: "Sunset sea", de: "Meer im Abendrot", asset: require("../../../assets/images/banners/sunset-sea.webp") as number },
    { id: "forest-shrine", en: "Forest shrine", de: "Waldschrein", asset: require("../../../assets/images/banners/forest-shrine.webp") as number },
    { id: "starry-peaks", en: "Starry peaks", de: "Berge unter Sternen", asset: require("../../../assets/images/banners/starry-peaks.webp") as number },
    { id: "cosmos", en: "Cosmos", de: "Kosmos", asset: require("../../../assets/images/banners/cosmos.webp") as number },
] as const

export const BANNER_PRESET_ASSETS: Readonly<Record<string, number>> = Object.fromEntries(BANNER_PRESETS.map(preset => [preset.id, preset.asset]))

/** The banner the stored theme shows on this device (none on tablets is the caller's choice) */
export function useHomeBanner(): BannerSource | undefined {
    const value = useThemeSettings().libraryScreenCustomBannerImage
    return resolveBanner(value, BANNER_PRESET_ASSETS)
}
