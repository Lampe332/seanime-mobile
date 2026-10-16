/** True in the Google Play build (SEA_PUBLIC_STORE=play): no self-update UI, store-specific content rules. */
export const IS_PLAY_STORE = import.meta.env.SEA_PUBLIC_STORE === "play"
