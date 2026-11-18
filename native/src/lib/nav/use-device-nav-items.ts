// geschrieben nach: docs/IOS-MACHBARKEIT.md §5 (erste iOS-Test-App); keine Vorlage
import { DOWNLOADS_ON_DEVICE } from "@/lib/device-features"
import { type NavItem } from "@/lib/nav/nav-items"
import { useAllNavItems } from "@/lib/nav/nav-store"
import React from "react"

/** useAllNavItems without the entries this build cannot open (Downloads on iOS); nav-store.ts stays free of react-native for its tests */
export function useDeviceNavItems(): NavItem[] {
    const all = useAllNavItems()
    return React.useMemo(() => DOWNLOADS_ON_DEVICE ? all : all.filter(item => item.href !== "/android-downloads"), [all])
}
