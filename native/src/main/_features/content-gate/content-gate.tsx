import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { MobileIcon } from "@/lib/mobile-icons"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { colors } from "@/lib/theme/tokens"
import { isLoginModalOpenAtom } from "@/main/_atoms/server-status.atoms"
import { isContentGateAllowedPath } from "@/main/_features/content-gate/content-gate-paths"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useSetAtom } from "jotai"
import React from "react"
import { View } from "react-native"
import Svg, { Path } from "react-native-svg"

/** Hides all anime/manga until the user added an AniList token or installed an extension (Android, see backend contentgate). */
export function ContentGate({ pathname, children }: { pathname: string, children: React.ReactNode }) {
    const serverStatus = useServerStatus()

    if (!serverStatus?.contentLocked || isContentGateAllowedPath(pathname)) return <>{children}</>

    return <ContentGateScreen />
}

function LogInIcon({ color }: { color: string }) {
    // react-icons FiLogIn
    return (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <Path d="m10 17 5-5-5-5" />
            <Path d="M15 12H3" />
        </Svg>
    )
}

const EXTENSIONS_READY = MENU_ENTRIES.some(e => e.id === "extensions" && e.ready)

function ContentGateScreen() {
    const t = useTr()
    const router = useRouter()
    const setLoginModal = useSetAtom(isLoginModalOpenAtom)

    return (
        <PhoneScreen className="pt-12">
            <View accessibilityRole="summary" className="w-full max-w-[448px] gap-6 self-center">
                <Text accessibilityRole="header" className="text-center text-2xl font-bold">{t("No content yet", "Noch keine Inhalte")}</Text>
                <Text className="text-center text-base leading-6 text-muted">
                    {t(
                        "This app does not include any anime or manga. Add your AniList token or install an extension to get started.",
                        "Diese App enthält keine Animes oder Mangas. Füge deinen AniList-Token hinzu oder installiere eine Erweiterung, um loszulegen.",
                    )}
                </Text>
                <View className="gap-3">
                    {/* Button intent="white" */}
                    <Button
                        intent="secondary"
                        className="bg-white active:bg-gray-200"
                        labelClassName="text-black"
                        leftIcon={<LogInIcon color="#000000" />}
                        onPress={() => setLoginModal(true)}
                    >
                        {t("Add AniList token", "AniList-Token hinzufügen")}
                    </Button>
                    {/* only once the Extensions screen exists, so the button never leads to an empty page */}
                    {EXTENSIONS_READY && <Button
                        intent="secondary"
                        leftIcon={<MobileIcon name="extensions" size={18} color={colors.smText} />}
                        onPress={() => router.push("/extensions")}
                    >
                        {t("Install extension", "Erweiterung installieren")}
                    </Button>}
                </View>
            </View>
        </PhoneScreen>
    )
}
