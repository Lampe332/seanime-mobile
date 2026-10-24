import { createLazyFileRoute, Navigate } from "@tanstack/react-router"

// Debrid and torrent downloads are listed on the Downloads page (plugins and old links still open /debrid).
export const Route = createLazyFileRoute("/_main/debrid/")({
    component: () => <Navigate to="/android-downloads" search={{ kind: "torrents" }} replace />,
})
