import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { SeaContextMenu } from "@/app/(main)/_features/context-menu/sea-context-menu"
import { MediaEntryCardAdultVeil } from "@/app/(main)/_features/media/_components/media-entry-card-components"
import { useMediaPreviewModal } from "@/app/(main)/_features/media/_containers/media-preview-modal"
import { PluginMediaCardContextMenuItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/components/ui/core/styling"
import { Modal } from "@/components/ui/modal"
import { Translate, useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import React from "react"
import { LuCheck, LuChevronDown, LuChevronRight, LuEye, LuSearch, LuX } from "react-icons/lu"
import "@/components/shared/mobile-surface.css"
import "./phone-screen.css"

/**
 * Building blocks of the Android phone tabs (My lists, Discover, Search) in the language of Home, Manga and Extensions.
 * The look lives in phone-screen.css (ps-*); every screen starts with <PhoneScreen>.
 */

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined }

/**
 * The page frame: PageWrapper with [data-phone-screen] and the measured Android text zoom (--ps-text-zoom), which scales
 * text but not lengths, so grids and rows can widen their cards for large text.
 */
export function PhoneScreen({ screen, className, children, ...data }: { screen: string, className?: string, children?: React.ReactNode } & DataAttributes) {
    const root = React.useRef<HTMLDivElement>(null)
    React.useLayoutEffect(() => {
        const probe = document.createElement("span")
        probe.style.cssText = "position:absolute;visibility:hidden;font:16px/1 sans-serif"
        probe.textContent = "M"
        document.body.append(probe)
        const zoom = probe.getBoundingClientRect().height / 16
        probe.remove()
        if (zoom > 0) root.current?.style.setProperty("--ps-text-zoom", zoom.toFixed(2))
    }, [])
    return <PageWrapper ref={root} className={cn("ps", className)} data-phone-screen={screen} {...data}>{children}</PageWrapper>
}

/** Title, the facts line under it and up to three 48 dp icon actions. */
export function PhoneHeader({ title, facts, children }: { title: string, facts?: React.ReactNode, children?: React.ReactNode }) {
    return <header className="ps-header">
        <div className="ps-header-text">
            <h1>{title}</h1>
            {facts != null && facts !== "" && <p data-phone-facts>{facts}</p>}
        </div>
        {!!children && <div className="ps-actions">{children}</div>}
    </header>
}

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & DataAttributes & {
    /** Accessible name; the state belongs in it too ("Filter and sort, 2 active") */
    label: string
    /** A small accent dot: something is running or active */
    dot?: boolean
}

/** A 48 dp round icon button; give a running icon className="ps-spin". */
export const PhoneIconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function PhoneIconButton({ label, dot, className, children, ...props }, ref) {
    return <button ref={ref} type="button" className={cn("ps-icon-button", className)} aria-label={label} {...props}>
        {children}
        {dot && <span className="ps-dot" aria-hidden />}
    </button>
})

export function PhoneIconLink({ href, label, children, ...data }: { href: string, label: string, children: React.ReactNode } & DataAttributes) {
    return <SeaLink href={href} className="ps-icon-button" aria-label={label} {...data}>{children}</SeaLink>
}

export type PhoneTab = {
    value: string
    label: string
    count?: number
    /** Attention mark next to the label, with its meaning for screen readers */
    dot?: boolean
    dotLabel?: string
    /** data-tab-name, for selectors that outlive the labels (tours, plugins) */
    name?: string
}

/**
 * A tablist: "pills" scroll sideways with counts (statuses, sources), "segment" splits a sunken track into equal parts
 * (Anime / Manga / Stats).
 */
export function PhoneTabs({ label, tabs, value, onChange, controls, variant = "pills", className, ...data }: {
    label: string
    tabs: PhoneTab[]
    value: string | null
    onChange: (value: string) => void
    /** id of the panel the tabs switch */
    controls?: string
    variant?: "pills" | "segment"
    className?: string
} & DataAttributes) {
    return <div className={cn(variant === "segment" ? "ps-segment" : "ps-tabs", className)} role="tablist" aria-label={label} {...data}>
        {tabs.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={tab.value === value} aria-controls={controls}
            data-tab-name={tab.name ?? tab.label} data-tab-value={tab.value} onClick={() => onChange(tab.value)}>
            {tab.label}
            {tab.count != null && <span>{tab.count}</span>}
            {tab.dot && (tab.dotLabel ? <span className="ps-tab-dot" role="img" aria-label={tab.dotLabel} /> : <span className="ps-tab-dot" aria-hidden />)}
        </button>)}
    </div>
}

