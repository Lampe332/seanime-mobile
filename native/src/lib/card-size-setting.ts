import type { CardSize } from "@/components/shared/cover-layout"
import { atomWithStorage } from "@/lib/storage"

/**
 * Size of the covers in grids (settings → Appearance), only on this device: a phone and a tablet want different sizes.
 * The factor per size is CARD_SIZE_FACTORS (cover-layout.ts); normal is the phone kit's own size.
 */
export const cardSizeAtom = atomWithStorage<CardSize>("sea-ui-settings-card-size", "normal")
