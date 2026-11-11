import React from "react"

/**
 * A key for the first layer inside an @rn-primitives Portal (Sheet, Dialog, Popover, Select).
 *
 * The portal host lists its layers without keys. When one sheet closed and the next opened in the same moment (Local
 * library › Folders and files), the new sheet took over the old one's mounted Content, and with it the primitive's Back
 * listener, which is set once on mount and still closed the old sheet: Back did nothing at all (S22). A key of its own
 * remounts the layer and its listener.
 */
export function usePortalKey() {
    return React.useId()
}
