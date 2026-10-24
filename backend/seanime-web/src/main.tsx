import { useIsSimulatedUser } from "@/app/(main)/_hooks/use-server-status"
import { ClientProviders, queryClient, store } from "@/app/client-providers"
import "./app/globals.css"
import "./app/tablet.css"
import { IS_TABLET_UI, reloadOnScreenClassChange } from "@/lib/tablet-ui"
import { __navigationPreloadModeAtom, getActualNavigationPreloadMode, NavigationPreloadMode } from "@/lib/navigation-preload-settings"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { useAtomValue } from "jotai/react"
import ReactDOM from "react-dom/client"
import { ErrorBoundary, FallbackProps } from "react-error-boundary"
import { LuffyError } from "./components/shared/luffy-error"
import { Button } from "./components/ui/button"
import { routeTree } from "./routeTree.gen"
import "@fontsource-variable/inter/index.css"

type RouterPreloadMode = false | "intent" | "viewport"

function createAppRouter(defaultPreload: RouterPreloadMode, defaultPreloadDelay?: number) {
    return createRouter({
        routeTree,
        defaultPreload,
        defaultPreloadDelay,
        context: {
            queryClient,
            store,
        },
        scrollRestoration: false,
        defaultPreloadStaleTime: 30 * 1000,
    })
}

type AppRouter = ReturnType<typeof createAppRouter>

const intentRouter = createAppRouter("intent")
const fasterIntentRouter = createAppRouter("intent", 0)
const viewportRouter = createAppRouter("viewport")
const disabledRouter = createAppRouter(false)

const routersByPreloadMode: Record<NavigationPreloadMode, AppRouter> = {
    disable: disabledRouter,
    default: intentRouter,
    faster: fasterIntentRouter,
    viewport: viewportRouter,
}

declare module "@tanstack/react-router" {
    interface Register {
        router: AppRouter
    }
}

function AppRouterProvider() {
    const _preloadMode = useAtomValue(__navigationPreloadModeAtom)
    const isSimulatedUser = useIsSimulatedUser()
    const preloadMode = getActualNavigationPreloadMode(_preloadMode, isSimulatedUser)

    return <RouterProvider router={routersByPreloadMode[preloadMode]} />
}

function RootErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
    return (
        <div className="min-h-screen bg-[#0c0c0c] text-white flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-2xl border bg-black/60 p-6 text-center backdrop-blur-sm space-y-4">
                <LuffyError
                    title="Client error"
                >
                    Seanime encountered an unexpected error. Please try again.
                </LuffyError>

                {!!(error as Error)?.message && (
                    <pre className="max-h-48 overflow-auto rounded-xl bg-black/50 p-3 text-left text-xs text-red-200 whitespace-pre-wrap break-words">
                        {(error as Error).message}
                    </pre>
                )}

                <div className="flex items-center justify-center gap-3">
                    <Button
                        type="button"
                        intent="gray-outline"
                        className="rounded-full"
                        onClick={resetErrorBoundary}
                    >
                        Retry
                    </Button>
                    <Button
                        type="button"
                        intent="gray-outline"
                        className="rounded-full"
                        onClick={() => window.location.reload()}
                    >
                        Reload
                    </Button>
                </div>
            </div>
        </div>
    )
}

// if (import.meta.env.DEV) {
//     const script = document.createElement("script")
//     script.src = "https://unpkg.com/react-scan/dist/auto.global.js"
//     script.crossOrigin = "anonymous"
//     document.head.appendChild(script)
// }
// Tablet layout: app/tablet.css lays the phone screens out for a tablet under this attribute
if (IS_TABLET_UI) document.documentElement.dataset.layout = "tablet"
reloadOnScreenClassChange()
ReactDOM.createRoot(document.getElementById("root")!, {
    onUncaughtError: (error, errorInfo) => {
        console.error("[Root] Uncaught renderer error", error, errorInfo)
    },
    onCaughtError: (error, errorInfo) => {
        console.error("[Root] Caught renderer error", error, errorInfo)
    },
}).render(
    <ErrorBoundary FallbackComponent={RootErrorFallback}>
        <ClientProviders>
            <AppRouterProvider />
        </ClientProviders>
    </ErrorBoundary>,
)
