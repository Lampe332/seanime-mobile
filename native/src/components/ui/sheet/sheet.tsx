import { dialogIn, dialogOut, scrimIn, scrimOut, sheetInPhone, sheetInSide, sheetOutPhone, sheetOutSide } from "@/components/ui/core/animations"
import { usePortalKey } from "@/components/ui/core/portal-key"
import { useKeyboardHeight } from "@/components/ui/core/use-keyboard-height"
import { bottomClearance, phoneSheetMaxHeight, sheetBodyMaxHeight, sheetFooterTop } from "@/lib/keyboard-room"
import { ButtonSizeContext } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { scrimAtOnce } from "@/lib/motion"
import { WIDE_MIN_WIDTH } from "@/lib/tablet-ui"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useTourTarget } from "@/main/_features/tour/tour-targets"
import * as DialogPrimitive from "@rn-primitives/dialog"
import React from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"
import Animated from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * Sheet (Blatt) and Dialog on @rn-primitives/dialog, in the look of `.ps-sheet` (phone-screen.css) and the tablet's side
 * sheets (tablet.css):
 *   phone        a bottom sheet 8dp from the edges, at most 32rem wide, 20dp corners, --sm-surface, rises 2rem in
 *   tablet ≥1000 a side sheet on the right, full height, 30rem wide, comes 2rem in from the right
 * The backdrop is the modal's bg-black/80. Back (the primitive's BackHandler), the backdrop and the close button close it.
 */
type BaseProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    children?: React.ReactNode
    /** pinned under the scrolling body (`.ps-sheet-actions`) */
    footer?: React.ReactNode
    className?: string
}

/** close-button.tsx: the modal's 16px glyph (`.ps-sheet .UI-Modal__close` keeps it, only the button grows to 48px) */
const CLOSE_GLYPH = "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"

/**
 * The primitive's Root is an empty View where the sheet is written; its content goes to the portal. Out of the layout it
 * takes no gap: radix renders nothing there, but a confirm dialog inside a sheet's body added a 16-20dp gap under its
 * last block (S22 10.11.: extension "Local" 24dp taller than 2.0.32 with the 8dp below).
 */
const OUT_OF_FLOW = { display: "none" } as const

function CloseButton({ top = 8 }: { top?: number }) {
    const t = useTr()
    return (
        <DialogPrimitive.Close asChild>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Close", "Schließen")}
                hitSlop={4}
                style={{ top }}
                className="absolute right-2 z-10 h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control"
            >
                <Svg width={16} height={16} viewBox="0 0 16 16"><Path fill="#d1d1d1" d={CLOSE_GLYPH} /></Svg>
            </Pressable>
        </DialogPrimitive.Close>
    )
}

function Header({ title, description, large, compact, workspace, titleIcon }: { title: string, description?: string, large?: boolean, compact?: boolean, workspace?: boolean, titleIcon?: React.ReactNode }) {
    return (
        // compact (`.mobile-download-sheet .UI-Modal__header`): at least 32px tall, the title centred in it
        <View className={cn("pr-12", titleIcon ? "gap-2" : "gap-1.5", compact && "min-h-8 justify-center")}>
            {/* with an icon (`.mex-sheet-title`): icon and name in one row, the name at 1.25rem */}
            {titleIcon ? <View className="flex-row items-center gap-3">
                {titleIcon}
                <DialogPrimitive.Title asChild>
                    <Text className="min-w-0 flex-1 text-[20px] leading-[25px] font-extrabold tracking-[-0.4px]">{title}</Text>
                </DialogPrimitive.Title>
            </View>
            : <DialogPrimitive.Title asChild>
                <Text className={cn(workspace ? "text-[18px] leading-[23.4px] font-extrabold tracking-[-0.27px]"
                    : compact ? "text-lg leading-[25px] font-bold"
                        : large ? "text-[22px] leading-[28px] font-extrabold tracking-[-0.44px]" : "text-xl font-semibold")}>{title}</Text>
            </DialogPrimitive.Title>}
            {!!description && (
                <DialogPrimitive.Description asChild>
                    <Muted>{description}</Muted>
                </DialogPrimitive.Description>
            )}
        </View>
    )
}

