import { describe, expect, it } from "vitest"
import { pluginSelectOptions } from "./plugin-select-options"
describe("plugin select transport values", () => {
    const options = [{ label: "0%", value: 0 }, { label: "25%", value: .25 }, { label: "100%", value: 1 }]
    it("keeps numeric values, including zero, behind Radix string IDs", () => {
        const selection = pluginSelectOptions(options, 0)
        expect(selection.value).toBe("plugin-option-0")
        expect(selection.decode("plugin-option-0")).toBe(0)
        expect(selection.decode("plugin-option-1")).toBe(.25)
        expect(selection.options.every(o => typeof o.value === "string" && o.value.length > 0)).toBe(true)
    })
    it("shows a saved non-preset value without changing or rounding it", () => {
        const selection = pluginSelectOptions(options, .7)
        expect(selection.options[0]).toMatchObject({ label: "0.7", value: "plugin-current" })
        expect(selection.decode(selection.value!)).toBe(.7)
        expect(selection.decode("plugin-option-1")).toBe(.25)
    })
    it("supports empty option values and numeric/string values without ID collisions", () => {
        const selection = pluginSelectOptions([{ label: "Empty", value: "" }, { label: "String", value: "0" }, { label: "Number", value: 0 }], "")
        expect(selection.value).toBe("plugin-option-0")
        expect(selection.decode("plugin-option-1")).toBe("0")
        expect(selection.decode("plugin-option-2")).toBe(0)
    })
})
