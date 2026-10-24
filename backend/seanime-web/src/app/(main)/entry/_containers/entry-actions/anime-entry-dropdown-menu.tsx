import { AL_AnimeDetailsById_Media, Anime_Entry } from "@/api/generated/types"
import { AnimeEntryPhoneMenu } from "@/app/(main)/entry/_containers/entry-actions/anime-entry-phone-menu"
import React from "react"

export function AnimeEntryDropdownMenu({ entry, details }: { entry: Anime_Entry, details?: AL_AnimeDetailsById_Media }) {
    // Android gets the phone kit's sheets
    return <AnimeEntryPhoneMenu entry={entry} details={details} />
}
