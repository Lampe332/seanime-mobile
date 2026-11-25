import { useGettingStarted } from "@/api/hooks/settings.hooks"
import type { Status } from "@/api/generated/types"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { APP_LANGUAGES, type AppLanguage, appLanguageAtom, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { usePalette } from "@/lib/theme/appearance"
import { accentGlow, type GlowStop } from "@/lib/theme/palette"
import { buildGettingStartedPayload, DEFAULT_GETTING_STARTED_FEATURES } from "@/main/_features/getting-started/getting-started-payload"
import { useSetServerStatus } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useAtom } from "jotai"
import React from "react"
import { Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * First start on Android (getting-started-page.tsx + getting-started-mobile.tsx/.css), kept to one step: language and
 * one start button. Streaming and manga start switched on (DEFAULT_GETTING_STARTED_FEATURES), both stay in Settings.
 * The core answers with the new status; useGettingStarted then opens the AniList sheet, the second and last step.
 * Look (`.gsm`): sunken page with a faint brand tint over the top 28rem, at most 32rem wide, the block centred.
 * `onPreviewStart` (test and scratch only, intro-preview.ts): the button goes on to the preview's AniList sheet and
 * nothing is saved.
 */
const TINT: GlowStop[] = [[0.14, 0], [0.05, 246], [0, 448]]

export function MobileGettingStarted({ status, onPreviewStart }: { status: Status, onPreviewStart?: () => void }) {
    const t = useTr()
    const palette = usePalette()
    const insets = useSafeAreaInsets()
    const router = useRouter()
    const setServerStatus = useSetServerStatus()
    const [language, setLanguage] = useAtom(appLanguageAtom)
    const { mutate, data, isPending } = useGettingStarted()

    // If the settings are returned, go home (getting-started-page.tsx)
    const onStarted = React.useEffectEvent((next: Status) => {
        setServerStatus(next)
        router.push("/")
    })
    React.useEffect(() => {
        if (!isPending && !!data?.settings) onStarted(data)
    }, [data, isPending])

    // the service notification follows through client-providers (syncAppLanguageToAndroid in the web app)
    const chooseLanguage = (next: AppLanguage) => setLanguage(next)

    const start = () => {
        if (onPreviewStart) onPreviewStart()
        else mutate(buildGettingStartedPayload(status.os, DEFAULT_GETTING_STARTED_FEATURES))
    }

    return (
        <ScrollView
            className="flex-1 bg-sm-surface-sunken"
            contentContainerStyle={{
                backgroundImage: accentGlow(TINT, undefined, palette),
                flexGrow: 1,
                paddingTop: Math.max(40, insets.top + 24),
                paddingBottom: Math.max(24, insets.bottom),
            }}
            contentContainerClassName="min-h-full"
        >
            <View className="w-full max-w-[512px] flex-1 justify-center gap-10 self-center px-4">
                <View className="gap-3">
                    <Image
                        source={require("../../../../assets/images/seanime-logo.png")}
                        style={{ width: 56, height: 56, marginBottom: 12 }}
                        contentFit="contain"
                        accessibilityIgnoresInvertColors
                    />
                    <Text accessibilityRole="header" className="text-[36px] leading-[40px] font-extrabold tracking-[-1.08px]">
                        {t("Welcome to Seanime Mobile", "Willkommen bei Seanime Mobile")}
                    </Text>
                    <Text className="text-base leading-6 text-sm-text-muted">
                        {t("Watch anime and read manga, all in one place.", "Anime schauen und Manga lesen, alles an einem Ort.")}
                    </Text>
                </View>

                <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel={t("Language", "Sprache")}
                    className="flex-row flex-wrap gap-1 rounded-surface-sm bg-sm-surface-raised p-1"
                >
                    {APP_LANGUAGES.map(({ value, label }) => {
                        const checked = language === value
                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="radio"
                                accessibilityState={{ checked }}
                                onPress={() => chooseLanguage(value)}
                                className={cn("min-h-12 grow basis-[45%] items-center justify-center rounded-[8px] px-2", checked && "bg-sm-surface-control")}
                            >
                                <Text className={cn("text-[15px]", checked ? "font-semibold text-sm-text" : "font-medium text-sm-text-muted")}>{label}</Text>
                            </Pressable>
                        )
                    })}
                </View>

                <View className="gap-4">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isPending, busy: isPending }}
                        disabled={isPending}
                        onPress={start}
                        className={cn("min-h-[52px] items-center justify-center rounded-full bg-brand-500 active:bg-brand-600", isPending && "opacity-60")}
                    >
                        <Text className="text-base font-semibold text-white">
                            {isPending ? t("Starting…", "Startet …") : t("Get started", "Los geht’s")}
                        </Text>
                    </Pressable>
                    <Text className="text-center text-sm text-sm-text-subtle">By Lampe332</Text>
                </View>
            </View>
        </ScrollView>
    )
}
