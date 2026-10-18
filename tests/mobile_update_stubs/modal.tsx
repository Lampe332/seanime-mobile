import React from "react"

export function Modal({ open, children }: { open: boolean, children: React.ReactNode }) {
    return open ? <div role="dialog" data-update-dialog>{children}</div> : null
}
