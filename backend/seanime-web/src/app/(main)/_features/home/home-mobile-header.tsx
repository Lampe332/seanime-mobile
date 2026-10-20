import React from "react"
import { atom } from "jotai"
import { useSetAtom } from "jotai/react"
import { useTr } from "@/lib/app-language"

/** Home toolbar actions render into this slot so they sit beside the title. */
export const __home_mobileActionsSlot = atom<HTMLElement | null>(null)

/** Android Home identity: image-independent and deliberately static. */
export function HomeMobileHeader({ children }: { children?: React.ReactNode }) {
    const tr = useTr()
    const setActionsSlot = useSetAtom(__home_mobileActionsSlot)
    return <header className="home-mobile-header">
        <div className="home-mobile-heading"><span>Seanime</span><h1>{tr("Home", "Startseite")}</h1></div>
        <div className="home-mobile-tools"><div className="home-mobile-actions" ref={setActionsSlot} />{children}</div>
    </header>
}
