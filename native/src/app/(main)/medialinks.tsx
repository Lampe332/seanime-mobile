import { MedialinksPhone } from "@/main/medialinks/_screens/medialinks-phone"
import { useLocalSearchParams } from "expo-router"

// The external player's page at the old app's path "/medialinks?id=…" (handle-play-media.ts with "External player link")
export default function MedialinksScreen() {
    const { id } = useLocalSearchParams<{ id?: string }>()
    return <MedialinksPhone mediaId={id || undefined} />
}
