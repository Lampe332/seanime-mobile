import { cva, VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn, ComponentAnatomy, defineStyleAnatomy } from "../core/styling"

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const AppLayoutAnatomy = defineStyleAnatomy({
    root: cva([
        "UI-AppLayout__root appLayout",
        "flex w-full group/appLayout",
    ], {
        variants: {
            withSidebar: {
                true: "flex-row with-sidebar",
                false: "flex-col",
            },
            sidebarSize: {
                slim: "sidebar-slim",
            },
        },
        defaultVariants: {
            withSidebar: false,
        },
    }),
})

// The native nav replaces the sidebar at every width; UIBottomNav.kt still reads its links from this DOM.
const AppLayoutSidebarAnatomy = defineStyleAnatomy({
    root: cva(["UI-AppLayoutSidebar__root hidden"]),
})

const AppLayoutContentAnatomy = defineStyleAnatomy({
    root: cva([
        "UI-AppLayoutContent__root",
        "relative",
    ]),
})

const AppLayoutStackAnatomy = defineStyleAnatomy({
    root: cva([
        "UI-AppLayoutStack__root",
        "relative",
    ], {
        variants: {
            spacing: {
                sm: "space-y-2",
                md: "space-y-4",
                lg: "space-y-8",
                xl: "space-y-10",
            },
        },
        defaultVariants: {
            spacing: "md",
        },
    }),
})

/* -------------------------------------------------------------------------------------------------
 * AppLayout
 * -----------------------------------------------------------------------------------------------*/

export type AppLayoutProps = React.ComponentPropsWithRef<"div"> &
    ComponentAnatomy<typeof AppLayoutAnatomy> &
    VariantProps<typeof AppLayoutAnatomy.root>

export const AppLayout = React.forwardRef<HTMLDivElement, AppLayoutProps>((props, ref) => {

    const {
        children,
        className,
        withSidebar = false,
        sidebarSize,
        ...rest
    } = props

    return (
        <div
            ref={ref}
            className={cn(
                AppLayoutAnatomy.root({ withSidebar, sidebarSize }),
                className,
            )}
            {...rest}
        >
            {children}
        </div>
    )

})

AppLayout.displayName = "AppLayout"

/* -------------------------------------------------------------------------------------------------
 * AppLayoutSidebar
 * -----------------------------------------------------------------------------------------------*/

export type AppLayoutSidebarProps = React.ComponentPropsWithRef<"aside">

export const AppLayoutSidebar = React.forwardRef<HTMLElement, AppLayoutSidebarProps>((props, ref) => {

    const {
        children,
        className,
        ...rest
    } = props

    return (
        <aside
            ref={ref}
            className={cn(AppLayoutSidebarAnatomy.root(), className)}
            {...rest}
        >
            {children}
        </aside>
    )

})

AppLayoutSidebar.displayName = "AppLayoutSidebar"

/* -------------------------------------------------------------------------------------------------
 * AppLayoutContent
 * -----------------------------------------------------------------------------------------------*/

export type AppLayoutContentProps = React.ComponentPropsWithRef<"main">

export const AppLayoutContent = React.forwardRef<HTMLElement, AppLayoutContentProps>((props, ref) => {

    const {
        children,
        className,
        ...rest
    } = props

    return (
        <main
            ref={ref}
            className={cn(AppLayoutContentAnatomy.root(), className)}
            {...rest}
        >
            {children}
        </main>
    )

})

AppLayoutContent.displayName = "AppLayoutContent"

/* -------------------------------------------------------------------------------------------------
 * AppLayoutStack
 * -----------------------------------------------------------------------------------------------*/

export type AppLayoutStackProps = React.ComponentPropsWithRef<"div"> &
    VariantProps<typeof AppLayoutStackAnatomy.root>

export const AppLayoutStack = React.forwardRef<HTMLDivElement, AppLayoutStackProps>((props, ref) => {

    const {
        children,
        className,
        spacing,
        ...rest
    } = props

    return (
        <div
            ref={ref}
            className={cn(AppLayoutStackAnatomy.root({ spacing }), className)}
            {...rest}
        >
            {children}
        </div>
    )

})

AppLayoutStack.displayName = "AppLayoutStack"

