import { LoadingOverlayWithLogo } from "@/components/shared/loading-overlay-with-logo"
import { Button } from "@/components/ui/button/button"
import { Card } from "@/components/ui/card/card"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { MobileAnilistLogin } from "@/main/_features/navigation/anilist-login-mobile"
import { MobileGettingStarted } from "@/main/_features/getting-started/getting-started-mobile"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import React from "react"
import { View } from "react-native"

/*
 * The screen part of server-data-wrapper.tsx (its data part lives in client-providers.tsx): the logo while the
 * server starts, the first start while it has no settings, then the app.
 * Not taken over: the password page (the app's own server on 127.0.0.1 never has a password) and the auth callback
 * route (the AniList sheet logs in directly).
 */
export function ServerDataWrapper({ children }: { children: React.ReactNode }) {
    const serverStatus = useServerStatus()

    if (!serverStatus) return <LoadingOverlayWithLogo />
    if (!serverStatus.serverReady) return <LoadingOverlayWithLogo title="L o a d i n g" />

    if (!serverStatus.settings) return <MobileGettingStarted status={serverStatus} />

    // The server sends a simulated user when no account is stored, so this is only reached with a broken account row
    if (!serverStatus.user) return <WelcomeLogin />

    return <>{children}</>
}

/** "Welcome!" with the AniList login; the web page opened the OAuth redirect, the app uses its token sheet */
function WelcomeLogin() {
    const t = useTr()
    const [open, setOpen] = React.useState(false)
    return (
        <View className="flex-1 justify-center bg-background px-4">
            <Card className="w-full max-w-[768px] items-center gap-4 self-center py-10">
                <Image source={require("../../assets/images/seanime-logo.png")} style={{ width: 96, height: 96 }} contentFit="contain" />
                <Text accessibilityRole="header" className="text-xl font-bold">{t("Welcome!", "Willkommen!")}</Text>
                <Button size="lg" onPress={() => setOpen(true)}>{t("Log in with AniList", "Mit AniList anmelden")}</Button>
            </Card>
            <MobileAnilistLogin open={open} onOpenChange={setOpen} />
        </View>
    )
}
