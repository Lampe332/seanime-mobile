import { atom } from "jotai"

// The local library's sheets on phones (scanner-modal, unmatched-file-manager, unknown-media-manager, ignored-file-manager of
// the web app kept these atoms in their .tsx containers).
export const __scanner_modalIsOpen = atom(false)
export const __scanner_isScanningAtom = atom(false)
export const __unmatchedFileManagerIsOpen = atom(false)
export const __unknownMedia_drawerIsOpen = atom(false)
export const __ignoredFileManagerIsOpen = atom(false)

/** Android home: genres the "Currently watching" row is narrowed to (all must match). Kept for the session only. */
export const homeCurrentGenresAtom = atom<string[]>([])