export type PhoneChip = { value: string, label: string, count?: number }

/** Toggle chips: one scrolling row on the page ("row") or a wrapping group in a sheet ("wrap"). */
export function PhoneChips({ label, chips, selected, onToggle, variant = "row", showCheck, className, ...data }: {
    label: string
    chips: PhoneChip[]
    selected: string[]
    onToggle: (value: string) => void
    variant?: "row" | "wrap"
    showCheck?: boolean
    className?: string
} & DataAttributes) {
    return <div className={cn(variant === "wrap" ? "ps-choices" : "ps-chips", className)} role="group" aria-label={label} {...data}>
        {chips.map(chip => {
            const pressed = selected.includes(chip.value)
            return <button key={chip.value} type="button" aria-pressed={pressed} data-chip={chip.value} onClick={() => onToggle(chip.value)}>
                {showCheck && pressed && <LuCheck aria-hidden />}
                {chip.label}
                {chip.count != null && <span>{chip.count}</span>}
            </button>
        })}
    </div>
}

/** A section with Home's heading, an optional quiet count and one text action on the right. */
export function PhoneSection({ id, title, count, action, note, children, className, ...data }: {
    id: string
    title: React.ReactNode
    count?: number | string
    action?: React.ReactNode
    note?: React.ReactNode
    children?: React.ReactNode
    className?: string
} & DataAttributes) {
    return <section className={cn("ps-section", className)} aria-labelledby={id} {...data}>
        <div className="ps-section-head">
            <h2 id={id}>{title}{count != null && count !== "" && <span>{count}</span>}</h2>
            {action}
        </div>
        {!!note && <p className="ps-section-note">{note}</p>}
        {children}
    </section>
}

export function PhoneSearchField({ t, value, onChange, placeholder, label, onSubmit, inputRef, ...data }: {
    t: Translate
    value: string
    onChange: (value: string) => void
    placeholder: string
    /** Accessible name when the placeholder is short */
    label?: string
    onSubmit?: () => void
    inputRef?: React.Ref<HTMLInputElement>
} & DataAttributes) {
    return <span className="ps-search">
        <LuSearch aria-hidden />
        <input ref={inputRef} type="search" value={value} placeholder={placeholder} aria-label={label || placeholder} enterKeyHint="search"
            autoComplete="off" autoCorrect="off" spellCheck={false} onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
                if (event.key !== "Enter") return
                onSubmit?.()
                event.currentTarget.blur()
            }} {...data} />
        {!!value && <button type="button" className="ps-search-clear" onClick={() => onChange("")} aria-label={t("Clear search", "Suche leeren")}>
            <LuX aria-hidden />
        </button>}
    </span>
}

type CardMedia = AL_BaseAnime | AL_BaseManga

export type PhoneCoverCardProps = {
    media: CardMedia
    type: "anime" | "manga"
    /** Defaults to the entry page */
    href?: string
    blurAdult?: boolean
    /** Thin bar on top of the cover */
    progress?: { value: number, total: number }
    /** Accent mark top right: new episodes, the user's score */
    badge?: string
    /** Plain mark bottom left: progress, episode, time */
    tag?: string
    /** Line under the title */
    meta?: React.ReactNode
    metaTone?: "accent"
    /** List entries warm their page when they scroll into view, as on Home */
    warm?: boolean
    /** Extra long-press menu items, between Preview and the plugin items */
    menuItems?: React.ReactNode
    /** Kept for DOM plugins that read list data from cards (as on MediaEntryCard) */
    listData?: unknown
    /** Accessible name when the title alone is not enough */
    label?: string
    className?: string
} & DataAttributes

/**
 * Cover card of the phone tabs. Long press opens the card menu (preview, plugin actions), which MediaEntryCard only
 * offers from 1024 px on.
 */
