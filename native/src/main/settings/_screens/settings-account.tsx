// geschrieben nach: Plan „Account + Sync“ (Abschnitt 2 Nutzer-Erlebnis, 6.1–6.9, 8 UI-Liste) und settings-kit.tsx / backup-group.tsx (Zeilen, Sheets, Felder)

import { Notice, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { useReleaseFocusOnLeave } from "@/components/ui/core/page-focus"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import type { CheckedDevice, PendingApproval } from "@/core/account/devices"
import {
    accountAtom, accountInfoAtom, answerNumber, approvalDone, changeEncryptionKey, denyApproval, disconnectGoogle, approvalProgress, askForApproval, changeAccountPassword, createAccount,
    deleteSyncedData, deleteWholeAccount, importDismissedAtom, keyNoticeAtom, lastSyncAtom, listDevices, newPasswordOfferAtom, newRecoveryCode, recoveryCodeUsable,
    resendConfirmation, sendSignInCode, setNewPassword, signIn, signInWithCode, signedInWithCode, signOutHere, skipNewPassword, startFreshHere, syncingAtom, syncNow, turnOffCodeOnly,
    turnOffWebEdit, turnOnCodeOnly, turnOnWebEdit, unlockWithRecoveryCode,
} from "@/lib/account/account-app"
import {
    CODE_LENGTH, type CodeEdit, MIN_PASSWORD_LENGTH, accountDate, accountErrorText, accountPhase, backspaceInCode, codeOf, eventText, formatRecoveryCode, formatSas,
    passwordStrength, repeatMismatch, resendWait, startApprovalAttempt, strengthLabel, syncedAgo, typeInCode,
} from "@/lib/account/account-view"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { accountLoadFailedAtom, retryAccountLoad } from "@/main/_features/account/account-service"
import { appLanguageAtom, plural, type Translate } from "@/lib/app-language"
import { copySecretToClipboard, openTab } from "@/lib/helpers/browser"
import { colors, accentInput } from "@/lib/theme/tokens"
import { NoScreenshots } from "@/main/_features/account/account-prompts"
import { ConfirmSheet, InfoRow, LinkRow, LocalSwitch, SettingsGroup } from "@/main/settings/_components/settings-kit"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { profilePictureAtom, useHasProfilePicture, useProfileAvatar } from "@/lib/account/profile-picture"
import { pickProfilePicture, removeProfilePictures } from "@/lib/account/profile-picture-photo"
import { useCurrentUser } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useAtomValue, useSetAtom } from "jotai"
import { RESET } from "jotai/utils"
import UserRound from "lucide-react-native/icons/user-round"
import React from "react"
import Eye from "lucide-react-native/icons/eye"
import EyeOff from "lucide-react-native/icons/eye-off"
import { Pressable, Share, TextInput, type TextInputInstance, View } from "react-native"

/*
 * Settings › Account. Signed out: Create account, Sign in (Google sign-in is not part of 4.2.0). A new device without the
 * account's key: "Approve on your phone" with the number, the recovery code or Start fresh. Signed in: when it last
 * synced, Sync now, the devices, the recovery code, password, sign out and the two deletes. The account is optional:
 * without one nothing in the app changes.
 */

const FIELD = "min-h-[52px] rounded-surface bg-sm-surface-raised px-4 py-3 font-sans text-base text-sm-text"
const RESET_PAGE = "https://seanimemobile.com/account/reset/"
const DEVICES_KEY = ["account", "devices"]

export function SettingsAccountSection({ t }: { t: Translate }) {
    const account = useAtomValue(accountAtom)
    const lastSync = useAtomValue(lastSyncAtom)
    const loadFailed = useAtomValue(accountLoadFailedAtom)
    const phase = accountPhase({ loaded: account.loaded, signedIn: account.signedIn, hasKey: account.hasKey, lastResult: lastSync })
    // the own picture needs no account: it stays on this device (profile-picture.ts)
    return <View className="gap-6">
        <ProfilePicture t={t} />
        {phase === "loading" && loadFailed ? <LoadFailed t={t} />
            : phase === "loading" ? <Muted className="px-1 text-[15px]">{t("Loading…", "Wird geladen …")}</Muted>
                : phase === "signed-out" ? <SignedOut t={t} />
                    : phase === "needs-key" ? <ApproveOnPhone t={t} />
                        : <Overview t={t} />}
    </View>
}

/** The own profile picture: shown in the More panel's head instead of AniList's; nothing is sent to AniList */
function ProfilePicture({ t }: { t: Translate }) {
    const user = useCurrentUser()
    const viewer = user && !user.isSimulated ? user.viewer : undefined
    const avatar = useProfileAvatar(viewer?.avatar?.large || viewer?.avatar?.medium || null)
    const own = useHasProfilePicture()
    const setPicture = useSetAtom(profilePictureAtom)
    const [busy, setBusy] = React.useState(false)

    async function change() {
        setBusy(true)
        try {
            const name = await pickProfilePicture()
            if (!name) return
            setPicture(name)
            removeProfilePictures(name)
        }
        catch {
            toast.error(t("Couldn't use this photo. Try another one.", "Dieses Foto ließ sich nicht verwenden. Versuch ein anderes."))
        }
        finally {
            setBusy(false)
        }
    }

    function remove() {
        setPicture(RESET)
        removeProfilePictures()
    }

    return <View className="flex-row items-center gap-4 px-1">
        {/* the same action as "Change picture" below, so screen readers skip it */}
        <Pressable onPress={() => void change()} disabled={busy} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
            className="rounded-full active:opacity-80">
            {avatar
                ? <Image source={avatar} accessibilityIgnoresInvertColors style={{ width: 80, height: 80, borderRadius: 40 }} contentFit="cover" />
                : (
                    <View className="h-20 w-20 items-center justify-center rounded-full bg-sm-surface-raised">
                        <UserRound size={36} color={colors.smTextSubtle} />
                    </View>
                )}
        </Pressable>
        <View className="min-w-0 flex-1 gap-1">
            <Text className="text-[17px] font-semibold text-sm-text">{t("Profile picture", "Profilbild")}</Text>
            <Muted className="text-[13px] leading-[18px]">
                {t("Shown in the menu on this device. Your AniList picture stays as it is.", "Erscheint im Menü auf diesem Gerät. Dein AniList-Bild bleibt, wie es ist.")}
            </Muted>
            <View className="-ml-2 flex-row flex-wrap">
                <TextAction label={t("Change picture", "Bild ändern")} disabled={busy} onPress={() => void change()} />
                {own && <TextAction label={t("Remove picture", "Bild entfernen")} disabled={busy} onPress={remove} />}
            </View>
        </View>
    </View>
}

/** The secured storage could not be read at start; without this the screen said "Loading…" for good */
function LoadFailed({ t }: { t: Translate }) {
    const [busy, setBusy] = React.useState(false)
    return <SettingsGroup title={t("Couldn't load your account", "Konto konnte nicht geladen werden")}
        note={t("This device's secure storage didn't answer. Your data on this device is fine.", "Der sichere Speicher dieses Geräts hat nicht geantwortet. Deine Daten auf diesem Gerät sind in Ordnung.")}>
        <LinkRow label={busy ? t("Loading…", "Wird geladen …") : t("Try again", "Nochmal versuchen")} tone="accent" disabled={busy} chevron={false}
            note={t("Reads this device's secure storage once more.", "Liest den sicheren Speicher dieses Geräts noch einmal.")}
            onPress={() => {
                setBusy(true)
                void retryAccountLoad().finally(() => setBusy(false))
            }} />
    </SettingsGroup>
}

/* ---- Signed out ---- */

