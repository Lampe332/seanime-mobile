import React from "react"
import { LuArrowLeft } from "react-icons/lu"

/** Shared Downloads page head: a 48px back action, then the title and one line of facts. */
export function DownloadsHeader({ backLabel, onBack, title, facts }: { backLabel: string, onBack: () => void, title?: string, facts?: string }) {
    return <header className="mdl-header">
        <button type="button" className="mdl-icon-button" aria-label={backLabel} onClick={onBack}><LuArrowLeft aria-hidden /></button>
        {title && <div className="mdl-header-text"><h1>{title}</h1>{facts && <p>{facts}</p>}</div>}
    </header>
}
