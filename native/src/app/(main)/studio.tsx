import { StudioPhone } from "@/main/studio/_screens/studio-phone"
import { useLocalSearchParams } from "expo-router"

// A studio's anime at "/studio?id=…&name=…" (the studio under an anime page's title)
export default function StudioScreen() {
    const { id, name } = useLocalSearchParams<{ id?: string, name?: string }>()
    return <StudioPhone id={Number(id)} name={name || undefined} />
}
