import { PhoneScreen } from "@/components/shared/phone-screen"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"

// A plugin's own page at the old app's path "/webview?id=…" (its Menu entry, or the plugin opening it)
export default function PluginScreen() {
    return (
        <PhoneScreen>
            <PluginWebviewSlot slot="screen" />
        </PhoneScreen>
    )
}
