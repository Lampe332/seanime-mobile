export const PAGE_TRANSITION = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 6 },
    transition: {
        // duration: 0.3,
        // delay: 0.1,
        type: "spring",
        damping: 28,
        stiffness: 260,
        mass: 0.7,
    },
}

/**
 * Phone: the page comes in exactly while React builds it and the GPU rasterises it, so the spring above (the y shorthand
 * runs frame by frame on the main thread) jumped to its end. A transform string on a tween runs on the compositor (Web
 * Animations) and keeps going meanwhile; the gentler phone curve (motion.ts PHONE_EASE) leaves the way to the late
 * frames. It hands back "none" at the end (Motion keeps "translateY(0px)" otherwise), so the page does not stay a
 * containing block for its fixed bars.
 */
export const PHONE_PAGE_TRANSITION = {
    initial: { opacity: 0, transform: "translateY(6px)" },
    animate: { opacity: 1, transform: "translateY(0px)", transitionEnd: { transform: "none" } },
    exit: { opacity: 0, transform: "translateY(6px)" },
    transition: {
        duration: 0.26,
        ease: [0.2, 0.6, 0.35, 1] as const,
    },
}
