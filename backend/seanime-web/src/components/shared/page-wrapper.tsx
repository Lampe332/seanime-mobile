import { PHONE_PAGE_TRANSITION, REDUCED_PAGE_TRANSITION, TABLET_PAGE_TRANSITION } from "@/components/shared/page-transition"
import { cn } from "@/components/ui/core/styling"
import { prefersReducedMotion } from "@/lib/motion"
import { IS_TABLET_UI } from "@/lib/tablet-ui"
import { motion } from "motion/react"
import React from "react"

type PageWrapperProps = {
    children?: React.ReactNode
} & React.ComponentPropsWithoutRef<"div">

// When the enclosing PageWrapper's entrance started (null outside of one). A PageWrapper mounted inside another while that
// one comes in (Home holds up to 8, three deep) only frames its content: six nested fades multiplied their opacity and
// added up their travel. One that mounts later (a section whose data came in) still comes in on its own.
const PageEntrance = React.createContext<number | null>(null)

export const PageWrapper = React.forwardRef<HTMLDivElement, PageWrapperProps>((props, ref) => {

    const {
        children,
        className,
        ...rest
    } = props

    const transition = prefersReducedMotion() ? REDUCED_PAGE_TRANSITION : IS_TABLET_UI ? TABLET_PAGE_TRANSITION : PHONE_PAGE_TRANSITION
    const outer = React.useContext(PageEntrance)
    const [mountedAt] = React.useState(() => performance.now())
    const still = outer !== null && mountedAt - outer < transition.transition.duration * 1000

    if (still) {
        return (
            <div data-page-wrapper-container ref={ref}>
                <div data-page-wrapper {...rest} className={cn("z-[5] relative", className)}>
                    {children}
                </div>
            </div>
        )
    }

    return (
        <div data-page-wrapper-container ref={ref}>
            <motion.div
                data-page-wrapper
                {...transition}
                {...rest as any}
                className={cn("z-[5] relative", className)}
            >
                <PageEntrance.Provider value={mountedAt}>
                    {children}
                </PageEntrance.Provider>
            </motion.div>
        </div>
    )
})
