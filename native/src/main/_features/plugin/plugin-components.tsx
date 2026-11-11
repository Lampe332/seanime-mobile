import { PickRow } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover/popover"
import { Select } from "@/components/ui/select/select"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Switch } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { useDebounce } from "@/hooks/use-debounce"
import { openInAppBrowser } from "@/lib/helpers/browser"
import { colors } from "@/lib/theme/tokens"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { Image } from "expo-image"
import React from "react"
import { Pressable, ScrollView, TextInput, View } from "react-native"
import { PluginClientEvents, PluginServerEvents, usePluginListen, usePluginSend } from "./plugin-events"
import { cssLength, pluginBoxLook, pluginIconButton, pluginSelectOptions, type PluginSelectValue, toNativeStyle } from "./plugin-logic"

/*
 * The components a plugin draws (web components/registry.tsx + registry-components.tsx), as native views in the phone
 * kit's look (mobile-plugin-runtime.css: raised surfaces instead of outlines, 48dp fields, pill buttons, wrapping rows).
 * Every handler goes back to the plugin as `handler:triggered`, fields report through their field ref, forms submit
 * their values. A plugin's `className` is web CSS and does not apply here; its inline style is taken as far as a native
 * view can (toNativeStyle); its `css` component has nothing to style (docs §9).
 */
export type PluginComponent = { type: string, props?: Record<string, unknown>, id?: string, key?: string }

type PluginScope = { extensionId: string, extensionName: string }
export const PluginScopeContext = React.createContext<PluginScope>({ extensionId: "", extensionName: "" })

/** Inside a trigger (modal, popover, menu): a tap on the plugin's own button also opens what it triggers, as the web's nested click did */
const TriggerContext = React.createContext<(() => void) | undefined>(undefined)

function useHandler() {
    const { extensionId } = React.useContext(PluginScopeContext)
    const send = usePluginSend()
    const trigger = React.useContext(TriggerContext)
    return React.useCallback((handlerName: unknown, event: Record<string, unknown> = {}) => {
        trigger?.()
        if (typeof handlerName === "string" && handlerName) send(PluginClientEvents.EventHandlerTriggered, { handlerName, event }, extensionId)
    }, [send, extensionId, trigger])
}

type FieldRef = { current?: unknown, __ID?: string }

/** A field's value: reported (debounced) to its handler and field ref after the first render; the plugin can set it */
function useFieldValue<T>(props: { value?: T, fieldRef?: FieldRef, onChange?: string }, debounceMs = 200) {
    const { extensionId } = React.useContext(PluginScopeContext)
    const send = usePluginSend()
    const initial = (props.value === undefined || (props.value as unknown) === "" ? props.fieldRef?.current : props.value) as T | undefined
    const [value, setValue] = React.useState<T | undefined>(initial)
    const debounced = useDebounce(value, debounceMs)
    const first = React.useRef(true)
    React.useEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        if (props.onChange) send(PluginClientEvents.EventHandlerTriggered, { handlerName: props.onChange, event: { value: debounced } }, extensionId)
        if (props.fieldRef?.__ID) send(PluginClientEvents.FieldRefSendValue, { fieldRef: props.fieldRef.__ID, value: debounced }, extensionId)
        // only the settled value is reported
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced])
    usePluginListen<{ fieldRef: string, value: T }>(PluginServerEvents.FieldRefSetValue, extensionId, data => {
        if (props.fieldRef?.__ID && data.fieldRef === props.fieldRef.__ID) setValue(data.value)
    })
    return [value, setValue] as const
}

const str = (value: unknown) => typeof value === "string" ? value : undefined
const items = (value: unknown) => Array.isArray(value) ? value as PluginComponent[] : undefined

