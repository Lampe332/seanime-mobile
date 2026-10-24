import { serverAuthTokenAtom, serverStatusAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { WebsocketProvider } from "@/app/websocket-provider"
import { CustomCSSProvider } from "@/components/shared/custom-css-provider"
import { CustomThemeProvider } from "@/components/shared/custom-theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { initEntryPreloader } from "@/lib/entry-preloader"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createStore } from "jotai"
import { Provider as JotaiProvider } from "jotai/react"
import React from "react"

interface ClientProvidersProps {
    children?: React.ReactNode
}

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 0,
        },
    },
})

export const store = createStore()

initEntryPreloader(
    queryClient,
    () => store.get(serverAuthTokenAtom),
    () => !store.get(serverStatusAtom)?.user?.isSimulated,
)

export const ClientProviders: React.FC<ClientProvidersProps> = ({ children }) => {

    return (
        <JotaiProvider store={store}>
            <QueryClientProvider client={queryClient}>
                <WebsocketProvider>
                    {children}
                    <CustomThemeProvider />
                    <Toaster />
                </WebsocketProvider>
                <CustomCSSProvider />
            </QueryClientProvider>
        </JotaiProvider>
    )

}
