import { PhoneSection } from "@/components/shared/phone-cards"
import { Notice, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Muted } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { saveExport } from "@/lib/file-transfer"
import { usePalette } from "@/lib/theme/appearance"
import type { WrappedView } from "@/main/lists/_lib/wrapped"
import { wrappedFormats } from "@/main/wrapped/_components/wrapped-cards"
import { WrappedShareImage } from "@/main/wrapped/_components/wrapped-share-image"
import { base64ToBytes, buildShareCard, SHARE_HEIGHT, SHARE_WIDTH } from "@/main/wrapped/_lib/wrapped-share"
import { Image } from "expo-image"
import Share2 from "lucide-react-native/icons/share-2"
import React from "react"
import { View } from "react-native"
import type Svg from "react-native-svg"

/** Wait after a change before drawing: the new props reach the native view first, and quick accent changes draw once */
const CAPTURE_DELAY = 250
/** A capture that does not answer by then counts as failed */
const CAPTURE_TIMEOUT = 10_000
/** Every PNG starts with these bytes ("\x89PNG\r\n\x1a\n"), in Base64 */
const PNG_START = "iVBORw0KGgo"
const FRAME = { aspectRatio: SHARE_WIDTH / SHARE_HEIGHT }
const FILL = { position: "absolute", inset: 0 } as const
/** Made PNGs by card and accent: the page is built anew on every visit, and a capture blocks the UI thread (S22: 150 ms) */
const made = new Map<string, string>()
const MADE_MAX = 8

function remember(image: string, png: string) {
    made.delete(image)
    made.set(image, png)
    if (made.size > MADE_MAX) made.delete(made.keys().next().value as string)
}

/**
 * The end of "Your year": the year as one picture to post. The SVG (WrappedShareImage) is drawn under the preview and
 * turned into a 1080 x 1350 PNG with toDataURL; the preview shows that PNG, and "Share image" hands its bytes to the
 * share sheet. A new year, accent or language draws a new PNG.
 */
export function WrappedShareSection({ view }: { view: WrappedView }) {
    const t = useTr()
    const palette = usePalette()
    const card = buildShareCard(view, t, wrappedFormats(t))
    const svgRef = React.useRef<Svg>(null)
    const [attempt, setAttempt] = React.useState(0)
    const [result, setResult] = React.useState<{ key: string, png: string | null }>({ key: "", png: null })
    const [sharing, setSharing] = React.useState(false)
    const image = `${JSON.stringify(card)}|${palette.swatch}|${palette.amoled}`
    const key = `${image}|${attempt}`
    const png = made.get(image) ?? (result.key === key ? result.png : null)
    const failed = !png && result.key === key

    React.useEffect(() => {
        if (made.has(image)) return
        let settled = false
        let limit: ReturnType<typeof setTimeout> | undefined
        const finish = (data: string | null) => {
            if (settled) return
            settled = true
            clearTimeout(limit)
            if (data) remember(image, data)
            setResult({ key, png: data })
        }
        const wait = setTimeout(() => {
            const svg = svgRef.current
            if (!svg) return finish(null)
            try {
                svg.toDataURL(data => finish(typeof data === "string" && data.startsWith(PNG_START) ? data : null),
                    { width: SHARE_WIDTH, height: SHARE_HEIGHT })
            }
            catch {
                finish(null)
            }
        }, CAPTURE_DELAY)
        limit = setTimeout(() => finish(null), CAPTURE_TIMEOUT)
        return () => {
            settled = true
            clearTimeout(wait)
            clearTimeout(limit)
        }
    }, [key, image])

    const share = async () => {
        if (!png || sharing) return
        setSharing(true)
        try {
            await saveExport(base64ToBytes(png), `seanime-${view.year}.png`, "image/png")
        }
        catch {
            made.delete(image)
            setResult({ key, png: null })
        }
        finally {
            setSharing(false)
        }
    }

    const summary = [card.heading, ...card.stats.map(stat => `${stat.value.replace("≈ ", t("about ", "etwa "))} ${stat.label}`)].join(", ")

    return (
        <PhoneSection title={t("Share your year", "Dein Jahr teilen")}>
            <View className="w-full max-w-[400px] gap-4 self-center">
                <View className="w-full overflow-hidden rounded-surface bg-sm-surface-raised" style={FRAME}>
                    {/* the drawing the PNG is made from, only until it is made; the placeholder covers it */}
                    {!png && <View className="absolute inset-0" importantForAccessibility="no-hide-descendants">
                        <WrappedShareImage ref={svgRef} card={card} t={t} />
                    </View>}
                    {png
                        ? <Image source={{ uri: `data:image/png;base64,${png}` }} cachePolicy="none" contentFit="cover"
                            style={FILL} accessibilityLabel={summary} accessible accessibilityIgnoresInvertColors />
                        : <View className="absolute inset-0 items-center justify-center bg-sm-surface-raised p-4" accessibilityLiveRegion="polite">
                            {failed
                                ? <View className="w-full">
                                    <Notice text={t("The image could not be made.", "Das Bild konnte nicht erstellt werden.")}>
                                        <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => setAttempt(value => value + 1)} />
                                    </Notice>
                                </View>
                                : <Muted>{t("Making your image", "Bild wird erstellt")}</Muted>}
                        </View>}
                </View>
                <Button intent="primary" disabled={!png} loading={sharing} onPress={() => void share()}
                    leftIcon={<Share2 size={18} color="#ffffff" />}>
                    {t("Share image", "Bild teilen")}
                </Button>
            </View>
        </PhoneSection>
    )
}
