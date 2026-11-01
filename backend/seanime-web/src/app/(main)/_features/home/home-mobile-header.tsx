import React from "react"
import { atom } from "jotai"
import { useSetAtom } from "jotai/react"
import { useTr } from "@/lib/app-language"
import { PHONE_EASE } from "@/lib/motion"
import { getAssetUrl } from "@/lib/server/assets"
import { IS_TABLET_UI } from "@/lib/tablet-ui"
import { useThemeSettings } from "@/lib/theme/theme-hooks"

/** Home toolbar actions render into this slot so they sit beside the title. */
export const __home_mobileActionsSlot = atom<HTMLElement | null>(null)

/** Android Home identity: image-independent and deliberately static. */
export function HomeMobileHeader({ children }: { children?: React.ReactNode }) {
    const tr = useTr()
    const setActionsSlot = useSetAtom(__home_mobileActionsSlot)
    return <header className="home-mobile-header">
        {!IS_TABLET_UI && <HomeBanner />}
        <div className="home-mobile-heading"><span>Seanime</span><h1>{tr("Home", "Startseite")}</h1></div>
        <div className="home-mobile-tools"><div className="home-mobile-actions" ref={setActionsSlot} />{children}</div>
    </header>
}

/**
 * Banner image of Settings > Appearance on the phone's Home: one still picture behind the title, cropped by the stored position,
 * at the stored opacity, darkened under the text and faded out at the bottom (home-mobile.css). It stays invisible until it has
 * loaded, since the WebView paints a loaded image one frame before its load event; then it fades in (opacity only).
 */
function HomeBanner() {
    const ts = useThemeSettings()
    const image = ts.libraryScreenCustomBannerImage?.trim()
    const ref = React.useRef<HTMLImageElement>(null)
    const opacity = Math.min(100, Math.max(0, ts.libraryScreenCustomBannerOpacity || 100)) / 100
    const show = React.useCallback(() => {
        const el = ref.current
        if (!el) return
        el.style.opacity = String(opacity)
        el.animate([{ opacity: 0, offset: 0 }, { opacity }], { duration: 320, easing: PHONE_EASE })
    }, [opacity])
    React.useEffect(() => {
        const el = ref.current
        if (el?.complete && el.naturalWidth) el.style.opacity = String(opacity)
    }, [image, opacity])
    if (!image) return null
    return <span className="home-banner" aria-hidden data-home-banner>
        <img ref={ref} key={image} src={getAssetUrl(image)} alt="" decoding="async" onLoad={show}
            style={{ objectPosition: ts.libraryScreenCustomBannerPosition || "50% 50%", opacity: 0 }} />
    </span>
}
