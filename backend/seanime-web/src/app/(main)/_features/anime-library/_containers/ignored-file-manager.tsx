import { Anime_LocalFile } from "@/api/generated/types"
import { IgnoredFilesPhoneSheet } from "@/app/(main)/_features/anime-library/_screens/library-phone"
import { atom } from "jotai"
import React from "react"

export const __ignoredFileManagerIsOpen = atom(false)

type IgnoredFileManagerProps = {
    files: Anime_LocalFile[]
}

/** Android gets the library's phone sheet. */
export function IgnoredFileManager(props: IgnoredFileManagerProps) {
    return <IgnoredFilesPhoneSheet files={props.files} />
}
