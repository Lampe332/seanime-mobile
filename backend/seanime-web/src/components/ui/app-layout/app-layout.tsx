import { vc_globalMiniPlayerAtom, vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { cva, VariantProps } from "class-variance-authority"
import { useAtomValue } from "jotai/react"
import * as React from "react"
import { __AppSidebarContext } from "."
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
                sm: "sidebar-sm",
                md: "sidebar-md",
                lg: "sidebar-lg",
                xl: "sidebar-xl",
            },
        },
        defaultVariants: {
            withSidebar: false,
            sidebarSize: "md",
        },
        compoundVariants: [
            { withSidebar: true, sidebarSize: "slim", className: "lg:[&>.appLayout]:pl-20" },
            { withSidebar: true, sidebarSize: "sm", className: "lg:[&>.appLayout]:pl-48" },
            { withSidebar: true, sidebarSize: "md", className: "lg:[&>.appLayout]:pl-64" },
            { withSidebar: true, sidebarSize: "lg", className: "lg:[&>.appLayout]:pl-[20rem]" },
            { withSidebar: true, sidebarSize: "xl", className: "lg:[&>.appLayout]:pl-[25rem]" },
        ],
    }),
})

const AppLayoutSidebarAnatomy = defineStyleAnatomy({
    root: cva([
        "UI-AppLayoutSidebar__root z-50",
        "hidden lg:fixed lg:inset-y-0 lg:flex lg:flex-col grow-0 shrink-0 basis-0",
        "group-[.sidebar-slim]/appLayout:w-20",
        "group-[.sidebar-sm]/appLayout:w-48",
        "group-[.sidebar-md]/appLayout:w-64",
        "group-[.sidebar-lg]/appLayout:w-[20rem]",
        "group-[.sidebar-xl]/appLayout:w-[25rem]",
    ]),
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

    const ctx = React.useContext(__AppSidebarContext)

    return (
        <div
            ref={ref}
            className={cn(
                AppLayoutAnatomy.root({ withSidebar, sidebarSize: ctx.size || sidebarSize }),
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

    const vcIsFullscreen = useAtomValue(vc_isFullscreen)
    const vcIsMiniplayer = useAtomValue(vc_globalMiniPlayerAtom)

    return (
        <aside
            ref={ref}
            className={cn(AppLayoutSidebarAnatomy.root(), className, (vcIsFullscreen && !vcIsMiniplayer) && "lg:hidden")}
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

