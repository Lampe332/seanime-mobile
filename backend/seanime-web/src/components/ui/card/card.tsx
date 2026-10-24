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

