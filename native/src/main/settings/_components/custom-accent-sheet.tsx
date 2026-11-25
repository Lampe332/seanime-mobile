import { Button } from "@/components/ui/button/button"
import { ColorWheel } from "@/components/ui/color-wheel/color-wheel"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import type { Translate } from "@/lib/app-language"
import { useThemeColors } from "@/lib/theme/appearance"
import { type AccentId, buildPalette, customAccent, hsvToRgb, parseHexColor, rgbToHsv, type RGB, toHex } from "@/lib/theme/palette"
import { accentInput } from "@/lib/theme/tokens"
import React from "react"
import { TextInput, View } from "react-native"

const code = (color: RGB) => toHex(color).toUpperCase()

/**
 * An own accent colour: the wheel or a #RRGGBB code, with a preview of the accent it gives. Only Apply changes the app.
 * The picked colour sets hue and saturation; the palette sets the brightness of each use (palette.ts, customPreset), so
 * the preview can be lighter or darker than the spot on the wheel. Mounted anew for each opening (key).
 */
export function CustomAccentSheet({ t, open, onOpenChange, initial, amoled, onApply }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    initial: RGB
    amoled: boolean
    onApply: (accent: AccentId) => void
}) {
    const colors = useThemeColors()
    const [color, setColor] = React.useState(initial)
    const [text, setText] = React.useState(() => code(initial))
    const [place, setPlace] = React.useState(() => {
        const [hue, saturation] = rgbToHsv(initial)
        return { hue, saturation }
    })
    const valid = parseHexColor(text) !== null
    const look = buildPalette(customAccent(color), amoled).js
    const label = t("Color code", "Farbcode")

    const apply = () => {
        if (!valid) return
        onOpenChange(false)
        onApply(customAccent(color))
    }
    return <Sheet title={t("Custom color", "Eigene Farbe")} open={open} onOpenChange={onOpenChange}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" onPress={() => onOpenChange(false)}>{t("Cancel", "Abbrechen")}</Button>
            <Button wrapperClassName="flex-1" disabled={!valid} onPress={apply}>{t("Apply", "Übernehmen")}</Button>
        </>}>
        <View className="gap-4">
            <View className="items-center">
                <ColorWheel accessibilityLabel={t("Color wheel", "Farbrad")} hue={place.hue} saturation={place.saturation}
                    onChange={(hue, saturation) => {
                        const next = hsvToRgb(hue, saturation, 1)
                        setPlace({ hue, saturation })
                        setColor(next)
                        setText(code(next))
                    }} />
            </View>
            <View accessible accessibilityLabel={`${t("Preview", "Vorschau")}: ${code(color)}`} className="gap-3 rounded-surface p-3"
                style={{ backgroundColor: look.smSurfaceRaised }}>
                <View className="h-14 items-center justify-center rounded-surface-sm" style={{ backgroundColor: look.brand500 }}>
                    <Text className="text-base font-semibold" style={{ color: "#ffffff" }}>{t("Preview", "Vorschau")}</Text>
                </View>
                <View className="flex-row items-center justify-between">
                    <View className="h-8 justify-center rounded-full px-3" style={{ backgroundColor: look.smAccentSoft }}>
                        <Text className="text-[13px] font-semibold" style={{ color: look.smAccent }}>{code(color)}</Text>
                    </View>
                    <View className="h-7 w-12 rounded-full" style={{ backgroundColor: look.smAccentStrong }}>
                        <View className="absolute right-1 top-1 h-5 w-5 rounded-full bg-white" />
                    </View>
                </View>
            </View>
            <View className="gap-2">
                <Text className="text-[15px] font-semibold">{label}</Text>
                <TextInput {...accentInput} value={text} placeholder="#7C5CFF" placeholderTextColor={colors.smTextSubtle}
                    accessibilityLabel={label} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={7}
                    returnKeyType="done" onSubmitEditing={apply}
                    onChangeText={value => {
                        setText(value)
                        const typed = parseHexColor(value)
                        if (!typed) return
                        const [hue, saturation] = rgbToHsv(typed)
                        setColor(typed)
                        setPlace({ hue, saturation })
                    }}
                    className={cn("min-h-[52px] rounded-surface bg-sm-surface-raised px-4 py-3 font-sans text-base text-sm-text", !valid && "border-2 border-sm-danger")} />
                <Text accessibilityRole={valid ? undefined : "alert"} className={cn("text-[13px] leading-[19.5px]", valid ? "text-sm-text-muted" : "text-sm-danger")}>
                    {valid
                        ? t("Pick any color. Its brightness is adjusted so text stays readable.", "Wähle eine beliebige Farbe. Die Helligkeit wird angepasst, damit Text lesbar bleibt.")
                        : t("Enter a color like #7C5CFF.", "Gib eine Farbe wie #7C5CFF ein.")}
                </Text>
            </View>
        </View>
    </Sheet>
}
