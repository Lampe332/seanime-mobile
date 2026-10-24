import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

export const __extensions_currentPageAtom = atom<"installed" | "marketplace">("installed")

// Default marketplace URL
export const DEFAULT_MARKETPLACE_URL = ""

// Atom to store the marketplace URL in localStorage
export const marketplaceUrlAtom = atomWithStorage<string>(
    "marketplace-url",
    DEFAULT_MARKETPLACE_URL,
    undefined,
    { getOnInit: true },
)
