import { Notice } from "@/components/shared/phone-kit"
import { type Translate } from "@/lib/app-language"
import { ANDROID_PLAYER_PRESETS, androidPlayerLink, androidPlayerPresetOf } from "@/lib/external-player-link/android-player-presets"
import { PlaybackDownloadedMedia, useCurrentDevicePlaybackSettings, useExternalPlayerLink } from "@/main/_atoms/playback.atoms"
import { SEEK_STEP_OPTIONS, seekStep, SEEK_BACK_SECONDS, SEEK_FORWARD_SECONDS } from "@/main/_features/player/player-logic"
import { player_seekBackAtom, player_seekForwardAtom } from "@/main/_features/player/player.atoms"
import { vc_autoNextAtom } from "@/main/_features/video-core/video-core.atoms"
import { LocalSwitch, SelectRow, SettingsGroup, TextSettingRow } from "@/main/settings/_components/settings-kit"
import { useAtom } from "jotai"

/** Playback (settings-phone-playback.tsx): the player for files, the next episode, the external player (all on this device). */
export function SettingsPlaybackSection({ t }: { t: Translate }) {
    const { downloadedMediaPlayback, setDownloadedMediaPlayback } = useCurrentDevicePlaybackSettings()
    const { externalPlayerLink, setExternalPlayerLink, encodePath, setEncodePath } = useExternalPlayerLink()
    const external = downloadedMediaPlayback === PlaybackDownloadedMedia.ExternalPlayerLink
    const preset = androidPlayerPresetOf(externalPlayerLink)
    // The app's player reads this per-device switch (Auto next in its menu); library.autoPlayNextEpisode is only read by
    // desktop players (settings audit 11c43d3: the two disagreed and episodes went on although the row said off)
    const [autoNext, setAutoNext] = useAtom(vc_autoNextAtom)
    // "custom" only marks a link typed below; picking it changes nothing
    const playerApp = preset?.packageName ?? (externalPlayerLink ? "custom" : "none")

    return <>
        <SettingsGroup title={t("Files on this device", "Dateien auf diesem Gerät")}
            note={t("How episodes from your local library play. Only on this device.", "Wie Folgen aus deiner lokalen Bibliothek abspielen. Nur auf diesem Gerät.")}>
            <SelectRow label={t("Player for files", "Player für Dateien")}
                value={external ? PlaybackDownloadedMedia.ExternalPlayerLink : PlaybackDownloadedMedia.Default}
                defaultValue={PlaybackDownloadedMedia.Default}
                note={external ? t("Hands the episode to another app, chosen below.", "Gibt die Folge an eine andere App, unten gewählt.")
                    : t("Plays in the app with subtitles, progress tracking and skipping.", "Spielt in der App, mit Untertiteln, Fortschritt und Überspringen.")}
                options={[
                    {
                        value: PlaybackDownloadedMedia.Default, label: t("Built-in player", "Eingebauter Player"),
                        note: t("Plays in the app with subtitles, progress tracking and skipping.", "Spielt in der App, mit Untertiteln, Fortschritt und Überspringen."),
                    },
                    {
                        value: PlaybackDownloadedMedia.ExternalPlayerLink, label: t("External player", "Externer Player"),
                        note: t("Hands the episode to another app, chosen below.", "Gibt die Folge an eine andere App, unten gewählt."),
                    },
                ]}
                onChange={value => setDownloadedMediaPlayback(value as PlaybackDownloadedMedia)} />
        </SettingsGroup>

        <SettingsGroup title={t("Next episode", "Nächste Folge")}>
            <LocalSwitch label={t("Play the next episode automatically", "Nächste Folge automatisch abspielen")} checked={autoNext} onCheckedChange={setAutoNext}
                defaultChecked
                note={t("Starts 5 seconds after an episode ends. Same switch as Auto next in the player menu.",
                    "Startet 5 Sekunden nach dem Ende einer Folge. Derselbe Schalter wie „Nächste Folge automatisch“ im Player-Menü.")} />
        </SettingsGroup>

        <SeekGroup t={t} />

        <SettingsGroup title={t("External player", "Externer Player")}
            note={t("Used for files when chosen above, and in the episode menu. Only on this device.", "Für Dateien, wenn oben gewählt, und im Folgenmenü. Nur auf diesem Gerät.")}
            notice={external && !externalPlayerLink ? <Notice text={t("Choose a player app first.", "Wähle zuerst eine Player-App.")} /> : undefined}>
            <SelectRow label={t("Player app", "Player-App")} value={playerApp} defaultValue="none"
                note={t("The app has to be installed on this device. For any other app, set its link below.",
                    "Die App muss auf diesem Gerät installiert sein. Für eine andere App trägst du unten ihren Link ein.")}
                options={[
                    { value: "none", label: t("None", "Keine"), note: t("Episodes only open in the app's own player.", "Folgen öffnen nur im Player der App.") },
                    ...ANDROID_PLAYER_PRESETS.map(item => ({ value: item.packageName, label: item.name })),
                    ...(playerApp === "custom" ? [{
                        value: "custom", label: t("Own link", "Eigener Link"),
                        note: t("The link set below.", "Der unten eingetragene Link."),
                    }] : []),
                ]}
                onChange={value => {
                    if (value === "custom") return
                    setExternalPlayerLink(value === "none" ? "" : androidPlayerLink(value))
                }} />
            <TextSettingRow label={t("Player link", "Player-Link")} value={externalPlayerLink} empty={t("Not set", "Nicht gesetzt")}
                display={value => androidPlayerPresetOf(value)?.name ?? value} placeholder="intent://{url}#Intent;…;end"
                note={t("For another app: its link scheme with {url} for the stream, e.g. outplayer://{url}.",
                    "Für eine andere App: ihr Link-Schema mit {url} für den Stream, z. B. outplayer://{url}.")}
                onApply={value => setExternalPlayerLink(value.trim())} />
            <LocalSwitch label={t("Encode the file path", "Dateipfad kodieren")} checked={encodePath} onCheckedChange={setEncodePath}
                defaultChecked={false}
                note={t("Library files only. Helps with special characters in file names.", "Nur Bibliotheksdateien. Hilft bei Sonderzeichen in Dateinamen.")} />
        </SettingsGroup>
    </>
}

/** The seek steps of the app's player: centre buttons and double taps (player-logic SEEK_STEP_OPTIONS), only on this device. */
function SeekGroup({ t }: { t: Translate }) {
    const [back, setBack] = useAtom(player_seekBackAtom)
    const [forward, setForward] = useAtom(player_seekForwardAtom)
    const options = SEEK_STEP_OPTIONS.map(seconds => ({ value: String(seconds), label: `${seconds} s` }))
    return <SettingsGroup title={t("Seeking", "Spulen")}
        note={t("For the buttons next to Play and for double taps in the player. Only on this device.",
            "Für die Tasten neben Abspielen und für Doppeltipps im Player. Nur auf diesem Gerät.")}>
        <SelectRow label={t("Back", "Zurück")} value={String(seekStep(back, SEEK_BACK_SECONDS))} options={options}
            note={t("How far one tap jumps back.", "Wie weit ein Tipp zurückspringt.")}
            defaultValue={String(SEEK_BACK_SECONDS)} onChange={value => setBack(Number(value))} />
        <SelectRow label={t("Forward", "Vor")} value={String(seekStep(forward, SEEK_FORWARD_SECONDS))} options={options}
            note={t("How far one tap jumps ahead.", "Wie weit ein Tipp vorspringt.")}
            defaultValue={String(SEEK_FORWARD_SECONDS)} onChange={value => setForward(Number(value))} />
    </SettingsGroup>
}
