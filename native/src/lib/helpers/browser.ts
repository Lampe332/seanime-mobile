import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import * as Clipboard from "expo-clipboard"
import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"
import { AppState } from "react-native"

/** The web app opened a new browser tab; the app hands the link to the system (browser or the app that owns it). */
export function openTab(url: string) {
    void Linking.openURL(url).catch(() => toast.error(tr("No installed app can open this link", "Keine installierte App kann diesen Link öffnen")))
}

// never handed on (PopupWebViewSheet.kt / MainActivity.shouldOverrideUrlLoading)
const BLOCKED_SCHEMES = new Set(["about", "data", "file", "content", "javascript", "intent"])

/**
 * A web page over the app (the old app's PopupWebViewSheet.kt → expo-web-browser's Custom Tab in the app's colours;
 * back closes it and the app is where it was). Links of other apps (market:, mailto: …) go to the app that owns them.
 */
export function openInAppBrowser(url: string) {
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim())?.[1]?.toLowerCase()
    if (!scheme) {
        toast.error(tr("This link is invalid", "Dieser Link ist ungültig"))
        return
    }
    if (scheme === "http" || scheme === "https") {
        void WebBrowser.openBrowserAsync(url, {
            toolbarColor: "#0f0f14",
            secondaryToolbarColor: "#0f0f14",
            showTitle: true,
            enableBarCollapsing: true,
        }).catch(() => openTab(url))
        return
    }
    if (BLOCKED_SCHEMES.has(scheme)) return
    openTab(url)
}

export async function copyToClipboard(text: string) {
    await Clipboard.setStringAsync(text)
}

const SENSITIVE = { android: { isSensitive: true } }

/**
 * N-7: a secret (the recovery code) goes to the clipboard marked sensitive (ClipDescription.EXTRA_IS_SENSITIVE: no
 * preview on Android 13+, keyboards keep it out of their clipboard history) and is cleared after `clearAfterMs`. The
 * clipboard can only be read while the app is in front, so a deadline that passes in the background is handled when the
 * app comes back. Only the app's own copy is cleared; something copied later stays.
 */
export async function copySecretToClipboard(text: string, clearAfterMs = 60_000) {
    await Clipboard.setStringAsync(text, SENSITIVE)
    const deadline = Date.now() + clearAfterMs
    let finished = false
    const finish = async () => {
        if (finished || Date.now() < deadline || AppState.currentState !== "active") return
        finished = true
        subscription.remove()
        clearTimeout(timer)
        try {
            if (await Clipboard.getStringAsync() === text) await Clipboard.setStringAsync("", SENSITIVE)
        }
        catch {
            // nothing to clear
        }
    }
    const subscription = AppState.addEventListener("change", () => void finish())
    const timer = setTimeout(() => void finish(), clearAfterMs)
}
