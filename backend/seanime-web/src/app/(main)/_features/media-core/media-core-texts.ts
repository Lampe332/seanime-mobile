import { streamStartError } from "@/app/(main)/_features/native-player/stream-start-error"
import { Translate } from "@/lib/app-language"

/** The server's loading steps (directstream, torrent stream) in the app's language; other texts are shown as they are. */
export function playerLoadingText(state: string, t: Translate) {
    const awaiting = state.match(/^Awaiting stream: (\d+)%$/)
    if (awaiting) return t(state, `Warte auf Stream: ${awaiting[1]} %`)
    switch (state) {
        case "Loading...":
            return t(state, "Wird geladen…")
        case "Opening...":
            return t(state, "Wird geöffnet…")
        case "Loading stream...":
            return t(state, "Stream wird geladen…")
        case "Loading metadata...":
            return t(state, "Metadaten werden geladen…")
        case "Downloading metadata...":
            return t(state, "Metadaten werden heruntergeladen…")
        case "Ending stream...":
            return t(state, "Stream wird beendet…")
    }
    return state
}

/** The <video> element's MediaError codes as the video core reports them ("... (Code: 3)"). */
export function videoElementErrorText(code: number | undefined, t: Translate) {
    switch (code) {
        case 2:
            return t("The connection to the stream was lost.", "Die Verbindung zum Stream ist abgebrochen.")
        case 3:
            return t("This device could not decode the video.", "Dieses Gerät konnte das Video nicht dekodieren.")
        case 4:
            return t("This device can't play this video format.", "Dieses Gerät kann dieses Videoformat nicht abspielen.")
    }
    return t("The video stopped because of an error.", "Das Video wurde wegen eines Fehlers angehalten.")
}

/** German for the player menu's fixed English titles and option labels; the English text stays the menu's internal id. */
const MENU_TEXTS: Record<string, string> = {
    "Small": "Klein", "Medium": "Mittel", "Large": "Groß", "Extra Large": "Sehr groß",
    "White": "Weiß", "Black": "Schwarz", "Gray": "Grau", "Yellow": "Gelb", "Cyan": "Cyan", "Pink": "Pink", "Purple": "Lila", "Lime": "Hellgrün",
    "None": "Keine", "On": "An", "Off": "Aus", "Options": "Optionen",
    "Font Size": "Schriftgröße", "Text Color": "Textfarbe", "Outline": "Kontur", "Shadow": "Schatten", "Background": "Hintergrund",
    "Subtitle Styles": "Untertitel-Stil", "Caption Styles": "Stil der Bildunterschriften", "Subtitle Delay": "Untertitel-Versatz",
    "Playback Speed": "Geschwindigkeit", "Subtitle Translation": "Untertitel-Übersetzung", "Default Languages": "Standardsprachen",
    "Player Appearance": "Player-Darstellung", "Skip Patterns": "Skip-Muster", "Sleep Timer": "Sleep-Timer",
    "Subtitle Blacklist": "Untertitel-Blacklist", "Volume Boost": "Lautstärke-Boost", "Subtitles": "Untertitel", "Audio": "Ton",
    "Highlight Skipped Chapters": "Übersprungene Kapitel hervorheben", "Increase Saturation": "Sättigung erhöhen",
}

export function menuText<T>(text: T, t: Translate): T | string {
    return typeof text === "string" && MENU_TEXTS[text] ? t(text, MENU_TEXTS[text]) : text
}

/** "jpn" → "Japanese"/"Japanisch"; unknown codes stay as they are. */
export function languageName(code: string | undefined, t: Translate) {
    if (!code) return ""
    try {
        const name = new Intl.DisplayNames([t("en", "de")], { type: "language" }).of(code)
        if (name && name.toLowerCase() !== code.toLowerCase()) return name
    } catch { /* not a language code */ }
    return code.toUpperCase()
}

/** A playback error from the server or the video element, in words a phone user can act on. */
export function playerErrorText(error: string, t: Translate) {
    const code = error.match(/^Video playback error occurred\. \(Code: (\d+|unknown)\)$/)
    if (code) return videoElementErrorText(Number(code[1]) || undefined, t)
    return streamStartError(error, t)
}
