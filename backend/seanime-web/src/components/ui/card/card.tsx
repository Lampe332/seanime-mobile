import { cva } from "class-variance-authority"
import * as React from "react"
import { cn, defineStyleAnatomy } from "../core/styling"

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

const CardAnatomy = defineStyleAnatomy({
    root: cva([
        "UI-Card__root",
        "rounded-xl border bg-[--paper] shadow-sm",
    ]),
    header: cva([
        "UI-Card__header",
        "flex flex-col space-y-1.5 p-4",
    ]),
    title: cva([
        "UI-Card__title",
        "text-2xl font-semibold leading-none tracking-tight",
    ]),
    description: cva([
        "UI-Card__description",
        "text-sm text-[--muted]",
    ]),
    content: cva([
        "UI-Card__content",
        "p-4 pt-0",
    ]),
    footer: cva([
        "UI-Card__footer",
        "flex items-center p-4 pt-0",
    ]),
})

/* -------------------------------------------------------------------------------------------------
 * Card
 * -----------------------------------------------------------------------------------------------*/

export type CardProps = React.ComponentPropsWithoutRef<"div">

export const Card = React.forwardRef<HTMLDivElement, CardProps>((props, ref) => {
    const { className, ...rest } = props
    return (
        <div
            ref={ref}
            className={cn(CardAnatomy.root(), className)}
            {...rest}
        />
    )
})
Card.displayName = "Card"