export const PhoneCoverCard = React.memo(function PhoneCoverCard(props: PhoneCoverCardProps) {
    const { media, type, blurAdult, progress, badge, tag, meta, metaTone, warm, menuItems, listData, label, className, href, ...data } = props
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const link = href ?? (type === "manga" ? `/manga/entry?id=${media.id}` : `/entry?id=${media.id}`)
    return <PhoneCardMenu content={<CoverCardMenuItems media={media} type={type} title={title}>{menuItems}</CoverCardMenuItems>}>
        {trigger => <SeaLink href={link} className={cn("ps-card", className)} aria-label={label} data-phone-card={media.id} data-media-id={media.id}
            data-media-type={type} data-list-data={listData ? JSON.stringify(listData) : undefined} warmEntryOnViewport={warm}
            bypassEntryPreloadBudget={warm} {...data} {...trigger}>
            <span className="ps-card-cover">
                <SeaImage src={getImageUrl(media.coverImage?.large || media.coverImage?.extraLarge || "")} alt="" fill className="ps-cover-image" />
                {blurAdult && media.isAdult && <MediaEntryCardAdultVeil />}
                {!!progress && progress.total > 0 && progress.value > 0 &&
                    <span className="ps-card-progress" aria-hidden><span style={{ transform: `scaleX(${Math.min(1, progress.value / progress.total)})` }} /></span>}
                {!!badge && <span className="ps-badge" data-phone-badge>{badge}</span>}
                {!!tag && <span className="ps-tag" data-phone-tag>{tag}</span>}
            </span>
            <span className="ps-card-title">{title}</span>
            {meta != null && meta !== "" && <span className="ps-card-meta" data-tone={metaTone}>{meta}</span>}
        </SeaLink>}
    </PhoneCardMenu>
})

/** A card's long-press menu: its title, Preview, the extra items, the plugin items. */
export function CoverCardMenuItems({ media, type, title, children }: { media: CardMedia, type: "anime" | "manga", title: string, children?: React.ReactNode }) {
    const t = useTr()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    return <ContextMenuGroup>
        <ContextMenuLabel className="text-[--muted] line-clamp-1 py-0 my-2">{title}</ContextMenuLabel>
        <ContextMenuItem onClick={() => setPreviewModalMediaId(media.id, type)}><LuEye /> {t("Preview", "Vorschau")}</ContextMenuItem>
        {children}
        <PluginMediaCardContextMenuItems for={type} media={media} />
    </ContextMenuGroup>
}

export type PhoneCardMenuTrigger = Pick<React.HTMLAttributes<HTMLElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onContextMenu">

/** The touch in progress: its long-press timer, the point to open at once the menu is there, and the mounted menu's opener. */
type CardPress = { timer: number, point: { x: number, y: number } | null, open: ((x: number, y: number) => void) | null }

/**
 * A card's long-press menu (SeaContextMenu), mounted on the card's first touch or right click: a tab holds over a hundred
 * cards, and a Radix menu on each took a third of the time of switching to it. The card's element takes `trigger` and stays
 * the same element when the menu mounts (a tap in progress still lands); the menu opens at the finger through a hidden Radix
 * trigger, on the contextmenu of a long press or right click, or after 700 ms of a still touch as Radix' own trigger does.
 */
export function PhoneCardMenu({ content, children }: { content: React.ReactNode, children: (trigger: PhoneCardMenuTrigger) => React.ReactNode }) {
    const [mounted, setMounted] = React.useState(false)
    const press = React.useRef<CardPress>({ timer: 0, point: null, open: null })
    const openAt = (x: number, y: number) => {
        if (press.current.open) return press.current.open(x, y)
        press.current.point = { x, y }
        setMounted(true)
    }
    const clearLongPress = (event: React.PointerEvent) => {
        if (event.pointerType !== "mouse") window.clearTimeout(press.current.timer)
    }
    return <>
        {children({
            onPointerDown: event => {
                if (event.pointerType === "mouse") return
                setMounted(true)
                window.clearTimeout(press.current.timer)
                const { clientX, clientY } = event
                press.current.timer = window.setTimeout(() => openAt(clientX, clientY), 700)
            },
            onPointerMove: clearLongPress,
            onPointerUp: clearLongPress,
            onPointerCancel: clearLongPress,
            onContextMenu: event => {
                window.clearTimeout(press.current.timer)
                event.preventDefault()
                openAt(event.clientX, event.clientY)
            },
        })}
        {mounted && <CardMenu press={press} content={content} />}
    </>
}

