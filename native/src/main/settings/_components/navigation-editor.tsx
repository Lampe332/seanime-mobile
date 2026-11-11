import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { appLanguageAtom, useTr } from "@/lib/app-language"
import { MobileIcon, type MobileIconName } from "@/lib/mobile-icons"
import { MAX_NAV_ITEMS, menuTargets, moveInBar, moveToBar, moveToMenu, navCount, navIcon, navLabel, type NavEditResult } from "@/lib/nav/nav-items"
import { saveNavItems, useAllNavItems } from "@/lib/nav/nav-store"
import { colors } from "@/lib/theme/tokens"
import { useAtomValue } from "jotai"
import ArrowDown from "lucide-react-native/icons/arrow-down"
import ArrowUp from "lucide-react-native/icons/arrow-up"
import Check from "lucide-react-native/icons/check"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * Customize navigation (UIBottomNav.kt edit mode): the bar's entries and the Menu's, a tap moves an entry between them, at
 * most MAX_NAV_ITEMS in the bar, the Menu button always stays. The old panel reordered by dragging a grip; here the bar's
 * entries move with ↑/↓ (Karte §9). Every change is stored at once under the old keys, so the bar follows behind the sheet.
 */
export function NavigationEditor({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    const language = useAtomValue(appLanguageAtom)
    const items = useAllNavItems()
    const [notice, setNotice] = React.useState<string | null>(null)
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current)
    }, [])

    const bar = items.filter(it => it.placement === "nav")
    const menu = menuTargets(items)

    // A refusal shows in the head for a moment in place of the count (showEditNotice)
    const apply = (result: NavEditResult) => {
        if ("items" in result) {
            saveNavItems(result.items)
            return
        }
        setNotice(result.refused === "full"
            ? t(`The bar is full (${MAX_NAV_ITEMS}/${MAX_NAV_ITEMS})`, `Leiste ist voll (${MAX_NAV_ITEMS}/${MAX_NAV_ITEMS})`)
            : t("Menu always stays in the bar", "Menü bleibt immer in der Leiste"))
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setNotice(null), 2200)
    }

    return <Sheet title={t("Customize navigation", "Navigation anpassen")} open={open} onOpenChange={onOpenChange}
        description={t(`Tap an item to move it into the bar or back into the menu. Up to ${MAX_NAV_ITEMS} in the bar. The arrows change the order.`,
            `Tippe einen Eintrag, um ihn in die Leiste zu holen oder zurück ins Menü zu geben. Maximal ${MAX_NAV_ITEMS} in der Leiste. Die Pfeile ändern die Reihenfolge.`)}
        footer={<Button wrapperClassName="flex-1" onPress={() => onOpenChange(false)}>{t("Done", "Fertig")}</Button>}>
        <Text accessibilityLiveRegion="polite" className={cn("text-sm font-semibold", notice ? "text-sm-warning" : "text-sm-text-muted")}>
            {notice ?? t(`In the bar: ${navCount(items)}/${MAX_NAV_ITEMS}`, `In der Leiste: ${navCount(items)}/${MAX_NAV_ITEMS}`)}
        </Text>

        <SheetGroup title={t("In the bar", "In der Leiste")}>
            <View className="gap-0.5 overflow-hidden rounded-surface">
                {bar.map((item, i) => {
                    const label = navLabel(item.label, language)
                    return <EditRow key={item.id} icon={item.isMenu ? "menu" : navIcon(item)} label={label}
                        accessibilityLabel={item.isMenu ? `${label}${t(" – always stays in the bar", " – bleibt immer in der Leiste")}`
                            : `${label}${t(" – move back to the menu", " – zurück ins Menü geben")}`}
                        onPress={() => apply(moveToMenu(items, item.id))}
                        trailing={item.isMenu
                            ? <Text className="text-[13px] font-semibold text-sm-text-subtle">{t("Fixed", "Fest")}</Text>
                            : <View className="flex-row items-center">
                                <Check size={18} color={colors.smAccent} />
                                <ArrowButton label={t(`Move ${label} up`, `${label} nach oben`)} disabled={i === 0}
                                    onPress={() => saveNavItems(moveInBar(items, item.id, -1))} up />
                                <ArrowButton label={t(`Move ${label} down`, `${label} nach unten`)} disabled={i === bar.length - 1}
                                    onPress={() => saveNavItems(moveInBar(items, item.id, 1))} />
                            </View>} />
                })}
            </View>
        </SheetGroup>

        <SheetGroup title={t("In the menu", "Im Menü")}>
            {menu.length
                ? <View className="gap-0.5 overflow-hidden rounded-surface">
                    {menu.map(target => {
                        const label = navLabel(target.label, language)
                        return <EditRow key={target.id} icon={target.icon} label={label}
                            accessibilityLabel={`${label}${t(" – move into the bar", " – in die Leiste holen")}`}
                            onPress={() => apply(moveToBar(items, target))} />
                    })}
                </View>
                : <Muted>{t("No more items in the menu.", "Keine weiteren Einträge im Menü.")}</Muted>}
        </SheetGroup>
    </Sheet>
}

function EditRow({ icon, label, accessibilityLabel, onPress, trailing }: {
    icon: MobileIconName
    label: string
    accessibilityLabel: string
    onPress: () => void
    trailing?: React.ReactNode
}) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
            className="min-h-14 flex-row items-center gap-3.5 bg-sm-surface-raised py-1 pl-4 pr-1 active:bg-sm-surface-control">
            <MobileIcon name={icon} size={22} color={colors.smTextMuted} />
            <Text className="min-w-0 flex-1 text-[15px]">{label}</Text>
            {trailing}
        </Pressable>
    )
}

function ArrowButton({ label, disabled, onPress, up }: { label: string, disabled: boolean, onPress: () => void, up?: boolean }) {
    const Icon = up ? ArrowUp : ArrowDown
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
            className={cn("h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control", disabled && "opacity-30")}>
            <Icon size={20} color={colors.smTextMuted} />
        </Pressable>
    )
}