// Sheet → sheet: how many scrims are up and when the last one went (scrimAtOnce)
let openScrims = 0
let lastScrimClose = 0

function Backdrop({ children }: { children: React.ReactNode }) {
    // decided once as it opens: while another scrim is up or just went, this one is there at once (no lighter frame between)
    const [atOnce] = React.useState(() => scrimAtOnce(openScrims, Date.now() - lastScrimClose))
    React.useEffect(() => {
        openScrims++
        return () => {
            openScrims--
            lastScrimClose = Date.now()
        }
    }, [])
    return (
        <DialogPrimitive.Overlay closeOnPress style={StyleSheet.absoluteFill}>
            <Animated.View entering={atOnce ? undefined : scrimIn} exiting={scrimOut} style={StyleSheet.absoluteFill} className="bg-black/80" />
            {children}
        </DialogPrimitive.Overlay>
    )
}

export function Sheet({ open, onOpenChange, title, description, children, footer, className, tourTarget, compact, workspace, titleIcon, dense }: BaseProps & {
    /** shown before the title in one row (the extension sheets' icon) */
    titleIcon?: React.ReactNode
    /** `.mex-sheet-body`: 1rem between the blocks instead of `.ps-sheet-body`'s 1.25rem */
    dense?: boolean
    /** the setup tour highlights the whole sheet under this name (tour-targets.ts) */
    tourTarget?: string
    /**
     * The entry page's dialog sheets (`.mobile-anime-dialog.mobile-download-sheet`, mobile-anime.css): 16dp on top, an
     * 18dp bold title, 12dp to the body – instead of the `.ps-sheet` head (20dp, 22dp heavy title, 16dp)
     */
    compact?: boolean
    /**
     * A workspace (playlists, mobile-workspace.css): as a tablet side sheet its title is 1.125rem and its footer sits at the
     * foot of the full-height sheet (`.mobile-workspace-footer`), not right under a short body.
     */
    workspace?: boolean
}) {
    const portalKey = usePortalKey()
    const insets = useSafeAreaInsets()
    const tourRef = useTourTarget(open && tourTarget ? tourTarget : null)
    const { isTablet, window } = useTabletLayout()
    const side = isTablet && window.width >= WIDE_MIN_WIDTH
    // The body's own max height: the sheet's room less its head, foot and paddings. Yoga does not shrink a ScrollView
    // reliably inside a parent that only has a maxHeight: once the body grew while open (results arriving, a section
    // turned on) it took its full content height, the sheet ran off the screen and the body no longer scrolled.
    const [headHeight, setHeadHeight] = React.useState(0)
    const [footHeight, setFootHeight] = React.useState(0)
    // an open keyboard lifts the phone sheet onto it and shortens the side sheet (lib/keyboard-room.ts)
    const keyboard = useKeyboardHeight()
    const bottom = bottomClearance(keyboard, insets.bottom)
    const sheetMax = phoneSheetMaxHeight(window.height, bottom)
    const bodyMax = side
        ? Math.max(120, window.height - (insets.top + 24) - 12 - keyboard - headHeight - (footer ? footHeight : 0) - 16)
        : sheetBodyMaxHeight({ sheetMax, topPadding: compact ? 16 : 20, headHeight, headGap: compact ? 12 : 16, footHeight: footer ? footHeight : 0 })

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} style={OUT_OF_FLOW}>
            <DialogPrimitive.Portal>
                <Backdrop key={portalKey}>
                    <View
                        pointerEvents="box-none"
                        style={StyleSheet.absoluteFill}
                        className={side ? "items-end" : "items-center justify-end"}
                    >
                        <DialogPrimitive.Content asChild>
                            <Animated.View
                                entering={side ? sheetInSide : sheetInPhone}
                                exiting={side ? sheetOutSide : sheetOutPhone}
                                style={side
                                    ? { height: "100%", paddingTop: insets.top + 24, paddingBottom: keyboard }
                                    : { marginBottom: bottom + 8, width: Math.min(window.width - 16, 512), maxHeight: sheetMax }}
                                className={cn(
                                    "bg-sm-surface",
                                    side
                                        ? "w-full max-w-[480px] rounded-l-surface-lg px-4 pb-3"
                                        : cn("rounded-surface-lg px-4 pb-3", compact ? "pt-4" : "pt-5"),
                                    className,
                                )}
                            >
                                {!!tourTarget && <View ref={tourRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />}
                                {/* the side sheet runs under the status bar; its close button sits below it */}
                                <CloseButton top={side ? insets.top + 8 : 8} />
                                <View onLayout={event => setHeadHeight(event.nativeEvent.layout.height)}>
                                    <Header title={title} description={description} large compact={compact} workspace={side && workspace} titleIcon={titleIcon} />
                                </View>
                                <ScrollView
                                    // only as tall as its content; it scrolls once it reaches the sheet's room (see bodyMax)
                                    style={{ maxHeight: bodyMax }}
                                    className={cn("shrink", compact ? "mt-3" : "mt-4", side && workspace ? "grow" : "grow-0")}
                                    contentContainerClassName={dense ? "gap-4" : "gap-5"}
                                    keyboardShouldPersistTaps="handled"
                                    showsVerticalScrollIndicator={false}
                                >
                                    {children}
                                </ScrollView>
                                {!!footer && <View onLayout={event => setFootHeight(event.nativeEvent.layout.height)} style={{ paddingTop: sheetFooterTop({ compact, dense }) }}
                                    className="flex-row gap-2 bg-sm-surface">
                                    {/* `.ps-sheet-actions > *` / `.mex-sheet-actions` buttons are 52dp; compact and workspace ones 48dp */}
                                    <ButtonSizeContext.Provider value={compact || workspace ? "md" : "lg"}>{footer}</ButtonSizeContext.Provider>
                                </View>}
                            </Animated.View>
                        </DialogPrimitive.Content>
                    </View>
                </Backdrop>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}

