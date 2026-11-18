// geschrieben nach: Plan „Account + Sync“ (Abschnitt 2 Nutzer-Erlebnis, 6.1–6.9, 8 UI-Liste) und settings-kit.tsx / backup-group.tsx (Zeilen, Sheets, Felder)

import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import type { CheckedDevice, PendingApproval } from "@/core/account/devices"
import {
    accountAtom, accountInfoAtom, answerNumber, approvalDone, changeEncryptionKey, disconnectGoogle, approvalProgress, askForApproval, changeAccountPassword, createAccount, deleteSyncedData,
    deleteWholeAccount, importDismissedAtom, keyNoticeAtom, lastSyncAtom, listDevices, newRecoveryCode, recoveryCodeUsable, resendConfirmation, signIn, signOutHere,
    startFreshHere, syncingAtom, syncNow, unlockWithRecoveryCode,
} from "@/lib/account/account-app"
import {
    MIN_PASSWORD_LENGTH, accountDate, accountErrorText, accountPhase, eventText, formatRecoveryCode, formatSas, passwordStrength, strengthLabel, syncedAgo,
} from "@/lib/account/account-view"
import { appLanguageAtom, plural, type Translate } from "@/lib/app-language"
import { copySecretToClipboard, openTab } from "@/lib/helpers/browser"
import { colors } from "@/lib/theme/tokens"
import { NoScreenshots } from "@/main/_features/account/account-prompts"
import { ConfirmSheet, LinkRow, LocalSwitch, SettingsGroup } from "@/main/settings/_components/settings-kit"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { Share, TextInput, View } from "react-native"

/*
 * Settings › Account. Signed out: Continue with Google (coming soon), Create account, Sign in. A new device without the
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
    const phase = accountPhase({ loaded: account.loaded, signedIn: account.signedIn, hasKey: account.hasKey, lastResult: lastSync })
    if (phase === "loading") return <Muted className="px-1 text-[15px]">{t("Loading…", "Wird geladen …")}</Muted>
    if (phase === "signed-out") return <SignedOut t={t} />
    if (phase === "needs-key") return <ApproveOnPhone t={t} />
    return <Overview t={t} />
}

/* ---- Signed out ---- */

function SignedOut({ t }: { t: Translate }) {
    const [step, setStep] = React.useState<"welcome" | "create" | "signin">("welcome")
    const notice = useAtomValue(keyNoticeAtom)
    if (step === "create") return <CredentialsForm t={t} mode="create" onBack={() => setStep("welcome")} />
    if (step === "signin") return <CredentialsForm t={t} mode="signin" onBack={() => setStep("welcome")} />
    return <View className="gap-6">
        {notice === "removed" && <SettingsGroup title={t("This device was removed", "Dieses Gerät wurde entfernt")}
            note={t("It was removed from your account on another device or on the website, so its key was deleted here. The data on this device stays. Sign in again to ask for access.",
                "Es wurde auf einem anderen Gerät oder auf der Website aus deinem Konto entfernt, deshalb wurde sein Schlüssel hier gelöscht. Die Daten auf diesem Gerät bleiben. Melde dich neu an, um wieder Zugang anzufragen.")}>
            {null}
        </SettingsGroup>}
        <SettingsGroup title={t("Sync between your devices", "Zwischen deinen Geräten synchronisieren")}
        note={t("Settings, extensions, playlists and watch history go to your account, encrypted on this device. Only your devices can read them, not even we can. An account is optional.",
            "Einstellungen, Erweiterungen, Playlists und Verlauf gehen verschlüsselt in dein Konto. Lesen können sie nur deine Geräte, nicht einmal wir. Ein Konto ist freiwillig.")}>
        <LinkRow label={t("Continue with Google", "Weiter mit Google")} value={t("Coming soon", "Bald")} disabled chevron={false} onPress={() => undefined} />
        <LinkRow label={t("Create account", "Konto erstellen")} tone="accent" note={t("With your email and a password", "Mit E-Mail und Passwort")} onPress={() => setStep("create")} />
        <LinkRow label={t("Sign in", "Anmelden")} onPress={() => setStep("signin")} />
        </SettingsGroup>
    </View>
}

