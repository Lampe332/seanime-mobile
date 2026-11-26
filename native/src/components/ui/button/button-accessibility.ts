// geschrieben nach: React Native BaseViewManager.updateViewContentDescription (Android)

/*
 * What a Button tells the screen reader. Android writes "busy" into the view's content description and only writes
 * that description again when it has something in it: a button without a label kept "busy" after its spinner went
 * (S22 26.11.: "Sign in" stayed busy after a failed sign-in). A string child is the label then, so the description is
 * written anew on every change.
 */
export function buttonAccessibility(input: { label?: string, children?: unknown, disabled: boolean, loading: boolean }) {
    const label = input.label ?? (typeof input.children === "string" ? input.children : undefined)
    return {
        ...(label ? { accessibilityLabel: label } : {}),
        accessibilityState: { disabled: input.disabled, busy: input.loading },
    }
}
