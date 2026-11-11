import { SearchPhone } from "@/main/search/_screens/search-phone"
import { useLocalSearchParams } from "expo-router"

// Search tab (main/search/_screens/search-phone.tsx), at the web app's path "/search?sorting=…&genre=…&q=…". Its own
// params only: the global ones belong to whatever screen is in front while the tab waits in the background.
export default function SearchScreen() {
    const params = useLocalSearchParams()
    return <SearchPhone params={params} />
}
