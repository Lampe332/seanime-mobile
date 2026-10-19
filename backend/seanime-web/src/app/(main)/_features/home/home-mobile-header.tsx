import React from "react"
import { useTr } from "@/lib/app-language"

/** Android Home identity: image-independent and deliberately static. */
export function HomeMobileHeader({ children }: { children?: React.ReactNode }) {
    const tr = useTr()
    return <header className="home-mobile-header">
        <div className="home-mobile-heading"><span><i aria-hidden="true" />Seanime</span><h1>{tr("Home", "Startseite")}</h1></div>
        <div className="home-mobile-tools">{children}</div>
        <svg className="home-mobile-motif" viewBox="0 0 180 96" fill="none" aria-hidden="true">
            <path d="M2 73h56l22-22h44l34-34h20M30 95l32-32h45l25-25h46" />
            <rect x="99" y="7" width="24" height="24" rx="7" transform="rotate(12 111 19)" />
            <circle cx="80" cy="51" r="4" /><circle cx="132" cy="38" r="4" />
        </svg>
    </header>
}
