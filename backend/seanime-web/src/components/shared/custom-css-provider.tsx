import { useAtom, useAtomValue } from "jotai"
import { atomWithStorage } from "jotai/utils"

const customCSSAtom = atomWithStorage("sea-custom-css", {
    customCSS: "",
    mobileCustomCSS: "",
}, undefined, { getOnInit: true })

// The app only offers the mobile custom CSS; customCSS is the desktop field of the shared theme settings.
export function CustomCSSProvider() {
    const { mobileCustomCSS } = useAtomValue(customCSSAtom)

    return mobileCustomCSS ? <style id="sea-custom-css" dangerouslySetInnerHTML={{ __html: mobileCustomCSS }} /> : null
}

export function useCustomCSS() {
    const [customCSS, setCustomCSS] = useAtom(customCSSAtom)

    return { customCSS, setCustomCSS }
}