function CardMenu({ press, content }: { press: React.RefObject<CardPress>, content: React.ReactNode }) {
    const hidden = React.useRef<HTMLSpanElement>(null)
    // A passive effect: Radix' anchor (its own effect) is in place before the first point moves it
    React.useEffect(() => {
        const state = press.current
        state.open = (x, y) => void hidden.current?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }))
        if (state.point) state.open(state.point.x, state.point.y)
        state.point = null
        return () => {
            state.open = null
            window.clearTimeout(state.timer)
        }
    }, [press])
    // The re-dispatched contextmenu ends at the hidden trigger: the page saw the card's own already
    return <SeaContextMenu content={content}>
        <ContextMenuTrigger asChild><span ref={hidden} hidden onContextMenu={event => event.stopPropagation()} /></ContextMenuTrigger>
    </SeaContextMenu>
}

/** Sheets take focus themselves on open: a focused field would open the keyboard, a focused row would show its ring. */
export function focusPhoneSheet(event: Event) {
    event.preventDefault()
    ;(event.currentTarget as HTMLElement | null)?.focus()
}

/** Bottom sheet; Android Back closes it through the app's back script. Focus goes back to the button that opened it. */
export function PhoneSheet({ title, open, onOpenChange, returnFocusRef, className, children, footer, ...data }: {
    title: React.ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocusRef?: React.RefObject<HTMLElement | null>
    className?: string
    children?: React.ReactNode
    /** Sticky actions at the foot: secondary first, the one primary last */
    footer?: React.ReactNode
} & DataAttributes) {
    return <Modal title={title} open={open} onOpenChange={onOpenChange} contentClass={cn("ps-sheet", className)} onOpenAutoFocus={focusPhoneSheet}
        onCloseAutoFocus={event => {
            event.preventDefault()
            returnFocusRef?.current?.focus()
        }}>
        <div className="ps-sheet-body" {...data}>
            {children}
            {!!footer && <div className="ps-sheet-actions">{footer}</div>}
        </div>
    </Modal>
}

export function PhoneSheetGroup({ title, note, action, children, ...data }: {
    title: React.ReactNode
    note?: React.ReactNode
    action?: React.ReactNode
    children?: React.ReactNode
} & DataAttributes) {
    return <div className="ps-sheet-group" {...data}>
        <div className="ps-sheet-head"><h3>{title}</h3>{action}</div>
        {!!note && <p className="ps-sheet-note">{note}</p>}
        {children}
    </div>
}

/** Native select: Android's own picker, which the Back key closes; Radix' item-aligned select it would not. */
export function PhoneSelect({ id, label, value, onChange, options, disabled, ...data }: {
    id: string
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string, label: string }[]
    disabled?: boolean
} & DataAttributes) {
    return <span className="ps-select-wrap">
        <select id={id} className="ps-select" value={value} disabled={disabled} aria-label={label} onChange={event => onChange(event.target.value)} {...data}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <LuChevronDown aria-hidden />
    </span>
}

/** A switch row; group several in <div className="ps-rows">. */
export function PhoneSwitch({ label, note, checked, onChange, disabled, ...data }: {
    label: string
    note?: string
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
} & DataAttributes) {
    const id = React.useId()
    return <button type="button" role="switch" aria-checked={checked} className="ps-check" disabled={disabled} aria-labelledby={`${id}-label`}
        aria-describedby={note ? `${id}-note` : undefined} onClick={() => onChange(!checked)} {...data}>
        <span className="ps-check-text">
            <span id={`${id}-label`}>{label}</span>
            {!!note && <small id={`${id}-note`}>{note}</small>}
        </span>
        <span className="ps-toggle" aria-hidden />
    </button>
}

/**
 * A row that acts or opens something; group several in <div className="ps-rows">. "attention" marks a queue that needs the
 * user (unmatched files), "danger" an action that removes something.
 */
