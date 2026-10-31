import { AL_BaseAnime } from "@/api/generated/types"
import { cn } from "@/components/ui/core/styling"
import { getAppLanguage, useTr } from "@/lib/app-language"
import { ThemeMediaPageInfoBoxSize, useThemeSettings } from "@/lib/theme/theme-hooks"
import { addSeconds, format, formatDistanceToNow } from "date-fns"
import { de } from "date-fns/locale"
import React from "react"
import { BiCalendarAlt } from "react-icons/bi"

export function NextAiringEpisode(props: { media: AL_BaseAnime }) {
    const t = useTr()
    const locale = getAppLanguage() === "de" ? { locale: de } : undefined
    const distance = formatDistanceToNow(addSeconds(new Date(), props.media.nextAiringEpisode?.timeUntilAiring || 0), { addSuffix: true, ...locale })
    const day = format(addSeconds(new Date(), props.media.nextAiringEpisode?.timeUntilAiring || 0), "EEEE", locale)
    const ts = useThemeSettings()
    return <>
        {!!props.media.nextAiringEpisode && (
            <div
                className={cn(
                    "flex gap-2 items-center justify-center text-lg",
                    ts.mediaPageBannerInfoBoxSize === ThemeMediaPageInfoBoxSize.Fluid && "justify-start",
                )}
            >
                <span className="font-semibold">{t("Episode", "Folge")} {props.media.nextAiringEpisode?.episode}</span> {distance}
                <BiCalendarAlt className="text-lg text-[--muted]" />
                <span className="text-[--muted]">{day}</span>
            </div>
        )}
    </>
}
