import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { useEffectiveReadingMode, useMangaPageZoomControls } from "@/main/manga/_lib/handle-chapter-reader"
import {
    __manga_autoHideControlsAtom,
    __manga_doublePageOffsetAtom,
    __manga_entryReaderSettings,
    __manga_hiddenBarAtom,
    __manga_keepScreenOnAtom,
    __manga_pageFitAtom,
    __manga_pageGapAtom,
    __manga_pageGapShadowAtom,
    __manga_pageOverflowContainerWidthAtom,
    __manga_pageStretchAtom,
    __manga_readerBackgroundAtom,
    __manga_readerBrightnessAtom,
    __manga_readingDirectionAtom,
    __manga_readingModeAtom,
    __manga_tapToggleControlsAtom,
    MANGA_PAGE_ZOOM_DEFAULT,
    MANGA_PAGE_ZOOM_MAX,
    MANGA_PAGE_ZOOM_MIN,
    MANGA_PAGE_ZOOM_STEP,
    MANGA_SETTINGS_ATOM_KEYS,
    type MangaReaderBackground,
    MangaPageFit,
    MangaPageStretch,
    MangaReadingDirection,
    MangaReadingMode,
} from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { MANGA_READING_MODE_AUTO } from "@/main/manga/_lib/reader-mode"
import { atom, useAtom } from "jotai"
import Minus from "lucide-react-native/icons/minus"
import Plus from "lucide-react-native/icons/plus"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * Reader settings (chapter-reader-settings.tsx + chapter-reader-settings-mobile.css): one sheet with the groups Reading
 * (mode, direction, tap to toggle the controls, hide them while scrolling, page offset), Page (fit, zoom, page width, same
 * width, reset) and Display (background, brightness, keep the screen on, gap and its shadow, hide the controls). Same atoms
 * and keys as before; mode, direction and the page layout are remembered per manga ("sea-manga-entry-reader-settings").
 */

export const __manga_readerSettingsOpenAtom = atom(false)

const DEFAULT_LAYOUT: Record<string, { pageFit: string, pageStretch: string }> = {
    [MangaReadingMode.LONG_STRIP]: { pageFit: MangaPageFit.COVER, pageStretch: MangaPageStretch.NONE },
    [MangaReadingMode.PAGED]: { pageFit: MangaPageFit.CONTAIN, pageStretch: MangaPageStretch.NONE },
    [MangaReadingMode.DOUBLE_PAGE]: { pageFit: MangaPageFit.CONTAIN, pageStretch: MangaPageStretch.NONE },
}

/** Loads this manga's remembered reader settings once, then stores every change for it. */
export function useEntryReaderSettings(mediaId: number) {
    const [readingDirection, setReadingDirection] = useAtom(__manga_readingDirectionAtom)
    const [readingMode, setReadingMode] = useAtom(__manga_readingModeAtom)
    const [pageFit, setPageFit] = useAtom(__manga_pageFitAtom)
    const [pageStretch, setPageStretch] = useAtom(__manga_pageStretchAtom)
    const [pageGap, setPageGap] = useAtom(__manga_pageGapAtom)
    const [pageGapShadow, setPageGapShadow] = useAtom(__manga_pageGapShadowAtom)
    const [doublePageOffset, setDoublePageOffset] = useAtom(__manga_doublePageOffsetAtom)
    const [overflowWidth, setOverflowWidth] = useAtom(__manga_pageOverflowContainerWidthAtom)
    const [entrySettings, setEntrySettings] = useAtom(__manga_entryReaderSettings)
    const loadedFor = React.useRef<number | null>(null)

    React.useEffect(() => {
        if (loadedFor.current === mediaId) return
        loadedFor.current = mediaId
        const settings = entrySettings[mediaId]
        if (!settings) return
        const k = MANGA_SETTINGS_ATOM_KEYS
        if (settings[k.readingDirection] !== undefined) setReadingDirection(settings[k.readingDirection])
        if (settings[k.readingMode] !== undefined) setReadingMode(settings[k.readingMode])
        if (settings[k.pageFit] !== undefined) setPageFit(settings[k.pageFit])
        if (settings[k.pageStretch] !== undefined) setPageStretch(settings[k.pageStretch])
        if (settings[k.pageGap] !== undefined) setPageGap(settings[k.pageGap])
        if (settings[k.pageGapShadow] !== undefined) setPageGapShadow(settings[k.pageGapShadow])
        if (settings[k.doublePageOffset] !== undefined) setDoublePageOffset(settings[k.doublePageOffset])
        if (settings[k.overflowPageContainerWidth] !== undefined) setOverflowWidth(settings[k.overflowPageContainerWidth])
    }, [mediaId, entrySettings, setReadingDirection, setReadingMode, setPageFit, setPageStretch, setPageGap, setPageGapShadow, setDoublePageOffset, setOverflowWidth])

    React.useEffect(() => {
        if (loadedFor.current !== mediaId) return
        const k = MANGA_SETTINGS_ATOM_KEYS
        const next = {
            [k.readingDirection]: readingDirection, [k.readingMode]: readingMode, [k.pageFit]: pageFit, [k.pageStretch]: pageStretch,
            [k.pageGap]: pageGap, [k.pageGapShadow]: pageGapShadow, [k.doublePageOffset]: doublePageOffset, [k.overflowPageContainerWidth]: overflowWidth,
        }
        setEntrySettings(prev => {
            const current = prev[mediaId]
            if (current && Object.keys(next).every(key => current[key] === next[key])) return prev
            return { ...prev, [mediaId]: next }
        })
    }, [mediaId, readingDirection, readingMode, pageFit, pageStretch, pageGap, pageGapShadow, doublePageOffset, overflowWidth, setEntrySettings])
}