export function RenderPluginComponents({ data }: { data: unknown }): React.ReactNode {
    if (Array.isArray(data)) return <>{(data as (PluginComponent | null)[]).map((component, i) => <RenderPluginComponents key={component?.key || component?.id || i} data={component} />)}</>
    if (!data || typeof data !== "object") return null
    const component = data as PluginComponent
    const props = component.props ?? {}
    const Renderer = REGISTRY[component.type]
    if (!Renderer) {
        if (component.type === "" && typeof props.item === "string") return props.item
        return <Muted className="p-4">Component type &quot;{component.type}&quot; not found</Muted>
    }
    return <Renderer {...props} />
}

function Box({ style, className, onClick, children, gap, direction }: {
    style?: unknown, className?: unknown, onClick?: unknown, children?: React.ReactNode, gap?: number, direction?: "row" | "column"
}) {
    const handle = useHandler()
    const look = pluginBoxLook(className)
    const native = toNativeStyle(style)
    const layout = direction ? { flexDirection: direction, gap: gap === undefined ? 8 : gap * 4, ...(direction === "row" ? { flexWrap: "wrap" as const } : null) } : null
    const boxClass = cn("min-w-0 max-w-full", look === "raised" && "rounded-surface bg-sm-surface-raised p-3", look === "line" && "border-b border-sm-line")
    if (typeof onClick === "string" && onClick) {
        return <Pressable accessibilityRole="button" onPress={() => handle(onClick)} style={[layout, native]}
            className={cn(boxClass, look === "raised" && "active:bg-sm-surface-control")}>{children}</Pressable>
    }
    return <View style={[layout, native]} className={boxClass}>{children}</View>
}

const REGISTRY: Record<string, React.ComponentType<Record<string, unknown>>> = {
    flex: props => <Box style={props.style} className={props.className} direction={props.direction === "column" ? "column" : "row"}
        gap={typeof props.gap === "number" ? props.gap : 2}><RenderPluginComponents data={props.items} /></Box>,
    stack: props => <Box style={props.style} className={props.className} direction="column" gap={typeof props.gap === "number" ? props.gap : 2}>
        <RenderPluginComponents data={props.items} /></Box>,
    div: props => <Box style={props.style} className={props.className} onClick={props.onClick}><RenderPluginComponents data={props.items} /></Box>,
    text: props => <Text selectable style={toNativeStyle(props.style)} className="text-[15px] leading-[22px] text-sm-text">{str(props.text)}</Text>,
    p: props => <Text style={toNativeStyle(props.style)} className="w-full text-[15px] leading-[22px] text-sm-text"><RenderPluginComponents data={props.items} /></Text>,
    span: props => <Text style={toNativeStyle(props.style)}>{str(props.text)}<RenderPluginComponents data={props.items} /></Text>,
    anchor: props => <PluginLink {...props}>{str(props.text) || "Link"}</PluginLink>,
    a: props => <PluginLink {...props}><RenderPluginComponents data={props.items} /></PluginLink>,
    button: PluginButton,
    input: PluginInput,
    select: PluginSelect,
    checkbox: props => <PluginToggle {...props} kind="checkbox" />,
    switch: props => <PluginToggle {...props} kind="switch" />,
    "radio-group": PluginRadioGroup,
    form: PluginForm,
    // a plugin's CSS styles web elements; native views have nothing it could reach (docs §9)
    css: () => null,
    tooltip: props => <View accessibilityHint={str(props.text)} className="self-start"><RenderPluginComponents data={props.item} /></View>,
    modal: PluginModal,
    popover: PluginPopover,
    "dropdown-menu": PluginDropdownMenu,
    "dropdown-menu-item": PluginDropdownMenuItem,
    "dropdown-menu-separator": () => <View className="my-1 h-px bg-sm-line" />,
    "dropdown-menu-label": props => <Text className="px-3 py-2 text-[13px] text-sm-text-muted">{str(props.label)}</Text>,
    alert: PluginAlert,
    tabs: PluginTabs,
    "tabs-list": props => <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0" contentContainerClassName="gap-2">
        <RenderPluginComponents data={props.items} /></ScrollView>,
    "tabs-trigger": PluginTabsTrigger,
    "tabs-content": PluginTabsContent,
    badge: PluginBadge,
    img: props => {
        const width = cssLength(props.width)
        const height = cssLength(props.height)
        return <Image source={str(props.src)} accessibilityLabel={str(props.alt)} contentFit="contain"
            style={[{ width: width ?? "100%", height: height ?? 160, maxWidth: "100%" }, toNativeStyle(props.style)]} />
    },
}