export function PhoneRow({ icon, label, note, value, chevron, tone, href, onClick, disabled, ...data }: {
    icon?: React.ReactNode
    label: React.ReactNode
    note?: React.ReactNode
    value?: React.ReactNode
    chevron?: boolean
    tone?: "attention" | "danger"
    href?: string
    onClick?: () => void
    disabled?: boolean
} & DataAttributes) {
    const inner = <>
        {!!icon && <span className="ps-action-icon" aria-hidden>{icon}</span>}
        <span className="ps-action-text"><span>{label}</span>{!!note && <small>{note}</small>}</span>
        {value != null && value !== "" && <span className="ps-action-value">{value}</span>}
        {chevron && <LuChevronRight className="ps-action-chevron" aria-hidden />}
    </>
    if (href) return <SeaLink href={href} className="ps-action" data-tone={tone} {...data}>{inner}</SeaLink>
    return <button type="button" className="ps-action" data-tone={tone} disabled={disabled} onClick={onClick} {...data}>{inner}</button>
}

/** A row with a box (role checkbox) or a ring (role radio, inside role="radiogroup"); `media` sits before the text. */
export function PhonePick({ role = "checkbox", label, note, checked, onChange, media, disabled, ...data }: {
    role?: "checkbox" | "radio"
    label: React.ReactNode
    note?: React.ReactNode
    checked: boolean
    onChange: () => void
    media?: React.ReactNode
    disabled?: boolean
} & DataAttributes) {
    return <button type="button" role={role} aria-checked={checked} className="ps-pick" disabled={disabled} onClick={onChange} {...data}>
        <span className="ps-pick-mark" aria-hidden>{role === "checkbox" && checked && <LuCheck />}</span>
        {media}
        <span className="ps-pick-text"><span>{label}</span>{!!note && <small>{note}</small>}</span>
    </button>
}

/** A labelled field; `numeric` brings up the number pad and keeps only digits. */
export function PhoneField({ id, label, note, value, onChange, placeholder, numeric, ...data }: {
    id: string
    label: string
    note?: React.ReactNode
    value: string
    onChange: (value: string) => void
    placeholder?: string
    numeric?: boolean
} & DataAttributes) {
    return <div className="ps-field">
        <label htmlFor={id}>{label}</label>
        <input id={id} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-describedby={note ? `${id}-note` : undefined}
            inputMode={numeric ? "numeric" : undefined} onChange={event => onChange(numeric ? event.target.value.replace(/\D/g, "") : event.target.value)} {...data} />
        {!!note && <small id={`${id}-note`}>{note}</small>}
    </div>
}

