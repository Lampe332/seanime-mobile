import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import Check from "lucide-react-native/icons/check"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Search from "lucide-react-native/icons/search"
import X from "lucide-react-native/icons/x"
import React from "react"
import { Pressable, TextInput, type TextInputInstance, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * Rows and small parts of the phone kit (phone-screen.css) that the screens share beside the UI blocks:
 *   ActionRow   `.ps-action`: icon, label with note, a value or a chevron; tone attention (accent) or danger
 *   PickRow     `.ps-pick`: a box (several) or a ring (one) on the left, the chosen one in the accent
 *   SearchField `.ps-search`: a 48dp pill with the search icon and a clear button
 *   Facts       `.ps-facts`: label/value pairs in one block
 *   FloatStatus `.ps-float`: one status above the bottom bar (a scan), with its progress line
 */

/** AniList formats in the app language (phone-screen.tsx FORMAT_LABELS) */
export const FORMAT_LABELS: Record<string, [string, string]> = {
    TV: ["TV", "TV"], TV_SHORT: ["TV short", "TV-Kurzserie"], MOVIE: ["Movie", "Film"], SPECIAL: ["Special", "Special"], OVA: ["OVA", "OVA"],
    ONA: ["ONA", "ONA"], MUSIC: ["Music", "Musik"], MANGA: ["Manga", "Manga"], NOVEL: ["Novel", "Roman"], ONE_SHOT: ["One shot", "One-Shot"],
}

export function RowGroup({ children, className }: { children: React.ReactNode, className?: string }) {
    return <View className={cn("gap-0.5 overflow-hidden rounded-surface", className)}>{children}</View>
}

export function ActionRow({ icon: Icon, label, note, value, chevron, trailing, tone, disabled, onPress }: {
    icon?: React.ComponentType<{ size?: number, color?: string }>
    label: string
    note?: string
    value?: string | number
    chevron?: boolean
    /** in place of the chevron, e.g. the ↗ of a link that leaves the app (`.ps-action-chevron`) */
    trailing?: React.ReactNode
    tone?: "attention" | "danger"
    disabled?: boolean
    onPress?: () => void
}) {
    const iconColor = tone === "attention" ? colors.smAccent : tone === "danger" ? colors.smDanger : colors.smTextMuted
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[label, value, note].filter(v => v !== undefined && v !== "").join(", ")}
            disabled={disabled || !onPress}
            onPress={onPress}
            className={cn("min-h-14 w-full flex-row items-center gap-3.5 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control", disabled && "opacity-60")}
        >
            {!!Icon && <Icon size={20} color={iconColor} />}
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className={cn("text-[15px]", tone === "danger" && "text-sm-danger")}>{label}</Text>
                {!!note && <Muted className="leading-[19px]">{note}</Muted>}
            </View>
            {value !== undefined && value !== "" && (
                <Text className={cn("max-w-[45%] text-right text-sm font-semibold", tone === "attention" ? "text-sm-accent" : "text-sm-text-muted")}>{value}</Text>
            )}
            {chevron && <ChevronRight size={18} color={colors.smTextSubtle} />}
            {trailing}
        </Pressable>
    )
}

export function PickRow({ checked, radio, label, note, media, onPress }: {
    checked: boolean
    radio?: boolean
    label: string
    note?: string
    /** a small cover in front of the text */
    media?: React.ReactNode
    onPress: () => void
}) {
    return (
        <Pressable
            accessibilityRole={radio ? "radio" : "checkbox"}
            accessibilityState={{ checked }}
            accessibilityLabel={note ? `${label}, ${note}` : label}
            onPress={onPress}
            className="min-h-[52px] w-full flex-row items-center gap-3.5 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control"
        >
            <View
                className={cn("h-[22px] w-[22px] items-center justify-center", radio ? "rounded-full" : "rounded-[6px]",
                    checked && !radio ? "bg-sm-accent-strong" : "border-2",
                    checked ? "border-sm-accent-strong" : "border-sm-text-subtle")}
            >
                {checked && !radio && <Check size={16} color="#ffffff" strokeWidth={3} />}
                {checked && radio && <View className="h-2.5 w-2.5 rounded-full bg-sm-accent-strong" />}
            </View>
            {media}
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-[15px]">{label}</Text>
                {!!note && <Muted className="leading-[19px]">{note}</Muted>}
            </View>
        </Pressable>
    )
}

export function SearchField({ value, onChangeText, placeholder, inputRef, onSubmit, onFocus }: {
    value: string
    onChangeText: (value: string) => void
    placeholder: string
    inputRef?: React.Ref<TextInputInstance>
    /** the keyboard's search key (Enter) */
    onSubmit?: () => void
    /** e.g. scroll the field to the top, so the hits show above the keyboard (My lists) */
    onFocus?: () => void
}) {
    const t = useTr()
    return (
        <View className="min-h-12 flex-row items-center rounded-full bg-sm-surface-raised">
            <View className="pl-4 pr-2.5"><Search size={18} color={colors.smTextSubtle} /></View>
            <TextInput
                ref={inputRef}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={colors.smTextSubtle}
                accessibilityLabel={placeholder}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={onSubmit}
                onFocus={onFocus}
                numberOfLines={1}
                className="min-h-12 flex-1 font-sans text-base text-sm-text"
            />
            {!!value && (
                <Pressable accessibilityRole="button" accessibilityLabel={t("Clear", "Leeren")} onPress={() => onChangeText("")}
                    className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                    <X size={18} color={colors.smTextMuted} />
                </Pressable>
            )}
        </View>
    )
}

