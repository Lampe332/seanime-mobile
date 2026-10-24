import { __extensions_currentPageAtom } from "@/app/(main)/extensions/_containers/extension-list"
import { ExtensionsPhone } from "@/app/(main)/extensions/_screens/extensions-phone"
import { useSearchParams } from "@/lib/navigation"
import { useSetAtom } from "jotai"
import React from "react"

export default function Page() {

    const setPage = useSetAtom(__extensions_currentPageAtom)

    const searchParams = useSearchParams()
    React.useEffect(() => {
        const tab = searchParams.get("tab")
        if (tab) {
            setPage(tab as "installed" | "marketplace")
        }
    }, [searchParams])

    return <ExtensionsPhone />
}
