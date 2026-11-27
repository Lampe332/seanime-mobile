import { PhoneSection } from "@/components/shared/phone-cards"
import { Notice, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { whenPagesQuiet } from "@/components/ui/core/page-transition"
import { Muted } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { saveExport } from "@/lib/file-transfer"
import { usePalette } from "@/lib/theme/appearance"
import type { WrappedView } from "@/main/lists/_lib/wrapped"
import { wrappedFormats } from "@/main/wrapped/_components/wrapped-cards"
import { SHARE_PARTS, WrappedShareImage } from "@/main/wrapped/_components/wrapped-share-image"
import { base64ToBytes, buildShareCard, SHARE_HEIGHT, SHARE_WIDTH } from "@/main/wrapped/_lib/wrapped-share"
import Share2 from "lucide-react-native/icons/share-2"
import React from "react"
import { View } from "react-native"
import type Svg from "react-native-svg"

/** A capture that does not answer by then counts as failed */
const CAPTURE_TIMEOUT = 10_000
/** Every PNG starts with these bytes ("\x89PNG\r\n\x1a\n"), in Base64 */
const PNG_START = "iVBORw0KGgo"
const FRAME = { aspectRatio: SHARE_WIDTH / SHARE_HEIGHT }
/** Made PNGs by card and accent: a capture blocks the UI thread (S22: 150 ms), a second "Share image" reuses the first */
const made = new Map<string, string>()
const MADE_MAX = 8

function remember(image: string, png: string) {
    made.delete(image)
    made.set(image, png)
    if (made.size > MADE_MAX) made.delete(made.keys().next().value as string)
}

/** Two frames: a state set before is on the screen by then */
function drawn() {
    return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** The SVG as a 1080 x 1350 PNG in Base64, null when it could not be made */
function capture(svg: Svg | null) {
    return new Promise<string | null>(resolve => {
        if (!svg) return resolve(null)
        let settled = false
        const finish = (data: string | null) => {
            if (settled) return
            settled = true
            clearTimeout(limit)
            resolve(data)
        }
        const limit = setTimeout(() => finish(null), CAPTURE_TIMEOUT)
        try {
            svg.toDataURL(data => finish(typeof data === "string" && data.startsWith(PNG_START) ? data : null),
                { width: SHARE_WIDTH, height: SHARE_HEIGHT })
        }
        catch {
            finish(null)
        }
    })
}

/**
 * The end of "Your year": the year as one picture to post. The preview is the SVG itself (WrappedShareImage); "Share
 * image" turns it into a 1080 x 1350 PNG with toDataURL and hands its bytes to the share sheet.
 * Making the PNG ahead and drawing the whole SVG in one frame cost the first open of "Your year" its smoothness (S22
 * 27.11.: toDataURL a 181 ms frame, the SVG's first draw 42 ms in a 65 ms frame). So the PNG is made on the tap, and the
 * SVG is drawn in parts, one per frame, once no finger is on the page and no page is coming in (whenPagesQuiet).
 */
export function WrappedShareSection({ view }: { view: WrappedView }) {
    const t = useTr()
    const palette = usePalette()
    const card = buildShareCard(view, t, wrappedFormats(t))
    const svgRef = React.useRef<Svg>(null)
    const [parts, setParts] = React.useState(0)
    const [sharing, setSharing] = React.useState(false)
    const [failedImage, setFailedImage] = React.useState<string | null>(null)
    const image = `${JSON.stringify(card)}|${palette.swatch}|${palette.amoled}`
    const ready = parts >= SHARE_PARTS
    const failed = failedImage === image

    React.useEffect(() => {
        if (parts >= SHARE_PARTS) return
        if (parts === 0) return whenPagesQuiet(() => setParts(1))
        const frame = requestAnimationFrame(() => setParts(parts + 1))
        return () => cancelAnimationFrame(frame)
    }, [parts])

    const share = async () => {
        if (!ready || sharing) return
        setSharing(true)
        setFailedImage(null)
        try {
            let png = made.get(image) ?? null
            if (!png) {
                // the button's loading state is drawn before the capture holds the UI thread
                await drawn()
                png = await capture(svgRef.current)
                if (!png) return setFailedImage(image)
                remember(image, png)
            }
            await saveExport(base64ToBytes(png), `seanime-${view.year}.png`, "image/png")
        }
        catch {
            made.delete(image)
        }
        finally {
            setSharing(false)
        }
    }

    const summary = [card.heading, ...card.stats.map(stat => `${stat.value.replace("≈ ", t("about ", "etwa "))} ${stat.label}`)].join(", ")

    return (
        <PhoneSection title={t("Share your year", "Dein Jahr teilen")}>
            <View className="w-full max-w-[400px] gap-4 self-center">
                <View className="w-full overflow-hidden rounded-surface bg-sm-surface-raised" style={FRAME}
                    accessible={ready && !failed} accessibilityRole="image" accessibilityLabel={summary}>
                    {/* the preview, and the drawing the PNG is made from; the placeholder covers it until all parts are drawn */}
                    {parts > 0 && <View className="absolute inset-0" importantForAccessibility="no-hide-descendants">
                        <WrappedShareImage ref={svgRef} card={card} t={t} parts={parts} />
                    </View>}
                    {(!ready || failed) && (
                        <View className="absolute inset-0 items-center justify-center bg-sm-surface-raised p-4" accessibilityLiveRegion="polite">
                            {failed
                                ? <View className="w-full">
                                    <Notice text={t("The image could not be made.", "Das Bild konnte nicht erstellt werden.")}>
                                        <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void share()} />
                                    </Notice>
                                </View>
                                : <Muted>{t("Making your image", "Bild wird erstellt")}</Muted>}
                        </View>
                    )}
                </View>
                <Button intent="primary" disabled={!ready} loading={sharing} onPress={() => void share()}
                    leftIcon={<Share2 size={18} color="#ffffff" />}>
                    {t("Share image", "Bild teilen")}
                </Button>
            </View>
        </PhoneSection>
    )
}
