import { PickRow, Choices, Notice } from "@/components/shared/phone-kit"
import { type Translate } from "@/lib/app-language"
import { ANDROID_PLAYER_PRESETS, androidPlayerLink, androidPlayerPresetOf } from "@/lib/external-player-link/android-player-presets"
import { PlaybackDownloadedMedia, useCurrentDevicePlaybackSettings, useExternalPlayerLink } from "@/main/_atoms/playback.atoms"
import { vc_autoNextAtom } from "@/main/_features/video-core/video-core.atoms"
import { ChoiceRows, LocalSwitch, SettingsGroup, TextSettingRow } from "@/main/settings/_components/settings-kit"
import { useAtom } from "jotai"
import { View } from "react-native"

/** Playback (settings-phone-playback.tsx): the player for files, the next episode, the external player (all on this device). */
export function SettingsPlaybackSection({ t }: { t: Translate }) {
    const { downloadedMediaPlayback, setDownloadedMediaPlayback } = useCurrentDevicePlaybackSettings()
    const { externalPlayerLink, setExternalPlayerLink, encodePath, setEncodePath } = useExternalPlayerLink()
    const external = downloadedMediaPlayback === PlaybackDownloadedMedia.ExternalPlayerLink
    const preset = androidPlayerPresetOf(externalPlayerLink)
    // The app's player reads this per-device switch (Auto next in its menu); library.autoPlayNextEpisode is only read by
    // desktop players (settings audit 11c43d3: the two disagreed and episodes went on although the row said off)
    const [autoNext, setAutoNext] = useAtom(vc_autoNextAtom)

    return <>
        <SettingsGroup title={t("Files on this device", "Dateien auf diesem Gerät")}
            note={t("How episodes from your local library play. Only on this device.", "Wie Folgen aus deiner lokalen Bibliothek abspielen. Nur auf diesem Gerät.")}>
            <ChoiceRows label={t("Player for files", "Player für Dateien")}>
                <PickRow radio checked={!external} onPress={() => setDownloadedMediaPlayback(PlaybackDownloadedMedia.Default)}
                    label={t("Built-in player", "Eingebauter Player")}
                    note={t("Plays in the app with subtitles, progress tracking and skipping.", "Spielt in der App, mit Untertiteln, Fortschritt und Überspringen.")} />
                <PickRow radio checked={external} onPress={() => setDownloadedMediaPlayback(PlaybackDownloadedMedia.ExternalPlayerLink)}
                    label={t("External player", "Externer Player")}
                    note={t("Hands the episode to another app, chosen below.", "Gibt die Folge an eine andere App, unten gewählt.")} />
            </ChoiceRows>
        </SettingsGroup>

        <SettingsGroup title={t("Next episode", "Nächste Folge")}>
            <LocalSwitch label={t("Play the next episode automatically", "Nächste Folge automatisch abspielen")} checked={autoNext} onCheckedChange={setAutoNext}
                note={t("Starts 5 seconds after an episode ends. Same switch as Auto next in the player menu.",
                    "Startet 5 Sekunden nach dem Ende einer Folge. Derselbe Schalter wie „Nächste Folge automatisch“ im Player-Menü.")} />
        </SettingsGroup>

        <SettingsGroup title={t("External player", "Externer Player")}
            note={t("Used for files when chosen above, and in the episode menu. Only on this device.", "Für Dateien, wenn oben gewählt, und im Folgenmenü. Nur auf diesem Gerät.")}>
            {external && !externalPlayerLink && <Notice text={t("Choose a player app first.", "Wähle zuerst eine Player-App.")} />}
            <View className="bg-sm-surface-raised px-4 py-3">
                <Choices label={t("Player app", "Player-App")} showCheck onRaised
                    chips={ANDROID_PLAYER_PRESETS.map(item => ({ value: item.packageName, label: item.name }))}
                    selected={preset ? [preset.packageName] : []} onToggle={packageName => setExternalPlayerLink(androidPlayerLink(packageName))} />
            </View>
            <TextSettingRow label={t("Player link", "Player-Link")} value={externalPlayerLink} empty={t("Not set", "Nicht gesetzt")}
                display={value => androidPlayerPresetOf(value)?.name ?? value} placeholder="intent://{url}#Intent;…;end"
                note={t("For another app: its link scheme with {url} for the stream, e.g. outplayer://{url}.",
                    "Für eine andere App: ihr Link-Schema mit {url} für den Stream, z. B. outplayer://{url}.")}
                onApply={value => setExternalPlayerLink(value.trim())} />
            <LocalSwitch label={t("Encode the file path", "Dateipfad kodieren")} checked={encodePath} onCheckedChange={setEncodePath}
                note={t("Library files only. Helps with special characters in file names.", "Nur Bibliotheksdateien. Hilft bei Sonderzeichen in Dateinamen.")} />
        </SettingsGroup>
    </>
}
