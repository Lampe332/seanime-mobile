import { useLogin } from "@/api/hooks/auth.hooks"
import { Sheet } from "@/components/ui/sheet/sheet"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { anilistLoginStep, extractAnilistToken, manualAnilistToken } from "@/main/_features/navigation/anilist-login-steps"
import { ANILIST_PIN_URL } from "@/lib/server/config"
import { colors, accentInput } from "@/lib/theme/tokens"
import { useThemeColors } from "@/lib/theme/appearance"
import * as Clipboard from "expo-clipboard"
import * as WebBrowser from "expo-web-browser"
import React from "react"
import { AppState, Pressable, TextInput, View } from "react-native"
import Svg, { Path } from "react-native-svg"

const ANILIST_LOGO = "M6.361 2.943 0 21.056h4.942l1.077-3.133H11.4l1.052 3.133H22.9c.71 0 1.1-.392 1.1-1.101V17.53c0-.71-.39-1.101-1.1-1.101h-6.483V4.045c0-.71-.392-1.102-1.101-1.102h-2.422c-.71 0-1.101.392-1.101 1.102v1.064l-.758-2.166zm2.324 5.948 1.688 5.018H7.144z"

/*
 * Android: connect AniList on a bottom sheet (anilist-login-mobile.tsx/.css), with one main button per step
 * (anilist-login-steps.ts): "Log in with AniList" opens AniList's PIN page (ANILIST_PIN_URL, client 13985), which shows
 * the token on AniList's own page instead of redirecting, so it works without a deep link. When the user comes back to
 * the app, the sheet looks for the copied token on the clipboard and offers "Connect"; pasting by hand stays as a small
 * second way. The sheet logs in directly with the login mutation, the token never enters a URL or history.
 * `preview` (test and scratch only, intro-preview.ts): Connect closes the sheet without logging in.
 */
