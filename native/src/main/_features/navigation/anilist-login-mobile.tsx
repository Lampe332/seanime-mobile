import { useLogin } from "@/api/hooks/auth.hooks"
import { Sheet } from "@/components/ui/sheet/sheet"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { ANILIST_PIN_URL } from "@/lib/server/config"
import { colors } from "@/lib/theme/tokens"
import * as Clipboard from "expo-clipboard"
import * as WebBrowser from "expo-web-browser"
import React from "react"
import { Pressable, TextInput, View } from "react-native"
import Svg, { Path } from "react-native-svg"

const ANILIST_LOGO = "M6.361 2.943 0 21.056h4.942l1.077-3.133H11.4l1.052 3.133H22.9c.71 0 1.1-.392 1.1-1.101V17.53c0-.71-.39-1.101-1.1-1.101h-6.483V4.045c0-.71-.392-1.102-1.101-1.102h-2.422c-.71 0-1.101.392-1.101 1.102v1.064l-.758-2.166zm2.324 5.948 1.688 5.018H7.144z"

/*
 * Android: connect AniList in two steps on a bottom sheet (open AniList, paste the token it shows), as
 * anilist-login-mobile.tsx/.css. The PIN client (ANILIST_PIN_URL, client 13985) shows the token on AniList's own page
 * instead of redirecting to a callback, so it works for any port and needs no deep link.
 * The old app sent the token through /auth/callback#access_token=…; here the sheet logs in directly with the same
 * mutation, and the token never enters a URL or history.
 */
export function MobileAnilistLogin({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    const [token, setToken] = React.useState("")
    const [pasteFailed, setPasteFailed] = React.useState(false)
    const { mutate: login, isPending } = useLogin()

    // every way of closing goes through here, so the next opening starts empty
    const setOpen = (next: boolean) => {
        if (!next) {
            setToken("")
            setPasteFailed(false)
        }
        onOpenChange(next)
    }

    const openAnilist = () => {
        // a Custom Tab over the app (PopupWebViewSheet.kt was a sheet over the WebView); AniList keeps its own login
        void WebBrowser.openBrowserAsync(ANILIST_PIN_URL)
    }

    const paste = async () => {
        try {
            const text = (await Clipboard.getStringAsync()).trim()
            if (text) setToken(text)
            setPasteFailed(!text)
        } catch {
            setPasteFailed(true)
        }
    }

    const connect = () => {
        const value = token.trim()
        if (!value) return
        login({ token: value })
        setOpen(false)
    }

    return (
        <>
            <Sheet
                open={open}
                onOpenChange={setOpen}
                title={t("Connect AniList", "Mit AniList verbinden")}
                footer={
                    <View className="flex-1 gap-1">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !token.trim() }}
                            disabled={!token.trim()}
                            onPress={connect}
                            className={cn("min-h-[52px] items-center justify-center rounded-full",
                                token.trim() ? "bg-brand-500 active:bg-brand-600" : "bg-sm-surface-control")}
                        >
                            <Text className={cn("text-base font-semibold", token.trim() ? "text-white" : "text-sm-text-subtle")}>
                                {t("Connect", "Verbinden")}
                            </Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} className="min-h-12 items-center justify-center">
                            <Text className="text-[15px] font-medium text-sm-text-muted">{t("Not now", "Später")}</Text>
                        </Pressable>
                    </View>
                }
            >
                <Text className="text-base leading-6 text-sm-text-muted">
                    {t("Seanime keeps your list, progress and scores in your AniList account.",
                        "Seanime speichert Liste, Fortschritt und Bewertungen in deinem AniList-Konto.")}
                </Text>

                {/* Two steps in one raised group (`.alm-steps`) */}
                <View className="gap-0.5 overflow-hidden rounded-surface">
                    <View className="gap-3 bg-sm-surface-raised p-4">
                        <Text className="text-[15px] font-semibold leading-[22px]">
                            {t("Open AniList, log in and allow Seanime.", "AniList öffnen, einloggen und Seanime erlauben.")}
                        </Text>
                        <Pressable
                            accessibilityRole="link"
                            onPress={openAnilist}
                            className="min-h-12 flex-row items-center justify-center gap-2.5 self-start rounded-full bg-white px-5 active:bg-[#dfe3e8]"
                        >
                            <Svg width={22} height={22} viewBox="0 0 24 24" fill="#0b1622">
                                <Path d={ANILIST_LOGO} />
                            </Svg>
                            <Text className="text-[15px] font-semibold text-[#0b1622]">{t("Open AniList", "AniList öffnen")}</Text>
                        </Pressable>
                    </View>
                    <View className="gap-3 bg-sm-surface-raised p-4">
                        <Text nativeID="alm-token-label" className="text-[15px] font-semibold leading-[22px]">
                            {t("Copy the token AniList shows and paste it here.", "Den Token von AniList kopieren und hier einfügen.")}
                        </Text>
                        <View className="gap-2">
                            <TextInput
                                accessibilityLabelledBy="alm-token-label"
                                value={token}
                                onChangeText={value => {
                                    setToken(value)
                                    setPasteFailed(false)
                                }}
                                placeholder={t("Token", "Token")}
                                placeholderTextColor={colors.smTextSubtle}
                                multiline
                                numberOfLines={3}
                                autoCapitalize="none"
                                autoCorrect={false}
                                spellCheck={false}
                                autoComplete="off"
                                importantForAutofill="no"
                                textAlignVertical="top"
                                className="min-h-[88px] w-full rounded-surface-sm bg-sm-surface-sunken p-3 font-sans text-sm leading-5 text-sm-text"
                            />
                            <Pressable accessibilityRole="button" onPress={paste} className="min-h-12 justify-center self-start px-1">
                                <Text className="text-[15px] font-semibold text-sm-accent">{t("Paste", "Einfügen")}</Text>
                            </Pressable>
                        </View>
                        {pasteFailed && (
                            <Text accessibilityLiveRegion="polite" className="text-[13px] leading-[19px] text-sm-text-muted">
                                {t("Nothing to paste. Long-press the field and choose Paste.",
                                    "Nichts zum Einfügen. Lange ins Feld tippen und Einfügen wählen.")}
                            </Text>
                        )}
                    </View>
                </View>
            </Sheet>
            {isPending && <AuthenticatingOverlay />}
        </>
    )
}

/** The callback page's "Authenticating..." overlay while the server checks the token */
function AuthenticatingOverlay() {
    const t = useTr()
    return (
        <View className="absolute inset-0 z-50 items-center justify-center gap-3 bg-background/95">
            <View className="h-10 w-10 items-center justify-center">
                <Svg width={36} height={36} viewBox="0 0 24 24" fill={colors.smAccentStrong}>
                    <Path d={ANILIST_LOGO} />
                </Svg>
            </View>
            <Text className="text-lg font-semibold">{t("Authenticating...", "Anmeldung läuft …")}</Text>
        </View>
    )
}
