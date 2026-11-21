// geschrieben nach: home-screen.tsx (Reihen der Startseite), media-card-row.tsx und docs/EIGENER-KERN.md §4t (B3)

import React from "react"
import { View } from "react-native"
import type { AL_BaseAnime } from "@/api/generated/types"
import { useGetMyShows } from "@/api/hooks/other_sources.hooks"
import { SectionTitle } from "@/components/ui/text/text"
import { cn } from "@/components/ui/core/styling"
import { useTr } from "@/lib/app-language"
import { MediaCardRow } from "@/main/_features/media/_components/media-card-row"
import { MediaEntryCard } from "@/main/_features/media/_components/media-entry-card"

/** "My shows": the titles of the other sources (TVmaze) kept on the device; nothing while it is empty */
export function MyShowsRow({ className }: { className?: string }) {
    const t = useTr()
    const { data } = useGetMyShows()
    if (!data?.length) return null
    return <View className={cn("gap-3", className)}>
        <SectionTitle>{t("My shows", "Meine Serien")}</SectionTitle>
        <MediaCardRow<AL_BaseAnime> data={data} keyOf={show => String(show.id)}
            renderCard={(show, width) => <MediaEntryCard media={show} type="anime" width={width} />} />
    </View>
}
