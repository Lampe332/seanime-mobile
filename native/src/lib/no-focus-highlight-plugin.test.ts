import { describe, expect, it } from "vitest"
// the config plugin is CommonJS (plugins/), tested here because vitest only runs src/**
import plugin from "../../plugins/with-no-focus-highlight"

type Styles = { resources: { style: { $: { name: string, parent?: string }, item: { $: { name: string, "tools:targetApi"?: string }, _: string }[] }[] } }
const { withoutFocusHighlight } = plugin as unknown as { withoutFocusHighlight: (styles: Styles) => Styles }

// shape of the styles.xml that expo prebuild (SDK 58) writes
const styles = (): Styles => ({
    resources: {
        style: [{ $: { name: "AppTheme", parent: "Theme.EdgeToEdge" }, item: [{ $: { name: "android:textColor" }, _: "@android:color/black" }] }],
    },
})

// 4.2.0 E (S22): after the way back from Search the magnifier of Home's head kept Android's square grey focus box
describe("with-no-focus-highlight", () => {
    it("turns Android's default focus highlight off in the app theme, from API 26", () => {
        const theme = withoutFocusHighlight(styles()).resources.style[0]!
        const item = theme.item.find(entry => entry.$.name === "android:defaultFocusHighlightEnabled")
        expect(item?._).toBe("false")
        expect(item?.$["tools:targetApi"]).toBe("26")
        // the theme's other items stay
        expect(theme.item.some(entry => entry.$.name === "android:textColor")).toBe(true)
    })

    it("adds the item once when prebuild runs it again", () => {
        const twice = withoutFocusHighlight(withoutFocusHighlight(styles()))
        expect(twice.resources.style[0]!.item.filter(entry => entry.$.name === "android:defaultFocusHighlightEnabled")).toHaveLength(1)
    })
})
