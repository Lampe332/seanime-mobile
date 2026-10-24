import Page from "@/mobile/legacy-sync-redirect"
import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/_main/sync/")({
    component: Page,
})
