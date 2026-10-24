import { useMediaPreviewModal } from "@/app/(main)/_features/media/_containers/media-preview-modal"
import { __discover_randomTrendingAtom } from "@/app/(main)/discover/_containers/discover-trending"
import { __discord_pageTypeAtom } from "@/app/(main)/discover/_lib/discover.atoms"
import { Skeleton } from "@/components/ui/skeleton"
import { usePathname } from "@/lib/navigation"
import { atom, useAtomValue } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { useTr } from "@/lib/app-language"

// Atoms for state management
export const __discover_hoveringHeaderAtom = atom(false)
export const __discover_clickedCarouselDotAtom = atom(0)

/** Android Home: the trending title as a picture card that opens its preview */
export function DiscoverPageHeader() {
    const tr = useTr()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const pathname = usePathname()

    const [pageType, setPageType] = useAtom(__discord_pageTypeAtom)
    const randomTrending = useAtomValue(__discover_randomTrendingAtom)

    // Reset page type to anime when on home page
    React.useLayoutEffect(() => {
        if (pathname === "/") {
            setPageType("anime")
        }
    }, [pathname])

    return <section className="home-discover-feature" aria-label={tr("Featured", "Im Fokus")}>
        {randomTrending ? <button type="button" className="home-discover-card"
            onClick={() => setPreviewModalMediaId(randomTrending.id, pageType === "manga" ? "manga" : "anime")}>
            {!!(randomTrending.bannerImage || randomTrending.coverImage?.extraLarge) &&
                <img src={randomTrending.bannerImage || randomTrending.coverImage?.extraLarge} alt="" loading="lazy" decoding="async" />}
            <span className="home-discover-card-text">
                <span className="home-discover-card-meta">{tr("Trending now", "Gerade im Trend")}</span>
                <strong>{randomTrending.title?.userPreferred}</strong>
                <span className="home-discover-card-action">{tr("Preview", "Vorschau")}</span>
            </span>
        </button> : <Skeleton className="h-48 rounded-xl" />}
    </section>
}
