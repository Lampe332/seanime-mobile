import { IMAGE_FADE } from "@/lib/motion"
import { useReducedMotion } from "react-native-reanimated"

/**
 * expo-image's `transition` for a picture that arrives after its frame was drawn (sea-image.tsx): a 220 ms fade, none for a
 * cached one, none with reduced motion (expo-image does not read the system setting itself).
 */
export function useImageFade() {
    return useReducedMotion() ? null : IMAGE_FADE
}
