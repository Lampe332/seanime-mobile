import { useLogin } from "@/api/hooks/auth.hooks"
import { websocketConnectedAtom } from "@/app/websocket-provider"
import { LoadingOverlay } from "@/components/ui/loading-spinner"
import { tr, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useAtomValue } from "jotai/react"
import React from "react"
import { toast } from "sonner"

/** Logs in with the AniList token from the URL hash. */
export function CallbackPage() {
    const t = useTr()
    const router = useRouter()
    const websocketConnected = useAtomValue(websocketConnectedAtom)
    const { mutate: login } = useLogin()
    const called = React.useRef(false)

    React.useEffect(() => {
        // A websocket reconnect while the login runs must not count as a second, empty callback
        if (!websocketConnected || called.current) return
        called.current = true
        const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token")
        // Keep the token out of the WebView history
        window.history.replaceState(window.history.state, "", window.location.pathname)
        if (token) {
            login({ token })
        } else {
            toast.error(tr("Invalid token", "Ungültiger Token"))
            router.replace("/")
        }
    }, [websocketConnected])

    return (
        <div>
            <LoadingOverlay className="fixed w-full h-full z-[80]">
                <h3 className="mt-2">{t("Authenticating...", "Anmeldung läuft …")}</h3>
            </LoadingOverlay>
        </div>
    )
}
