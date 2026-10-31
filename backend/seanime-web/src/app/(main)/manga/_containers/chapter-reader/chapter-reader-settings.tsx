import { useEffectiveReadingMode, useMangaPageZoomControls } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import {
    __manga_doublePageOffsetAtom,
    __manga_autoHideControlsAtom,
    __manga_entryReaderSettings,
    __manga_hiddenBarAtom,
    __manga_keepScreenOnAtom,
    __manga_readerBackgroundAtom,
    __manga_readerBrightnessAtom,
    __manga_tapToggleControlsAtom,
    MangaReaderBackground,
    __manga_pageFitAtom,
    __manga_pageGapAtom,
    __manga_pageGapShadowAtom,
    __manga_pageOverflowContainerWidthAtom,
    __manga_pageStretchAtom,
    __manga_readingDirectionAtom,
    __manga_readingModeAtom,
    MANGA_PAGE_ZOOM_DEFAULT,
    MANGA_PAGE_ZOOM_MAX,
    MANGA_PAGE_ZOOM_MIN,
    MANGA_PAGE_ZOOM_STEP,
    MANGA_SETTINGS_ATOM_KEYS,
    MangaPageFit,
    MangaPageStretch,
    MangaReadingDirection,
    MangaReadingMode,
} from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"
import { MANGA_READING_MODE_AUTO } from "@/app/(main)/manga/_lib/reader-mode"
import { IS_TABLET_UI } from "@/lib/tablet-ui"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { FaRedo } from "react-icons/fa"
import { LuSettings } from "react-icons/lu"
import { Modal } from "@/components/ui/modal"
import { Translate, useTr } from "@/lib/app-language"
import { LuMinus, LuPlus } from "react-icons/lu"
import "@/components/shared/mobile-surface.css"
import "@/app/(main)/entry/_components/mobile-anime.css"
import "./chapter-reader-settings-mobile.css"

export type ChapterReaderSettingsProps = {
    mediaId: number
}

export const __manga__readerSettingsDrawerOpen = atom(false)

