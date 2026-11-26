// geschrieben nach: settings-account.tsx (Anmeldeformular, PasswordField) und settings-more.tsx (Nakama, Host-Warnung)

import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { type MediaServerStatus, readingFinished, useMediaServerLogin, useMediaServerLogout, useMediaServerRefresh, useMediaServerStatus, useSaveMediaServerSettings } from "@/api/hooks/mediaserver.hooks"
import { Notice } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { useReleaseFocusOnLeave } from "@/components/ui/core/page-focus"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { plural, type Translate } from "@/lib/app-language"
import { useThemeColors } from "@/lib/theme/appearance"
import { accentInput } from "@/lib/theme/tokens"
import { ConfirmSheet, InfoRow, LinkRow, LocalSwitch, SettingsGroup } from "@/main/settings/_components/settings-kit"
import { checkServerAddress } from "@/main/settings/_lib/mediaserver-host"
import { MediaServerMatchSheet } from "@/main/entry/_containers/entry-actions/media-server-match-sheet"
import { type MatchSubject, subjectOfLeftOut, subjectOfUnmatched } from "@/main/entry/_lib/media-server-match"
import { useQueryClient } from "@tanstack/react-query"
import Eye from "lucide-react-native/icons/eye"
import EyeOff from "lucide-react-native/icons/eye-off"
import React from "react"
import { Pressable, TextInput, type TextInputInstance, View } from "react-native"

/*
 * Settings › Media server. Signed out: address, username and password, then Sign in. Signed in: the server, the user,
 * how many series it has and how many of them were matched, when it was last read, Read again, the series that were not
 * matched (tapping one opens "Change match" with its suggestion picked) and Sign out. The password only goes to the server: the field is emptied after signing in and it
 * is never kept. Jellyfin only for now.
 */

const FIELD = "min-h-[52px] rounded-surface bg-sm-surface-raised px-4 py-3 font-sans text-base text-sm-text"

/** The core's answer status of a failed call (server-settings.ts `failureOf`) */
const statusOf = (error: unknown) => (error as { response?: { status?: unknown } } | null)?.response?.status

/** The words for a failed sign-in or reading; never the server's own text, never the password */
function failureText(t: Translate, error: unknown): string {
    switch (statusOf(error)) {
        case 422:
            return t("Wrong username or password.", "Falscher Nutzername oder falsches Passwort.")
        case 504:
            return t("The server did not answer. Check the address and that the server is running.",
                "Der Server hat nicht geantwortet. Prüfe die Adresse und ob der Server läuft.")
        case 502:
            return t("No Jellyfin server answered at this address.", "Unter dieser Adresse hat kein Jellyfin-Server geantwortet.")
        case 400:
            return t("This address does not work. It needs a server name, for example http://192.168.1.20:8096.",
                "Diese Adresse geht nicht. Sie braucht einen Servernamen, zum Beispiel http://192.168.1.20:8096.")
        default:
            return t("Something went wrong while asking the server. Try again.", "Beim Fragen des Servers ging etwas schief. Versuch es noch mal.")
    }
}

/** Why the last reading failed (source.ts `problem`); the series from before stay */
function problemText(t: Translate, problem: string): string {
    if (problem === "unreachable") return t("The server did not answer the last time it was read. The series from before stay.",
        "Der Server hat beim letzten Einlesen nicht geantwortet. Die Serien von vorher bleiben.")
    if (problem === "rejected") return t("The server no longer accepts this sign-in. Sign out and sign in again.",
        "Der Server nimmt diese Anmeldung nicht mehr an. Melde dich ab und wieder an.")
    return t("Reading the server failed. The series from before stay.", "Das Einlesen des Servers ist fehlgeschlagen. Die Serien von vorher bleiben.")
}

function readAgo(t: Translate, readAt: number | null, now: number): string {
    if (readAt === null) return t("Not yet", "Noch nicht")
    const minutes = Math.max(0, Math.floor((now - readAt) / 60_000))
    if (minutes < 1) return t("Just now", "Gerade eben")
    if (minutes < 60) return plural(t, minutes, ["1 min ago", "{0} min ago"], ["vor 1 Min.", "vor {0} Min."])
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return plural(t, hours, ["1 h ago", "{0} h ago"], ["vor 1 Std.", "vor {0} Std."])
    const days = Math.floor(hours / 24)
    return plural(t, days, ["1 day ago", "{0} days ago"], ["vor 1 Tag", "vor {0} Tagen"])
}

