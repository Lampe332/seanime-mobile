import { __discord_pageTypeAtom } from "@/app/(main)/discover/_lib/discover.atoms"
import { DiscoverPhone } from "@/app/(main)/discover/_screens/discover-phone"
import { useSearchParams } from "@/lib/navigation"
import { useSetAtom } from "jotai/react"
import React from "react"

export default function Page() {
    const setPageType = useSetAtom(__discord_pageTypeAtom)
    const searchParams = useSearchParams()
    const searchType = searchParams.get("type")

    // DiscoverPhone reads ?type= on its first render and the atom afterwards. Only the address the page opens with sets the
    // tab: the tabs write ?type= themselves (replace), and following those writes let a late one switch back to a tab
    // tapped before (fast taps showed Manga, Schedule, Anime in turn).
    React.useEffect(() => {
        if (searchType) {
            setPageType(searchType as any)
        }
    }, [])

    return <DiscoverPhone />
}
