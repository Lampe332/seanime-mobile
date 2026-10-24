import { MediaPreviewPhoneSheet } from "@/app/(main)/_features/media/_containers/media-preview-phone"
import { usePathname } from "@/lib/navigation"
import { atom } from "jotai"
import { useAtom, useSetAtom } from "jotai/react"
import React from "react"

const __mediaPreview_mediaIdAtom = atom<{ mediaId: number, type: "anime" | "manga" } | undefined>(undefined)

export function useMediaPreviewModal() {
    const setInfo = useSetAtom(__mediaPreview_mediaIdAtom)
    return {
        setPreviewModalMediaId: (mediaId: number, type: "anime" | "manga") => {
            setInfo({ mediaId, type })
        },
    }
}

export function MediaPreviewModal() {

    const [info, setInfo] = useAtom(__mediaPreview_mediaIdAtom)

    const pathname = usePathname()

    React.useEffect(() => {
        setInfo(undefined)
    }, [pathname])

    // A sheet with the essentials and the page one tap away
    return <MediaPreviewPhoneSheet info={info} onClose={() => setInfo(undefined)} />
}