/** The library and an open anime page read the server's series again (as Nakama does when the host changes) */
function useReloadLibrary() {
    const queryClient = useQueryClient()
    return () => {
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
    }
}

export function SettingsMediaServerSection({ t }: { t: Translate }) {
    const { data: status, isLoading, isError, refetch } = useMediaServerStatus()

    return <>
        <SettingsGroup title={t("Media server", "Medienserver")}
            note={t("Watch the series on your own media server in this app. Jellyfin is supported for now.",
                "Schau die Serien deines eigenen Medienservers in dieser App. Derzeit wird Jellyfin unterstützt.")}>
            {isLoading ? <InfoRow label={t("Loading…", "Lädt …")} />
                : isError || !status ? <LinkRow label={t("Could not load the media server", "Medienserver konnte nicht geladen werden")} chevron={false}
                    note={t("Tap to try again.", "Tippe für einen neuen Versuch.")} onPress={() => void refetch()} />
                    : status.signedIn ? <ServerRows t={t} status={status} />
                        : <InfoRow label={t("Not signed in", "Nicht angemeldet")} />}
        </SettingsGroup>
        {status && !status.signedIn && <SignInForm t={t} />}
        {status?.signedIn && <SignedIn t={t} status={status} />}
    </>
}

function ServerRows({ t, status }: { t: Translate, status: MediaServerStatus }) {
    return <>
        <InfoRow label={t("Server", "Server")} value={status.serverName || status.url} />
        <InfoRow label={t("User", "Nutzer")} value={status.username} />
    </>
}

