import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { cva } from "class-variance-authority"
import * as React from "react"
import { cn, ComponentAnatomy, defineStyleAnatomy } from "../core/styling"

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

const ContextMenuAnatomy = defineStyleAnatomy({
    subTrigger: cva([
        "UI-ContextMenu__subTrigger",
        "focus:bg-[--subtle] data-[state=open]:bg-[--subtle]",
    ]),
    subContent: cva([
        "UI-ContextMenu__subContent",
        "z-50 min-w-[12rem] overflow-hidden rounded-xl border bg-[--paper-lighter] p-2 text-[--foreground] shadow-sm",
        "data-[state=open]:animate-in",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
    ]),
    trigger: cva([
        "UI-ContextMenu__trigger",
    ]),
    content: cva([
        "UI-ContextMenu__content",
    ]),
    root: cva([
        "UI-ContextMenu__root",
        "z-50 min-w-[15rem] overflow-hidden rounded-xl border bg-[--paper-lighter] p-1 text-[--foreground] shadow-sm",
        "data-[state=open]:animate-in",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
    ]),
    item: cva([
        "UI-ContextMenu__item",
        "relative flex cursor-default select-none items-center rounded-[--radius] cursor-pointer px-1.5 py-2 text-sm outline-none transition-colors",
        "focus:bg-[--subtle] data-[disabled]:pointer-events-none",
        "data-[disabled]:opacity-50",
        "[&>svg]:mr-2 [&>svg]:text-lg",
    ]),
    group: cva([
        "UI-ContextMenu__group",
    ]),
    label: cva([
        "UI-ContextMenu__label",
        "px-2 py-1.5 text-sm font-semibold text-[--muted]",
    ]),
    separator: cva([
        "UI-ContextMenu__separator",
        "-mx-1 my-1 h-px bg-[--border]",
    ]),
    shortcut: cva([
        "UI-ContextMenu__shortcut",
        "ml-auto text-xs tracking-widest opacity-60",
    ]),
})

const __ContextMenuAnatomyContext = React.createContext<ComponentAnatomy<typeof ContextMenuAnatomy> & { className?: string }>({})

/* -------------------------------------------------------------------------------------------------
 * ContextMenuTrigger
 * -----------------------------------------------------------------------------------------------*/

export type ContextMenuTriggerProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>

export const ContextMenuTrigger = React.forwardRef<HTMLDivElement, ContextMenuTriggerProps>((props, ref) => {
    const { className, ...rest } = props

    const { triggerClass } = React.useContext(__ContextMenuAnatomyContext)

    return <ContextMenuPrimitive.Trigger ref={ref} className={cn(triggerClass, className)} {...rest} />
})

/* -------------------------------------------------------------------------------------------------
 * ContextMenuContent
 * -----------------------------------------------------------------------------------------------*/

export type ContextMenuContentProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>

export const ContextMenuContent = React.forwardRef<HTMLDivElement, ContextMenuContentProps>((props, ref) => {
    const { className, ...rest } = props

    const { className: rootClass, contentClass } = React.useContext(__ContextMenuAnatomyContext)

    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content
                ref={ref}
                className={cn(ContextMenuAnatomy.root(), rootClass, contentClass, className)}
                {...rest}
            />
        </ContextMenuPrimitive.Portal>
    )
})

/* -------------------------------------------------------------------------------------------------
 * ContextMenuGroup
 * -----------------------------------------------------------------------------------------------*/

export type ContextMenuGroupProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Group>

export const ContextMenuGroup = React.forwardRef<HTMLDivElement, ContextMenuGroupProps>((props, ref) => {
    const { className, ...rest } = props

    const { groupClass } = React.useContext(__ContextMenuAnatomyContext)

    return (
        <ContextMenuPrimitive.Group
            ref={ref}
            className={cn(ContextMenuAnatomy.group(), groupClass, className)}
            {...rest}
        />
    )
})

ContextMenuGroup.displayName = "ContextMenuGroup"

/* -------------------------------------------------------------------------------------------------
 * ContextMenuItem
 * -----------------------------------------------------------------------------------------------*/

export type ContextMenuItemProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
}

export const ContextMenuItem = React.forwardRef<HTMLDivElement, ContextMenuItemProps>((props, ref) => {
    const { className, inset, ...rest } = props

    const { itemClass } = React.useContext(__ContextMenuAnatomyContext)

    return (
        <ContextMenuPrimitive.Item
            ref={ref}
            className={cn(
                ContextMenuAnatomy.item(),
                inset && "pl-8",
                itemClass,
                className,
            )}
            {...rest}
        />
    )
})
ContextMenuItem.displayName = "ContextMenuItem"

/* -------------------------------------------------------------------------------------------------
 * ContextMenuLabel
 * -----------------------------------------------------------------------------------------------*/

export type ContextMenuLabelProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean
}

export const ContextMenuLabel = React.forwardRef<HTMLDivElement, ContextMenuLabelProps>((props, ref) => {
    const { className, inset, ...rest } = props

    const { labelClass } = React.useContext(__ContextMenuAnatomyContext)

    return (
        <ContextMenuPrimitive.Label
            ref={ref}
            className={cn(
                ContextMenuAnatomy.label(),
                inset && "pl-8",
                labelClass,
                className,
            )}
            {...rest}
        />
    )
})

ContextMenuLabel.displayName = "ContextMenuLabel"

/* -------------------------------------------------------------------------------------------------
 * ContextMenuSeparator
 * -----------------------------------------------------------------------------------------------*/

export type ContextMenuSeparatorProps = React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>

export const ContextMenuSeparator = React.forwardRef<HTMLDivElement, ContextMenuSeparatorProps>((props, ref) => {
    const { className, ...rest } = props

    const { separatorClass } = React.useContext(__ContextMenuAnatomyContext)

    return (
        <ContextMenuPrimitive.Separator
            ref={ref}
            className={cn(ContextMenuAnatomy.separator(), separatorClass, className)}
            {...rest}
        />
    )
})

ContextMenuSeparator.displayName = "ContextMenuSeparator"

