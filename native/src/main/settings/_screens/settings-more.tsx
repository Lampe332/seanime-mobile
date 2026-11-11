import { useListMangaProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useNakamaReconnectToHost } from "@/api/hooks/nakama.hooks"
import { Notice } from "@/components/shared/phone-kit"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate } from "@/lib/app-language"
import { useNakamaStatus } from "@/main/_features/nakama/nakama-manager"
import { useStoredMangaProviders } from "@/main/manga/_lib/handle-manga-selected-provider"
import {
    ConfirmSheet,
    LinkRow,
    SelectRow,
    SettingsGroup,
    SettingSwitch,
    TextSettingRow,
    useSaveSetting,
    useSettingValue,
} from "@/main/settings/_components/settings-kit"
import { PickFolderButton } from "@/main/settings/_components/pick-folder"
import { atom, useAtom } from "jotai"
import React from "react"

/* Online streaming, Manga and Nakama (settings-phone-more.tsx) */

export function SettingsOnlinestreamSection({ t }: { t: Translate }) {
    return <SettingsGroup title={t("Online streaming", "Online-Streaming")}>
        <SettingSwitch path="library.enableOnlinestream" label={t("Online streaming", "Online-Streaming")}
            note={t("Watch episodes from online sources (streaming extensions).", "Folgen aus Online-Quellen schauen (Streaming-Erweiterungen).")} />
        <SettingSwitch path="library.includeOnlineStreamingInLibrary" label={t("Streaming titles in your anime lists", "Streaming-Titel in deinen Anime-Listen")}
            note={t("Shows the titles you are watching online in your anime lists.", "Zeigt online geschaute Titel in deinen Anime-Listen.")} />
    </SettingsGroup>
}

/** Sources before "Use … for every manga", for Undo while the app runs (as on the desktop page). */
const storedProvidersHistoryAtom = atom<Record<string, string> | null>(null)

