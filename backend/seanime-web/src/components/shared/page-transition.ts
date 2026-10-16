import { __isElectronDesktop__ } from "../../types/constants"

export const PAGE_TRANSITION = __isElectronDesktop__ ? {} : {
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
