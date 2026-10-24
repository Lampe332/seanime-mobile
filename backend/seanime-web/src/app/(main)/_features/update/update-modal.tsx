import { MobileUpdateModal } from "./mobile-update-modal"
import { atom } from "jotai"

type UpdateModalProps = {
    collapsed?: boolean
}


export const updateModalOpenAtom = atom<boolean>(false)

export function UpdateModal(props: UpdateModalProps) {
    return <MobileUpdateModal />
}
