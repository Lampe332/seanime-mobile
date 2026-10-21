import { CustomLibraryBanner } from "@/app/(main)/_features/anime-library/_containers/custom-library-banner"
import { isAndroidPhone } from "@/app/(main)/_features/video-core/video-core-menu"
import { AnilistCollectionLists } from "@/app/(main)/lists/_containers/anilist-collection-lists"
import { ListsPhone } from "@/app/(main)/lists/_screens/lists-phone"
import { PageWrapper } from "@/components/shared/page-wrapper"
import React from "react"


export default function Home() {

    // Android phones get their own screen; tablets and desktop keep the lists
    if (isAndroidPhone()) return <ListsPhone />

    return (
        <>
            <CustomLibraryBanner discrete />
            <PageWrapper
                className="p-4 sm:p-8 pt-4 relative"
                data-anilist-page
            >
                <AnilistCollectionLists />
            </PageWrapper>
        </>
    )
}
