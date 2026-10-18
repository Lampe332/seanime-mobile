import React from "react"

export function MobileIcon({ name, className }: { name: string, className?: string }) {
    return <span aria-hidden="true" data-icon={name} className={className} />
}
