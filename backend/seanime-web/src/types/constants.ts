export const __isElectronDesktop__ = import.meta.env.SEA_PUBLIC_DESKTOP === "electron"
export const __isDesktop__ = import.meta.env.SEA_PUBLIC_PLATFORM === "desktop" || __isElectronDesktop__
export const __clientPlatform__ = __isElectronDesktop__
    ? "denshi"
    : import.meta.env.SEA_PUBLIC_PLATFORM === "web"
        ? "web"
        : import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"
            ? "mobile"
            : ""
export const HIDE_IMAGES = false

/** Build-time platform fact. Unlike a runtime bridge check this lets the bundler drop code. */
export const __isMobile__ = __clientPlatform__ === "mobile"

export const __CAST_ENABLED__ = false

