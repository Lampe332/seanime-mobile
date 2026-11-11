import { CustomSourcesPhone } from "@/main/custom-sources/_screens/custom-sources-phone"
import { useLocalSearchParams } from "expo-router"

// Custom sources at the old app's path "/custom-sources?provider=…" (Extensions: "Browse", "Browse this source")
export default function CustomSourcesScreen() {
    const { provider } = useLocalSearchParams<{ provider?: string }>()
    return <CustomSourcesPhone providerParam={provider || undefined} />
}
