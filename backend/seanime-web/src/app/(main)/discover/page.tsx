import { __discord_pageTypeAtom } from "@/app/(main)/discover/_lib/discover.atoms"
import { DiscoverPhone } from "@/app/(main)/discover/_screens/discover-phone"
import { useSearchParams } from "@/lib/navigation"
import { useSetAtom } from "jotai/react"
import React from "react"

export default function Page() {
    const setPageType = useSetAtom(__discord_pageTypeAtom)
    const searchParams = useSearchParams()
    const searchType = searchParams.get("type")

    // DiscoverPhone reads ?type= on its first render and the atom afterwards
    React.useEffect(() => {
        if (searchType) {
            setPageType(searchType as any)
        }
    }, [searchParams])

    return <DiscoverPhone />
}
