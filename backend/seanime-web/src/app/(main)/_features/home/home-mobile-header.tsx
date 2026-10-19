import { Anime_Episode } from "@/api/generated/types"
import { SeaImage } from "@/components/shared/sea-image"
import { useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { ThemeLibraryScreenBannerType, ThemeMediaPageBannerType, useThemeSettings } from "@/lib/theme/theme-hooks"

/** Home-only banner: stays in document flow and never subscribes to scroll. */
export function HomeMobileHeader({ episode }: { episode?: Anime_Episode }) {
    const tr = useTr()
    const ts = useThemeSettings()
    const custom = ts.libraryScreenBannerType === ThemeLibraryScreenBannerType.Custom
    const image = custom ? ts.libraryScreenCustomBannerImage : episode?.baseAnime?.bannerImage
    const visible = ts.mediaPageBannerType !== ThemeMediaPageBannerType.Hide &&
        (custom || ts.libraryScreenBannerType === ThemeLibraryScreenBannerType.Dynamic)
    return <>
        {visible && image && <div className="home-mobile-backdrop" aria-hidden="true">
            <SeaImage src={getImageUrl(image)} alt="" fill priority className="object-cover" />
        </div>}
        <header className="home-mobile-header">
        <div className="home-mobile-heading"><span>Seanime</span><h1>{tr("Home", "Startseite")}</h1></div>
        </header>
    </>
}
