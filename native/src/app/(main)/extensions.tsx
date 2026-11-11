import { ExtensionsPhone } from "@/main/extensions/_screens/extensions-phone"
import { useLocalSearchParams } from "expo-router"

// Extensions at the old app's path "/extensions" (Menu, content gate, Torrent sheet) and
// "/extensions?tab=marketplace&type=onlinestream-provider" (Online tab: find more providers).
export default function ExtensionsScreen() {
    const { tab, type } = useLocalSearchParams<{ tab?: string, type?: string }>()
    return <ExtensionsPhone page={tab === "marketplace" ? "marketplace" : tab === "installed" ? "installed" : undefined} marketType={type || undefined} />
}