function SignedOut({ t }: { t: Translate }) {
    const [step, setStep] = React.useState<"welcome" | "create" | "signin" | "code">("welcome")
    // the address typed on the password form goes along to the code form
    const [codeEmail, setCodeEmail] = React.useState("")
    const notice = useAtomValue(keyNoticeAtom)
    if (step === "create") return <CredentialsForm t={t} mode="create" onBack={() => setStep("welcome")} />
    if (step === "signin") return <CredentialsForm t={t} mode="signin" onBack={() => setStep("welcome")} onCode={email => {
        setCodeEmail(email)
        setStep("code")
    }} />
    if (step === "code") return <CodeSignIn t={t} initialEmail={codeEmail} onBack={() => setStep("signin")} />
    return <View className="gap-6">
        {/* a warning, not a section: no group of its own, so it never becomes a jump chip */}
        {notice === "removed" && <Notice text={t("This device was removed from your account on another device or on the website, so its key was deleted here. The data on this device stays. Sign in again to ask for access.",
            "Dieses Gerät wurde auf einem anderen Gerät oder auf der Website aus deinem Konto entfernt, deshalb wurde sein Schlüssel hier gelöscht. Die Daten auf diesem Gerät bleiben. Melde dich neu an, um wieder Zugang anzufragen.")} />}
        <SettingsGroup title={t("Sync between your devices", "Zwischen deinen Geräten synchronisieren")}
            note={t("Settings, extensions, playlists and watch history go to your account, encrypted on this device. Only your devices can read them, not even we can. An account is optional.",
                "Einstellungen, Erweiterungen, Playlists und Verlauf gehen verschlüsselt in dein Konto. Lesen können sie nur deine Geräte, nicht einmal wir. Ein Konto ist freiwillig.")}>
            <LinkRow label={t("Create account", "Konto erstellen")} tone="accent" note={t("New here? Sign up with your email and a password.", "Neu hier? Registriere dich mit E-Mail und Passwort.")} onPress={() => setStep("create")} />
            <LinkRow label={t("Sign in", "Anmelden")} note={t("Already have an account? Use your password or a code from your email.", "Schon ein Konto? Mit Passwort oder einem Code aus deiner E-Mail.")} onPress={() => setStep("signin")} />
        </SettingsGroup>
    </View>
}

