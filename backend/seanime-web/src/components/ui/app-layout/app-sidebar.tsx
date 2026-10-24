import { layoutWidth } from "@/lib/tablet-ui"
import { cva } from "class-variance-authority"
import * as React from "react"
import { cn, ComponentAnatomy, defineStyleAnatomy } from "../core/styling"
import { Drawer } from "../drawer"

/* -------------------------------------------------------------------------------------------------
 * Context
 * -----------------------------------------------------------------------------------------------*/

const __AppSidebarContext = React.createContext<{
    open: boolean,
    setOpen: (open: boolean) => void,
    isBelowBreakpoint: boolean,
}>({
    open: false,
    setOpen: () => {},
    isBelowBreakpoint: false,
})

export function useAppSidebarContext() {
    return React.useContext(__AppSidebarContext)
}

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const AppSidebarAnatomy = defineStyleAnatomy({
    sidebar: cva([
        "UI-AppSidebar__sidebar",
        "flex flex-grow flex-col overflow-y-auto border-r border-transparent bg-[--background]",
    ]),
})

/* -------------------------------------------------------------------------------------------------
 * AppSidebar
 * -----------------------------------------------------------------------------------------------*/

export type AppSidebarProps = React.ComponentPropsWithoutRef<"div"> & ComponentAnatomy<typeof AppSidebarAnatomy>

export const AppSidebar = React.forwardRef<HTMLDivElement, AppSidebarProps>((props, ref) => {

    const {
        children,
        className,
        ...rest
    } = props

    const ctx = React.useContext(__AppSidebarContext)

    return (
        <>
            <div
                ref={ref}
                className={cn(
                    AppSidebarAnatomy.sidebar(),
                    className,
                )}
                {...rest}
            >
                {children}
            </div>
            <Drawer
                open={ctx.open}
                onOpenChange={v => ctx.setOpen(v)}
                side="left"
            >
                {children}
            </Drawer>
        </>
    )

})

AppSidebar.displayName = "AppSidebar"

/* -------------------------------------------------------------------------------------------------
 * AppSidebarProvider
 * -----------------------------------------------------------------------------------------------*/

export const AppSidebarProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {

    const [open, setOpen] = React.useState(false)

    const [isBelowBreakpoint, setIsBelowBreakpoint] = React.useState<boolean>(false)

    React.useEffect(() => {
        const handleResize = () => setIsBelowBreakpoint(layoutWidth(window.innerWidth) < 1024) // lg breakpoint
        handleResize()
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [])

    return (
        <__AppSidebarContext.Provider value={{ open, setOpen, isBelowBreakpoint }}>
            {children}
        </__AppSidebarContext.Provider>
    )
}

AppSidebarProvider.displayName = "AppSidebarProvider"
