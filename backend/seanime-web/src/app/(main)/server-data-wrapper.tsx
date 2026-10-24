import { useGetStatus } from "@/api/hooks/status.hooks"
import { serverAuthTokenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { GettingStartedPage } from "@/app/(main)/_features/getting-started/getting-started-page"
import { useServerStatus, useSetServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { LoadingOverlayWithLogo } from "@/components/shared/loading-overlay-with-logo"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { logger } from "@/lib/helpers/debug"
import { useTr } from "@/lib/app-language"
import { usePathname } from "@/lib/navigation"
import { ANILIST_OAUTH_URL } from "@/lib/server/config"
import { WSEvents } from "@/lib/server/ws-events"
import { useAtomValue } from "jotai"
import React from "react"
import { useWebsocketMessageListener } from "./_hooks/handle-websockets"

export function ServerDataWrapper({ children }: { children?: React.ReactNode }) {
    const t = useTr()
    const pathname = usePathname()
    const serverStatus = useServerStatus()
    const setServerStatus = useSetServerStatus()
    const password = useAtomValue(serverAuthTokenAtom)
    const { data: queryServerStatus, isLoading, refetch } = useGetStatus()
    const resolvedServerStatus = serverStatus ?? queryServerStatus

    React.useEffect(() => {
        if (queryServerStatus) {
            logger("SERVER").info("Server status", queryServerStatus)
            setServerStatus(queryServerStatus)
        }
    }, [queryServerStatus, setServerStatus])

    useWebsocketMessageListener({
        type: WSEvents.ANILIST_DATA_LOADED,
        onMessage: () => {
            logger("Data Wrapper").info("Anilist data loaded, refetching server status")
            refetch()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.SETTINGS_CHANGED,
        onMessage: () => {
            logger("Data Wrapper").info("Settings changed, refetching server status")
            refetch()
        },
    })

    const authenticated = !resolvedServerStatus?.serverHasPassword || !!password

    React.useEffect(() => {
        if (resolvedServerStatus?.serverHasPassword && !password) {
            window.location.href = "/public/auth"
            console.warn("Redirecting to auth")
        }
    }, [resolvedServerStatus?.serverHasPassword, password])

    // Polls while the server starts, in case the websocket misses the ready event
    const intervalId = React.useRef<number | null>(null)
    React.useEffect(() => {
        if (!resolvedServerStatus?.serverReady) {
            intervalId.current = window.setInterval(() => {
                logger("Data Wrapper").info("Refetching server status")
                refetch()
            }, 2000)
        }
        return () => {
            logger("Data Wrapper").info("Clearing interval")
            if (intervalId.current) {
                window.clearInterval(intervalId.current)
                intervalId.current = null
            }
        }
    }, [resolvedServerStatus?.serverReady, refetch])

    if (isLoading || !resolvedServerStatus || !authenticated) return <LoadingOverlayWithLogo />
    if (!resolvedServerStatus.serverReady) return <LoadingOverlayWithLogo title="L o a d i n g" />

    const currentServerStatus = resolvedServerStatus

    if (pathname.startsWith("/auth/callback")) return children

    if (!currentServerStatus.settings) {
        return <GettingStartedPage status={currentServerStatus} />
    }

    // The server sends a simulated user when no account is stored, so this is only reached with a broken account row
    if (!currentServerStatus.user) {
        return <div className="container max-w-3xl py-10">
            <Card className="md:py-10">
                <AppLayoutStack>
                    <div className="text-center space-y-4">
                        <div className="mb-4 flex justify-center w-full">
                            <img loading="lazy" decoding="async" src="/seanime-logo.png" alt="logo" className="w-24 h-auto" />
                        </div>
                        <h3>{t("Welcome!", "Willkommen!")}</h3>
                        <Button
                            onClick={() => {
                                const url = currentServerStatus.anilistClientId
                                    ? `https://anilist.co/api/v2/oauth/authorize?client_id=${currentServerStatus.anilistClientId}&response_type=token`
                                    : ANILIST_OAUTH_URL
                                window.open(url, "_self")
                            }}
                            leftIcon={<svg
                                xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="24" height="24"
                                viewBox="0 0 24 24" role="img"
                            >
                                <path
                                    d="M6.361 2.943 0 21.056h4.942l1.077-3.133H11.4l1.052 3.133H22.9c.71 0 1.1-.392 1.1-1.101V17.53c0-.71-.39-1.101-1.1-1.101h-6.483V4.045c0-.71-.392-1.102-1.101-1.102h-2.422c-.71 0-1.101.392-1.101 1.102v1.064l-.758-2.166zm2.324 5.948 1.688 5.018H7.144z"
                                />
                            </svg>}
                            intent="primary"
                            size="xl"
                        >{t("Log in with AniList", "Mit AniList anmelden")}</Button>
                    </div>
                </AppLayoutStack>
            </Card>
        </div>
    }

    return children
}