function SignInForm({ t }: { t: Translate }) {
    const colors = useThemeColors()
    const reloadLibrary = useReloadLibrary()
    const { mutate: login, isPending, error, reset } = useMediaServerLogin()
    const [address, setAddress] = React.useState("")
    const [username, setUsername] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [shown, setShown] = React.useState(false)
    const [addressLeft, setAddressLeft] = React.useState(false)
    // Settings stays mounted under the next page: the field lets go of the keyboard then (page-focus.ts)
    const addressRef = React.useRef<TextInputInstance>(null)
    useReleaseFocusOnLeave(addressRef)
    const checked = checkServerAddress(address)
    const addressWrong = addressLeft && !!address.trim() && !checked.ok
    const ready = checked.ok && !!username.trim() && !isPending
    const PasswordIcon = shown ? EyeOff : Eye

    function edit(set: (value: string) => void) {
        return (value: string) => {
            set(value)
            if (error) reset()
        }
    }

    function submit() {
        setAddressLeft(true)
        if (!ready || !checked.ok) return
        login({ url: checked.url, username: username.trim(), password }, {
            onSuccess: () => {
                setPassword("")
                reloadLibrary()
            },
        })
    }

    return <View className="gap-6">
        <SettingsGroup title={t("Sign in", "Anmelden")}
            note={t("The address of your Jellyfin server and your Jellyfin user. The password only goes to the server and is not kept.",
                "Die Adresse deines Jellyfin-Servers und dein Jellyfin-Nutzer. Das Passwort geht nur an den Server und wird nicht gespeichert.")}>
            <View className="gap-2 bg-sm-surface px-0 py-1">
                <TextInput {...accentInput} ref={addressRef} value={address} onChangeText={edit(setAddress)} onBlur={() => setAddressLeft(true)} editable={!isPending}
                    placeholder={t("e.g. http://192.168.1.20:8096", "z. B. http://192.168.1.20:8096")} placeholderTextColor={colors.smTextSubtle}
                    accessibilityLabel={t("Server address", "Serveradresse")} autoCapitalize="none" autoCorrect={false} autoComplete="url" textContentType="URL"
                    keyboardType="url" returnKeyType="next" className={cn(FIELD, addressWrong && "border-2 border-sm-danger")} />
                {addressWrong && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">
                    {t("This is not a server address. Write it like http://192.168.1.20:8096 or https://jellyfin.example.com.",
                        "Das ist keine Serveradresse. Schreib sie wie http://192.168.1.20:8096 oder https://jellyfin.example.com.")}
                </Text>}
                <TextInput {...accentInput} value={username} onChangeText={edit(setUsername)} editable={!isPending}
                    placeholder={t("Username", "Nutzername")} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={t("Username", "Nutzername")}
                    autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" className={FIELD} />
                <View className="justify-center">
                    <TextInput {...accentInput} value={password} onChangeText={edit(setPassword)} editable={!isPending}
                        placeholder={t("Password", "Passwort")} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={t("Password", "Passwort")}
                        autoCapitalize="none" autoCorrect={false} spellCheck={false} secureTextEntry={!shown} autoComplete="current-password" textContentType="password"
                        returnKeyType="go" onSubmitEditing={submit} className={cn(FIELD, "pr-14", statusOf(error) === 422 && "border-2 border-sm-danger")} />
                    <Pressable accessibilityRole="button" accessibilityLabel={shown ? t("Hide password", "Passwort verbergen") : t("Show password", "Passwort zeigen")}
                        onPress={() => setShown(value => !value)} className="absolute right-1 h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                        <PasswordIcon size={20} color={colors.smTextMuted} />
                    </Pressable>
                </View>
                {!!error && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">{failureText(t, error)}</Text>}
            </View>
        </SettingsGroup>
        {/* below the fields, so it never pushes them down while the address is typed */}
        {checked.ok && checked.unencrypted && <Notice text={t("This address has no https://, so your password goes over the network unencrypted. Use https:// if your server supports it.",
            "Diese Adresse hat kein https://, deshalb geht dein Passwort unverschlüsselt durchs Netzwerk. Nutze https://, wenn dein Server es unterstützt.")} />}
        <Button intent="primary" disabled={!ready} loading={isPending} onPress={submit}>
            {isPending ? t("Signing in…", "Melde an …") : t("Sign in", "Anmelden")}
        </Button>
    </View>
}

function SignedIn({ t, status }: { t: Translate, status: MediaServerStatus }) {
    const reloadLibrary = useReloadLibrary()
    const refresh = useMediaServerRefresh()
    const logout = useMediaServerLogout()
    const [confirmOut, setConfirmOut] = React.useState(false)
    const [matching, setMatching] = React.useState<MatchSubject | null>(null)
    const [matchOpen, setMatchOpen] = React.useState(false)
    // The time "last read" is counted from; it moves on with each answer
    const [now, setNow] = React.useState(() => Date.now())
    // and once a minute while the page is open, so "5 min ago" does not stand still
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(timer)
    }, [])
    const reading = refresh.isPending || status.reading
    // a reading in the background (after signing in, or due) ends: the library and an open anime page show its series
    const wasReading = React.useRef(status.reading)
    React.useEffect(() => {
        if (readingFinished(wasReading.current, status.reading)) reloadLibrary()
        wasReading.current = status.reading
    }, [status.reading, reloadLibrary])
    const failure = refresh.error ? failureText(t, refresh.error) : status.problem ? problemText(t, status.problem) : ""

    function readAgain() {
        refresh.mutate(undefined, {
            onSuccess: () => reloadLibrary(),
            onSettled: () => setNow(Date.now()),
        })
    }

    function signOut() {
        setConfirmOut(false)
        logout.mutate(undefined, { onSuccess: () => reloadLibrary() })
    }

    return <>
        <SettingsGroup title={t("Series", "Serien")}
            notice={failure && !reading ? <Notice text={failure} /> : undefined}>
            {status.series === 0 && !reading
                ? <InfoRow label={t("No series yet", "Noch keine Serien")}
                    note={t("The server showed no series to this user. Add some in Jellyfin, then read again.",
                        "Der Server hat diesem Nutzer keine Serien gezeigt. Füge in Jellyfin welche hinzu und lies dann neu ein.")} />
                : <>
                    <InfoRow label={t("Series on the server", "Serien auf dem Server")} value={String(status.series)} />
                    <InfoRow label={t("Matched", "Zugeordnet")} value={String(status.matched)} />
                    <InfoRow label={t("Not matched", "Nicht zugeordnet")} value={String(status.unmatched.length)} />
                    {status.leftOutSeries > 0 && <InfoRow label={t("Left out", "Ausgelassen")} value={String(status.leftOutSeries)} />}
                </>}
            <InfoRow label={t("Last read", "Zuletzt eingelesen")} value={readAgo(t, status.lastReadAt, now)} />
            <LinkRow label={reading ? t("Reading…", "Lese ein …") : t("Read again", "Neu einlesen")} chevron={false} disabled={reading || logout.isPending}
                note={t("Reads the series from the server now. Your library updates afterwards.", "Liest die Serien jetzt vom Server. Deine Bibliothek wird danach aktualisiert.")}
                onPress={readAgain} />
        </SettingsGroup>

        {status.unmatched.length > 0 && <SettingsGroup title={t("Not matched", "Nicht zugeordnet")}
            note={t("These series could not be matched to an AniList entry, so they do not show up in your library.",
                "Diese Serien ließen sich keinem AniList-Eintrag zuordnen, deshalb erscheinen sie nicht in deiner Bibliothek.")}>
            {status.unmatched.map(show => <LinkRow key={show.seriesId} label={show.year ? `${show.name} (${show.year})` : show.name}
                note={show.suggestion ? t(`Suggestion: ${show.suggestion.title}`, `Vorschlag: ${show.suggestion.title}`) : t("No suggestion", "Kein Vorschlag")}
                onPress={() => { setMatching(subjectOfUnmatched(show)); setMatchOpen(true) }} />)}
        </SettingsGroup>}
        {status.leftOut.length > 0 && <SettingsGroup title={t("Left out", "Ausgelassen")}
            note={t("Series you marked as belonging to nothing. They stay out of your library.",
                "Serien, die du als „gehört zu nichts“ markiert hast. Sie bleiben aus deiner Bibliothek heraus.")}>
            {status.leftOut.map(item => <LinkRow key={item.itemId} label={item.year ? `${item.name} (${item.year})` : item.name}
                note={item.seasonName !== null ? leftSeasonName(t, item) : t("Whole series", "Ganze Serie")}
                onPress={() => { setMatching(subjectOfLeftOut(item)); setMatchOpen(true) }} />)}
        </SettingsGroup>}
        {/* kept in state: the series leaves its group once saved, the sheet stays until it closes */}
        {!!matching && <MediaServerMatchSheet subject={matching} open={matchOpen} onOpenChange={setMatchOpen} />}

        <ProgressSwitch status={status} t={t} />

        <SettingsGroup>
            <LinkRow label={logout.isPending ? t("Signing out…", "Melde ab …") : t("Sign out", "Abmelden")} tone="danger" chevron={false}
                disabled={logout.isPending || refresh.isPending}
                note={t("The server's series leave your library. Your matches stay.", "Die Serien des Servers verschwinden aus deiner Bibliothek. Deine Zuordnungen bleiben.")}
                onPress={() => setConfirmOut(true)} />
        </SettingsGroup>
        <ConfirmSheet open={confirmOut} onOpenChange={setConfirmOut} danger
            title={t("Sign out of the media server?", "Vom Medienserver abmelden?")}
            text={t("The server's series leave your library until you sign in again.", "Die Serien des Servers verschwinden aus deiner Bibliothek, bis du dich wieder anmeldest.")}
            action={t("Sign out", "Abmelden")} onConfirm={signOut} />
    </>
}

/** The left-out season of a "Left out" row, by its name on the server or else its number */
function leftSeasonName(t: Translate, item: MediaServerStatus["leftOut"][number]): string {
    if (item.seasonName) return item.seasonName
    const index = item.seasons.find(season => season.id === item.itemId)?.index ?? "?"
    return t(`Season ${index}`, `Staffel ${index}`)
}

/** Whether a playing server episode tells its server start, position and end (core/jellyfin/playback.ts asks it every time) */
function ProgressSwitch({ status, t }: { status: MediaServerStatus, t: Translate }) {
    const save = useSaveMediaServerSettings()
    return <SettingsGroup title={t("Progress", "Fortschritt")}>
        <LocalSwitch label={t("Report progress to the server", "Fortschritt an den Server melden")}
            note={t("Episodes you play from the server tell it where you are, so it can show them under Continue Watching and mark them as played. AniList is updated as before.",
                "Folgen, die du vom Server abspielst, melden ihm deinen Stand. So zeigt er sie unter „Weiterschauen“ und markiert sie als gesehen. AniList wird wie bisher aktualisiert.")}
            checked={status.sendProgress} disabled={save.isPending} onCheckedChange={value => save.mutate({ sendProgress: value })} />
    </SettingsGroup>
}