/** A centred dialog (UI-Modal): a question or a short form; at most 32rem wide like everything on a tablet. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: BaseProps) {
    const portalKey = usePortalKey()
    // centred in the room above an open keyboard
    const keyboard = useKeyboardHeight()
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} style={OUT_OF_FLOW}>
            <DialogPrimitive.Portal>
                <Backdrop key={portalKey}>
                    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingBottom: keyboard }]} className="items-center justify-center px-4">
                        <DialogPrimitive.Content asChild>
                            <Animated.View
                                entering={dialogIn}
                                exiting={dialogOut}
                                className={cn("w-full max-w-[512px] gap-4 rounded-surface-lg border border-white/5 bg-sm-surface p-5", className)}
                            >
                                <CloseButton />
                                <Header title={title} description={description} />
                                {children}
                                {!!footer && <View className="flex-row flex-wrap justify-end gap-2">{footer}</View>}
                            </Animated.View>
                        </DialogPrimitive.Content>
                    </View>
                </Backdrop>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}

/**
 * `.ps-sheet-group`: a titled block inside a sheet. `action` is the text action on the right of the title
 * (`.ps-sheet-head`), `intro` the note under the title (`.ps-sheet-note` before the content), `note` one after it.
 */
export function SheetGroup({ title, note, intro, action, children, className }: {
    title?: string
    note?: string
    intro?: string
    action?: React.ReactNode
    children?: React.ReactNode
    /** e.g. the torrent search's `.tsp .ps-sheet-group` (gap .75rem) */
    className?: string
}) {
    return (
        <View className={cn("gap-2.5", className)}>
            {(!!title || !!action) && (
                <View className="min-h-6 flex-row items-center justify-between gap-3">
                    {/* an <h3>: `.ps-sheet-head h3` sets 1rem, the line height stays the h3's text-2xl 2rem (globals.css) */}
                    {!!title && <Text className="min-w-0 flex-1 text-base leading-8 font-bold">{title}</Text>}
                    {!!action && <View className="-my-3 -mr-2">{action}</View>}
                </View>
            )}
            {!!intro && <Muted className="leading-[19.5px]">{intro}</Muted>}
            {children}
            {!!note && <Muted>{note}</Muted>}
        </View>
    )
}