export function ChapterReaderSettings() {
    const t = useTr()
    const isTablet = useIsTabletScreen()
    const [open, setOpen] = useAtom(__manga_readerSettingsOpenAtom)
    const [readingDirection, setReadingDirection] = useAtom(__manga_readingDirectionAtom)
    const [readingMode, setReadingMode] = useAtom(__manga_readingModeAtom)
    const effectiveMode = useEffectiveReadingMode()
    const [pageFit, setPageFit] = useAtom(__manga_pageFitAtom)
    const [pageStretch, setPageStretch] = useAtom(__manga_pageStretchAtom)
    const [pageGap, setPageGap] = useAtom(__manga_pageGapAtom)
    const [pageGapShadow, setPageGapShadow] = useAtom(__manga_pageGapShadowAtom)
    const [doublePageOffset, setDoublePageOffset] = useAtom(__manga_doublePageOffsetAtom)
    const [overflowWidth, setOverflowWidth] = useAtom(__manga_pageOverflowContainerWidthAtom)
    const { pageZoom, setZoom, resetZoom } = useMangaPageZoomControls()
    const [hiddenBar, setHideBar] = useAtom(__manga_hiddenBarAtom)
    const [keepScreenOn, setKeepScreenOn] = useAtom(__manga_keepScreenOnAtom)
    const [readerBackground, setReaderBackground] = useAtom(__manga_readerBackgroundAtom)
    const [readerBrightness, setReaderBrightness] = useAtom(__manga_readerBrightnessAtom)
    const [tapToggleControls, setTapToggleControls] = useAtom(__manga_tapToggleControlsAtom)
    const [autoHideControls, setAutoHideControls] = useAtom(__manga_autoHideControlsAtom)
    const layoutDefaults = DEFAULT_LAYOUT[effectiveMode] ?? DEFAULT_LAYOUT[MangaReadingMode.PAGED]
    const isDefaultLayout = pageFit === layoutDefaults.pageFit && pageStretch === layoutDefaults.pageStretch

    return <Sheet compact title={t("Reader settings", "Lese-Einstellungen")} open={open} onOpenChange={setOpen}>
        {/* `.reader-settings`: the groups 1rem apart (the sheet's own body gap is 1.25rem) */}
        <View className="gap-4 pb-1">
        <ReaderGroup title={t("Reading", "Lesen")}>
            <ReaderSegment label={t("Mode", "Modus")} value={readingMode} onChange={setReadingMode} options={[
                { value: MangaReadingMode.LONG_STRIP, label: t("Long strip", "Endlos") },
                { value: MangaReadingMode.PAGED, label: t("Single page", "Einzelseite") },
                { value: MangaReadingMode.DOUBLE_PAGE, label: t("Double page", "Doppelseite") },
                // tablets can pick by window shape; a stored choice stays visible when the device changed
                ...(isTablet || readingMode === MANGA_READING_MODE_AUTO ? [{ value: MANGA_READING_MODE_AUTO, label: t("Automatic", "Automatisch") }] : []),
            ]} note={readingMode === MANGA_READING_MODE_AUTO ? (effectiveMode === MangaReadingMode.DOUBLE_PAGE
                ? t("Double page in landscape, single page in portrait. Now: double page.", "Quer Doppelseite, hochkant Einzelseite. Gerade: Doppelseite.")
                : t("Double page in landscape, single page in portrait. Now: single page.", "Quer Doppelseite, hochkant Einzelseite. Gerade: Einzelseite.")) : undefined} />
            {effectiveMode !== MangaReadingMode.LONG_STRIP && <ReaderSegment label={t("Direction", "Richtung")} value={readingDirection} onChange={setReadingDirection} options={[
                { value: MangaReadingDirection.LTR, label: t("Left to right", "Links → rechts") },
                { value: MangaReadingDirection.RTL, label: t("Right to left", "Rechts → links") },
            ]} />}
            <ReaderSwitch label={t("Tap the middle to show or hide controls", "Mitte antippen blendet Steuerung ein/aus")} checked={tapToggleControls} onChange={setTapToggleControls} />
            {effectiveMode === MangaReadingMode.LONG_STRIP && <ReaderSwitch label={t("Hide controls while scrolling down", "Steuerung beim Runterscrollen ausblenden")}
                checked={autoHideControls} onChange={setAutoHideControls} />}
            {effectiveMode === MangaReadingMode.DOUBLE_PAGE && <ReaderStepper t={t} label={t("Page offset", "Seitenversatz")} value={doublePageOffset}
                display={String(doublePageOffset)} onChange={setDoublePageOffset} min={-10} max={10} step={1} />}
        </ReaderGroup>

        <ReaderGroup title={t("Page", "Seite")}>
            <ReaderSegment label={t("Fit", "Anpassen")} value={pageFit} onChange={setPageFit} options={[
                { value: MangaPageFit.CONTAIN, label: t("Whole page", "Ganze Seite") },
                { value: MangaPageFit.COVER, label: t("Fit width", "Breite") },
                { value: MangaPageFit.LARGER, label: t("Overflow", "Überlauf") },
                { value: MangaPageFit.TRUE_SIZE, label: t("Original", "Original") },
            ]} />
            <ReaderStepper t={t} label={t("Zoom", "Zoom")} value={Math.round(pageZoom * 100)} display={`${Math.round(pageZoom * 100)} %`}
                onChange={value => setZoom(value / 100)} min={MANGA_PAGE_ZOOM_MIN * 100} max={MANGA_PAGE_ZOOM_MAX * 100} step={MANGA_PAGE_ZOOM_STEP * 100}
                onReset={pageZoom !== MANGA_PAGE_ZOOM_DEFAULT ? resetZoom : undefined} />
            {pageFit === MangaPageFit.LARGER && effectiveMode !== MangaReadingMode.DOUBLE_PAGE && <ReaderStepper t={t} label={t("Page width", "Seitenbreite")}
                value={overflowWidth} display={`${overflowWidth} %`} onChange={setOverflowWidth} min={10} max={100} step={5} />}
            {effectiveMode === MangaReadingMode.LONG_STRIP && (pageFit === MangaPageFit.LARGER || pageFit === MangaPageFit.CONTAIN) && <ReaderSwitch
                label={t("Same width for all pages", "Alle Seiten gleich breit")} checked={pageStretch === MangaPageStretch.STRETCH}
                onChange={v => setPageStretch(v ? MangaPageStretch.STRETCH : MangaPageStretch.NONE)} />}
            {!isDefaultLayout && <Pressable accessibilityRole="button" onPress={() => {
                setPageFit(layoutDefaults.pageFit)
                setPageStretch(layoutDefaults.pageStretch)
            }} className="min-h-12 flex-row items-center gap-2.5 bg-sm-surface-raised px-3 active:bg-sm-surface-control">
                <RotateCcw size={16} color={colors.smAccent} />
                <Text className="text-sm text-sm-accent">{t("Reset page layout for this mode", "Seitenlayout für diesen Modus zurücksetzen")}</Text>
            </Pressable>}
        </ReaderGroup>

        <ReaderGroup title={t("Display", "Anzeige")}>
            <ReaderSegment label={t("Background", "Hintergrund")} value={readerBackground} onChange={v => setReaderBackground(v as MangaReaderBackground)} options={[
                { value: "black", label: t("Black", "Schwarz") },
                { value: "gray", label: t("Gray", "Grau") },
                { value: "white", label: t("White", "Weiß") },
            ]} />
            <ReaderStepper t={t} label={t("Brightness", "Helligkeit")} value={readerBrightness} display={`${readerBrightness} %`} onChange={setReaderBrightness} min={30} max={100} step={10} />
            <ReaderSwitch label={t("Keep the screen on", "Bildschirm anlassen")} checked={keepScreenOn} onChange={setKeepScreenOn} />
            <ReaderSwitch label={t("Gap between pages", "Abstand zwischen Seiten")} checked={pageGap} onChange={setPageGap} />
            {pageGap && <ReaderSwitch label={t("Shadow in the gap", "Schatten im Abstand")} checked={pageGapShadow} onChange={setPageGapShadow} />}
            <Pressable accessibilityRole="button" onPress={() => {
                setHideBar(prev => !prev)
                setOpen(false)
            }} className="min-h-12 justify-center bg-sm-surface-raised px-3 active:bg-sm-surface-control">
                <Text className="text-[15px]">{hiddenBar ? t("Show reader controls", "Lese-Steuerung einblenden") : t("Hide reader controls", "Lese-Steuerung ausblenden")}</Text>
            </Pressable>
        </ReaderGroup>
        </View>
    </Sheet>
}

