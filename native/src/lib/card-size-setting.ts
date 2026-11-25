import { type CardSize, cardSizeFactor } from "@/components/shared/cover-layout"
import { atomWithStorage } from "@/lib/storage"
import { useAtomValue } from "jotai"

/**
 * Size of the cover posters (settings → Appearance), only on this device: a phone and a tablet want different sizes.
 * The factor per size is CARD_SIZE_FACTORS (cover-layout.ts); normal is the phone kit's own size.
 */
export const cardSizeAtom = atomWithStorage<CardSize>("sea-ui-settings-card-size", "normal")

/** The card size as a factor on a cover's width; re-renders when the setting changes. */
export function useCardSizeFactor() {
    return cardSizeFactor(useAtomValue(cardSizeAtom))
}
