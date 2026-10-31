import { Manga_Entry } from "@/api/generated/types"
import { PhoneRow, PhoneSheet, PhoneSheetGroup } from "@/app/(main)/_features/phone-screen/phone-screen"
import { usePluginMangaPageDropdownItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { ExternalRow } from "@/app/(main)/entry/_containers/entry-actions/anime-entry-phone-menu"
import { IconButton } from "@/components/ui/button"
import { useTr } from "@/lib/app-language"
import { copyToClipboard } from "@/lib/helpers/browser"
import { getCustomSourceMediaSiteUrl, isCustomSource } from "@/lib/server/utils"
import { TabletLabel } from "@/lib/tablet-ui"
import React from "react"
import { BiDotsVerticalRounded } from "react-icons/bi"
import { LuCopy, LuPuzzle } from "react-icons/lu"
import { toast } from "sonner"

/** The manga page's "More": the same sheet and pill as on an anime page, instead of the desktop dropdown. */
export function MangaEntryPhoneMenu({ entry }: { entry: Manga_Entry }) {
    const t = useTr()
    const trigger = React.useRef<HTMLButtonElement>(null)
    const [open, setOpen] = React.useState(false)
    const { items: pluginItems, handleClick: runPlugin } = usePluginMangaPageDropdownItems(entry.media)
    const media = entry.media
    const custom = isCustomSource(entry.mediaId)
    const siteUrl = custom && media ? getCustomSourceMediaSiteUrl(media) : null

    return <>
        <IconButton ref={trigger} data-manga-entry-dropdown-menu-trigger intent="gray-subtle" size="md"
            icon={<><BiDotsVerticalRounded /><TabletLabel>{t("More", "Mehr")}</TabletLabel></>}
            aria-label={t("More for this manga", "Mehr zu diesem Manga")} aria-haspopup="dialog" onClick={() => setOpen(true)} />

        <PhoneSheet title={t("More", "Mehr")} open={open} onOpenChange={setOpen} returnFocusRef={trigger} data-manga-phone-menu>
            <PhoneSheetGroup title={t("Elsewhere", "Anderswo")}>
                <div className="ps-rows">
                    {!custom && <ExternalRow href={`https://anilist.co/manga/${entry.mediaId}`} label="AniList" note={t("Lists, reviews, staff", "Listen, Rezensionen, Mitwirkende")} />}
                    {!!media?.idMal && <ExternalRow href={`https://myanimelist.net/manga/${media.idMal}`} label="MyAnimeList" note={t("Scores and forums", "Wertungen und Foren")} />}
                    {!!siteUrl && <ExternalRow href={siteUrl} label={t("Website", "Website")} note={t("The source's own page", "Die Seite der Quelle")} />}
                    {custom && <PhoneRow icon={<LuCopy />} label={t("Copy ID", "ID kopieren")} value={entry.mediaId}
                        onClick={() => copyToClipboard(entry.mediaId.toString()).then(() => toast.success(t("ID copied", "ID kopiert")))} />}
                </div>
            </PhoneSheetGroup>
            {pluginItems.length > 0 && <PhoneSheetGroup title={t("Plugins", "Plugins")}>
                <div className="ps-rows">
                    {pluginItems.map(item => <PhoneRow key={item.id} icon={<LuPuzzle />} label={item.label || "?"} disabled={item.disabled}
                        onClick={() => {
                            setOpen(false)
                            runPlugin(item)
                        }} />)}
                </div>
            </PhoneSheetGroup>}
        </PhoneSheet>
    </>
}
