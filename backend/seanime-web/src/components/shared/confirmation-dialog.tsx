import { ButtonProps } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useDisclosure, UseDisclosureReturn } from "@/hooks/use-disclosure"
import { useTr } from "@/lib/app-language"
import React from "react"
import "@/components/shared/mobile-surface.css"
import "@/app/(main)/_features/phone-screen/phone-screen.css"

type ConfirmationDialogHookProps = {
    title: string,
    description?: React.ReactNode,
    actionText?: string,
    cancelText?: string,
    actionIntent?: ButtonProps["intent"]
    onConfirm: () => void
    onCancel?: () => void
}

export function useConfirmationDialog(props: ConfirmationDialogHookProps) {
    const api = useDisclosure(false)
    return {
        ...api,
        ...props,
    }
}

/** A bottom sheet like the other phone sheets: the text, then cancel and the one action in thumb reach. */
export const ConfirmationDialog: React.FC<ConfirmationDialogHookProps & UseDisclosureReturn> = (props) => {

    const t = useTr()

    const {
        isOpen,
        close,
        onConfirm,
        onCancel,
        title,
        description = t("Are you sure you want to continue?", "Möchtest du wirklich fortfahren?"),
        actionText = t("Confirm", "Bestätigen"),
        cancelText = t("Cancel", "Abbrechen"),
        actionIntent = "alert-subtle",
    } = props

    return (
        <Modal
            title={title}
            open={isOpen}
            onOpenChange={close}
            contentClass="ps-sheet"
        >
            <div className="ps-sheet-body">
                <div className="ps-sheet-text">{description}</div>
                <div className="ps-sheet-actions">
                    <button
                        type="button"
                        className="ps-secondary"
                        onClick={() => {
                            onCancel?.()
                            close()
                        }}
                    >
                        {cancelText}
                    </button>
                    <button
                        type="button"
                        className="ps-primary"
                        data-tone={actionIntent?.startsWith("alert") ? "danger" : undefined}
                        onClick={() => {
                            onConfirm()
                            close()
                        }}
                    >
                        {actionText}
                    </button>
                </div>
            </div>
        </Modal>
    )

}
