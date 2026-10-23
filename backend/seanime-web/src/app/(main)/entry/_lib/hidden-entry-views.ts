import { atomWithStorage } from "jotai/utils"

/** Streaming tabs hidden on this device's anime pages (phones: More → Tabs); the library tab always stays. */
export const __anime_hiddenEntryViewsAtom = atomWithStorage<string[]>("sea-anime-entry-hidden-views", [], undefined, { getOnInit: true })
