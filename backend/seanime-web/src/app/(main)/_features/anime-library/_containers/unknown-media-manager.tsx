import { Anime_UnknownGroup } from "@/api/generated/types"
import { HiddenMediaPhoneSheet } from "@/app/(main)/_features/anime-library/_screens/library-phone"
import { atom } from "jotai"
import React from "react"

export const __unknownMedia_drawerIsOpen = atom(false)

type UnknownMediaManagerProps = {
    unknownGroups: Anime_UnknownGroup[]
    onActionComplete?: () => void
}

/** Android gets the library's phone sheet. */
export function UnknownMediaManager(props: UnknownMediaManagerProps) {
    return <HiddenMediaPhoneSheet {...props} />
}