function ReaderGroup({ title, children }: { title: string, children: React.ReactNode }) {
    return <View className="gap-1.5">
        {/* an <h3>: .8125rem, the line height stays the h3's text-2xl 2rem (globals.css) */}
        <Text accessibilityRole="header" className="mx-3 text-[13px] leading-8 font-medium text-sm-text-subtle">{title}</Text>
        <View className="gap-0.5 overflow-hidden rounded-surface">{children}</View>
    </View>
}

function ReaderSegment({ label, value, onChange, options, note }: { label: string, value: string, onChange: (value: string) => void, options: { value: string, label: string }[], note?: string }) {
    const columns = options.length === 4 ? 2 : options.length
    return <View accessibilityLabel={label} className="gap-2 bg-sm-surface-raised px-3 pb-3 pt-2.5">
        <Text className="text-[15px]">{label}</Text>
        <View className="flex-row flex-wrap gap-1 rounded-surface-sm bg-sm-surface-sunken p-1">
            {options.map(option => {
                const pressed = value === option.value
                return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: pressed }} onPress={() => onChange(option.value)}
                    style={{ width: `${100 / columns - 2}%`, flexGrow: 1 }}
                    className={cn("min-h-11 items-center justify-center rounded-[8px] px-2 py-1", pressed && "bg-sm-surface-control")}>
                    <Text numberOfLines={2} className={cn("text-center text-sm leading-[17px]", pressed ? "font-semibold text-sm-text" : "font-medium text-sm-text-muted")}>{option.label}</Text>
                </Pressable>
            })}
        </View>
        {!!note && <Muted accessibilityLiveRegion="polite" className="leading-[19px]">{note}</Muted>}
    </View>
}