export function ChapterReaderSettings(props: ChapterReaderSettingsProps) {

    const {
        mediaId,
        ...rest
    } = props

    const [readingDirection, setReadingDirection] = useAtom(__manga_readingDirectionAtom)
    const [readingMode, setReadingMode] = useAtom(__manga_readingModeAtom)
    // what is laid out: "auto" resolves to single or double page for the current window
    const effectiveMode = useEffectiveReadingMode()
    const [pageFit, setPageFit] = useAtom(__manga_pageFitAtom)
    const [pageStretch, setPageStretch] = useAtom(__manga_pageStretchAtom)
    const [pageGap, setPageGap] = useAtom(__manga_pageGapAtom)
    const [pageGapShadow, setPageGapShadow] = useAtom(__manga_pageGapShadowAtom)
    const [doublePageOffset, setDoublePageOffset] = useAtom(__manga_doublePageOffsetAtom)
    const [pageOverflowContainerWidth, setPageOverflowContainerWidth] = useAtom(__manga_pageOverflowContainerWidthAtom)
    const { pageZoom, setZoom, resetZoom } = useMangaPageZoomControls()
    //---
    const [hiddenBar, setHideBar] = useAtom(__manga_hiddenBarAtom)

    const defaultSettings = {
        [MangaReadingMode.LONG_STRIP]: { pageFit: MangaPageFit.COVER, pageStretch: MangaPageStretch.NONE },
        [MangaReadingMode.PAGED]: { pageFit: MangaPageFit.CONTAIN, pageStretch: MangaPageStretch.NONE },
        [MangaReadingMode.DOUBLE_PAGE]: { pageFit: MangaPageFit.CONTAIN, pageStretch: MangaPageStretch.NONE },
    }

    /**
     * Remember settings for current media
     */
    const [entrySettings, setEntrySettings] = useAtom(__manga_entryReaderSettings)

    const mounted = React.useRef(false)
    React.useEffect(() => {
        if (!mounted.current) {
            if (entrySettings[mediaId]) {
                const settings = entrySettings[mediaId]
                setReadingDirection(settings[MANGA_SETTINGS_ATOM_KEYS.readingDirection])
                setReadingMode(settings[MANGA_SETTINGS_ATOM_KEYS.readingMode])
                setPageFit(settings[MANGA_SETTINGS_ATOM_KEYS.pageFit])
                setPageStretch(settings[MANGA_SETTINGS_ATOM_KEYS.pageStretch])
                setPageGap(settings[MANGA_SETTINGS_ATOM_KEYS.pageGap])
                setPageGapShadow(settings[MANGA_SETTINGS_ATOM_KEYS.pageGapShadow])
                setDoublePageOffset(settings[MANGA_SETTINGS_ATOM_KEYS.doublePageOffset])
                setPageOverflowContainerWidth(settings[MANGA_SETTINGS_ATOM_KEYS.overflowPageContainerWidth])
            }
        }
        mounted.current = true
    }, [entrySettings[mediaId]])

    React.useEffect(() => {
        setEntrySettings(prev => ({
            ...prev,
            [mediaId]: {
                [MANGA_SETTINGS_ATOM_KEYS.readingDirection]: readingDirection,
                [MANGA_SETTINGS_ATOM_KEYS.readingMode]: readingMode,
                [MANGA_SETTINGS_ATOM_KEYS.pageFit]: pageFit,
                [MANGA_SETTINGS_ATOM_KEYS.pageStretch]: pageStretch,
                [MANGA_SETTINGS_ATOM_KEYS.pageGap]: pageGap,
                [MANGA_SETTINGS_ATOM_KEYS.pageGapShadow]: pageGapShadow,
                [MANGA_SETTINGS_ATOM_KEYS.doublePageOffset]: doublePageOffset,
                [MANGA_SETTINGS_ATOM_KEYS.overflowPageContainerWidth]: pageOverflowContainerWidth,
            },
        }))
    }, [readingDirection, readingMode, pageFit, pageStretch, pageGap, pageGapShadow, doublePageOffset, pageOverflowContainerWidth])

    const isDefaultSettings =
        pageFit === defaultSettings[effectiveMode].pageFit &&
        pageStretch === defaultSettings[effectiveMode].pageStretch

    const [open, setOpen] = useAtom(__manga__readerSettingsDrawerOpen)
    const t = useTr()
    const [keepScreenOn, setKeepScreenOn] = useAtom(__manga_keepScreenOnAtom)
    const [readerBackground, setReaderBackground] = useAtom(__manga_readerBackgroundAtom)
    const [readerBrightness, setReaderBrightness] = useAtom(__manga_readerBrightnessAtom)
    const [tapToggleControls, setTapToggleControls] = useAtom(__manga_tapToggleControlsAtom)
    const [autoHideControls, setAutoHideControls] = useAtom(__manga_autoHideControlsAtom)

    // A bottom sheet in the app's style. Same atoms, so every value is stored exactly as before.
    return (
        <>
            <button type="button" className="reader-bar-btn" data-chapter-reader-settings-dropdown-menu-trigger
                aria-label={t("Reader settings", "Lese-Einstellungen")} onClick={() => setOpen(true)}>
                <LuSettings aria-hidden />
            </button>
            <Modal
                open={open}
                onOpenChange={setOpen}
                title={t("Reader settings", "Lese-Einstellungen")}
                contentClass="mobile-anime-dialog mobile-download-sheet reader-settings-sheet z-[160]"
                overlayClass="z-[159]"
            >
                <div className="reader-settings" data-mobile-reader-settings>
                    <ReaderGroup title={t("Reading", "Lesen")}>
                        <ReaderSegment
                            label={t("Mode", "Modus")}
                            value={readingMode}
                            onChange={setReadingMode}
                            options={[
                                { value: MangaReadingMode.LONG_STRIP, label: t("Long strip", "Endlos") },
                                { value: MangaReadingMode.PAGED, label: t("Single page", "Einzelseite") },
                                { value: MangaReadingMode.DOUBLE_PAGE, label: t("Double page", "Doppelseite") },
                                // Tablets can pick by window shape; a stored choice stays visible when the device changed
                                ...(IS_TABLET_UI || readingMode === MANGA_READING_MODE_AUTO
                                    ? [{ value: MANGA_READING_MODE_AUTO, label: t("Automatic", "Automatisch") }]
                                    : []),
                            ]}
                            note={readingMode === MANGA_READING_MODE_AUTO ? (effectiveMode === MangaReadingMode.DOUBLE_PAGE
                                ? t("Double page in landscape, single page in portrait. Now: double page.", "Quer Doppelseite, hochkant Einzelseite. Gerade: Doppelseite.")
                                : t("Double page in landscape, single page in portrait. Now: single page.", "Quer Doppelseite, hochkant Einzelseite. Gerade: Einzelseite.")) : undefined}
                        />
                        {effectiveMode !== MangaReadingMode.LONG_STRIP && <ReaderSegment
                            label={t("Direction", "Richtung")}
                            value={readingDirection}
                            onChange={setReadingDirection}
                            options={[
                                { value: MangaReadingDirection.LTR, label: t("Left to right", "Links → rechts") },
                                { value: MangaReadingDirection.RTL, label: t("Right to left", "Rechts → links") },
                            ]}
                        />}
                        <ReaderSwitch label={t("Tap the middle to show or hide controls", "Mitte antippen blendet Steuerung ein/aus")}
                            checked={tapToggleControls} onChange={setTapToggleControls} />
                        {effectiveMode === MangaReadingMode.LONG_STRIP && <ReaderSwitch label={t("Hide controls while scrolling down", "Steuerung beim Runterscrollen ausblenden")}
                            checked={autoHideControls} onChange={setAutoHideControls} />}
                        {effectiveMode === MangaReadingMode.DOUBLE_PAGE && <ReaderStepper
                            t={t}
                            label={t("Page offset", "Seitenversatz")}
                            value={doublePageOffset}
                            display={String(doublePageOffset)}
                            onChange={setDoublePageOffset}
                            min={-10}
                            max={10}
                            step={1}
                        />}
                    </ReaderGroup>

                    <ReaderGroup title={t("Page", "Seite")}>
                        <ReaderSegment
                            label={t("Fit", "Anpassen")}
                            value={pageFit}
                            onChange={setPageFit}
                            options={[
                                { value: MangaPageFit.CONTAIN, label: t("Whole page", "Ganze Seite") },
                                { value: MangaPageFit.COVER, label: t("Fit width", "Breite") },
                                { value: MangaPageFit.LARGER, label: t("Overflow", "Überlauf") },
                                { value: MangaPageFit.TRUE_SIZE, label: t("Original", "Original") },
                            ]}
                        />
                        <ReaderStepper
                            t={t}
                            label={t("Zoom", "Zoom")}
                            value={Math.round(pageZoom * 100)}
                            display={`${Math.round(pageZoom * 100)} %`}
                            onChange={value => setZoom(value / 100)}
                            min={MANGA_PAGE_ZOOM_MIN * 100}
                            max={MANGA_PAGE_ZOOM_MAX * 100}
                            step={MANGA_PAGE_ZOOM_STEP * 100}
                            onReset={pageZoom !== MANGA_PAGE_ZOOM_DEFAULT ? resetZoom : undefined}
                        />
                        {pageFit === MangaPageFit.LARGER && effectiveMode !== MangaReadingMode.DOUBLE_PAGE && <ReaderStepper
                            t={t}
                            label={t("Page width", "Seitenbreite")}
                            value={pageOverflowContainerWidth}
                            display={`${pageOverflowContainerWidth} %`}
                            onChange={setPageOverflowContainerWidth}
                            min={10}
                            max={100}
                            step={5}
                        />}
                        {effectiveMode === MangaReadingMode.LONG_STRIP && (pageFit === MangaPageFit.LARGER || pageFit === MangaPageFit.CONTAIN) && <ReaderSwitch
                            label={t("Same width for all pages", "Alle Seiten gleich breit")}
                            checked={pageStretch === MangaPageStretch.STRETCH}
                            onChange={v => setPageStretch(v ? MangaPageStretch.STRETCH : MangaPageStretch.NONE)}
                        />}
                        {!isDefaultSettings && <button type="button" className="reader-settings-row reader-settings-reset" onClick={() => {
                            setPageFit(defaultSettings[effectiveMode].pageFit)
                            setPageStretch(defaultSettings[effectiveMode].pageStretch)
                        }}>
                            <FaRedo aria-hidden />{t("Reset page layout for this mode", "Seitenlayout für diesen Modus zurücksetzen")}
                        </button>}
                    </ReaderGroup>

                    <ReaderGroup title={t("Display", "Anzeige")}>
                        <ReaderSegment
                            label={t("Background", "Hintergrund")}
                            value={readerBackground}
                            onChange={v => setReaderBackground(v as MangaReaderBackground)}
                            options={[
                                { value: "black", label: t("Black", "Schwarz") },
                                { value: "gray", label: t("Gray", "Grau") },
                                { value: "white", label: t("White", "Weiß") },
                            ]}
                        />
                        <ReaderStepper
                            t={t}
                            label={t("Brightness", "Helligkeit")}
                            value={readerBrightness}
                            display={`${readerBrightness} %`}
                            onChange={setReaderBrightness}
                            min={30}
                            max={100}
                            step={10}
                        />
                        <ReaderSwitch label={t("Keep the screen on", "Bildschirm anlassen")} checked={keepScreenOn} onChange={setKeepScreenOn} />
                        <ReaderSwitch label={t("Gap between pages", "Abstand zwischen Seiten")} checked={pageGap} onChange={setPageGap} />
                        {pageGap && <ReaderSwitch label={t("Shadow in the gap", "Schatten im Abstand")} checked={pageGapShadow} onChange={setPageGapShadow} />}
                        <button type="button" className="reader-settings-row" onClick={() => {
                            setHideBar(prev => !prev)
                            setOpen(false)
                        }}>
                            <span>{hiddenBar ? t("Show reader controls", "Lese-Steuerung einblenden") : t("Hide reader controls", "Lese-Steuerung ausblenden")}</span>
                        </button>
                    </ReaderGroup>
                </div>
            </Modal>
        </>
    )
}

