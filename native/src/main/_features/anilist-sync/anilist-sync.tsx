// geschrieben nach: der Warteschlange für AniList (core/anilist/changes.ts, cache-only.ts) und dem Auftrag „App ohne AniList“ vom 15.11.2026 (Hinweis nur, wenn nötig; Antippen erklärt und sendet); Aussehen nach der Kopfzeile von Home und Listen
import { coreAnilistSyncState, coreSendWaitingChanges } from "@/api/client/core-switch"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { tr, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { watchAnilistState } from "@/core"
import { MobileAnilistLogin } from "@/main/_features/navigation/anilist-login-mobile"
import NetInfo from "@react-native-community/netinfo"
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai"
import Check from "lucide-react-native/icons/check"
import CloudOff from "lucide-react-native/icons/cloud-off"
import KeyRound from "lucide-react-native/icons/key-round"
import React from "react"
import { AppState, Pressable, View } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

/*
 * The sync hint: a small line under the head of Home and My lists, only while something is not normal. Offline, AniList
 * not answering, or changes waiting for it; after the waiting changes went out, "Synced" for a moment. Tapping explains
 * and offers "Send now". The service (mounted once in AppServices) sends what waits at the start of the app, when the
 * network comes back and when the app comes to the front; the core's own timer tries again in between (changes.ts).
 * AniList turning the sign-in away (an expired token, client.ts) keeps the changes in the queue: a toast and the hint
 * offer "Sign in again", the AniList sign-in sheet opens (AnilistSignInAgain), and the new sign-in sends them (auth.ts).
 */

type SyncState = { waiting: number, reachable: boolean, localAccount: boolean, signInExpired: boolean, offline: boolean, synced: boolean }

const anilistSyncAtom = atom<SyncState>({ waiting: 0, reachable: true, localAccount: false, signInExpired: false, offline: false, synced: false })

/** The AniList sign-in sheet opened from the toast or the hint (AnilistSignInAgain, mounted once in the main layout) */
const signInAgainOpenAtom = atom(false)

const SYNCED_FOR_MS = 3000

/** Mount once at the app root: keeps the hint's state and sends the waiting changes at the right moments */
export function useAnilistSyncService() {
    const store = useStore()
    React.useEffect(() => {
        let alive = true
        let syncedTimer: ReturnType<typeof setTimeout> | null = null
        const refresh = async (sent: number) => {
            const before = store.get(anilistSyncAtom)
            const now = await coreAnilistSyncState().catch(() => null)
            if (!alive || !now) return
            // "Synced" only when the hint showed something before: a change that goes out at once is normal operation
            const synced = sent > 0 && now.waiting === 0 && (before.waiting > 0 || !before.reachable)
            store.set(anilistSyncAtom, { ...store.get(anilistSyncAtom), ...now, synced: synced || store.get(anilistSyncAtom).synced })
            // told when the sign-in is first turned away, and again for each change that has to wait for it
            if (now.signInExpired && (!before.signInExpired || now.waiting > before.waiting)) {
                toast.warning(tr("Your AniList sign-in expired", "Deine AniList-Anmeldung ist abgelaufen"), {
                    id: "anilist-sign-in-expired",
                    description: tr("Your changes are kept on this device until you sign in again.", "Deine Änderungen bleiben auf diesem Gerät, bis du dich neu anmeldest."),
                    duration: 8000,
                    action: { label: tr("Sign in again", "Neu anmelden"), onClick: () => store.set(signInAgainOpenAtom, true) },
                })
            }
            if (synced) {
                if (syncedTimer) clearTimeout(syncedTimer)
                syncedTimer = setTimeout(() => store.set(anilistSyncAtom, { ...store.get(anilistSyncAtom), synced: false }), SYNCED_FOR_MS)
            }
        }
        const stopWatching = watchAnilistState(sent => void refresh(sent))
        void refresh(0).then(() => coreSendWaitingChanges())
        const stopNet = NetInfo.addEventListener(state => {
            const offline = state.isConnected === false
            const was = store.get(anilistSyncAtom).offline
            store.set(anilistSyncAtom, { ...store.get(anilistSyncAtom), offline })
            if (was && !offline) void coreSendWaitingChanges()
        })
        const front = AppState.addEventListener("change", next => {
            if (next === "active") void coreSendWaitingChanges()
        })
        return () => {
            alive = false
            if (syncedTimer) clearTimeout(syncedTimer)
            stopWatching()
            stopNet()
            front.remove()
        }
    }, [store])
}

/** The sending done from the sheet: the state follows through the watcher */
function useSendNow() {
    const setState = useSetAtom(anilistSyncAtom)
    return React.useCallback(async () => {
        await coreSendWaitingChanges()
        const now = await coreAnilistSyncState().catch(() => null)
        if (now) setState(state => ({ ...state, ...now }))
    }, [setState])
}

/** The AniList sign-in sheet for "Sign in again"; mount once (main layout) */
export function AnilistSignInAgain() {
    const [open, setOpen] = useAtom(signInAgainOpenAtom)
    return <MobileAnilistLogin open={open} onOpenChange={setOpen} />
}

export function AnilistSyncBar({ className }: { className?: string }) {
    const t = useTr()
    const state = useAtomValue(anilistSyncAtom)
    const setSignInOpen = useSetAtom(signInAgainOpenAtom)
    const [open, setOpen] = React.useState(false)
    const sendNow = useSendNow()
    const n = state.waiting
    const waitingText = (n === 1 ? t("1 change waiting", "1 Änderung wartet") : t(`${n} changes waiting`, `${n} Änderungen warten`))

    let text: string | null = null
    if (state.synced) text = t("Synced with AniList", "Mit AniList abgeglichen")
    else if (state.localAccount) text = null
    else if (state.signInExpired) text = n > 0 ? t(`AniList sign-in expired, ${waitingText}`, `AniList-Anmeldung abgelaufen, ${waitingText}`) : t("AniList sign-in expired", "AniList-Anmeldung abgelaufen")
    else if (state.offline) text = n > 0 ? t(`Offline – ${waitingText}, sent later`, `Offline – ${waitingText}, später gesendet`) : t("Offline – changes are saved and sent later", "Offline – Änderungen werden gespeichert und später gesendet")
    else if (!state.reachable) text = n > 0 ? t(`AniList unreachable – ${waitingText}`, `AniList nicht erreichbar – ${waitingText}`) : t("AniList unreachable – showing saved data", "AniList nicht erreichbar – gespeicherte Daten")
    else if (n > 0) text = t(`${waitingText} for AniList`, `${waitingText} auf AniList`)
    if (!text) return null

    const icon = state.synced ? <Check size={14} color={colors.smSuccess} />
        : state.signInExpired ? <KeyRound size={14} color={colors.smWarning} /> : <CloudOff size={14} color={colors.smTextSubtle} />
    if (state.signInExpired) {
        return (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} className={className}>
                <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={() => setOpen(true)}
                    className="flex-row items-center gap-2 self-start rounded-full border border-sm-line bg-sm-surface-raised px-3 py-1.5 active:scale-[0.97] active:opacity-80">
                    {icon}
                    <Text className="text-[13px] leading-[18px] text-sm-text-muted" numberOfLines={1}>{text}</Text>
                </Pressable>
                <Sheet title={t("Sign in to AniList again", "Neu bei AniList anmelden")} open={open} onOpenChange={setOpen}
                    footer={<>
                        <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setOpen(false)}>{t("Close", "Schließen")}</Button>
                        <Button intent="primary" wrapperClassName="flex-1" onPress={() => {
                            setOpen(false)
                            setSignInOpen(true)
                        }}>{t("Sign in again", "Neu anmelden")}</Button>
                    </>}>
                    <View className="gap-3">
                        <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                            {t("AniList no longer accepts this sign-in. Progress, status and scores you change stay on this device and go to AniList once you sign in again with the same account.",
                                "AniList nimmt diese Anmeldung nicht mehr an. Fortschritt, Status und Wertungen, die du änderst, bleiben auf diesem Gerät und gehen an AniList, sobald du dich mit demselben Konto neu anmeldest.")}
                        </Text>
                        {n > 0 && <Text className="text-[15px] leading-[23px] text-sm-text">{waitingText}</Text>}
                    </View>
                </Sheet>
            </Animated.View>
        )
    }
    return (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} className={className}>
            <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={state.synced} onPress={() => setOpen(true)}
                className="flex-row items-center gap-2 self-start rounded-full border border-sm-line bg-sm-surface-raised px-3 py-1.5 active:scale-[0.97] active:opacity-80">
                {icon}
                <Text className="text-[13px] leading-[18px] text-sm-text-muted" numberOfLines={1}>{text}</Text>
            </Pressable>
            <Sheet title={t("Changes for AniList", "Änderungen für AniList")} open={open} onOpenChange={setOpen}
                footer={<>
                    <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setOpen(false)}>{t("Close", "Schließen")}</Button>
                    <Button intent="primary" wrapperClassName="flex-1" disabled={n === 0} onPress={() => {
                        setOpen(false)
                        void sendNow()
                    }}>{t("Send now", "Jetzt senden")}</Button>
                </>}>
                <View className="gap-3">
                    <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                        {t("Progress, status and scores you change are saved on this device first and show right away. When AniList can be reached again, the app sends them on its own, in the order you made them.",
                            "Fortschritt, Status und Wertungen, die du änderst, werden zuerst auf diesem Gerät gespeichert und gleich angezeigt. Sobald AniList wieder erreichbar ist, sendet die App sie von selbst, in der Reihenfolge, in der du sie gemacht hast.")}
                    </Text>
                    <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                        {t("If you watched further on another device in the meantime, the higher progress on AniList is kept.",
                            "Hast du inzwischen auf einem anderen Gerät weitergeschaut, bleibt der höhere Fortschritt auf AniList erhalten.")}
                    </Text>
                    {n > 0 && <Text className="text-[15px] leading-[23px] text-sm-text">{waitingText}</Text>}
                </View>
            </Sheet>
        </Animated.View>
    )
}
