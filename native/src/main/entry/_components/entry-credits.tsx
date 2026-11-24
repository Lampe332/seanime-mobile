import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { type CreditRole, type CreditRow, type EntryTag, pickCredits, pickTags, type StaffEdgeInput, type TagInput } from "@/main/entry/_lib/entry-credits"
import Eye from "lucide-react-native/icons/eye"
import TriangleAlert from "lucide-react-native/icons/triangle-exclamation-point"
import React from "react"
import { Pressable, View } from "react-native"

type Tr = ReturnType<typeof useTr>

function roleLabel(role: CreditRole, t: Tr): string {
    switch (role) {
        case "original": return t("Original", "Original")
        case "director": return t("Director", "Regie")
        case "composition": return t("Series composition", "Serienkomposition")
        case "characters": return t("Character design", "Charakterdesign")
        case "music": return t("Music", "Musik")
        case "storyArt": return t("Story & art", "Story & Zeichnungen")
        case "story": return t("Story", "Story")
        case "art": return t("Art", "Zeichnungen")
    }
}

/** "Story & art" for one person with both roles; later English labels start lower-case */
function rowLabel(row: CreditRow, t: Tr): string {
    const english = t("en", "de") === "en"
    return row.roles.map((role, i) => {
        const label = roleLabel(role, t)
        return i > 0 && english ? label.charAt(0).toLowerCase() + label.slice(1) : label
    }).join(" & ")
}

/**
 * In "About this anime/manga": the few staff a reader looks for (names open the person's page) and, for anime, the
 * best-ranked tags (open a search for one) with spoiler tags behind a tap. Nothing at all without data (TVmaze, custom
 * sources).
 */
export function EntryCredits({ kind, staff, tags }: { kind: "anime" | "manga", staff?: readonly StaffEdgeInput[] | null, tags?: readonly TagInput[] | null }) {
    const t = useTr()
    const router = useRouter()
    const rows = React.useMemo(() => pickCredits(staff, kind), [staff, kind])
    const picked = React.useMemo(() => pickTags(tags), [tags])
    const [spoilersShown, setSpoilersShown] = React.useState(false)
    if (!rows.length && !picked.tags.length && !picked.spoilers.length) return null

    const openTag = (tag: EntryTag) => router.push(`/search?${kind === "manga" ? "type=manga&" : ""}tags=${encodeURIComponent(tag.name)}&at=${Date.now()}`)

    return <View className="mb-[14.4px] gap-4">
        {rows.length > 0 && <View className="gap-2">
            {rows.map(row => <View key={row.roles.join("-")} className="flex-row items-start gap-3">
                <Text className="w-[112px] pt-[1px] text-[13px] leading-5 text-sm-text-subtle">{rowLabel(row, t)}</Text>
                <View className="flex-1 flex-row flex-wrap gap-x-1">
                    {row.people.map((person, i) => <Pressable key={person.id} hitSlop={6} accessibilityRole="link"
                        accessibilityLabel={t(`${person.name}, show their works`, `${person.name}, Werke anzeigen`)}
                        onPress={() => router.push(`/staff?id=${person.id}&name=${encodeURIComponent(person.name)}&kind=${kind}`)}
                        className="active:opacity-60">
                        <Text className="text-sm font-semibold leading-5 text-sm-text">{person.name}{i < row.people.length - 1 ? "," : ""}</Text>
                    </Pressable>)}
                </View>
            </View>)}
        </View>}

        {(picked.tags.length > 0 || picked.spoilers.length > 0) && <View className="flex-row flex-wrap gap-2">
            {picked.tags.map(tag => <TagChip key={tag.name} tag={tag} onPress={openTag} t={t} />)}
            {spoilersShown && picked.spoilers.map(tag => <TagChip key={tag.name} tag={tag} onPress={openTag} t={t} spoiler />)}
            {picked.spoilers.length > 0 && !spoilersShown && <Pressable hitSlop={4} accessibilityRole="button"
                accessibilityLabel={t(`Show ${picked.spoilers.length} spoiler tags`, `${picked.spoilers.length} Spoiler-Tags zeigen`)}
                onPress={() => setSpoilersShown(true)}
                className="min-h-9 flex-row items-center gap-1.5 rounded-full border border-sm-line px-3.5 active:opacity-70">
                <Eye size={14} color={colors.smTextSubtle} />
                <Text className="text-[13px] font-semibold text-sm-text-subtle">{t(`Show spoilers (${picked.spoilers.length})`, `Spoiler zeigen (${picked.spoilers.length})`)}</Text>
            </Pressable>}
        </View>}
    </View>
}

function TagChip({ tag, onPress, t, spoiler }: { tag: EntryTag, onPress: (tag: EntryTag) => void, t: Tr, spoiler?: boolean }) {
    return <Pressable hitSlop={4} accessibilityRole="button"
        accessibilityLabel={spoiler ? t(`Spoiler tag ${tag.name}, search`, `Spoiler-Tag ${tag.name} suchen`) : t(`Search tag ${tag.name}`, `Tag ${tag.name} suchen`)}
        onPress={() => onPress(tag)}
        className="min-h-9 flex-row items-center gap-1.5 rounded-full bg-sm-surface-raised px-3.5 active:bg-sm-surface-control">
        {spoiler && <TriangleAlert size={13} color={colors.smWarning} />}
        <Text className="text-[13px] font-semibold text-sm-text-muted">{tag.name}</Text>
        <Text className="text-[12px] text-sm-text-subtle">{tag.rank}%</Text>
    </Pressable>
}