export function Facts({ items }: { items: { label: string, value: React.ReactNode, note?: string }[] }) {
    return (
        <View className="gap-0.5 overflow-hidden rounded-surface">
            {items.map(item => (
                <View key={item.label} className="flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-sm-surface-raised px-4 py-3">
                    <Text className="text-sm text-sm-text-muted">{item.label}</Text>
                    <View className="ml-auto items-end">
                        {typeof item.value === "string" || typeof item.value === "number"
                            ? <Text className="text-right text-base font-semibold">{item.value}</Text>
                            : item.value}
                        {!!item.note && <Text className="text-xs text-sm-text-subtle">{item.note}</Text>}
                    </View>
                </View>
            ))}
        </View>
    )
}

/**
 * `.ps-choices` (PhoneChips "wrap"): chips that wrap to the next line, several or one chosen; the chosen ones in the
 * accent, with a check when `showCheck`.
 */
export function Choices({ label, chips, selected, onToggle, showCheck, quiet, onRaised }: {
    label: string
    /** `count` shows quietly after the label (My lists: titles of the shown list with that value) */
    chips: { value: string, label: string, count?: number }[]
    selected: string[]
    onToggle: (value: string) => void
    showCheck?: boolean
    /** chips without hits in the shown list (`.pl-chips-quiet`): sunken and subtler until chosen */
    quiet?: boolean
    /** chips inside a raised block (the settings' `.pst-chips`): unchosen ones on the control surface */
    onRaised?: boolean
}) {
    return (
        <View accessibilityRole="none" accessibilityLabel={label} className="flex-row flex-wrap gap-2">
            {chips.map(chip => {
                const pressed = selected.includes(chip.value)
                return (
                    <Pressable key={chip.value} accessibilityRole="togglebutton" accessibilityState={{ checked: pressed }}
                        accessibilityLabel={chip.count === undefined ? chip.label : `${chip.label}, ${chip.count}`}
                        onPress={() => onToggle(chip.value)}
                        className={cn("min-h-12 flex-row items-center gap-1.5 rounded-full px-3.5",
                            pressed ? "bg-sm-accent-soft active:bg-sm-surface-control" : quiet ? "bg-sm-surface-sunken active:bg-sm-surface-control"
                                : onRaised ? "bg-sm-surface-control active:bg-sm-line-strong" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                        {showCheck && pressed && <Check size={16} color={colors.smAccent} strokeWidth={2.5} />}
                        <Text className={cn("text-sm", pressed ? "font-semibold text-sm-accent" : quiet ? "font-medium text-sm-text-subtle" : "font-medium text-sm-text-muted")}>{chip.label}</Text>
                        {chip.count !== undefined && <Text className={cn("text-sm", pressed ? "font-semibold text-sm-accent" : "text-sm-text-subtle")}
                            style={{ fontVariant: ["tabular-nums"] }}>{chip.count}</Text>}
                    </Pressable>
                )
            })}
        </View>
    )
}

/** `.ps-notice`: a failed block, one sentence and its text actions (try again, a way around) */
export function Notice({ text, children }: { text: string, children?: React.ReactNode }) {
    return (
        <View accessibilityRole="alert" className="gap-1 rounded-surface bg-sm-surface-raised px-4 pb-1 pt-4">
            <Text className="text-[15px] leading-[22.5px]">{text}</Text>
            {children ? <View className="-mx-2 flex-row flex-wrap gap-x-4">{children}</View> : <View className="h-3" />}
        </View>
    )
}

/** `.ps-text-action`: the accent text button of a head or a notice */
export function TextAction({ label, onPress, disabled, expanded, accessibilityLabel }: {
    label: string
    onPress: () => void
    disabled?: boolean
    expanded?: boolean
    /** when the label alone is unclear ("Clear" → "Clear genres") */
    accessibilityLabel?: string
}) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!disabled, expanded }} disabled={disabled} onPress={onPress}
            className={cn("min-h-12 justify-center rounded-full px-2 active:bg-sm-surface-control", disabled && "opacity-50")}>
            <Text className="text-[15px] font-semibold text-sm-accent">{label}</Text>
        </Pressable>
    )
}

/** `.ps-more`: a quiet centred "show more" line, 48dp tall, .875rem in the muted colour */
export function MoreAction({ label, onPress }: { label: string, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" onPress={onPress} className="min-h-12 flex-row items-center justify-center gap-2 px-4 py-2">
            <Text className="text-sm leading-[21px] text-sm-text-muted">{label}</Text>
        </Pressable>
    )
}

/** `.ps-loading` with row bones: the shape of a list that is still loading */
export function LoadingRows({ label, count = 4 }: { label: string, count?: number }) {
    return (
        <View accessibilityRole="progressbar" accessibilityLabel={label} className="gap-3">
            {Array.from({ length: count }, (_, i) => <View key={i} className="h-[76px] rounded-surface-sm bg-sm-surface-raised" />)}
        </View>
    )
}

/** Above the phone's bottom bar (tablet: at the foot of the content beside the rail); hidden while a sheet covers the page. */
export function FloatStatus({ text, detail, progress, children }: { text: string, detail?: string, progress?: number, children?: React.ReactNode }) {
    const insets = useSafeAreaInsets()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={detail ? `${text}, ${detail}` : text}
            style={{ bottom: (rail ? 16 : barHeight + 12) + insets.bottom, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 }}
            className="absolute left-4 right-4 max-w-[512px] self-center flex-row items-center gap-3 rounded-surface bg-sm-surface-control py-2 pl-4 pr-2 min-h-14"
        >
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-sm leading-[20px]">{text}</Text>
                {!!detail && <Muted numberOfLines={1}>{detail}</Muted>}
            </View>
            {children}
            {progress != null && (
                <View className="absolute bottom-0 left-4 right-4 h-[3px] overflow-hidden rounded-full bg-sm-line-strong">
                    <View style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} className="h-full bg-sm-accent-strong" />
                </View>
            )}
        </View>
    )
}
