import { PlaybackDownloadedMedia, useCurrentDevicePlaybackSettings, useExternalPlayerLink } from "@/app/(main)/_atoms/playback.atoms"
import { PhoneChips, PhoneNotice, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import { SettingsGroup, SettingSwitch, TextSettingRow } from "@/app/(main)/settings/_screens/settings-phone-kit"
import { Translate } from "@/lib/app-language"
import { ANDROID_PLAYER_PRESETS, androidPlayerLink, androidPlayerPresetOf } from "@/lib/external-player-link/android-player-presets"
import React from "react"

/** Playback: the player for downloaded files, the next episode, the external player link (all but the first only on this phone). */
export function SettingsPlaybackSection({ t }: { t: Translate }) {
    const { downloadedMediaPlayback, setDownloadedMediaPlayback } = useCurrentDevicePlaybackSettings()
    const { externalPlayerLink, setExternalPlayerLink, encodePath, setEncodePath } = useExternalPlayerLink()
    const external = downloadedMediaPlayback === PlaybackDownloadedMedia.ExternalPlayerLink
    const preset = androidPlayerPresetOf(externalPlayerLink)

    return <>
        <SettingsGroup id="playback-files" title={t("Files on this device", "Dateien auf diesem Gerät")}
            note={t("How episodes from your local library play. Only on this device.", "Wie Folgen aus deiner lokalen Bibliothek abspielen. Nur auf diesem Gerät.")}>
            <div role="radiogroup" aria-label={t("Player for files", "Player für Dateien")} className="pst-choice-rows" data-settings-file-player>
                <ChoiceRow checked={!external} onSelect={() => setDownloadedMediaPlayback(PlaybackDownloadedMedia.Default)} value="builtin"
                    label={t("Built-in player", "Eingebauter Player")}
                    note={t("Plays in the app with subtitles, progress tracking and skipping.", "Spielt in der App, mit Untertiteln, Fortschritt und Überspringen.")} />
                <ChoiceRow checked={external} onSelect={() => setDownloadedMediaPlayback(PlaybackDownloadedMedia.ExternalPlayerLink)} value="external"
                    label={t("External player", "Externer Player")}
                    note={t("Hands the episode to another app, chosen below.", "Gibt die Folge an eine andere App, unten gewählt.")} />
            </div>
        </SettingsGroup>

        <SettingsGroup id="playback-next" title={t("Next episode", "Nächste Folge")}>
            <SettingSwitch path="library.autoPlayNextEpisode" label={t("Play the next episode automatically", "Nächste Folge automatisch abspielen")}
                note={t("Starts it after a short delay when an episode ends.", "Startet sie kurz nach dem Ende einer Folge.")} />
        </SettingsGroup>

        <SettingsGroup id="playback-external" title={t("External player", "Externer Player")}
            note={t("Used for files when chosen above, and in the episode menu. Only on this device.", "Für Dateien, wenn oben gewählt, und im Folgenmenü. Nur auf diesem Gerät.")}>
            {external && !externalPlayerLink && <PhoneNotice text={t("Choose a player app first.", "Wähle zuerst eine Player-App.")} data-settings-external-missing />}
            <PhoneChips label={t("Player app", "Player-App")} variant="wrap" showCheck className="pst-chips" data-settings-external-presets
                chips={ANDROID_PLAYER_PRESETS.map(item => ({ value: item.packageName, label: item.name }))}
                selected={preset ? [preset.packageName] : []} onToggle={packageName => setExternalPlayerLink(androidPlayerLink(packageName))} />
            <TextSettingRow t={t} label={t("Player link", "Player-Link")} value={externalPlayerLink} empty={t("Not set", "Nicht gesetzt")}
                display={value => androidPlayerPresetOf(value)?.name ?? value} placeholder="intent://{url}#Intent;…;end"
                note={t("For another app: its link scheme with {url} for the stream, e.g. outplayer://{url}.",
                    "Für eine andere App: ihr Link-Schema mit {url} für den Stream, z. B. outplayer://{url}.")}
                onApply={value => setExternalPlayerLink(value.trim())} data-settings-external-link />
            <PhoneSwitch label={t("Encode the file path", "Dateipfad kodieren")} checked={encodePath} onChange={setEncodePath} data-settings-encode-path
                note={t("Library files only. Helps with special characters in file names.", "Nur Bibliotheksdateien. Hilft bei Sonderzeichen in Dateinamen.")} />
        </SettingsGroup>
    </>
}

function ChoiceRow({ checked, onSelect, label, note, value }: { checked: boolean, onSelect: () => void, label: string, note: string, value: string }) {
    return <button type="button" role="radio" aria-checked={checked} className="pst-choice" onClick={onSelect} data-choice={value}>
        <span className="pst-radio" aria-hidden />
        <span className="pst-row-text"><span>{label}</span><small>{note}</small></span>
    </button>
}
