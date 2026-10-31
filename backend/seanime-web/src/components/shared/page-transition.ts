/**
 * Phone: the page comes in exactly while React builds it and the GPU rasterises it, so a spring on the y shorthand (it
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

/**
 * Tablet: the same compositor tween (the spring there showed its first frame at 71 % on the way back from a page), on the
 * tablet's strong ease-out, as its frames come every 16.7 ms.
 */
export const TABLET_PAGE_TRANSITION = {
    ...PHONE_PAGE_TRANSITION,
    transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] as const },
}

/** Reduced motion (phone and tablet): the page only fades in; Motion's tween does not read the media query itself. */
export const REDUCED_PAGE_TRANSITION = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2, ease: "easeOut" as const },
}