function ReaderGroup(props: { title: string, children: React.ReactNode }) {
    const id = React.useId()
    return <section className="reader-settings-group" aria-labelledby={id}>
        <h3 id={id}>{props.title}</h3>
        <div className="reader-settings-rows">{props.children}</div>
    </section>
}

function ReaderSegment(props: { label: string, value: string, onChange: (value: string) => void, options: { value: string, label: string }[], note?: string }) {
    return <div className="reader-settings-field" role="group" aria-label={props.label}>
        <span>{props.label}</span>
        <div className="reader-settings-segment" data-count={props.options.length}>
            {props.options.map(option => <button key={option.value} type="button" aria-pressed={props.value === option.value}
                onClick={() => props.onChange(option.value)}>{option.label}</button>)}
        </div>
        {!!props.note && <small aria-live="polite">{props.note}</small>}
    </div>
}

function ReaderStepper(props: {
    t: Translate, label: string, value: number, display: string, onChange: (value: number) => void,
    min: number, max: number, step: number, onReset?: () => void,
}) {
    const { t, value, min, max, step } = props
    const set = (next: number) => props.onChange(Math.min(max, Math.max(min, Math.round(next * 100) / 100)))
    return <div className="reader-settings-row reader-settings-stepper">
        <span>{props.label}</span>
        {props.onReset && <button type="button" className="reader-settings-link" onClick={props.onReset}>{t("Reset", "Zurücksetzen")}</button>}
        <div role="group" aria-label={props.label}>
            <button type="button" aria-label={t(`Decrease ${props.label}`, `${props.label} verringern`)} disabled={value <= min} onClick={() => set(value - step)}><LuMinus aria-hidden /></button>
            <output aria-live="polite">{props.display}</output>
            <button type="button" aria-label={t(`Increase ${props.label}`, `${props.label} erhöhen`)} disabled={value >= max} onClick={() => set(value + step)}><LuPlus aria-hidden /></button>
        </div>
    </div>
}

function ReaderSwitch(props: { label: string, checked: boolean, onChange: (value: boolean) => void }) {
    return <button type="button" role="switch" aria-checked={props.checked} className="reader-settings-row" onClick={() => props.onChange(!props.checked)}>
        <span>{props.label}</span>
        <span className="reader-settings-toggle" aria-hidden />
    </button>
}
