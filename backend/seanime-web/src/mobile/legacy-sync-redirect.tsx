import { Navigate } from "@tanstack/react-router"

/** Android compatibility target for bookmarks and browser history from older releases. */
export default function LegacySyncRedirect() {
    return <Navigate to="/android-downloads" replace />
}