/** A status above the bottom bar: what is going on, a detail, one text action and an optional progress (0-100). */
export function PhoneFloat({ text, detail, progress, children, ...data }: {
    text: React.ReactNode
    detail?: React.ReactNode
    progress?: number
    children?: React.ReactNode
} & DataAttributes) {
    return <div className="ps-float" role="status" {...data}>
        <span className="ps-float-text"><span>{text}</span>{!!detail && <small>{detail}</small>}</span>
        {children}
        {progress != null && <span className="ps-float-bar" aria-hidden><span style={{ transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})` }} /></span>}
    </div>
}

type BoneKind = "head" | "tabs" | "feature" | "row" | "cover-row" | "grid"

/** Loading: the final layout as flat blocks, read out once as "Loading …". */
export function PhoneLoading({ label, layout }: { label: string, layout: BoneKind[] }) {
    return <div className="ps-loading" aria-busy="true" role="status" aria-label={label}>
        {layout.map((kind, index) => kind === "grid"
            ? <div key={index} className="ps-grid">{Array.from({ length: 6 }, (_, i) => <span key={i} className="ps-bone" data-kind="cover" />)}</div>
            : kind === "cover-row"
                ? <div key={index} className="ps-row">{Array.from({ length: 4 }, (_, i) => <span key={i} className="ps-bone" />)}</div>
                : <span key={index} className="ps-bone" data-kind={kind} />)}
    </div>
}

/** What is missing, why or how to change it, and up to two ways on. */
export function PhoneEmpty({ title, text, children, ...data }: { title: string, text?: React.ReactNode, children?: React.ReactNode } & DataAttributes) {
    return <div className="ps-empty" {...data}>
        <p>{title}</p>
        {!!text && <p>{text}</p>}
        {!!children && <div className="ps-empty-actions">{children}</div>}
    </div>
}

/** A failed block: one sentence and its text actions (try again, a way around). */
export function PhoneNotice({ text, children, ...data }: { text: React.ReactNode, children?: React.ReactNode } & DataAttributes) {
    return <div className="ps-notice" role="alert" {...data}>
        <p>{text}</p>
        {!!children && <div className="ps-notice-actions">{children}</div>}
    </div>
}

/** "No internet connection, so …" when the phone is offline, else the plain sentence. */
export function offlineAware(t: Translate, plain: [string, string], offline: [string, string]) {
    return typeof navigator !== "undefined" && navigator.onLine === false ? t(...offline) : t(...plain)
}

/**
 * Android Back for the screen's own state (a search mode, a sub view): while `active`, Back calls `onBack` instead of
 * leaving the page. Sheets and menus need nothing: the app's back script closes them.
 */
export function usePhoneBack(active: boolean, onBack: () => void) {
    const latest = React.useRef(onBack)
    latest.current = onBack
    React.useEffect(() => {
        if (!active) return
        const back = (event: Event) => {
            if (event.defaultPrevented) return
            event.preventDefault()
            latest.current()
        }
        window.addEventListener("seanime:android-back", back)
        return () => window.removeEventListener("seanime:android-back", back)
    }, [active])
}

/** The last data a query had, so a refetch or a new key keeps the screen instead of showing bones again. */
export function useLastData<T>(data: T | undefined): T | undefined {
    const last = React.useRef<T | undefined>(data)
    if (data !== undefined) last.current = data
    return data ?? last.current
}

/** Watches an element and reports once it scrolls near the viewport (lazy sections, "load more"). */
export function useNearViewport<T extends Element>(rootMargin = "300px", once = true) {
    const ref = React.useRef<T>(null)
    const [near, setNear] = React.useState(false)
    React.useEffect(() => {
        const el = ref.current
        if (!el || (once && near)) return
        if (typeof IntersectionObserver === "undefined") return void setNear(true)
        const observer = new IntersectionObserver(entries => {
            const hit = entries.some(entry => entry.isIntersecting)
            if (once && hit) {
                setNear(true)
                observer.disconnect()
            } else if (!once) setNear(hit)
        }, { rootMargin })
        observer.observe(el)
        return () => observer.disconnect()
    }, [rootMargin, once, near])
    return [ref, near] as const
}

/** Season of a month (1-12) as AniList names it. */
export function seasonOfMonth(month: number): "WINTER" | "SPRING" | "SUMMER" | "FALL" {
    return month <= 3 ? "WINTER" : month <= 6 ? "SPRING" : month <= 9 ? "SUMMER" : "FALL"
}

export const SEASON_LABELS: Record<string, [string, string]> = {
    WINTER: ["Winter", "Winter"], SPRING: ["Spring", "Frühling"], SUMMER: ["Summer", "Sommer"], FALL: ["Fall", "Herbst"],
}

export const FORMAT_LABELS: Record<string, [string, string]> = {
    TV: ["TV", "TV"], TV_SHORT: ["TV short", "TV-Kurzserie"], MOVIE: ["Movie", "Film"], SPECIAL: ["Special", "Special"], OVA: ["OVA", "OVA"],
    ONA: ["ONA", "ONA"], MUSIC: ["Music", "Musik"], MANGA: ["Manga", "Manga"], NOVEL: ["Novel", "Roman"], ONE_SHOT: ["One shot", "One-Shot"],
}

export const MEDIA_STATUS_LABELS: Record<string, [string, string]> = {
    FINISHED: ["Finished", "Abgeschlossen"], RELEASING: ["Releasing", "Läuft"], NOT_YET_RELEASED: ["Upcoming", "Demnächst"],
    HIATUS: ["Hiatus", "Pausiert"], CANCELLED: ["Cancelled", "Abgebrochen"],
}

/** "Fall 2026", in the app language; empty when AniList knows neither. */
export function seasonYearLabel(t: Translate, media: { season?: string | null, seasonYear?: number | null, startDate?: { year?: number | null } | null }) {
    const season = media.season ? t(...(SEASON_LABELS[media.season] ?? [media.season, media.season])) : ""
    const year = media.seasonYear || media.startDate?.year || ""
    return [season, year].filter(Boolean).join(" ")
}