export function MobileAnilistLogin({ open, onOpenChange, preview }: { open: boolean, onOpenChange: (open: boolean) => void, preview?: boolean }) {
    useThemeColors()
    const t = useTr()
    const [opened, setOpened] = React.useState(false)
    const [found, setFound] = React.useState<string | null>(null)
    const [manual, setManual] = React.useState(false)
    const [typed, setTyped] = React.useState("")
    const [pasteFailed, setPasteFailed] = React.useState(false)
    const { mutate: login, isPending } = useLogin()
    const step = anilistLoginStep({ opened, token: found, manual })

    // every way of closing goes through here, so the next opening starts at the first step
    const setOpen = (next: boolean) => {
        if (!next) {
            setOpened(false)
            setFound(null)
            setManual(false)
            setTyped("")
            setPasteFailed(false)
        }
        onOpenChange(next)
    }

    const readClipboard = async () => {
        try {
            return (await Clipboard.getStringAsync()).trim()
        } catch {
            return ""
        }
    }

    // back from AniList: the window has focus again, so Android lets the app read the clipboard
    const lookForToken = React.useEffectEvent(async () => {
        const token = extractAnilistToken(await readClipboard())
        if (token) setFound(token)
    })
    React.useEffect(() => {
        if (!open || step !== "waiting") return
        const sub = AppState.addEventListener("focus", () => void lookForToken())
        return () => sub.remove()
    }, [open, step])

    const openAnilist = () => {
        setOpened(true)
        // a Custom Tab over the app (PopupWebViewSheet.kt was a sheet over the WebView); AniList keeps its own login
        void WebBrowser.openBrowserAsync(ANILIST_PIN_URL)
    }

    // "Paste code" while waiting: a token goes straight to Connect, anything else opens the field with a hint
    const pasteWaiting = async () => {
        const text = await readClipboard()
        const token = extractAnilistToken(text)
        if (token) return setFound(token)
        setTyped(text)
        setPasteFailed(!text)
        setManual(true)
    }

    const pasteIntoField = async () => {
        const text = await readClipboard()
        if (text) setTyped(text)
        setPasteFailed(!text)
    }

    const connect = (token: string) => {
        if (!token) return
        if (!preview) login({ token })
        setOpen(false)
    }

    const manualToken = manualAnilistToken(typed)
    const main = {
        start: { label: t("Log in with AniList", "Mit AniList anmelden"), onPress: openAnilist, enabled: true },
        waiting: { label: t("Paste code", "Code einfügen"), onPress: () => void pasteWaiting(), enabled: true },
        found: { label: t("Connect", "Verbinden"), onPress: () => connect(found ?? ""), enabled: true },
        manual: { label: t("Connect", "Verbinden"), onPress: () => connect(manualToken), enabled: !!manualToken },
    }[step]

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
                            accessibilityState={{ disabled: !main.enabled }}
                            disabled={!main.enabled}
                            onPress={main.onPress}
                            className={cn("min-h-[52px] flex-row items-center justify-center gap-2.5 rounded-full",
                                !main.enabled ? "bg-sm-surface-control"
                                    : step === "start" ? "bg-white active:bg-[#dfe3e8]" : "bg-brand-500 active:bg-brand-600")}
                        >
                            {step === "start" && (
                                <Svg width={22} height={22} viewBox="0 0 24 24" fill="#0b1622">
                                    <Path d={ANILIST_LOGO} />
                                </Svg>
                            )}
                            <Text className={cn("text-base font-semibold",
                                !main.enabled ? "text-sm-text-subtle" : step === "start" ? "text-[#0b1622]" : "text-white")}>
                                {main.label}
                            </Text>
                        </Pressable>
                        <View className="flex-row">
                            {step === "start" && (
                                <Pressable accessibilityRole="button" onPress={() => setManual(true)} className="min-h-12 flex-1 items-center justify-center active:opacity-70">
                                    <Text className="text-[15px] font-semibold text-sm-accent">{t("Paste a code instead", "Code selbst einfügen")}</Text>
                                </Pressable>
                            )}
                            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} className="min-h-12 flex-1 items-center justify-center active:opacity-70">
                                <Text className="text-[15px] font-medium text-sm-text-muted">{t("Not now", "Später")}</Text>
                            </Pressable>
                        </View>
                    </View>
                }
            >
                {step === "start" && (
                    <Text className="text-base leading-6 text-sm-text-muted">
                        {t("Seanime Mobile keeps your list and progress in your AniList account.",
                            "Seanime Mobile speichert Liste und Fortschritt in deinem AniList-Konto.")}
                    </Text>
                )}

                {step === "waiting" && (
                    <>
                        <Text accessibilityLiveRegion="polite" className="text-base leading-6 text-sm-text-muted">
                            {t("Log in on AniList and allow access. Then copy the code it shows and come back here.",
                                "Auf AniList anmelden und erlauben. Dann den angezeigten Code kopieren und hierher zurückkommen.")}
                        </Text>
                        <SmallLink label={t("Open AniList again", "AniList erneut öffnen")} onPress={openAnilist} />
                    </>
                )}

                {step === "found" && (
                    <View accessibilityLiveRegion="polite" className="flex-row items-center gap-3 rounded-surface bg-sm-surface-raised p-4">
                        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.smAccentStrong} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <Path d="M20 6 9 17l-5-5" />
                        </Svg>
                        <Text className="min-w-0 flex-1 text-base font-semibold leading-[22px]">
                            {t("Code found. Connect to finish.", "Code gefunden. Zum Abschluss verbinden.")}
                        </Text>
                    </View>
                )}

                {step === "manual" && (
                    <View className="gap-2">
                        <TextInput {...accentInput}
                            accessibilityLabel={t("AniList code", "AniList-Code")}
                            value={typed}
                            onChangeText={value => {
                                setTyped(value)
                                setPasteFailed(false)
                            }}
                            placeholder={t("Code from AniList", "Code von AniList")}
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
                        <SmallLink label={t("Paste", "Einfügen")} onPress={() => void pasteIntoField()} />
                        {pasteFailed && (
                            <Text accessibilityLiveRegion="polite" className="text-[13px] leading-[19px] text-sm-text-muted">
                                {t("Nothing to paste. Copy the code on AniList first.",
                                    "Nichts zum Einfügen. Erst auf AniList den Code kopieren.")}
                            </Text>
                        )}
                    </View>
                )}
            </Sheet>
            {isPending && <AuthenticatingOverlay />}
        </>
    )
}

/** The small second way under a step: accent text, 48dp tall to tap */
function SmallLink({ label, onPress }: { label: string, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" onPress={onPress} className="min-h-12 justify-center self-start px-1 active:opacity-70">
            <Text className="text-[15px] font-semibold text-sm-accent">{label}</Text>
        </Pressable>
    )
}

/** The callback page's "Authenticating..." overlay while the server checks the token */
function AuthenticatingOverlay() {
    useThemeColors()
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
