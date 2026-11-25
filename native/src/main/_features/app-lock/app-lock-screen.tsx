import { Button } from "@/components/ui/button/button"
import { Heading, Text } from "@/components/ui/text/text"
import { unlockApp, useAppLocked } from "@/lib/app-lock/app-lock"
import { tr, useTr } from "@/lib/app-language"
import { confirmWithDeviceLock } from "@/lib/device-lock"
import { useThemeColors } from "@/lib/theme/appearance"
import * as Application from "expo-application"
import Lock from "lucide-react-native/icons/lock"
import React from "react"
import { AppState, BackHandler, StyleSheet, View } from "react-native"

/*
 * The app lock's cover (lib/app-lock): opaque over the whole app, sheets, toasts, the tour and the player included
 * (client-providers.tsx renders it last and hides the rest from the screen reader). The device lock's prompt opens by
 * itself as the cover appears; a cancelled or failed prompt leaves it locked and "Unlock" asks again. It is not opened
 * again by itself, so a cancel cannot turn into a loop. Back does nothing while it is up.
 */
export function AppLockScreen() {
    const locked = useAppLocked()
    return locked ? <LockCover /> : null
}

let prompting = false

/** One device lock prompt at a time; true without a device lock, so a lock removed after the switch locks nobody out */
async function askToUnlock(setBusy: (busy: boolean) => void) {
    if (prompting) return
    prompting = true
    setBusy(true)
    try {
        if (await confirmWithDeviceLock(tr("Unlock the app", "App entsperren"))) unlockApp()
    }
    finally {
        prompting = false
        setBusy(false)
    }
}

function LockCover() {
    const t = useTr()
    const colors = useThemeColors()
    const [busy, setBusy] = React.useState(false)
    const appName = Application.applicationName ?? "Seanime"

    // the prompt once as the cover appears; at a cold start it waits until the app is in front
    React.useEffect(() => {
        if (AppState.currentState === "active") {
            void askToUnlock(setBusy)
            return
        }
        const sub = AppState.addEventListener("change", state => {
            if (state !== "active") return
            sub.remove()
            void askToUnlock(setBusy)
        })
        return () => sub.remove()
    }, [])

    // registered last, so it runs before every screen's own handler: nothing behind the cover goes back
    React.useEffect(() => {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => true)
        return () => sub.remove()
    }, [])

    return (
        <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            className="items-center justify-center px-8">
            <View className="w-full max-w-[320px] items-center">
                <View className="mb-6 h-16 w-16 items-center justify-center rounded-full bg-sm-surface-raised">
                    <Lock size={28} color={colors.smAccent} />
                </View>
                <Heading className="text-center">{appName}</Heading>
                <Text className="mt-2 text-center text-sm-text-muted">
                    {t("Locked. Use your fingerprint, face or screen lock to open the app.",
                        "Gesperrt. Öffne die App mit Fingerabdruck, Gesicht oder Displaysperre.")}
                </Text>
                <Button className="mt-8" wrapperClassName="w-full" size="lg" loading={busy} onPress={() => void askToUnlock(setBusy)}>
                    {t("Unlock", "Entsperren")}
                </Button>
            </View>
        </View>
    )
}
