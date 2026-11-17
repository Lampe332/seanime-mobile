import { colors } from "@/lib/theme/tokens"
import { useTr } from "@/lib/app-language"
import { Image } from "expo-image"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

/*
 * One page of a chapter (chapter-page.tsx): expo-image with a spinner while it loads; a failed page tries again up to
 * three times one second apart, then shows a retry button. The page reports its picture size once loaded, so the reader
 * lays it out at its real shape. The reader sizes the page for every fit (Original too), so the picture always fills it:
 * expo-image's "none" draws in raw pixels and left Original a small picture in the middle of a dp-sized page.
 */
export const ChapterPage = React.memo(function ChapterPage({ url, headers, index, width, height, onSize, onLoaded, recycle }: {
    url: string | undefined
    /** Headers the picture needs, given straight to it (area manga on, §4n) */
    headers?: Record<string, string>
    index: number
    width: number
    height: number
    onSize?: (index: number, size: { width: number, height: number }) => void
    onLoaded?: (index: number) => void
    /** FlashList reuses the view: a new page must not show the previous one's picture for a frame */
    recycle?: boolean
}) {
    const t = useTr()
    const [attempt, setAttempt] = React.useState(0)
    const [failed, setFailed] = React.useState(false)
    const [loaded, setLoaded] = React.useState(false)
    // a new page (or a new address) starts over
    const [shownUrl, setShownUrl] = React.useState(url)
    if (shownUrl !== url) {
        setShownUrl(url)
        setAttempt(0)
        setFailed(false)
        setLoaded(false)
    }
    React.useEffect(() => {
        if (!failed || attempt >= 3) return
        const timer = setTimeout(() => {
            setFailed(false)
            setAttempt(a => a + 1)
        }, 1000)
        return () => clearTimeout(timer)
    }, [failed, attempt])

    return <View style={{ width, height }} className="items-center justify-center">
        {!!url && <Image
            key={attempt}
            source={headers ? { uri: url, headers } : url}
            recyclingKey={recycle ? `${url}#${attempt}` : undefined}
            contentFit="contain"
            cachePolicy="memory-disk"
            style={{ width, height }}
            accessibilityLabel={t(`Page ${index + 1}`, `Seite ${index + 1}`)}
            accessibilityIgnoresInvertColors
            onLoad={event => {
                setLoaded(true)
                onSize?.(index, { width: event.source.width, height: event.source.height })
                onLoaded?.(index)
            }}
            onError={() => setFailed(true)}
        />}
        {(!url || (!loaded && !(failed && attempt >= 3))) && <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <ActivityIndicator color={colors.smTextMuted} />
        </View>}
        {failed && attempt >= 3 && <View className="absolute inset-0 items-center justify-center">
            <Pressable accessibilityRole="button" accessibilityLabel={t("Load the page again", "Seite erneut laden")} onPress={() => {
                setFailed(false)
                setAttempt(a => a + 1)
            }} className="h-12 w-12 items-center justify-center rounded-full bg-white active:opacity-80">
                <RotateCw size={20} color="#111" />
            </Pressable>
        </View>}
    </View>
})
