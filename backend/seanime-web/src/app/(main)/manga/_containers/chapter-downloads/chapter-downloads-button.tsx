import { __manga_chapterDownloadsDrawerIsOpenAtom } from "@/app/(main)/manga/_containers/chapter-downloads/chapter-downloads-drawer"
import { Button } from "@/components/ui/button"
import { usePathname } from "@/lib/navigation"
import { openAndroidDownloads } from "@/lib/android-offline"
import { useTr } from "@/lib/app-language"
import { useSetAtom } from "jotai/react"
import React from "react"
import { LuFolderDown } from "react-icons/lu"

type ChapterDownloadsButtonProps = {
    children?: React.ReactNode
}

export function ChapterDownloadsButton(props: ChapterDownloadsButtonProps) {

    const {
        children,
        ...rest
    } = props

    const pathname = usePathname()

    const openDownloadQueue = useSetAtom(__manga_chapterDownloadsDrawerIsOpenAtom)
    const t = useTr()

    if (!pathname.startsWith("/manga")) return null

    // Android: the Downloads tab already lists manga chapters with its own reader and queue.
    if (import.meta.env.SEA_PUBLIC_PLATFORM === "mobile") return (
        <button type="button" className="mobile-topbar-downloads" aria-label={t("Manga downloads", "Manga-Downloads")}
            onClick={() => openAndroidDownloads("manga")}>
            <LuFolderDown aria-hidden />
        </button>
    )

    return (
        <>
            <Button
                onClick={() => openDownloadQueue(true)}
                intent="white-subtle"
                rounded
                size="sm"
                leftIcon={<LuFolderDown />}
            >
                Downloads
            </Button>
        </>
    )
}
