import { Anime_UnmatchedGroup } from "@/api/generated/types"
import { UnmatchedPhoneSheet } from "@/app/(main)/_features/anime-library/_screens/library-phone"
import { atom } from "jotai"
import React from "react"

export const __unmatchedFileManagerIsOpen = atom(false)

type UnmatchedFileManagerProps = {
    unmatchedGroups: Anime_UnmatchedGroup[]
}

/** Android gets the library's phone sheet. */
export function UnmatchedFileManager(props: UnmatchedFileManagerProps) {
    return <UnmatchedPhoneSheet unmatchedGroups={props.unmatchedGroups} />
}
