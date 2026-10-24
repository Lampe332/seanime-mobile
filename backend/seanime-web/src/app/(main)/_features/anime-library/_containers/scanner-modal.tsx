import { LibraryPhoneSheet } from "@/app/(main)/_features/anime-library/_screens/library-phone"
import { atom } from "jotai"
import React from "react"

export const __scanner_modalIsOpen = atom(false)
export const __scanner_isScanningAtom = atom(false)

/** Android gets the library's phone sheet. */
export function ScannerModal() {
    return <LibraryPhoneSheet />
}
