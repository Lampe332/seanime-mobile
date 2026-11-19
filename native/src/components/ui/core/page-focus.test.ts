import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { releaseIfLeft } from "./page-focus"

const read = (file: string) => readFileSync(join(__dirname, "..", "..", "..", file), "utf8")

// 4.2.0 E (Pixel Tablet): a search field of a page left behind kept the focus, so the keyboard came up on the next page
describe("a text field lets go of the keyboard when its page is left", () => {
    it("blurs the field once its page is no longer in front, never while it is", () => {
        const blurred: string[] = []
        releaseIfLeft(true, { blur: () => blurred.push("front") })
        releaseIfLeft(false, { blur: () => blurred.push("left") })
        releaseIfLeft(false, null)
        expect(blurred).toEqual(["left"])
    })

    it("tells each page whether it is in front", () => {
        expect(read("components/ui/core/page-transition.tsx")).toMatch(/<PageFocusContext\.Provider value=\{isFocused\}>/)
    })

    it("lets every search field and the text fields on pages go", () => {
        expect(read("components/shared/phone-kit.tsx")).toMatch(/useReleaseFocusOnLeave\(own\)/)
        expect(read("main/settings/_screens/settings-account.tsx").match(/useReleaseFocusOnLeave\(/g)).toHaveLength(2)
        expect(read("main/settings/_screens/settings-torrents.tsx")).toMatch(/useReleaseFocusOnLeave\(field\)/)
        expect(read("main/settings/_screens/settings-auto-select.tsx").match(/useReleaseFocusOnLeave\(field\)/g)).toHaveLength(2)
        expect(read("main/manga/_containers/chapter-list/chapter-list.tsx")).toMatch(/useReleaseFocusOnLeave\(jumpField\)/)
    })

    it("takes the keyboard down when a sheet or dialog opens or closes", () => {
        expect(read("components/ui/sheet/sheet.tsx").match(/useDismissKeyboardOnToggle\(open\)/g)).toHaveLength(2)
    })
})
