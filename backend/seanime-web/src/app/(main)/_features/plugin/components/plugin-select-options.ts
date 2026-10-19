/** Radix uses string IDs; plugins may use numeric values and keep values not in the current presets. */
export type PluginSelectValue = string | number
export function pluginSelectOptions(options: Array<{ label: string; value: PluginSelectValue }>, current: PluginSelectValue | undefined) {
    const mapped = options.map((option, index) => ({ label: option.label, value: `plugin-option-${index}`, original: option.value }))
    let selected = mapped.find(option => Object.is(option.original, current))
    if (!selected && current !== undefined && current !== "") {
        selected = { label: String(current), value: "plugin-current", original: current }
        mapped.unshift(selected)
    }
    return { options: mapped, value: selected?.value, decode: (value: string) => mapped.find(option => option.value === value)?.original }
}