function CredentialsForm({ t, mode, onBack, onCode }: { t: Translate, mode: "create" | "signin", onBack: () => void, onCode?: (email: string) => void }) {
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [repeat, setRepeat] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    // S5: the sign-in waits for the link in a mail; the same device signs in again after the user opened it
    const [mailLink, setMailLink] = React.useState(false)
    const create = mode === "create"
    // Settings stays mounted under the next page: the field lets go of the keyboard then (page-focus.ts)
    const emailRef = React.useRef<TextInputInstance>(null)
    useReleaseFocusOnLeave(emailRef)
    const strength = passwordStrength(password, email)
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    const ready = emailOk && (create ? strength >= 2 && repeat === password : password.length > 0) && !busy

    async function submit() {
        if (!ready) return
        setBusy(true)
        setError(null)
        try {
            if (create) await createAccount(email, password)
            else await signIn(email, password)
        }
        catch (failure) {
            setMailLink((failure as Error | null)?.name === "MailConfirmationError")
            setError(accountErrorText(t, failure, "sign-in"))
            setBusy(false)
        }
    }

    return <View className="gap-6">
        <SettingsGroup title={create ? t("Create account", "Konto erstellen") : t("Sign in", "Anmelden")}
            note={create
                ? t("You need this password on every new device. Lose it and all your devices, and the synced data is gone. A recovery code helps; you can save one next.",
                    "Dieses Passwort brauchst du auf jedem neuen Gerät. Sind Passwort und alle Geräte weg, sind die synchronisierten Daten weg. Ein Wiederherstellungscode hilft, du kannst gleich danach einen speichern.")
                : undefined}>
            <View className="gap-2 bg-sm-surface px-0 py-1">
                <TextInput {...accentInput} ref={emailRef} value={email} onChangeText={setEmail} placeholder={t("Email", "E-Mail")} placeholderTextColor={colors.smTextSubtle}
                    accessibilityLabel={t("Email", "E-Mail")} autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    keyboardType="email-address" returnKeyType="next" className={FIELD} />
                <PasswordField t={t} value={password} onChangeText={setPassword} label={t("Password", "Passwort")} newPassword={create}
                    returnKeyType={create ? "next" : "go"} onSubmitEditing={create ? undefined : () => void submit()} />
                {create && <StrengthMeter t={t} score={strength} />}
                {create && <RepeatField t={t} label={t("Repeat password", "Passwort wiederholen")} password={password} value={repeat} onChangeText={setRepeat} onSubmitEditing={() => void submit()} />}
                {!!error && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
            </View>
        </SettingsGroup>
        <Button intent="primary" disabled={!ready} loading={busy} onPress={() => void submit()}>
            {create ? t("Create account", "Konto erstellen") : mailLink ? t("Continue", "Weiter") : t("Sign in", "Anmelden")}
        </Button>
        {!create && <SettingsGroup title={t("Other ways in", "Andere Wege")}>
            {onCode && <LinkRow label={t("Sign in with a code instead", "Stattdessen mit Code anmelden")} disabled={busy}
                note={t("We email you a 6-digit code. You don't need your password for it.", "Wir schicken dir einen 6-stelligen Code per E-Mail. Dein Passwort brauchst du dafür nicht.")}
                onPress={() => onCode(email.trim())} />}
            <LinkRow label={t("Forgot password", "Passwort vergessen")} disabled={busy}
                note={t("Opens the reset page on seanimemobile.com in your browser.", "Öffnet die Seite zum Zurücksetzen auf seanimemobile.com im Browser.")}
                onPress={() => openTab(RESET_PAGE)} />
        </SettingsGroup>}
        <Button intent="text" disabled={busy} onPress={onBack}>{t("Back", "Zurück")}</Button>
    </View>
}

const EMPTY_CODE = Array.from({ length: CODE_LENGTH }, () => "")

/**
 * Sign-in with a code: the email, then the 6-digit code from the mail in six boxes (a pasted code spreads over them, a
 * whole one signs in at once). Without "code only" the device then shows the ways to unlock the data (ApproveOnPhone).
 */
function CodeSignIn({ t, initialEmail, onBack }: { t: Translate, initialEmail: string, onBack: () => void }) {
    const [email, setEmail] = React.useState(initialEmail)
    const [sentTo, setSentTo] = React.useState<string | null>(null)
    const [sentAt, setSentAt] = React.useState<number | null>(null)
    const [now, setNow] = React.useState(Date.now)
    const [digits, setDigits] = React.useState(EMPTY_CODE)
    const [busy, setBusy] = React.useState<"send" | "check" | null>(null)
    // the error itself, worded at render (a language change words it anew)
    const [failure, setFailure] = React.useState<unknown>(null)
    const emailRef = React.useRef<TextInputInstance>(null)
    const boxes = React.useRef<(TextInputInstance | null)[]>([])
    useReleaseFocusOnLeave(emailRef)
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    const wait = resendWait(sentAt, now)
    const waiting = wait > 0
    const code = codeOf(digits)

    React.useEffect(() => {
        if (!waiting) return
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [waiting])

    async function send() {
        if (!emailOk || busy || waiting) return
        setBusy("send")
        setFailure(null)
        try {
            await sendSignInCode(email)
            const at = Date.now()
            setSentTo(email.trim())
            setSentAt(at)
            setNow(at)
            setDigits(EMPTY_CODE)
            setTimeout(() => boxes.current[0]?.focus(), 50)
        }
        catch (error) {
            setFailure(error)
        }
        finally {
            setBusy(null)
        }
    }

    async function check(value: string) {
        if (!sentTo || busy) return
        setBusy("check")
        setFailure(null)
        try {
            // on success the account screen moves on (ready, or the ways to unlock the data)
            await signInWithCode(sentTo, value)
        }
        catch (error) {
            setFailure(error)
            setDigits(EMPTY_CODE)
            setBusy(null)
            setTimeout(() => boxes.current[0]?.focus(), 50)
        }
    }

    function edit(change: CodeEdit) {
        setDigits(change.digits)
        setFailure(null)
        boxes.current[change.focus]?.focus()
        const whole = codeOf(change.digits)
        if (whole) void check(whole)
    }

    if (sentTo === null) return <View className="gap-6">
        <SettingsGroup title={t("Sign in with a code", "Mit Code anmelden")}
            note={t("We email you a 6-digit code. You don't need your password for it.", "Wir schicken dir einen 6-stelligen Code per E-Mail. Dein Passwort brauchst du dafür nicht.")}>
            <View className="gap-2 bg-sm-surface px-0 py-1">
                <TextInput {...accentInput} ref={emailRef} value={email} onChangeText={setEmail} placeholder={t("Email", "E-Mail")} placeholderTextColor={colors.smTextSubtle}
                    accessibilityLabel={t("Email", "E-Mail")} autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    keyboardType="email-address" returnKeyType="send" onSubmitEditing={() => void send()} className={FIELD} />
                {failure !== null && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">{accountErrorText(t, failure, "code")}</Text>}
            </View>
        </SettingsGroup>
        <Button intent="primary" disabled={!emailOk || waiting} loading={busy === "send"} onPress={() => void send()}>
            {waiting ? t(`Send code in ${wait} s`, `Code senden in ${wait} s`) : t("Send code", "Code senden")}
        </Button>
        <Button intent="text" disabled={!!busy} onPress={onBack}>{t("Back", "Zurück")}</Button>
    </View>

    return <View className="gap-6">
        <SettingsGroup title={t("Enter the code", "Code eingeben")}
            note={t(`We sent a 6-digit code to ${sentTo}. It works for 10 minutes.`, `Wir haben einen 6-stelligen Code an ${sentTo} geschickt. Er gilt 10 Minuten.`)}>
            <View className="gap-2 bg-sm-surface px-0 py-1">
                <CodeBoxes t={t} digits={digits} boxes={boxes} disabled={busy === "check"} invalid={failure !== null} onEdit={edit} />
                {failure !== null && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">{accountErrorText(t, failure, "code")}</Text>}
            </View>
        </SettingsGroup>
        <Button intent="primary" disabled={!code} loading={busy === "check"} onPress={() => code && void check(code)}>{t("Sign in", "Anmelden")}</Button>
        <SettingsGroup title={t("No code?", "Kein Code da?")}>
            <LinkRow label={busy === "send" ? t("Sending…", "Wird gesendet …") : t("Send a new code", "Neuen Code senden")} chevron={false}
                value={waiting ? t(`in ${wait} s`, `in ${wait} s`) : undefined} disabled={waiting || !!busy}
                note={t("Check your spam folder first. You can ask again after a short wait.", "Schau zuerst im Spam-Ordner nach. Nach kurzer Wartezeit kannst du neu anfragen.")}
                onPress={() => void send()} />
            <LinkRow label={t("Use another email", "Andere E-Mail nutzen")} disabled={!!busy}
                note={t("Go back and type a different address.", "Zurück, um eine andere Adresse einzugeben.")}
                onPress={() => {
                    setSentTo(null)
                    setFailure(null)
                    setDigits(EMPTY_CODE)
                }} />
        </SettingsGroup>
    </View>
}

/**
 * Six boxes, one digit each, on the number pad. The phone's keyboard can fill the code from the mail (oneTimeCode /
 * sms-otp on the first box); a paste anywhere spreads over the boxes (account-view.ts typeInCode). A tablet gets larger
 * boxes, never stretched over the whole pane.
 */
function CodeBoxes({ t, digits, boxes, disabled, invalid, onEdit }: {
    t: Translate
    digits: string[]
    boxes: React.RefObject<(TextInputInstance | null)[]>
    disabled: boolean
    invalid: boolean
    onEdit: (change: CodeEdit) => void
}) {
    const { isTablet } = useTabletLayout()
    // all six let go of the keyboard when the page is left (RN blurs only the focused one)
    const allBoxes = React.useRef({ blur: () => boxes.current.forEach(box => box?.blur()) })
    useReleaseFocusOnLeave(allBoxes)
    return <View accessibilityLabel={t("Sign-in code", "Anmeldecode")} className="w-full flex-row gap-2" style={{ maxWidth: isTablet ? 440 : 380 }}>
        {digits.map((digit, index) => <TextInput {...accentInput} key={index} ref={box => {
            boxes.current[index] = box
        }} value={digit} editable={!disabled} onChangeText={text => onEdit(typeInCode(digits, index, text))}
            onKeyPress={event => {
                if (event.nativeEvent.key === "Backspace") onEdit(backspaceInCode(digits, index))
            }}
            keyboardType="number-pad" inputMode="numeric" textContentType="oneTimeCode" autoComplete={index === 0 ? "sms-otp" : "off"} autoCorrect={false}
            selectTextOnFocus caretHidden accessibilityLabel={t(`Digit ${index + 1} of 6`, `Ziffer ${index + 1} von 6`)}
            className={cn("min-w-0 flex-1 rounded-surface bg-sm-surface-raised text-center font-sans font-semibold text-sm-text", isTablet ? "h-16 text-[26px]" : "h-14 text-[22px]",
                invalid && "border-2 border-sm-danger")} />)}
    </View>
}

function StrengthMeter({ t, score }: { t: Translate, score: 0 | 1 | 2 | 3 | 4 }) {
    const tone = score <= 1 ? "bg-sm-danger" : score === 2 ? "bg-sm-warning" : "bg-brand-500"
    return <View className="gap-1.5 px-1" accessibilityLabel={strengthLabel(t, score)}>
        <View className="flex-row gap-1">
            {[1, 2, 3, 4].map(step => <View key={step} className={cn("h-1 flex-1 rounded-full", step <= score ? tone : "bg-sm-surface-control")} />)}
        </View>
        <Text className="text-[13px] leading-[19.5px] text-sm-text-muted">{strengthLabel(t, score)}</Text>
    </View>
}

/** A password field with a Show / Hide button, so a typo can be seen before it locks the user out */
function PasswordField({ t, value, onChangeText, label, newPassword, returnKeyType, onSubmitEditing, invalid }: {
    t: Translate
    value: string
    onChangeText: (value: string) => void
    label: string
    newPassword?: boolean
    returnKeyType?: "next" | "go" | "done"
    onSubmitEditing?: () => void
    invalid?: boolean
}) {
    const [shown, setShown] = React.useState(false)
    const Icon = shown ? EyeOff : Eye
    const ref = React.useRef<TextInputInstance>(null)
    useReleaseFocusOnLeave(ref)
    return <View className="justify-center">
        <TextInput {...accentInput} ref={ref} value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
            autoCapitalize="none" autoCorrect={false} secureTextEntry={!shown} autoComplete={newPassword ? "new-password" : "current-password"}
            textContentType={newPassword ? "newPassword" : "password"} returnKeyType={returnKeyType} onSubmitEditing={onSubmitEditing}
            className={cn(FIELD, "pr-14", invalid && "border-2 border-sm-danger")} />
        <Pressable accessibilityRole="button" accessibilityLabel={shown ? t("Hide password", "Passwort verbergen") : t("Show password", "Passwort zeigen")}
            onPress={() => setShown(value => !value)} className="absolute right-1 h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
            <Icon size={20} color={colors.smTextMuted} />
        </Pressable>
    </View>
}

/** The new password a second time; says so as soon as the two differ */
function RepeatField({ t, label, password, value, onChangeText, onSubmitEditing }: {
    t: Translate
    label: string
    password: string
    value: string
    onChangeText: (value: string) => void
    onSubmitEditing?: () => void
}) {
    const mismatch = repeatMismatch(password, value)
    return <>
        <PasswordField t={t} value={value} onChangeText={onChangeText} label={label} newPassword
            returnKeyType="done" onSubmitEditing={onSubmitEditing} invalid={mismatch} />
        {mismatch && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">{t("The passwords don't match.", "Die Passwörter stimmen nicht überein.")}</Text>}
    </>
}

/* ---- New device without the key ---- */

function ApproveOnPhone({ t }: { t: Translate }) {
    const account = useAtomValue(accountAtom)
    const notice = useAtomValue(keyNoticeAtom)
    const [attempt, setAttempt] = React.useState(0)
    const [status, setStatus] = React.useState<"asking" | "waiting" | "compare" | "confirmed" | "mismatch" | "denied" | "expired" | "failed">("asking")
    const [sas, setSas] = React.useState<string | null>(null)
    // the error itself, worded at render: a language change neither keeps an old text nor starts a new request
    const [failure, setFailure] = React.useState<unknown>(null)
    const [sheet, setSheet] = React.useState<"recovery" | "fresh" | "signout" | null>(null)
    const [answering, setAnswering] = React.useState(false)
    // a code sign-in starts fresh without the password; a new one is offered right after
    const askPassword = account.kind === "email" && !signedInWithCode()
    const pendingRef = React.useRef<PendingApproval | null>(null)
    // S1: "No" stops the polling at once; this request is over, "Ask again" makes a new one
    const pauseRef = React.useRef<() => void>(() => undefined)

    React.useEffect(() => {
        const attemptRun = startApprovalAttempt({
            ask: askForApproval,
            progress: approvalProgress,
            // before a number was shown there is nothing to answer: the request is only denied on the server
            end: pending => pending.shown ? answerNumber(pending, false) : denyApproval(pending.id),
            wait: (ms, run) => {
                const timer = setTimeout(run, ms)
                return () => clearTimeout(timer)
            },
            onPending: pending => {
                pendingRef.current = pending
            },
            onProgress: progress => {
                if (progress.state === "approved") return void approvalDone()
                if (progress.state === "denied" || progress.state === "expired") return setStatus(progress.state)
                if (progress.state === "compare") {
                    setSas(progress.sas)
                    // NEU-1: the key is taken only after the user said here that both devices show the same number
                    setStatus(progress.confirmed ? "confirmed" : "compare")
                }
                else setStatus("waiting")
            },
            onError: error => {
                setFailure(error)
                setStatus("failed")
            },
        })
        pauseRef.current = attemptRun.pause
        return attemptRun.stop
    }, [attempt])

    async function answer(same: boolean) {
        const pending = pendingRef.current
        if (!pending || answering) return
        if (!same) pauseRef.current()
        setAnswering(true)
        try {
            const progress = await answerNumber(pending, same)
            if (!same) return setStatus("mismatch")
            if (progress.state === "approved") return void approvalDone()
            if (progress.state === "denied" || progress.state === "expired") setStatus(progress.state)
            else if (progress.state === "compare" && progress.confirmed) setStatus("confirmed")
        }
        catch (error) {
            setFailure(error)
            setStatus("failed")
        }
        finally {
            setAnswering(false)
        }
    }

    const ended = status === "mismatch" || status === "denied" || status === "expired" || status === "failed"
    const statusText = status === "mismatch" ? t("Numbers didn't match. This could be an attack. Nothing was shared, and this request is over.",
        "Die Zahlen passten nicht. Das könnte ein Angriff sein. Nichts wurde geteilt, diese Anfrage ist beendet.")
        : status === "denied" ? t("The request was denied.", "Die Anfrage wurde abgelehnt.")
        : status === "expired" ? t("The request expired.", "Die Anfrage ist abgelaufen.")
            : status === "failed" ? accountErrorText(t, failure)
                : status === "compare" ? t("Does your other device show the same number?", "Zeigt dein anderes Gerät dieselbe Zahl?")
                    : status === "confirmed" ? t("Now approve on your other device.", "Gib jetzt auf deinem anderen Gerät frei.")
                        : t("Waiting for your other device…", "Warte auf dein anderes Gerät …")

    return <View className="gap-6">
        <NoScreenshots id="account-approve-here" />
        {notice === "key-changed" && <Notice text={t("Your account's key changed. Since this device last synced, the account switched to a key none of your devices vouched for. That happens after Start fresh on another device, or when someone tries to get in. Nothing was imported or uploaded. If you didn't start fresh, don't approve this device and change your password.",
            "Der Schlüssel deines Kontos hat sich geändert. Seit dieses Gerät zuletzt synchronisiert hat, nutzt das Konto einen Schlüssel, den keines deiner Geräte bestätigt hat. Das passiert nach Neu anfangen auf einem anderen Gerät oder wenn jemand reinzukommen versucht. Nichts wurde importiert oder hochgeladen. Wenn du nicht neu angefangen hast, gib dieses Gerät nicht frei und ändere dein Passwort.")} />}
        <SettingsGroup title={t("Approve on your phone", "Auf deinem Handy freigeben")}
            note={t("Open Seanime Mobile on a device that is already signed in. It asks if this device may sign in.",
                "Öffne Seanime Mobile auf einem Gerät, das schon angemeldet ist. Es fragt, ob dieses Gerät sich anmelden darf.")}>
            <View className="items-center gap-2 bg-sm-surface-raised px-4 py-6">
                <Text accessibilityLabel={sas ? sas.split("").join(" ") : undefined}
                    className={cn("text-[34px] font-bold tracking-[3px]", (!sas || ended) && "text-sm-text-subtle")}>{sas ? formatSas(sas) : "··· ···"}</Text>
                <Text accessibilityRole={ended ? "alert" : undefined}
                    className={cn("text-center text-[15px] leading-[23px]", status === "mismatch" ? "text-sm-danger" : "text-sm-text-muted")}>{statusText}</Text>
            </View>
            {status === "compare" && <View className="flex-row gap-2 bg-sm-surface px-4 py-3">
                <Button intent="secondary" wrapperClassName="flex-1" disabled={answering} onPress={() => void answer(false)}>{t("No, different", "Nein, andere")}</Button>
                <Button intent="primary" wrapperClassName="flex-1" loading={answering} onPress={() => void answer(true)}>{t("Yes, same number", "Ja, dieselbe")}</Button>
            </View>}
            {ended && <LinkRow label={t("Ask again", "Neu anfragen")} tone="accent"
                note={t("Sends a new request to your other device.", "Schickt eine neue Anfrage an dein anderes Gerät.")} onPress={() => {
                setStatus("asking")
                setSas(null)
                setAttempt(count => count + 1)
            }} />}
        </SettingsGroup>
        {recoveryCodeUsable() && <SettingsGroup title={t("No other device?", "Kein anderes Gerät?")}>
            <LinkRow label={t("Use recovery code", "Wiederherstellungscode nutzen")}
                note={t("Unlock with the 26-character code you saved.", "Entsperre mit dem 26-stelligen Code, den du gespeichert hast.")} onPress={() => setSheet("recovery")} />
        </SettingsGroup>}
        <SettingsGroup title={t("Leave or start over", "Verlassen oder neu anfangen")}>
            <LinkRow label={t("Start fresh", "Neu anfangen")} tone="danger"
                note={t("Deletes the synced data in your account. Only if you have no other device and no recovery code.", "Löscht die synchronisierten Daten im Konto. Nur, wenn du kein anderes Gerät und keinen Code hast.")}
                onPress={() => setSheet("fresh")} />
            <LinkRow label={t("Sign out", "Abmelden")} tone="danger" note={t("The data on this device stays.", "Die Daten auf diesem Gerät bleiben.")} onPress={() => setSheet("signout")} />
        </SettingsGroup>
        <InputSheet t={t} open={sheet === "recovery"} onOpenChange={open => !open && setSheet(null)} title={t("Use recovery code", "Wiederherstellungscode nutzen")}
            text={t("Enter the 26 characters of your recovery code. Spaces don't matter.", "Gib die 26 Zeichen deines Codes ein. Leerzeichen sind egal.")}
            field="code" placeholder="ABCD EFGH …" action={t("Unlock", "Entsperren")} onSubmit={code => unlockWithRecoveryCode(code)} />
        <InputSheet t={t} open={sheet === "fresh"} onOpenChange={open => !open && setSheet(null)} title={t("Start fresh?", "Neu anfangen?")} danger field={askPassword ? "password" : "none"}
            text={t("Your synced data in the account is deleted for good and every other device is signed out. The data on this device stays and becomes the account's new data. Do this only if you have no other device and no recovery code.",
                "Die synchronisierten Daten im Konto werden endgültig gelöscht und alle anderen Geräte abgemeldet. Die Daten auf diesem Gerät bleiben und werden die neuen Daten des Kontos. Mach das nur, wenn du kein anderes Gerät und keinen Code hast.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Start fresh", "Neu anfangen")}
            onSubmit={password => startFreshHere(askPassword ? password : undefined)} />
        <ConfirmSheet open={sheet === "signout"} onOpenChange={open => !open && setSheet(null)} title={t("Sign out?", "Abmelden?")}
            text={t("The data on this device stays.", "Die Daten auf diesem Gerät bleiben.")} action={t("Sign out", "Abmelden")} onConfirm={() => void signOutHere()} />
    </View>
}

/* ---- Signed in ---- */

function Overview({ t }: { t: Translate }) {
    const account = useAtomValue(accountAtom)
    const info = useAtomValue(accountInfoAtom)
    const lastSync = useAtomValue(lastSyncAtom)
    const syncing = useAtomValue(syncingAtom)
    const setImportDismissed = useSetAtom(importDismissedAtom)
    const queryClient = useQueryClient()
    const [now, setNow] = React.useState(Date.now)
    const [sheet, setSheet] = React.useState<"recovery" | "password" | "signout" | "data" | "delete" | "google" | "code-only" | "web-edit" | "new-password" | null>(null)
    const [code, setCode] = React.useState<string | null>(null)
    const passwordOffer = useAtomValue(newPasswordOfferAtom)
    const [codeOnlyBusy, setCodeOnlyBusy] = React.useState(false)
    const [webEditBusy, setWebEditBusy] = React.useState(false)
    // S2: "Change encryption key" with the device list; `off`: a device the user tapped Remove on starts unticked
    const [keySheet, setKeySheet] = React.useState<{ off: string | null } | null>(null)
    // asked only while this device holds a session: signed out, the page shows the sign-in instead and asks nothing
    const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: listDevices, enabled: account.signedIn })
    const language = useAtomValue(appLanguageAtom)

    React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(id)
    }, [])

    async function syncNowPressed() {
        try {
            await syncNow()
            void queryClient.invalidateQueries({ queryKey: DEVICES_KEY })
        }
        catch (error) {
            toast.error(accountErrorText(t, error))
        }
    }

    async function resend() {
        try {
            await resendConfirmation()
            toast.success(t("Sent. Check your inbox.", "Gesendet. Schau in dein Postfach."))
        }
        catch (error) {
            toast.error(accountErrorText(t, error))
        }
    }

    /** "Code only" off at once: the server deletes its copy of the key */
    async function codeOnlyOff() {
        setCodeOnlyBusy(true)
        try {
            await turnOffCodeOnly()
            toast.success(t("Code-only sign-in is off. Your synced data is end-to-end encrypted again.", "Nur-Code-Anmeldung ist aus. Deine synchronisierten Daten sind wieder Ende-zu-Ende-verschlüsselt."))
        }
        catch (error) {
            toast.error(accountErrorText(t, error))
        }
        finally {
            setCodeOnlyBusy(false)
        }
    }

    /** "Edit on the website" off at once: the server locks every unlocked browser */
    async function webEditOff() {
        setWebEditBusy(true)
        try {
            await turnOffWebEdit()
            toast.success(t("Edit on the website is off. Any unlocked browser is locked again.", "Auf der Website bearbeiten ist aus. Jeder entsperrte Browser ist wieder gesperrt."))
        }
        catch (error) {
            toast.error(accountErrorText(t, error))
        }
        finally {
            setWebEditBusy(false)
        }
    }

    const renewal = info?.recoveryRenewalNeeded || lastSync?.recoveryRenewalNeeded
    const syncNote = syncNoteFor(t, lastSync?.state)
    // M-4, S4: a removed or signed-out device may still know the old key until the user changes it
    const keyChangePending = (info?.rotationRequired || lastSync?.rotationRequired) && lastSync?.state !== "key-untrusted"
    const shortDate = (seconds: number) => accountDate(language, seconds)

    return <View className="gap-6">
        {/* prompts, not sections: no group of their own, so they never become jump chips */}
        {passwordOffer && <Notice text={t("You signed in with a code. Set a new password now if you forgot the old one. Your other devices stay signed in.",
            "Du hast dich mit einem Code angemeldet. Leg jetzt ein neues Passwort fest, falls du das alte vergessen hast. Deine anderen Geräte bleiben angemeldet.")}>
            <TextAction label={t("Set a new password", "Neues Passwort festlegen")} onPress={() => setSheet("new-password")} />
            <TextAction label={t("Not now", "Jetzt nicht")} onPress={skipNewPassword} />
        </Notice>}
        {info && !info.emailVerified && <Notice text={t(`Confirm your email. We sent a link to ${info.email}. Nothing is blocked until then; unconfirmed accounts are deleted after 7 days.`,
            `Bestätige deine E-Mail. Wir haben einen Link an ${info.email} geschickt. Bis dahin ist nichts gesperrt; unbestätigte Konten werden nach 7 Tagen gelöscht.`)}>
            <TextAction label={t("Resend email", "E-Mail erneut senden")} onPress={() => void resend()} />
        </Notice>}

        <SettingsGroup title={t("Sync", "Synchronisierung")}
            note={t("Settings, extensions, playlists and watch history stay the same on all your devices.", "Einstellungen, Erweiterungen, Playlists und Verlauf bleiben auf allen deinen Geräten gleich.")}>
            {!!account.email && <InfoRow label={t("Signed in as", "Angemeldet als")} note={account.email} />}
            {lastSync?.state === "import-available" && <LinkRow label={t("Import your settings", "Einstellungen importieren")} tone="accent"
                note={t("Your account has data from another device. Bring it to this one.", "Dein Konto hat Daten von einem anderen Gerät. Hol sie auf dieses.")} onPress={() => setImportDismissed(false)} />}
            {/* the status under the action, not beside it: as a value it took 55 % of the row, and in Russian the label broke
                mid-word ("Синхронизирова/ть") while the status was cut ("Синхронизировано 5 м…") */}
            <LinkRow label={syncing ? t("Syncing…", "Wird synchronisiert …") : t("Sync now", "Jetzt synchronisieren")} disabled={syncing} tone={syncing ? undefined : "accent"}
                note={[syncedAgo(t, account.lastSyncAt, Math.max(now, account.lastSyncAt ?? 0)), syncNote].filter(Boolean).join("\n")} chevron={false}
                onPress={() => void syncNowPressed()} />
            {/* the device keeps its old key: it joins again only through a new sign-in (password, recovery code or approval) */}
            {(lastSync?.state === "key-untrusted" || lastSync?.state === "key-changed") && <LinkRow label={t("Sign out to join again", "Abmelden, um wieder reinzukommen")}
                tone="accent" note={t("The data on this device stays. Then sign in again.", "Die Daten auf diesem Gerät bleiben. Danach meldest du dich neu an.")} onPress={() => setSheet("signout")} />}
        </SettingsGroup>

        <SettingsGroup title={t("Devices", "Geräte")} note={t("Only the devices you keep get a new key. Removing a device or leaving it out signs it out for good, so it can't read anything new.",
            "Nur die Geräte, die du behältst, bekommen einen neuen Schlüssel. Ein entferntes oder weggelassenes Gerät ist endgültig abgemeldet und kann nichts Neues mehr lesen.")}>
            {devices.data?.map(device => <LinkRow key={device.id} label={device.name} tone={device.verified && !device.signedOut ? undefined : "danger"}
                note={!device.verified
                    ? t("Not added by one of your devices. Remove it if you don't know it.", "Nicht von einem deiner Geräte hinzugefügt. Entferne es, wenn du es nicht kennst.")
                    : device.signedOut ? t(`Signed out on ${shortDate(device.signedOutAt!)}. It gets no new key.`, `Abgemeldet am ${shortDate(device.signedOutAt!)}. Es bekommt keinen neuen Schlüssel.`)
                        : device.current ? t("This device", "Dieses Gerät") : t(`Last seen ${shortDate(device.lastSeenAt)}`, `Zuletzt ${shortDate(device.lastSeenAt)}`)}
                value={device.current ? undefined : t("Remove", "Entfernen")} chevron={!device.current} disabled={device.current} onPress={() => setKeySheet({ off: device.id })} />)}
            {devices.isError && <LinkRow label={t("Couldn't load the devices", "Geräte konnten nicht geladen werden")} note={accountErrorText(t, devices.error)}
                value={devices.isFetching ? t("Loading…", "Wird geladen …") : t("Try again", "Erneut versuchen")} chevron={false} disabled={devices.isFetching}
                onPress={() => void devices.refetch()} />}
            {devices.isPending && !devices.isError && <InfoRow label={t("Loading…", "Wird geladen …")} />}
            <LinkRow label={t("Change encryption key", "Schlüssel wechseln")} tone={keyChangePending ? "accent" : undefined}
                note={keyChangePending
                    ? t("A device was removed or signed out. Until you change the key, it may still read what you sync.", "Ein Gerät wurde entfernt oder abgemeldet. Bis du den Schlüssel wechselst, kann es noch lesen, was du synchronisierst.")
                    : t("Pick the devices that keep access. All others are removed.", "Wähle die Geräte, die Zugang behalten. Alle anderen werden entfernt.")}
                // the sheet needs the device list: without it the row waits (the Loading / Retry row above says why)
                disabled={!devices.data} onPress={() => devices.data && setKeySheet({ off: null })} />
        </SettingsGroup>

        {!!info?.events?.length && <SettingsGroup title={t("Security events", "Sicherheitsereignisse")}
            note={t("Each one was also sent to your email.", "Jedes ging auch an deine E-Mail.")}>
            {/* NEU4-5: all of them; the server sends the newest 20 and the newest of each kind, so none can be pushed out */}
            {info.events.map((event, index) => <InfoRow key={`${event.at}-${index}`} label={eventText(t, event)} value={shortDate(event.at)} />)}
        </SettingsGroup>}

        <SettingsGroup title={t("Sign-in and access", "Anmeldung und Zugriff")}>
            <LinkRow label={info?.hasRecovery && !renewal ? t("Make a new recovery code", "Neuen Wiederherstellungscode erstellen") : t("Save a recovery code", "Wiederherstellungscode speichern")}
                tone={renewal || !info?.hasRecovery ? "accent" : undefined}
                note={renewal ? t("Your recovery code stopped working when a device was removed. Save a new one.", "Dein Code gilt nicht mehr, seit ein Gerät entfernt wurde. Speichere einen neuen.")
                    : info?.hasRecovery ? t("Only needed if you lose all your devices at once. The new code replaces the old one.", "Nur nötig, wenn alle deine Geräte auf einmal weg sind. Der neue Code ersetzt den alten.")
                        : t("Only needed if you lose all your devices at once.", "Nur nötig, wenn alle deine Geräte auf einmal weg sind.")}
                onPress={() => setSheet("recovery")} />
            {account.kind === "email" && <LinkRow label={t("Change password", "Passwort ändern")} note={t("You need your current password. Your other devices are signed out.", "Du brauchst dein aktuelles Passwort. Deine anderen Geräte werden abgemeldet.")} onPress={() => setSheet("password")} />}
            {account.kind === "email" && info?.googleLinked && <LinkRow label={t("Disconnect Google", "Google trennen")}
                note={t("Google sign-in is linked to this account. After this you sign in with email and password.", "Google-Anmeldung ist mit diesem Konto verknüpft. Danach meldest du dich mit E-Mail und Passwort an.")} onPress={() => setSheet("google")} />}
            {/* opt-in: on, the server holds the key; turning it on asks for the password, turning it off is immediate */}
            {account.kind === "email" && info?.hasPassword && <LocalSwitch label={t("Sign in with an email code only", "Nur mit E-Mail-Code anmelden")}
                note={t("Seanime can then read your synced data. Off keeps it end-to-end encrypted.", "Seanime kann deine synchronisierten Daten dann lesen. Aus bleiben sie Ende-zu-Ende-verschlüsselt.")}
                checked={info.codeOnly === true} disabled={codeOnlyBusy}
                onCheckedChange={checked => checked ? setSheet("code-only") : void codeOnlyOff()} />}
            {/* opt-in, off by default: turning it on asks for the password (or a recent Google sign-in), turning it off is immediate */}
            {info && <LocalSwitch label={t("Edit on the website", "Auf der Website bearbeiten")}
                note={t("Unlock and change your settings at seanimemobile.com. Off keeps the key on your devices only.",
                    "Entsperre und ändere deine Einstellungen auf seanimemobile.com. Aus bleibt der Schlüssel nur auf deinen Geräten.")}
                checked={info.webEdit === true} disabled={webEditBusy}
                onCheckedChange={checked => checked ? setSheet("web-edit") : void webEditOff()} />}
        </SettingsGroup>

        <SettingsGroup title={t("Sign out or delete", "Abmelden oder löschen")}>
            <LinkRow label={t("Sign out", "Abmelden")} tone="danger" note={t("The data on this device stays. Sync stops until you sign in again.", "Die Daten auf diesem Gerät bleiben. Die Synchronisierung stoppt, bis du dich wieder anmeldest.")} onPress={() => setSheet("signout")} />
            <LinkRow label={t("Delete synced data", "Synchronisierte Daten löschen")} tone="danger"
                note={t("Deletes the encrypted copy in your account. Your devices keep their data.", "Löscht die verschlüsselte Kopie im Konto. Deine Geräte behalten ihre Daten.")} onPress={() => setSheet("data")} />
            <LinkRow label={t("Delete account", "Konto löschen")} tone="danger"
                note={t("Deletes your account, its devices and the synced data for good.", "Löscht Konto, Geräte und synchronisierte Daten endgültig.")} onPress={() => setSheet("delete")} />
        </SettingsGroup>

        <InputSheet t={t} open={sheet === "recovery"} onOpenChange={open => !open && setSheet(null)} title={t("Save a recovery code", "Code speichern")}
            text={t("Enter your password. The code is shown once; keep it somewhere safe, like a password manager.", "Gib dein Passwort ein. Der Code wird einmal gezeigt; heb ihn sicher auf, z. B. im Passwortmanager.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Show code", "Code zeigen")} onSubmit={async password => setCode(await newRecoveryCode(password))} />
        <RecoveryCodeSheet t={t} code={code} onDone={() => setCode(null)} />
        <ChangePasswordSheet t={t} open={sheet === "password"} onOpenChange={open => !open && setSheet(null)} email={account.email ?? ""} />
        <ConfirmSheet open={sheet === "signout"} onOpenChange={open => !open && setSheet(null)} title={t("Sign out?", "Abmelden?")}
            text={t("The data on this device stays. Sync stops until you sign in again.", "Die Daten auf diesem Gerät bleiben. Die Synchronisierung stoppt, bis du dich wieder anmeldest.")}
            action={t("Sign out", "Abmelden")} onConfirm={() => void signOutHere().catch(error => toast.error(accountErrorText(t, error)))} />
        <ConfirmSheet open={sheet === "data"} onOpenChange={open => !open && setSheet(null)} title={t("Delete synced data?", "Synchronisierte Daten löschen?")} danger
            text={t("The encrypted copy in your account is deleted. Your devices keep their data, and this one uploads again at the next sync. Sign out first if you want sync to stop.",
                "Die verschlüsselte Kopie im Konto wird gelöscht. Deine Geräte behalten ihre Daten, und dieses lädt beim nächsten Sync neu hoch. Melde dich vorher ab, wenn der Sync aufhören soll.")}
            action={t("Delete", "Löschen")} onConfirm={() => void deleteSyncedData().then(() => toast.success(t("Synced data deleted.", "Synchronisierte Daten gelöscht.")), error => toast.error(accountErrorText(t, error)))} />
        <InputSheet t={t} open={sheet === "delete"} onOpenChange={open => !open && setSheet(null)} title={t("Delete account?", "Konto löschen?")} danger field={account.kind === "email" ? "password" : "none"}
            text={t("Your account, its devices and the synced data are deleted for good. The data on this device stays.", "Konto, Geräte und synchronisierte Daten werden endgültig gelöscht. Die Daten auf diesem Gerät bleiben.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Delete account", "Konto löschen")}
            onSubmit={async password => {
                await deleteWholeAccount(password)
                toast.success(t("Account deleted.", "Konto gelöscht."))
            }} />
        {keySheet && devices.data && <ChangeKeySheet t={t} devices={devices.data} off={keySheet.off} password={account.kind === "email"}
            onClose={() => setKeySheet(null)}
            onSubmit={async (keep, password) => {
                await changeEncryptionKey(keep, account.kind === "email" ? password : undefined)
                void queryClient.invalidateQueries({ queryKey: DEVICES_KEY })
                toast.success(t("Done. Only the devices you kept can read what you sync from now on.", "Fertig. Nur die behaltenen Geräte können ab jetzt lesen, was du synchronisierst."))
            }} />}
        <InputSheet t={t} open={sheet === "google"} onOpenChange={open => !open && setSheet(null)} title={t("Disconnect Google?", "Google trennen?")} danger
            text={t("Google can't be used to sign in to this account any more. You sign in with your email and password.", "Google kann danach nicht mehr zum Anmelden genutzt werden. Du meldest dich mit E-Mail und Passwort an.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Disconnect", "Trennen")}
            onSubmit={async password => {
                await disconnectGoogle(password)
                toast.success(t("Google disconnected.", "Google getrennt."))
            }} />
        <InputSheet t={t} open={sheet === "code-only"} onOpenChange={open => !open && setSheet(null)} title={t("Sign in with a code only?", "Nur mit Code anmelden?")} danger
            text={t("Seanime's server gets the key to your synced data and can read it: settings, history, playlists, extensions and their keys. A code from your email is then enough to get everything on a new device, without your password or another device. Anyone who gets into your email can read your synced data too. You can turn it off any time; the server's copy of the key is deleted at once.",
                "Der Server von Seanime bekommt den Schlüssel zu deinen synchronisierten Daten und kann sie lesen: Einstellungen, Verlauf, Playlists, Erweiterungen und ihre Schlüssel. Ein Code aus deiner E-Mail reicht dann, um auf einem neuen Gerät alles zu bekommen, ohne Passwort und ohne anderes Gerät. Wer in dein E-Mail-Postfach kommt, kann deine synchronisierten Daten dann auch lesen. Du kannst es jederzeit ausschalten; die Kopie des Schlüssels auf dem Server wird dann sofort gelöscht.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Turn on", "Einschalten")}
            onSubmit={async password => {
                await turnOnCodeOnly(password)
                toast.success(t("Code-only sign-in is on.", "Nur-Code-Anmeldung ist an."))
            }} />
        <InputSheet t={t} open={sheet === "web-edit"} onOpenChange={open => !open && setSheet(null)} title={t("Edit on the website?", "Auf der Website bearbeiten?")}
            field={info?.hasPassword ? "password" : "none"}
            text={t("Once you unlock your settings at seanimemobile.com, your browser holds the key to your synced data while you edit, in memory only. You get an email each time. Turn this off and every unlocked browser is locked again at once.",
                "Sobald du deine Einstellungen auf seanimemobile.com entsperrst, hält dein Browser den Schlüssel zu deinen synchronisierten Daten, solange du bearbeitest, nur im Arbeitsspeicher. Du bekommst jedes Mal eine E-Mail. Schaltest du es aus, ist jeder entsperrte Browser sofort wieder gesperrt.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Turn on", "Einschalten")}
            onSubmit={async password => {
                await turnOnWebEdit(info?.hasPassword ? password : undefined)
                toast.success(t("Edit on the website is on.", "Auf der Website bearbeiten ist an."))
            }} />
        <NewPasswordSheet t={t} open={sheet === "new-password"} onOpenChange={open => !open && setSheet(null)} email={account.email ?? info?.email ?? ""} googleLinked={!!info?.googleLinked} />
    </View>
}

/** "Set a new password" after a code sign-in: no current password, only the new one twice */
function NewPasswordSheet({ t, open, onOpenChange, email, googleLinked }: { t: Translate, open: boolean, onOpenChange: (open: boolean) => void, email: string, googleLinked: boolean }) {
    const [next, setNext] = React.useState("")
    const [repeat, setRepeat] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const strength = passwordStrength(next, email)
    const ready = strength >= 2 && repeat === next
    const close = () => {
        setNext("")
        setRepeat("")
        setError(null)
        onOpenChange(false)
    }
    async function submit() {
        if (busy || !ready) return
        setBusy(true)
        setError(null)
        try {
            await setNewPassword(next)
            toast.success(t("New password set.", "Neues Passwort festgelegt."))
            close()
        }
        catch (failure) {
            // the server allows it only within 15 minutes of the code sign-in
            setError((failure as { code?: string } | null)?.code === "reauth_required"
                ? t("This works only within 15 minutes of signing in with a code. Sign out, then sign in with a new code.", "Das geht nur innerhalb von 15 Minuten nach der Anmeldung mit Code. Melde dich ab und dann mit einem neuen Code an.")
                : accountErrorText(t, failure))
        }
        finally {
            setBusy(false)
        }
    }
    return <Sheet title={t("Set a new password", "Neues Passwort festlegen")} open={open} onOpenChange={value => !busy && !value && close()}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={close}>{t("Cancel", "Abbrechen")}</Button>
            <Button intent="primary" wrapperClassName="flex-1" disabled={!ready} loading={busy} onPress={() => void submit()}>{t("Save", "Speichern")}</Button>
        </>}>
        <View className="gap-3">
            <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                {t("You need this password on every new device, unless you sign in with a code.", "Dieses Passwort brauchst du auf jedem neuen Gerät, außer du meldest dich mit einem Code an.")}
                {googleLinked ? ` ${t("Google sign-in is removed from the account.", "Die Google-Anmeldung wird vom Konto entfernt.")}` : ""}
            </Text>
            <PasswordField t={t} value={next} onChangeText={setNext} label={t(`New password (${MIN_PASSWORD_LENGTH}+ characters)`, `Neues Passwort (${MIN_PASSWORD_LENGTH}+ Zeichen)`)}
                newPassword returnKeyType="next" />
            <StrengthMeter t={t} score={strength} />
            <RepeatField t={t} label={t("Repeat new password", "Neues Passwort wiederholen")} password={next} value={repeat} onChangeText={setRepeat} onSubmitEditing={() => void submit()} />
            {!!error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
        </View>
    </Sheet>
}

/**
 * S2: "Change encryption key". Ticked devices keep access and get the new key; every other device is removed in the same
 * step. Pre-ticked: devices one of yours added and that are still signed in. Unverified and signed-out devices can't be
 * kept; this device always keeps it.
 */
function ChangeKeySheet({ t, devices, off, password, onClose, onSubmit }: {
    t: Translate
    devices: CheckedDevice[]
    /** A device the user tapped Remove on: unticked at the start */
    off: string | null
    password: boolean
    onClose: () => void
    onSubmit: (keep: string[], password: string) => Promise<unknown>
}) {
    const [keep, setKeep] = React.useState(() => new Set(devices.filter(device => device.current || device.keepByDefault && device.id !== off).map(device => device.id)))
    const [value, setValue] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const leaving = devices.filter(device => !keep.has(device.id))
    async function submit() {
        if (busy || (password && !value)) return
        setBusy(true)
        setError(null)
        try {
            await onSubmit([...keep], value)
            onClose()
        }
        catch (failure) {
            setError(accountErrorText(t, failure))
        }
        finally {
            setBusy(false)
        }
    }
    return <Sheet title={t("Change encryption key", "Schlüssel wechseln")} open onOpenChange={next => !busy && !next && onClose()}
        // stacked, each button the sheet's full width: side by side, "Удалить 1 устройство" or "Remover 1 dispositivo" is wider
        // than half a phone's sheet, and the button's single line cuts it with an ellipsis; stacked always, so the footer does
        // not jump while devices are ticked
        footer={<View className="flex-1 gap-2">
            <Button intent={leaving.length > 0 ? "danger" : "primary"} disabled={password && !value} loading={busy} onPress={() => void submit()}>
                {leaving.length > 0 ? plural(t, leaving.length, ["Remove 1 device", "Remove {0} devices"], ["1 Gerät entfernen", "{0} Geräte entfernen"]) : t("Change key", "Wechseln")}
            </Button>
            <Button intent="secondary" disabled={busy} onPress={onClose}>{t("Cancel", "Abbrechen")}</Button>
        </View>}>
        <View className="gap-3">
            <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                {t("Your data gets a new key. Only the ticked devices get it; the others are removed and can't read anything you sync from now on.",
                    "Deine Daten bekommen einen neuen Schlüssel. Nur die angehakten Geräte bekommen ihn; die anderen werden entfernt und können ab jetzt nichts mehr lesen, was du synchronisierst.")}
            </Text>
            <View className="gap-0.5">
                {devices.map(device => <LocalSwitch key={device.id} label={device.name} checked={keep.has(device.id)}
                    disabled={busy || device.current || !device.keepByDefault}
                    note={device.current ? t("This device", "Dieses Gerät")
                        : !device.verified ? t("Not added by one of your devices", "Nicht von einem deiner Geräte hinzugefügt")
                            : device.signedOut ? t("Signed out", "Abgemeldet") : undefined}
                    onCheckedChange={checked => setKeep(current => {
                        const next = new Set(current)
                        if (checked) next.add(device.id)
                        else next.delete(device.id)
                        return next
                    })} />)}
            </View>
            {password && <TextInput {...accentInput} value={value} onChangeText={setValue} placeholder={t("Your password", "Dein Passwort")} placeholderTextColor={colors.smTextSubtle}
                accessibilityLabel={t("Your password", "Dein Passwort")} autoCapitalize="none" autoCorrect={false} secureTextEntry autoComplete="current-password"
                returnKeyType="done" onSubmitEditing={() => void submit()} className={cn(FIELD, !!error && "border-2 border-sm-danger")} />}
            {!!error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
        </View>
    </Sheet>
}

function syncNoteFor(t: Translate, state: string | undefined): string | undefined {
    switch (state) {
        case "key-changed": return t("This device no longer gets the account's key. To join again, sign out and sign in with your password, your recovery code or an approval from another device.",
            "Dieses Gerät bekommt den Schlüssel des Kontos nicht mehr. Um wieder reinzukommen, melde dich ab und neu an, mit deinem Passwort, deinem Wiederherstellungscode oder einer Freigabe von einem anderen Gerät.")
        case "key-untrusted": return t("Sync stopped: the account's key changed, and none of your devices vouched for it. That happens after Start fresh on another device, when this device missed more than one key change, or when someone tries to get in. Nothing was imported or uploaded. To join again, sign out and sign in with your password, your recovery code or an approval from another device.",
            "Sync gestoppt: Der Schlüssel des Kontos wurde gewechselt, ohne dass eines deiner Geräte das bestätigt hat. Das passiert nach Neu anfangen auf einem anderen Gerät, wenn dieses Gerät mehr als einen Schlüsselwechsel verpasst hat, oder wenn jemand reinzukommen versucht. Nichts wurde importiert oder hochgeladen. Um wieder reinzukommen, melde dich ab und neu an, mit deinem Passwort, deinem Wiederherstellungscode oder einer Freigabe von einem anderen Gerät.")
        case "rate-limited": return t("Paused for a moment, too many syncs.", "Kurz pausiert, zu viele Syncs.")
        case "rollback-rejected": return t("The server sent older data than this device knows. Nothing was changed.", "Der Server schickte ältere Daten, als dieses Gerät kennt. Nichts wurde geändert.")
        default: return undefined
    }
}

/* ---- Sheets ---- */

/** One field (password or code), a sentence above, the action; errors stay in the sheet */
function InputSheet({ t, open, onOpenChange, title, text, placeholder, action, danger, field = "password", onSubmit }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    text: string
    placeholder: string
    action: string
    danger?: boolean
    /** "none": no field (Google accounts give no password) */
    field?: "password" | "code" | "none"
    onSubmit: (value: string) => Promise<unknown>
}) {
    const [value, setValue] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const close = () => {
        setValue("")
        setError(null)
        onOpenChange(false)
    }
    const hasField = field !== "none"
    const secure = field === "password"
    async function submit() {
        if (busy || (hasField && !value)) return
        setBusy(true)
        setError(null)
        try {
            await onSubmit(value)
            close()
        }
        catch (failure) {
            setError(accountErrorText(t, failure))
        }
        finally {
            setBusy(false)
        }
    }
    return <Sheet title={title} open={open} onOpenChange={next => !busy && !next && close()}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={close}>{t("Cancel", "Abbrechen")}</Button>
            <Button intent={danger ? "danger" : "primary"} wrapperClassName="flex-1" disabled={hasField && !value} loading={busy} onPress={() => void submit()}>{action}</Button>
        </>}>
        <View className="gap-3">
            <Text className="text-[15px] leading-[23px] text-sm-text-muted">{text}</Text>
            {hasField && <TextInput {...accentInput} value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={placeholder}
                autoCapitalize={secure ? "none" : "characters"} autoCorrect={false} secureTextEntry={secure} autoComplete={secure ? "current-password" : "off"}
                returnKeyType="done" onSubmitEditing={() => void submit()} className={cn(FIELD, !!error && "border-2 border-sm-danger")} />}
            {!!error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
        </View>
    </Sheet>
}

function RecoveryCodeSheet({ t, code, onDone }: { t: Translate, code: string | null, onDone: () => void }) {
    const shown = code ? formatRecoveryCode(code) : ""
    return <Sheet title={t("Your recovery code", "Dein Wiederherstellungscode")} open={code !== null} onOpenChange={() => undefined}
        footer={<Button intent="primary" wrapperClassName="flex-1" onPress={onDone}>{t("I saved it", "Gespeichert")}</Button>}>
        {code !== null && <NoScreenshots id="account-recovery-code" />}
        <View className="gap-4">
            <Text selectable className="rounded-surface bg-sm-surface-raised px-4 py-4 text-center font-mono text-[19px] leading-[30px] tracking-[1px]">{shown}</Text>
            <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                {t("It opens your synced data if all your devices are gone. Anyone with the code and your email can read that data. You won't see it again here.",
                    "Er öffnet deine synchronisierten Daten, wenn alle Geräte weg sind. Wer Code und E-Mail hat, kann sie lesen. Hier siehst du ihn nicht noch einmal.")}
            </Text>
            <View className="flex-row gap-2">
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => void copySecretToClipboard(shown).then(() => toast.success(t("Copied. It leaves the clipboard in 60 seconds.", "Kopiert. In 60 Sekunden ist er wieder aus der Zwischenablage.")))}>{t("Copy", "Kopieren")}</Button>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => void Share.share({ message: shown })}>{t("Share", "Teilen")}</Button>
            </View>
        </View>
    </Sheet>
}

