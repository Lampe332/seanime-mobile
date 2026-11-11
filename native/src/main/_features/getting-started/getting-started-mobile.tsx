import { useGettingStarted } from "@/api/hooks/settings.hooks"
import type { Status } from "@/api/generated/types"
import { cn } from "@/components/ui/core/styling"
import { Switch } from "@/components/ui/switch/switch"
import { Text } from "@/components/ui/text/text"
import { type AppLanguage, appLanguageAtom, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import {
    buildGettingStartedPayload,
    DEFAULT_GETTING_STARTED_FEATURES,
    type GettingStartedFeatures,
} from "@/main/_features/getting-started/getting-started-payload"
import { useSetServerStatus } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useAtom } from "jotai"
import React from "react"
import { Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * First start on Android (getting-started-page.tsx + getting-started-mobile.tsx/.css): one screen, no folders or
 * desktop players to set up. Language, the two features, one start action. The server answers with the new status;
 * useGettingStarted then opens the AniList sheet.
 * Look (`.gsm`): sunken page with a faint brand tint over the top 28rem, at most 32rem wide, 32dp between blocks.
 */
const TINT = "linear-gradient(180deg, rgba(97,82,223,0.14) 0px, rgba(97,82,223,0.05) 246px, rgba(97,82,223,0) 448px)"

export function MobileGettingStarted({ status }: { status: Status }) {
    const t = useTr()
    const insets = useSafeAreaInsets()
    const router = useRouter()
    const setServerStatus = useSetServerStatus()
    const [language, setLanguage] = useAtom(appLanguageAtom)
    const [features, setFeatures] = React.useState<GettingStartedFeatures>(DEFAULT_GETTING_STARTED_FEATURES)
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

    const rows: { name: keyof GettingStartedFeatures, title: string, text: string }[] = [
        {
            name: "enableOnlinestream",
            title: t("Online streaming", "Online-Streaming"),
            text: t("Watch episodes from online sources and download them to this device.",
                "Folgen aus Online-Quellen schauen und aufs Gerät laden."),
        },
        {
            name: "enableManga",
            title: "Manga",
            text: t("Read chapters, follow new ones and save them for offline reading.",
                "Kapitel lesen, neue verfolgen und für offline speichern."),
        },
    ]

    return (
        <ScrollView
            className="flex-1 bg-sm-surface-sunken"
            contentContainerStyle={{
                backgroundImage: TINT,
                paddingTop: Math.max(40, insets.top + 24),
                paddingBottom: Math.max(24, insets.bottom),
            }}
            contentContainerClassName="min-h-full"
        >
            <View className="w-full max-w-[512px] gap-8 self-center px-4">
                <View className="gap-3">
                    <Image
                        source={require("../../../../assets/images/seanime-logo.png")}
                        style={{ width: 56, height: 56, marginBottom: 12 }}
                        contentFit="contain"
                        accessibilityIgnoresInvertColors
                    />
                    <Text accessibilityRole="header" className="text-[36px] leading-[40px] font-extrabold tracking-[-1.08px]">
                        {t("Welcome to Seanime", "Willkommen bei Seanime")}
                    </Text>
                    <Text className="text-base leading-6 text-sm-text-muted">
                        {t("Choose what the app shows. You can change all of this later in Settings.",
                            "Wähle, was die App zeigt. Alles lässt sich später in den Einstellungen ändern.")}
                    </Text>
                </View>

                <View className="gap-3">
                    <Text accessibilityRole="header" className="text-xl leading-[27px] font-bold tracking-[-0.3px]">{t("Language", "Sprache")}</Text>
                    <View accessibilityRole="radiogroup" className="flex-row gap-1 rounded-surface-sm bg-sm-surface-raised p-1">
                        {([["en", "English"], ["de", "Deutsch"]] as const).map(([value, label]) => {
                            const checked = language === value
                            return (
                                <Pressable
                                    key={value}
                                    accessibilityRole="radio"
                                    accessibilityState={{ checked }}
                                    onPress={() => chooseLanguage(value)}
                                    className={cn("min-h-12 flex-1 items-center justify-center rounded-[8px]", checked && "bg-sm-surface-control")}
                                >
                                    <Text className={cn("text-[15px]", checked ? "font-semibold text-sm-text" : "font-medium text-sm-text-muted")}>{label}</Text>
                                </Pressable>
                            )
                        })}
                    </View>
                </View>

                <View className="gap-3">
                    <Text accessibilityRole="header" className="text-xl leading-[27px] font-bold tracking-[-0.3px]">{t("Features", "Funktionen")}</Text>
                    <View className="gap-0.5 overflow-hidden rounded-surface">
                        {rows.map(row => {
                            const checked = features[row.name]
                            const toggle = () => setFeatures(prev => ({ ...prev, [row.name]: !prev[row.name] }))
                            return (
                                // the whole row is the switch
                                <Pressable
                                    key={row.name}
                                    accessibilityRole="switch"
                                    accessibilityState={{ checked }}
                                    accessibilityLabel={row.title}
                                    onPress={toggle}
                                    className="min-h-[72px] w-full flex-row items-center gap-4 bg-sm-surface-raised px-4 py-3.5 active:bg-sm-surface-control"
                                >
                                    <View className="min-w-0 flex-1 gap-1">
                                        <Text className="text-base font-semibold leading-[22px]">{row.title}</Text>
                                        <Text className="text-sm leading-5 text-sm-text-muted">{row.text}</Text>
                                    </View>
                                    <View pointerEvents="none">
                                        <Switch checked={checked} onCheckedChange={toggle} />
                                    </View>
                                </Pressable>
                            )
                        })}
                    </View>
                </View>

                <View className="mt-2 gap-4">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isPending, busy: isPending }}
                        disabled={isPending}
                        onPress={() => mutate(buildGettingStartedPayload(status.os, features))}
                        className={cn("min-h-[52px] items-center justify-center rounded-full bg-brand-500 active:bg-brand-600", isPending && "opacity-60")}
                    >
                        <Text className="text-base font-semibold text-white">
                            {isPending ? t("Starting…", "Startet …") : t("Start Seanime", "Seanime starten")}
                        </Text>
                    </Pressable>
                    <Text className="text-center text-sm text-sm-text-subtle">By Lampe332</Text>
                </View>
            </View>
        </ScrollView>
    )
}