function ReaderStepper({ t, label, value, display, onChange, min, max, step, onReset }: {
    t: Translate, label: string, value: number, display: string, onChange: (value: number) => void, min: number, max: number, step: number, onReset?: () => void,
}) {
    const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next * 100) / 100)))
    return <View className="min-h-12 flex-row items-center gap-3 bg-sm-surface-raised px-3 py-1.5">
        <Text className="min-w-0 flex-1 text-[15px]">{label}</Text>
        {!!onReset && <Pressable accessibilityRole="button" onPress={onReset} className="min-h-11 justify-center px-2"><Text className="text-[13px] text-sm-accent">{t("Reset", "Zurücksetzen")}</Text></Pressable>}
        <View accessibilityLabel={label} className="flex-row items-center gap-1">
            <Pressable accessibilityRole="button" accessibilityLabel={t(`Decrease ${label}`, `${label} verringern`)} disabled={value <= min} onPress={() => set(value - step)}
                className={cn("h-11 w-11 items-center justify-center rounded-full bg-sm-surface-control", value <= min && "opacity-35")}>
                <Minus size={18} color={colors.smText} />
            </Pressable>
            <Text accessibilityLiveRegion="polite" className="min-w-[68px] text-center" style={{ fontVariant: ["tabular-nums"] }}>{display}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t(`Increase ${label}`, `${label} erhöhen`)} disabled={value >= max} onPress={() => set(value + step)}
                className={cn("h-11 w-11 items-center justify-center rounded-full bg-sm-surface-control", value >= max && "opacity-35")}>
                <Plus size={18} color={colors.smText} />
            </Pressable>
        </View>
    </View>
}

function ReaderSwitch({ label, checked, onChange }: { label: string, checked: boolean, onChange: (value: boolean) => void }) {
    return <SwitchRow label={label} checked={checked} onCheckedChange={onChange} />
}
