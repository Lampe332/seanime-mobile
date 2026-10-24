import { usePathname } from "@/lib/navigation"
import { openAndroidDownloads } from "@/lib/android-offline"
import { useTr } from "@/lib/app-language"
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

    const t = useTr()

    if (!pathname.startsWith("/manga")) return null

    // Android: the Downloads tab already lists manga chapters with its own reader and queue.
    return (
        <button type="button" className="mobile-topbar-downloads" aria-label={t("Manga downloads", "Manga-Downloads")}
            onClick={() => openAndroidDownloads("manga")}>
            <LuFolderDown aria-hidden />
        </button>
    )
}