function ChangePasswordSheet({ t, open, onOpenChange, email }: { t: Translate, open: boolean, onOpenChange: (open: boolean) => void, email: string }) {
    const [current, setCurrent] = React.useState("")
    const [next, setNext] = React.useState("")
    const [repeat, setRepeat] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const strength = passwordStrength(next, email)
    // a typo here would sign out every other device with a password nobody knows
    const ready = !!current && strength >= 2 && repeat === next
    const close = () => {
        setCurrent("")
        setNext("")
        setRepeat("")
        setError(null)
        onOpenChange(false)
    }
    async function submit() {
        if (busy || !ready) return
        setBusy(true)
        setError(null)
        try {
            await changeAccountPassword(current, next)
            toast.success(t("Password changed.", "Passwort geändert."))
            close()
        }
        catch (failure) {
            setError(accountErrorText(t, failure))
        }
        finally {
            setBusy(false)
        }
    }
    return <Sheet title={t("Change password", "Passwort ändern")} open={open} onOpenChange={value => !busy && !value && close()}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={close}>{t("Cancel", "Abbrechen")}</Button>
            <Button intent="primary" wrapperClassName="flex-1" disabled={!ready} loading={busy} onPress={() => void submit()}>{t("Change", "Ändern")}</Button>
        </>}>
        <View className="gap-3">
            <PasswordField t={t} value={current} onChangeText={setCurrent} label={t("Current password", "Aktuelles Passwort")} returnKeyType="next" />
            <PasswordField t={t} value={next} onChangeText={setNext} label={t(`New password (${MIN_PASSWORD_LENGTH}+ characters)`, `Neues Passwort (${MIN_PASSWORD_LENGTH}+ Zeichen)`)}
                newPassword returnKeyType="next" />
            <StrengthMeter t={t} score={strength} />
            <RepeatField t={t} label={t("Repeat new password", "Neues Passwort wiederholen")} password={next} value={repeat} onChangeText={setRepeat} onSubmitEditing={() => void submit()} />
            {!!error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
        </View>
    </Sheet>
}
