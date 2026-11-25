import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { accountAtom, lastSyncAtom } from "@/lib/account/account-app"
import { useProfileAvatar } from "@/lib/account/profile-picture"
import { useTr } from "@/lib/app-language"
import { moreProfile, profileHeadOpens } from "@/lib/nav/more-panel"
import { accountLoadFailedAtom } from "@/main/_features/account/account-service"
import { useCurrentUser } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useAtomValue } from "jotai"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import UserRound from "lucide-react-native/icons/user-round"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * The top of the More panel (4.2.0, Nick): who is signed in. The AniList avatar and name (without AniList a neutral avatar
 * and "Sign in to AniList"), under them the Seanime account ("you@mail.com · Synced 2 min ago", or "Sync between your
 * devices"). The whole row opens Settings › Account, or AniList's sign-in while there is no AniList (the panel's only
 * way there, 4.2.0 E). The same row on the phone panel and beside the tablet rail.
 */
export function MoreProfileHead({ onPress, onSignIn }: {
    /** opens Settings › Account */
    onPress: () => void
    /** opens AniList's sign-in: the head's way while the app runs on the local account (profileHeadOpens) */
    onSignIn: () => void
}) {
    const t = useTr()
    const user = useCurrentUser()
    const signIn = profileHeadOpens(user) === "anilist-sign-in"
    const account = useAtomValue(accountAtom)
    const lastResult = useAtomValue(lastSyncAtom)
    const loadFailed = useAtomValue(accountLoadFailedAtom)
    // the panel mounts on every opening, so "Synced 2 min ago" counts from that moment
    const [now] = React.useState(Date.now)
    const viewer = user && !user.isSimulated ? user.viewer : undefined
    const profile = moreProfile(t, {
        anilist: viewer?.name ? { name: viewer.name, avatar: viewer.avatar?.medium || viewer.avatar?.large || null } : null,
        account,
        loadFailed,
        lastResult,
        now,
    })
    // the own picture (Settings › Account) in place of AniList's, also without AniList or an account
    const avatar = useProfileAvatar(profile.avatar)
    return (
        <View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={[profile.title, profile.line].filter(Boolean).join(", ")}
                accessibilityHint={signIn ? t("Opens the AniList sign-in", "Öffnet die AniList-Anmeldung") : t("Opens your account settings", "Öffnet deine Kontoeinstellungen")}
                onPress={signIn ? onSignIn : onPress}
                className="min-h-16 flex-row items-center gap-3 rounded-[16px] py-2 pl-2 pr-2.5 active:bg-white/8"
            >
                {avatar
                    ? <Image source={avatar}accessibilityIgnoresInvertColors style={{ width: 44, height: 44, borderRadius: 22 }} contentFit="cover" />
                    : (
                        <View className="h-11 w-11 items-center justify-center rounded-full border border-white/7 bg-white/6">
                            <UserRound size={22} color="rgba(255,255,255,0.78)" />
                        </View>
                    )}
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text numberOfLines={1} className="text-[15.5px] font-semibold tracking-[0.1px] text-white/95">{profile.title}</Text>
                    {!!profile.line && (
                        <Text numberOfLines={2} className={cn("text-[13px] leading-[17px]", profile.lineTone === "warning" ? "text-sm-warning" : "text-white/60")}>
                            {profile.line}
                        </Text>
                    )}
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.45)" />
            </Pressable>
            <View pointerEvents="none" className="mx-2.5 my-1 h-px bg-white/7" />
        </View>
    )
}