export function SettingsMangaSection({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const defaultProvider = useSettingValue("manga.defaultMangaProvider", "")
    const localDirectory = useSettingValue("manga.mangaLocalSourceDirectory", "")
    const { data: extensions } = useListMangaProviderExtensions()
    const { storedProviders, overwriteStoredProviders, overwriteStoredProvidersWith } = useStoredMangaProviders(extensions)
    const [history, setHistory] = useAtom(storedProvidersHistoryAtom)
    const [confirm, setConfirm] = React.useState(false)
    const defaultExtension = extensions?.find(extension => extension.id === defaultProvider)
    const options = [
        { value: "-", label: t("Automatic", "Automatisch") },
        ...(extensions ?? []).map(extension => ({ value: extension.id, label: extension.name })).sort((a, b) => a.label.localeCompare(b.label)),
    ]

    return <>
        <SettingsGroup title={t("Manga", "Manga")}>
            <SettingSwitch path="library.enableManga" label={t("Manga", "Manga")}
                note={t("Read manga, download chapters and track your progress.", "Manga lesen, Kapitel laden und Fortschritt speichern.")} />
            <SettingSwitch path="manga.mangaAutoUpdateProgress" label={t("Update progress automatically", "Fortschritt automatisch speichern")}
                note={t("Saves your progress when you reach the end of a chapter.", "Speichert den Fortschritt am Ende eines Kapitels.")} />
        </SettingsGroup>

        <SettingsGroup title={t("Source", "Quelle")}>
            <SelectRow label={t("Default source", "Standardquelle")} value={defaultProvider || "-"} options={options}
                note={t("Chosen when you open a manga for the first time.", "Wird gewählt, wenn du einen Manga zum ersten Mal öffnest.")}
                onChange={value => void save("manga.defaultMangaProvider", value === "-" ? "" : value)} />
            {!!defaultExtension && <LinkRow label={t(`Use ${defaultExtension.name} for every manga`, `${defaultExtension.name} für jeden Manga nutzen`)}
                note={t("Replaces the source you chose for each manga you opened.", "Ersetzt die Quelle, die du für jeden geöffneten Manga gewählt hast.")}
                onPress={() => setConfirm(true)} />}
            {!!history && <LinkRow label={t("Undo: restore the previous sources", "Rückgängig: vorige Quellen wiederherstellen")}
                onPress={() => {
                    overwriteStoredProviders(history)
                    setHistory(null)
                    toast.success(t("The previous sources are back.", "Die vorigen Quellen sind wiederhergestellt."))
                }} />}
        </SettingsGroup>
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Replace all sources?", "Alle Quellen ersetzen?")}
            text={t(`Every manga you opened will use ${defaultExtension?.name}. You can undo this until the app closes.`,
                `Jeder geöffnete Manga nutzt dann ${defaultExtension?.name}. Bis die App geschlossen wird, lässt sich das rückgängig machen.`)}
            action={t("Replace", "Ersetzen")}
            onConfirm={() => {
                if (!defaultExtension) return
                // a copy: the stored record is replaced, not changed in place (Hermes has structuredClone only on newer versions)
                const previous = { ...storedProviders }
                overwriteStoredProvidersWith(defaultExtension.id)
                setHistory(previous)
                toast.success(t("All sources replaced.", "Alle Quellen ersetzt."))
            }} />

        <SettingsGroup title={t("Local manga", "Lokale Manga")}
            note={t("For the local source: a folder with your manga on this device.", "Für die lokale Quelle: ein Ordner mit deinen Manga auf diesem Gerät.")}>
            <TextSettingRow label={t("Manga folder", "Manga-Ordner")} value={localDirectory} empty={t("Not set", "Nicht gesetzt")}
                placeholder="/storage/emulated/0/Manga" extra={setDraft => <PickFolderButton t={t} onPicked={setDraft} />}
                onApply={value => void save("manga.mangaLocalSourceDirectory", value.trim())} />
        </SettingsGroup>
    </>
}

/**
 * Nakama as a peer only: the app's server listens on 127.0.0.1, so no one could reach it as a host. The connection row
 * (connected to …, tap to connect again) reads the Nakama status of the Nakama manager (2.13).
 */
export function SettingsNakamaSection({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const username = useSettingValue("nakama.username", "")
    const url = useSettingValue("nakama.remoteServerURL", "")
    const passcode = useSettingValue("nakama.remoteServerPassword", "")
    const isHost = useSettingValue("nakama.isHost", false)
    const enabled = useSettingValue("nakama.enabled", false)
    const notSet = t("Not set", "Nicht gesetzt")

    return <>
        <SettingsGroup title={t("Nakama", "Nakama")}
            note={t("Stream the anime library of Seanime on your PC or home server, or watch together.",
                "Die Anime-Bibliothek von Seanime auf deinem PC oder Home-Server streamen oder gemeinsam schauen.")}>
            <SettingSwitch path="nakama.enabled" label={t("Nakama", "Nakama")} />
            <TextSettingRow label={t("Name", "Name")} value={username} empty={t("Random", "Zufällig")} placeholder={t("Your name", "Dein Name")}
                note={t("How others see you. Empty gives a random ID.", "So sehen dich andere. Leer ergibt eine zufällige ID.")}
                onApply={value => void save("nakama.username", value.trim())} />
        </SettingsGroup>

        <SettingsGroup title={t("Host", "Host")}>
            {isHost && <>
                <Notice text={t("Host mode is on, so this device cannot join a host. Phones and tablets cannot host.",
                    "Der Host-Modus ist an, deshalb kann dieses Gerät keinem Host beitreten. Handys und Tablets können nicht hosten.")} />
                <SettingSwitch path="nakama.isHost" label={t("Host mode", "Host-Modus")} />
            </>}
            <TextSettingRow label={t("Host address", "Host-Adresse")} value={url} empty={notSet} keyboardType="url" placeholder="https://… / room://…"
                note={t("The address of the Nakama host or a room link.", "Die Adresse des Nakama-Hosts oder ein Raum-Link.")}
                onApply={value => void save("nakama.remoteServerURL", value.trim())} />
            <TextSettingRow label={t("Host passcode", "Host-Passwort")} value={passcode} empty={notSet} secure display={() => "••••••"}
                onApply={value => void save("nakama.remoteServerPassword", value)} />
            <SettingSwitch path="nakama.includeNakamaAnimeLibrary" disabled={isHost} label={t("Use the host's anime library", "Anime-Bibliothek des Hosts nutzen")}
                note={t("When the host shares it, its anime join your library. Episodes on this device stay.",
                    "Wenn der Host sie teilt, kommen seine Anime zu deiner Bibliothek dazu. Folgen auf diesem Gerät bleiben.")} />
            {enabled && !!url && !isHost && <NakamaConnectionRow t={t} />}
        </SettingsGroup>
    </>
}

/** Whether the phone reached the host; a tap connects again, for example after the host was switched off. */
function NakamaConnectionRow({ t }: { t: Translate }) {
    const status = useNakamaStatus()
    const { mutate: reconnect, isPending } = useNakamaReconnectToHost()
    const connected = !!status?.isConnectedToHost
    const host = status?.hostConnectionStatus?.username
    // The state is the row's title: a value beside a two-line note would be cut off
    const label = isPending ? t("Connecting…", "Verbinde …")
        : connected ? host ? t(`Connected to ${host}`, `Verbunden mit ${host}`) : t("Connected", "Verbunden")
            : t("Not connected", "Nicht verbunden")
    return <LinkRow label={label} disabled={isPending} onPress={() => reconnect({})}
        note={connected ? t("Tap to connect again.", "Tippe, um neu zu verbinden.")
            : t("Check the address, the passcode and that the host is running. Tap to try again.",
                "Prüfe Adresse, Passwort und ob der Host läuft. Tippe für einen neuen Versuch.")} />
}