function PluginLink(props: Record<string, unknown> & { children: React.ReactNode }) {
    const handle = useHandler()
    const href = str(props.href)
    return <Text accessibilityRole="link" suppressHighlighting={false} style={toNativeStyle(props.style)} className="text-sm-accent underline"
        onPress={() => {
            if (props.onClick) handle(props.onClick, { href, ...(str(props.text) ? { text: props.text } : null) })
            else if (href && /^https?:\/\//.test(href)) openInAppBrowser(href)
        }}>{props.children}</Text>
}

function PluginButton(props: Record<string, unknown>) {
    const handle = useHandler()
    const intent = str(props.intent) ?? ""
    // An icon button: no visible label, the icon is the style's background image (Random Entry's dice/anime/manga buttons
    // came out as empty pills, device run 06.11.); native views draw no CSS backgrounds, so the image goes inside
    const icon = pluginIconButton(props.label, props.style)
    if (icon) {
        return <Button intent="icon" size="md" wrapperClassName="self-start" disabled={!!props.disabled} loading={!!props.loading}
            onPress={() => handle(props.onClick)}>
            <Image source={icon} contentFit="contain" style={{ width: 24, height: 24 }} />
        </Button>
    }
    return <Button intent={intent.startsWith("primary") ? "primary" : intent.startsWith("alert") ? "danger" : "secondary"}
        wrapperClassName="max-w-full self-start" style={toNativeStyle(props.style)} disabled={!!props.disabled} loading={!!props.loading}
        onPress={() => handle(props.onClick)}>{str(props.label) || "Button"}</Button>
}

function FieldLabel({ label }: { label?: string }) {
    return label ? <Text className="text-[13px] font-semibold text-sm-text-muted">{label}</Text> : null
}

function PluginInput(props: Record<string, unknown>) {
    const { extensionId } = React.useContext(PluginScopeContext)
    const send = usePluginSend()
    const [value, setValue] = useFieldValue<string>(props as never)
    const [selection, setSelection] = React.useState<{ value: string, cursorStart: number, cursorEnd: number } | null>(null)
    const settled = useDebounce(selection, 400)
    React.useEffect(() => {
        if (typeof props.onSelect === "string" && settled) send(PluginClientEvents.EventHandlerTriggered, { handlerName: props.onSelect, event: settled }, extensionId)
        // only the settled selection is reported
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settled?.value, settled?.cursorStart, settled?.cursorEnd])
    const label = str(props.label)
    return <View className="min-w-0 max-w-full gap-1.5">
        <FieldLabel label={label} />
        <TextInput value={value ?? ""} onChangeText={setValue} placeholder={str(props.placeholder)} placeholderTextColor={colors.smTextSubtle}
            accessibilityLabel={label || str(props.placeholder)} editable={!props.disabled} multiline={!!props.textarea}
            onSelectionChange={typeof props.onSelect === "string" ? event => {
                const { start, end } = event.nativeEvent.selection
                setSelection({ value: (value ?? "").slice(start, end), cursorStart: start, cursorEnd: end })
            } : undefined}
            style={toNativeStyle(props.style)}
            className={cn("min-h-12 rounded-surface bg-sm-surface-raised px-4 font-sans text-base text-sm-text", props.textarea ? "py-3" : "", props.disabled ? "opacity-50" : "")} />
    </View>
}

function PluginSelect(props: Record<string, unknown>) {
    const [value, setValue] = useFieldValue<PluginSelectValue>(props as never)
    const options = Array.isArray(props.options) ? props.options as { label: string, value: PluginSelectValue }[] : []
    const selection = pluginSelectOptions(options, value)
    const label = str(props.label)
    return <View className="min-w-0 max-w-full gap-1.5">
        <FieldLabel label={label} />
        <Select value={selection.value} onValueChange={next => setValue(selection.decode(next))} disabled={!!props.disabled}
            options={selection.options.map(option => ({ value: option.value, label: option.label }))} placeholder={label || "…"} accessibilityLabel={label} />
    </View>
}

function PluginToggle(props: Record<string, unknown> & { kind: "checkbox" | "switch" }) {
    const [value, setValue] = useFieldValue<boolean>(props as never)
    const label = str(props.label) ?? ""
    const checked = !!value
    if (props.kind === "checkbox") return <View className="overflow-hidden rounded-surface"><PickRow checked={checked} label={label} onPress={() => !props.disabled && setValue(!checked)} /></View>
    return <View className="min-h-12 flex-row items-center gap-3">
        <Text className="min-w-0 flex-1 text-[15px]">{label}</Text>
        <Switch checked={checked} onCheckedChange={setValue} disabled={!!props.disabled} accessibilityLabel={label} />
    </View>
}

function PluginRadioGroup(props: Record<string, unknown>) {
    const [value, setValue] = useFieldValue<string>(props as never)
    const options = Array.isArray(props.options) ? props.options as { label: string, value: string }[] : []
    return <View className="gap-1.5">
        <FieldLabel label={str(props.label)} />
        <View accessibilityRole="radiogroup" className="gap-0.5 overflow-hidden rounded-surface">
            {options.map(option => <PickRow key={option.value} radio checked={value === option.value} label={option.label}
                onPress={() => !props.disabled && setValue(option.value)} />)}
        </View>
    </View>
}

type FormField = { id: string, type: string, name: string, label: string, placeholder?: string, value?: unknown, options?: { label: string, value: unknown }[] }

function initialFormValues(fields: FormField[]) {
    return Object.fromEntries(fields.filter(field => field.name).map(field => [field.name, field.value ?? (field.type === "checkbox" || field.type === "switch" ? false : "")]))
}

function PluginForm(props: Record<string, unknown>) {
    const { extensionId } = React.useContext(PluginScopeContext)
    const send = usePluginSend()
    const name = str(props.name) ?? ""
    const fields = React.useMemo(() => Array.isArray(props.fields) ? props.fields as FormField[] : [], [props.fields])
    const [values, setValues] = React.useState<Record<string, unknown>>(() => initialFormValues(fields))
    const set = (key: string, value: unknown) => setValues(prev => ({ ...prev, [key]: value }))

    usePluginListen<{ formName: string, fieldToReset?: string }>(PluginServerEvents.FormReset, extensionId, data => {
        if (data.formName !== name) return
        const initial = initialFormValues(fields)
        setValues(prev => data.fieldToReset ? { ...prev, [data.fieldToReset]: initial[data.fieldToReset] } : initial)
    })
    usePluginListen<{ formName: string, data: Record<string, unknown> }>(PluginServerEvents.FormSetValues, extensionId, data => {
        if (data.formName === name) setValues(prev => ({ ...prev, ...data.data }))
    })

    const submit = () => send(PluginClientEvents.FormSubmitted, { formName: name, data: values }, extensionId)
    return <View className="gap-4">
        {fields.map(field => {
            if (!field.name && field.type !== "submit") return null
            const value = values[field.name]
            switch (field.type) {
                case "input":
                case "number":
                    return <View key={field.id} className="gap-1.5">
                        <FieldLabel label={field.label} />
                        <TextInput value={value === undefined || value === null ? "" : String(value)} placeholder={field.placeholder} placeholderTextColor={colors.smTextSubtle}
                            keyboardType={field.type === "number" ? "numeric" : "default"} accessibilityLabel={field.label}
                            onChangeText={text => set(field.name, field.type === "number" && text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text)}
                            className="min-h-12 rounded-surface bg-sm-surface-raised px-4 font-sans text-base text-sm-text" />
                    </View>
                case "select": {
                    const options = (field.options ?? []).map(option => ({ label: option.label, value: String(option.value) }))
                    return <View key={field.id} className="gap-1.5">
                        <FieldLabel label={field.label} />
                        <Select value={value ? String(value) : undefined} onValueChange={next => set(field.name, next)} options={options}
                            placeholder={field.placeholder || field.label} accessibilityLabel={field.label} />
                    </View>
                }
                case "checkbox":
                    return <View key={field.id} className="overflow-hidden rounded-surface"><PickRow checked={!!value} label={field.label} onPress={() => set(field.name, !value)} /></View>
                case "switch":
                    return <View key={field.id} className="min-h-12 flex-row items-center gap-3">
                        <Text className="min-w-0 flex-1 text-[15px]">{field.label}</Text>
                        <Switch checked={!!value} onCheckedChange={next => set(field.name, next)} accessibilityLabel={field.label} />
                    </View>
                case "radio":
                    return <View key={field.id} className="gap-1.5">
                        <FieldLabel label={field.label} />
                        <View className="gap-0.5 overflow-hidden rounded-surface">
                            {(field.options ?? []).map(option => <PickRow key={String(option.value)} radio checked={value === String(option.value)} label={option.label}
                                onPress={() => set(field.name, String(option.value))} />)}
                        </View>
                    </View>
                case "date": {
                    const date = value instanceof Date ? value : typeof value === "string" && value ? new Date(value) : undefined
                    return <View key={field.id} className="gap-1.5">
                        <FieldLabel label={field.label} />
                        <Pressable accessibilityRole="button" accessibilityLabel={field.label}
                            onPress={() => DateTimePickerAndroid.open({ value: date && !isNaN(date.getTime()) ? date : new Date(), mode: "date",
                                onValueChange: (_event, picked) => picked && set(field.name, picked) })}
                            className="min-h-12 justify-center rounded-surface bg-sm-surface-raised px-4 active:bg-sm-surface-control">
                            <Text className="text-base">{date && !isNaN(date.getTime()) ? date.toLocaleDateString() : field.placeholder || "—"}</Text>
                        </Pressable>
                    </View>
                }
                case "submit":
                    return <Button key={field.id} wrapperClassName="self-start" onPress={submit}>{field.label}</Button>
                default:
                    return null
            }
        })}
    </View>
}

/** A trigger the user taps to open what it belongs to; the plugin's own button inside it keeps its handler */
function Trigger({ data, onOpen }: { data: unknown, onOpen: () => void }) {
    if (!data) return null
    return <TriggerContext value={onOpen}>
        <Pressable accessibilityRole="button" onPress={onOpen} className="self-start"><RenderPluginComponents data={data} /></Pressable>
    </TriggerContext>
}

function PluginModal(props: Record<string, unknown>) {
    const { extensionName } = React.useContext(PluginScopeContext)
    const handle = useHandler()
    const [open, setOpen] = React.useState(!!props.open)
    // the plugin can open or close the modal after its first render
    const [storedOpen, setStoredOpen] = React.useState(props.open)
    if (storedOpen !== props.open) {
        setStoredOpen(props.open)
        if (props.open !== undefined) setOpen(!!props.open)
    }
    const change = (next: boolean) => {
        setOpen(next)
        if (props.onOpenChange) handle(props.onOpenChange, { open: next })
    }
    return <>
        <Trigger data={props.trigger} onOpen={() => change(true)} />
        <Sheet open={open} onOpenChange={change} title={str(props.title) || extensionName} description={str(props.description)}
            footer={props.footer ? <View className="flex-1"><RenderPluginComponents data={props.footer} /></View> : undefined}>
            <RenderPluginComponents data={props.items} />
        </Sheet>
    </>
}

function PluginPopover(props: Record<string, unknown>) {
    const { extensionName } = React.useContext(PluginScopeContext)
    const [open, setOpen] = React.useState(false)
    return <>
        <Trigger data={props.trigger} onOpen={() => setOpen(true)} />
        <Sheet open={open} onOpenChange={setOpen} title={extensionName}><RenderPluginComponents data={props.items} /></Sheet>
    </>
}

function PluginDropdownMenu(props: Record<string, unknown>) {
    return <Popover>
        <PopoverTrigger asChild>
            <Pressable accessibilityRole="button" className="self-start"><View pointerEvents="none"><RenderPluginComponents data={props.trigger} /></View></Pressable>
        </PopoverTrigger>
        <PopoverContent align="start"><ScrollView style={{ maxHeight: 420 }}><RenderPluginComponents data={props.items} /></ScrollView></PopoverContent>
    </Popover>
}

function PluginDropdownMenuItem(props: Record<string, unknown>) {
    const handle = useHandler()
    return <PopoverClose asChild>
        <Pressable accessibilityRole="menuitem" disabled={!!props.disabled} onPress={() => handle(props.onClick)}
            className={cn("min-h-12 flex-row items-center gap-3 rounded-[10px] px-3 active:bg-sm-surface-control", !!props.disabled && "opacity-50")}>
            <View pointerEvents="none" className="min-w-0 flex-1"><RenderPluginComponents data={props.item} /></View>
        </Pressable>
    </PopoverClose>
}

const ALERT_TONES: Record<string, string> = { success: colors.smSuccess, warning: colors.smWarning, alert: colors.smDanger, info: colors.smAccent }

function PluginAlert(props: Record<string, unknown>) {
    const tone = ALERT_TONES[str(props.intent) ?? "info"] ?? colors.smAccent
    return <View accessibilityRole="alert" style={{ borderLeftColor: tone }} className="gap-1 rounded-surface border-l-4 bg-sm-surface-raised p-4">
        {!!str(props.title) && <Text className="font-semibold" style={{ color: tone }}>{str(props.title)}</Text>}
        {!!str(props.description) && <Text className="text-sm leading-[21px] text-sm-text-muted">{str(props.description)}</Text>}
    </View>
}

function PluginBadge(props: Record<string, unknown>) {
    const intent = str(props.intent) ?? "gray"
    const tone = intent === "success" ? colors.smSuccess : intent === "warning" ? colors.smWarning : intent === "alert" ? colors.smDanger
        : intent === "primary" || intent === "info" || intent === "blue" ? colors.smAccent : colors.smTextMuted
    return <View className="self-start rounded-full bg-sm-surface-control px-2.5 py-1">
        <Text className="text-xs font-semibold" style={{ color: tone }}>{str(props.text)}</Text>
    </View>
}

const TabsContext = React.createContext<{ value: string, setValue: (value: string) => void }>({ value: "", setValue: () => {} })

function PluginTabs(props: Record<string, unknown>) {
    const [value, setValue] = React.useState(str(props.defaultValue) ?? "")
    return <TabsContext value={{ value, setValue }}><View className="gap-3"><RenderPluginComponents data={items(props.items)} /></View></TabsContext>
}

function PluginTabsTrigger(props: Record<string, unknown>) {
    const tabs = React.useContext(TabsContext)
    const value = str(props.value) ?? ""
    const selected = tabs.value === value
    return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => tabs.setValue(value)}
        className={cn("min-h-12 flex-row items-center rounded-full px-4", selected ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
        <View pointerEvents="none"><RenderPluginComponents data={props.item} /></View>
    </Pressable>
}

function PluginTabsContent(props: Record<string, unknown>) {
    const tabs = React.useContext(TabsContext)
    if (tabs.value !== (str(props.value) ?? "")) return null
    return <View><RenderPluginComponents data={props.items} /></View>
}