function CredentialsForm({ t, mode, onBack }: { t: Translate, mode: "create" | "signin", onBack: () => void }) {
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    // S5: the sign-in waits for the link in a mail; the same device signs in again after the user opened it
    const [mailLink, setMailLink] = React.useState(false)
    const create = mode === "create"
    const strength = passwordStrength(password, email)
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    const ready = emailOk && (create ? strength >= 2 : password.length > 0) && !busy

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
            setError(accountErrorText(t, failure))
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
                <TextInput value={email} onChangeText={setEmail} placeholder={t("Email", "E-Mail")} placeholderTextColor={colors.smTextSubtle}
                    accessibilityLabel={t("Email", "E-Mail")} autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
                    keyboardType="email-address" returnKeyType="next" className={FIELD} />
                <TextInput value={password} onChangeText={setPassword} placeholder={t("Password", "Passwort")} placeholderTextColor={colors.smTextSubtle}
                    accessibilityLabel={t("Password", "Passwort")} autoCapitalize="none" autoCorrect={false} secureTextEntry
                    autoComplete={create ? "new-password" : "current-password"} textContentType={create ? "newPassword" : "password"}
                    returnKeyType="go" onSubmitEditing={() => void submit()} className={FIELD} />
                {create && <StrengthMeter t={t} score={strength} />}
                {!!error && <Text accessibilityRole="alert" className="px-1 text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
            </View>
        </SettingsGroup>
        <View className="gap-3">
            <Button intent="primary" disabled={!ready} loading={busy} onPress={() => void submit()}>
                {create ? t("Create account", "Konto erstellen") : mailLink ? t("Continue", "Weiter") : t("Sign in", "Anmelden")}
            </Button>
            {!create && <Button intent="text" disabled={busy} onPress={() => openTab(RESET_PAGE)}>{t("Forgot password", "Passwort vergessen")}</Button>}
            <Button intent="text" disabled={busy} onPress={onBack}>{t("Back", "Zurück")}</Button>
        </View>
    </View>
}

function StrengthMeter({ t, score }: { t: Translate, score: 0 | 1 | 2 | 3 | 4 }) {
    const tone = score <= 1 ? "bg-sm-danger" : score === 2 ? "bg-amber-400" : "bg-brand-500"
    return <View className="gap-1.5 px-1" accessibilityLabel={strengthLabel(t, score)}>
        <View className="flex-row gap-1">
            {[1, 2, 3, 4].map(step => <View key={step} className={cn("h-1 flex-1 rounded-full", step <= score ? tone : "bg-sm-surface-control")} />)}
        </View>
        <Text className="text-[13px] leading-[19.5px] text-sm-text-muted">{strengthLabel(t, score)}</Text>
    </View>
}

/* ---- New device without the key ---- */

function ApproveOnPhone({ t }: { t: Translate }) {
    const account = useAtomValue(accountAtom)
    const notice = useAtomValue(keyNoticeAtom)
    const [attempt, setAttempt] = React.useState(0)
    const [status, setStatus] = React.useState<"asking" | "waiting" | "compare" | "confirmed" | "mismatch" | "denied" | "expired" | "failed">("asking")
    const [sas, setSas] = React.useState<string | null>(null)
    const [failure, setFailure] = React.useState<string | null>(null)
    const [sheet, setSheet] = React.useState<"recovery" | "fresh" | "signout" | null>(null)
    const [answering, setAnswering] = React.useState(false)
    const pendingRef = React.useRef<PendingApproval | null>(null)
    // S1: "No" stops the polling at once; this request is over, "Ask again" makes a new one
    const stopRef = React.useRef<() => void>(() => undefined)

    React.useEffect(() => {
        let alive = true
        let timer: ReturnType<typeof setTimeout> | null = null
        stopRef.current = () => {
            alive = false
            if (timer) clearTimeout(timer)
        }
        const poll = async (pending: PendingApproval) => {
            try {
                const progress = await approvalProgress(pending)
                if (!alive) return
                if (progress.state === "approved") return void approvalDone()
                if (progress.state === "denied" || progress.state === "expired") return setStatus(progress.state)
                if (progress.state === "compare") {
                    setSas(progress.sas)
                    // NEU-1: the key is taken only after the user said here that both devices show the same number
                    setStatus(progress.confirmed ? "confirmed" : "compare")
                }
                else setStatus("waiting")
            }
            catch (error) {
                if (alive) {
                    setFailure(accountErrorText(t, error))
                    setStatus("failed")
                }
                return
            }
            timer = setTimeout(() => void poll(pending), 2000)
        }
        void askForApproval().then(pending => {
            pendingRef.current = pending
            if (alive) void poll(pending)
        }, error => {
            if (!alive) return
            setFailure(accountErrorText(t, error))
            setStatus("failed")
        })
        return () => {
            alive = false
            if (timer) clearTimeout(timer)
        }
    }, [attempt, t])

    async function answer(same: boolean) {
        const pending = pendingRef.current
        if (!pending || answering) return
        if (!same) stopRef.current()
        setAnswering(true)
        try {
            const progress = await answerNumber(pending, same)
            if (!same) return setStatus("mismatch")
            if (progress.state === "approved") return void approvalDone()
            if (progress.state === "denied" || progress.state === "expired") setStatus(progress.state)
            else if (progress.state === "compare" && progress.confirmed) setStatus("confirmed")
        }
        catch (error) {
            setFailure(accountErrorText(t, error))
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
            : status === "failed" ? failure ?? ""
                : status === "compare" ? t("Does your other device show the same number?", "Zeigt dein anderes Gerät dieselbe Zahl?")
                    : status === "confirmed" ? t("Now approve on your other device.", "Gib jetzt auf deinem anderen Gerät frei.")
                        : t("Waiting for your other device…", "Warte auf dein anderes Gerät …")

    return <View className="gap-6">
        <NoScreenshots id="account-approve-here" />
        {notice === "key-changed" && <SettingsGroup title={t("Your account's key changed", "Der Schlüssel deines Kontos hat sich geändert")}
            note={t("Since this device last synced, the account switched to a key none of your devices vouched for. That happens after Start fresh on another device, or when someone tries to get in. Nothing was imported or uploaded. If you didn't start fresh, don't approve this device and change your password.",
                "Seit dieses Gerät zuletzt synchronisiert hat, nutzt das Konto einen Schlüssel, den keines deiner Geräte bestätigt hat. Das passiert nach Neu anfangen auf einem anderen Gerät oder wenn jemand reinzukommen versucht. Nichts wurde importiert oder hochgeladen. Wenn du nicht neu angefangen hast, gib dieses Gerät nicht frei und ändere dein Passwort.")}>
            {null}
        </SettingsGroup>}
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
            {ended && <LinkRow label={t("Ask again", "Neu anfragen")} tone="accent" onPress={() => {
                setStatus("asking")
                setSas(null)
                setAttempt(count => count + 1)
            }} />}
        </SettingsGroup>
        <SettingsGroup title={t("No other device?", "Kein anderes Gerät?")}>
            {recoveryCodeUsable() && <LinkRow label={t("Use recovery code", "Wiederherstellungscode nutzen")} onPress={() => setSheet("recovery")} />}
            <LinkRow label={t("Start fresh", "Neu anfangen")} tone="danger" note={t("Deletes the synced data in your account", "Löscht die synchronisierten Daten im Konto")} onPress={() => setSheet("fresh")} />
            <LinkRow label={t("Sign out", "Abmelden")} onPress={() => setSheet("signout")} />
        </SettingsGroup>
        <InputSheet t={t} open={sheet === "recovery"} onOpenChange={open => !open && setSheet(null)} title={t("Use recovery code", "Wiederherstellungscode nutzen")}
            text={t("Enter the 26 characters of your recovery code. Spaces don't matter.", "Gib die 26 Zeichen deines Codes ein. Leerzeichen sind egal.")}
            field="code" placeholder="ABCD EFGH …" action={t("Unlock", "Entsperren")} onSubmit={code => unlockWithRecoveryCode(code)} />
        <InputSheet t={t} open={sheet === "fresh"} onOpenChange={open => !open && setSheet(null)} title={t("Start fresh?", "Neu anfangen?")} danger field={account.kind === "email" ? "password" : "none"}
            text={t("Your synced data in the account is deleted for good and every other device is signed out. The data on this device stays and becomes the account's new data. Do this only if you have no other device and no recovery code.",
                "Die synchronisierten Daten im Konto werden endgültig gelöscht und alle anderen Geräte abgemeldet. Die Daten auf diesem Gerät bleiben und werden die neuen Daten des Kontos. Mach das nur, wenn du kein anderes Gerät und keinen Code hast.")}
            placeholder={t("Your password", "Dein Passwort")} action={t("Start fresh", "Neu anfangen")}
            onSubmit={password => startFreshHere(account.kind === "email" ? password : undefined)} />
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
    const [sheet, setSheet] = React.useState<"recovery" | "password" | "signout" | "data" | "delete" | "google" | null>(null)
    const [code, setCode] = React.useState<string | null>(null)
    // S2: "Change encryption key" with the device list; `off`: a device the user tapped Remove on starts unticked
    const [keySheet, setKeySheet] = React.useState<{ off: string | null } | null>(null)
    const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: listDevices })
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

    const renewal = info?.recoveryRenewalNeeded || lastSync?.recoveryRenewalNeeded
    const syncNote = syncNoteFor(t, lastSync?.state)
    // M-4, S4: a removed or signed-out device may still know the old key until the user changes it
    const keyChangePending = (info?.rotationRequired || lastSync?.rotationRequired) && lastSync?.state !== "key-untrusted"
    const shortDate = (seconds: number) => accountDate(language, seconds)

    return <View className="gap-6">
        {info && !info.emailVerified && <SettingsGroup title={t("Confirm your email", "Bestätige deine E-Mail")}
            note={t(`We sent a link to ${info.email}. Nothing is blocked until then; unconfirmed accounts are deleted after 7 days.`,
                `Wir haben einen Link an ${info.email} geschickt. Bis dahin ist nichts gesperrt; unbestätigte Konten werden nach 7 Tagen gelöscht.`)}>
            <LinkRow label={t("Resend email", "E-Mail erneut senden")} onPress={() => void resend()} />
        </SettingsGroup>}

        <SettingsGroup title={t("Sync", "Synchronisierung")} note={account.email ?? undefined}>
            {lastSync?.state === "import-available" && <LinkRow label={t("Import your settings", "Einstellungen importieren")} tone="accent"
                note={t("Your account has data from another device", "Dein Konto hat Daten von einem anderen Gerät")} onPress={() => setImportDismissed(false)} />}
            <LinkRow label={syncing ? t("Syncing…", "Wird synchronisiert …") : t("Sync now", "Jetzt synchronisieren")} disabled={syncing}
                value={syncedAgo(t, account.lastSyncAt, Math.max(now, account.lastSyncAt ?? 0))} note={syncNote} chevron={false} onPress={() => void syncNowPressed()} />
        </SettingsGroup>

        <SettingsGroup title={t("Devices", "Geräte")} note={t("Only the devices you keep get a new key. Removing a device or leaving it out signs it out for good, so it can't read anything new.",
            "Nur die Geräte, die du behältst, bekommen einen neuen Schlüssel. Ein entferntes oder weggelassenes Gerät ist endgültig abgemeldet und kann nichts Neues mehr lesen.")}>
            {devices.data?.map(device => <LinkRow key={device.id} label={device.name} tone={device.verified && !device.signedOut ? undefined : "danger"}
                note={!device.verified
                    ? t("Not added by one of your devices. Remove it if you don't know it.", "Nicht von einem deiner Geräte hinzugefügt. Entferne es, wenn du es nicht kennst.")
                    : device.signedOut ? t(`Signed out on ${shortDate(device.signedOutAt!)}. It gets no new key.`, `Abgemeldet am ${shortDate(device.signedOutAt!)}. Es bekommt keinen neuen Schlüssel.`)
                        : device.current ? t("This device", "Dieses Gerät") : t(`Last seen ${shortDate(device.lastSeenAt)}`, `Zuletzt ${shortDate(device.lastSeenAt)}`)}
                value={device.current ? undefined : t("Remove", "Entfernen")} chevron={!device.current} disabled={device.current} onPress={() => setKeySheet({ off: device.id })} />)}
            {devices.isError && <LinkRow label={t("Couldn't load the devices", "Geräte konnten nicht geladen werden")} value={t("Retry", "Nochmal")} onPress={() => void devices.refetch()} />}
            {devices.isPending && <LinkRow label={t("Loading…", "Wird geladen …")} chevron={false} disabled onPress={() => undefined} />}
            <LinkRow label={t("Change encryption key", "Schlüssel wechseln")} tone={keyChangePending ? "accent" : undefined}
                note={keyChangePending
                    ? t("A device was removed or signed out. Until you change the key, it may still read what you sync.", "Ein Gerät wurde entfernt oder abgemeldet. Bis du den Schlüssel wechselst, kann es noch lesen, was du synchronisierst.")
                    : t("Pick the devices that keep access. All others are removed.", "Wähle die Geräte, die Zugang behalten. Alle anderen werden entfernt.")}
                onPress={() => setKeySheet({ off: null })} />
        </SettingsGroup>

        {!!info?.events?.length && <SettingsGroup title={t("Security events", "Sicherheitsereignisse")}
            note={t("Each one was also sent to your email.", "Jedes ging auch an deine E-Mail.")}>
            {/* NEU4-5: all of them; the server sends the newest 20 and the newest of each kind, so none can be pushed out */}
            {info.events.map((event, index) => <LinkRow key={`${event.at}-${index}`} label={eventText(t, event)} value={shortDate(event.at)} chevron={false} disabled onPress={() => undefined} />)}
        </SettingsGroup>}

        <SettingsGroup title={t("Recovery code", "Wiederherstellungscode")}
            note={renewal ? t("Your recovery code stopped working when a device was removed. Save a new one.", "Dein Code gilt nicht mehr, seit ein Gerät entfernt wurde. Speichere einen neuen.")
                : t("Only needed if you lose all your devices at once.", "Nur nötig, wenn alle deine Geräte auf einmal weg sind.")}>
            <LinkRow label={info?.hasRecovery && !renewal ? t("Make a new recovery code", "Neuen Code erstellen") : t("Save a recovery code", "Code speichern")}
                tone={renewal || !info?.hasRecovery ? "accent" : undefined}
                note={info?.hasRecovery && !renewal ? t("The new code replaces the old one", "Der neue ersetzt den alten") : undefined} onPress={() => setSheet("recovery")} />
        </SettingsGroup>

        <SettingsGroup title={t("Account", "Konto")}>
            {account.kind === "email" && <LinkRow label={t("Change password", "Passwort ändern")} note={t("Signs out your other devices and disconnects Google", "Meldet deine anderen Geräte ab und trennt Google")} onPress={() => setSheet("password")} />}
            {account.kind === "email" && info?.googleLinked && <LinkRow label={t("Disconnect Google", "Google trennen")}
                note={t("Google sign-in is linked to this account", "Google-Anmeldung ist mit diesem Konto verknüpft")} onPress={() => setSheet("google")} />}
            <LinkRow label={t("Sign out", "Abmelden")} note={t("The data on this device stays", "Die Daten auf diesem Gerät bleiben")} onPress={() => setSheet("signout")} />
            <LinkRow label={t("Delete synced data", "Synchronisierte Daten löschen")} tone="danger" onPress={() => setSheet("data")} />
            <LinkRow label={t("Delete account", "Konto löschen")} tone="danger" onPress={() => setSheet("delete")} />
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
    </View>
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
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={onClose}>{t("Cancel", "Abbrechen")}</Button>
            <Button intent={leaving.length > 0 ? "danger" : "primary"} wrapperClassName="flex-1" disabled={password && !value} loading={busy} onPress={() => void submit()}>
                {leaving.length > 0 ? plural(t, leaving.length, ["Remove 1 device", "Remove {0} devices"], ["1 Gerät entfernen", "{0} Geräte entfernen"]) : t("Change key", "Wechseln")}
            </Button>
        </>}>
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
            {password && <TextInput value={value} onChangeText={setValue} placeholder={t("Your password", "Dein Passwort")} placeholderTextColor={colors.smTextSubtle}
                accessibilityLabel={t("Your password", "Dein Passwort")} autoCapitalize="none" autoCorrect={false} secureTextEntry autoComplete="current-password"
                returnKeyType="done" onSubmitEditing={() => void submit()} className={cn(FIELD, !!error && "border-2 border-sm-danger")} />}
            {!!error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
        </View>
    </Sheet>
}

function syncNoteFor(t: Translate, state: string | undefined): string | undefined {
    switch (state) {
        case "key-changed": return t("This device no longer gets the account's key. It can join again with your password, your recovery code or an approval from another device.",
            "Dieses Gerät bekommt den Schlüssel des Kontos nicht mehr. Es kommt mit deinem Passwort, deinem Wiederherstellungscode oder einer Freigabe von einem anderen Gerät wieder rein.")
        case "key-untrusted": return t("Sync stopped: the account's key changed, and none of your devices vouched for it. That happens after Start fresh on another device, when this device missed more than one key change, or when someone tries to get in. Nothing was imported or uploaded. This device can join again with your password, your recovery code or an approval from another device.",
            "Sync gestoppt: Der Schlüssel des Kontos wurde gewechselt, ohne dass eines deiner Geräte das bestätigt hat. Das passiert nach Neu anfangen auf einem anderen Gerät, wenn dieses Gerät mehr als einen Schlüsselwechsel verpasst hat, oder wenn jemand reinzukommen versucht. Nichts wurde importiert oder hochgeladen. Dieses Gerät kommt mit deinem Passwort, deinem Wiederherstellungscode oder einer Freigabe von einem anderen Gerät wieder rein.")
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
            {hasField && <TextInput value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={placeholder}
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
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const strength = passwordStrength(next, email)
    const close = () => {
        setCurrent("")
        setNext("")
        setError(null)
        onOpenChange(false)
    }
    async function submit() {
        if (busy || !current || strength < 2) return
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
            <Button intent="primary" wrapperClassName="flex-1" disabled={!current || strength < 2} loading={busy} onPress={() => void submit()}>{t("Change", "Ändern")}</Button>
        </>}>
        <View className="gap-3">
            <TextInput value={current} onChangeText={setCurrent} placeholder={t("Current password", "Aktuelles Passwort")} placeholderTextColor={colors.smTextSubtle}
                accessibilityLabel={t("Current password", "Aktuelles Passwort")} autoCapitalize="none" autoCorrect={false} secureTextEntry autoComplete="current-password" className={FIELD} />
            <TextInput value={next} onChangeText={setNext} placeholder={t(`New password (${MIN_PASSWORD_LENGTH}+ characters)`, `Neues Passwort (${MIN_PASSWORD_LENGTH}+ Zeichen)`)}
                placeholderTextColor={colors.smTextSubtle} accessibilityLabel={t("New password", "Neues Passwort")} autoCapitalize="none" autoCorrect={false} secureTextEntry
                autoComplete="new-password" className={FIELD} />
            <StrengthMeter t={t} score={strength} />
            {!!error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{error}</Text>}
        </View>
    </Sheet>
}
