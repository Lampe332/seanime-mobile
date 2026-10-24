import { ContextMenuContent } from "@/components/ui/context-menu"
import { ContextMenu } from "@radix-ui/react-context-menu"
import React from "react"
import "@/components/shared/mobile-surface.css"

export type SeaContextMenuProps = {
    content: React.ReactNode
    children?: React.ReactNode
    hideMenuIf?: boolean
    onOpenChange?: (open: boolean) => void
}

export const SeaContextMenu = React.memo((props: SeaContextMenuProps) => {

    const {
        content,
        children,
        hideMenuIf,
        onOpenChange,
        ...rest
    } = props

    return (
        <ContextMenu data-sea-context-menu onOpenChange={onOpenChange} {...rest}>
            {children}

            {!hideMenuIf &&
                <ContextMenuContent className="max-w-xs" data-sea-context-menu-content data-phone-menu
                    collisionPadding={16}>
                    {content}
                </ContextMenuContent>}
        </ContextMenu>
    )
})
