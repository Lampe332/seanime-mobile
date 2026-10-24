import { ContentGate } from "@/app/(main)/_features/content-gate/content-gate"
import { MainLayout } from "@/app/(main)/_features/layout/main-layout"
import { TopNavbar } from "@/app/(main)/_features/layout/top-navbar"
import { TourOverlay } from "@/app/(main)/_features/tour/tour-overlay"
import { ServerDataWrapper } from "@/app/(main)/server-data-wrapper"
import { AppErrorBoundary } from "@/components/shared/app-error-boundary"
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import React from "react"
import { ErrorBoundary } from "react-error-boundary"

export const Route = createFileRoute("/_main")({
    component: Layout,
})

function Layout() {
    const navigate = useNavigate()
    React.useEffect(() => {
        const open = (event: Event) => { document.querySelectorAll("video").forEach(video => video.pause()); navigate({ to: "/android-downloads", search: (event as CustomEvent).detail?.kind === "manga" ? { kind: "manga" } : {} }) }
        window.addEventListener("seanime-open-downloads", open)
        return () => window.removeEventListener("seanime-open-downloads", open)
    }, [navigate])
    const [host, setHost] = React.useState<string>("")

    React.useEffect(() => {
        setHost(window?.location?.host || "")
    }, [])

    return (
        <ServerDataWrapper host={host}>
            <MainLayout>
                <div data-main-layout-container className="h-auto">
                    <TopNavbar />
                    <div data-main-layout-content>
                        <ErrorBoundary FallbackComponent={AppErrorBoundary}>
                            <ContentGate>
                                <Outlet />
                            </ContentGate>
                        </ErrorBoundary>
                    </div>
                </div>
            </MainLayout>
            <TourOverlay />
        </ServerDataWrapper>
    )
}
