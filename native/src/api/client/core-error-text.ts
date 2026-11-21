import { tr } from "@/lib/app-language"
import { compileCatalog, translateText } from "@/lib/i18n/catalog"

/**
 * German for the errors of the core (CoreError, AnilistFailure) that people see most, so a failed request toasts in the
 * app language. scripts/i18n-extract.mjs takes the property names as catalog keys; {0}, {1} stand for the parts the core
 * fills in. Errors not listed here stay English.
 */
const CORE_ERRORS_DE: Record<string, string> = {
    "not logged in to AniList": "Nicht bei AniList angemeldet",
    "AniList could not be reached": "AniList ist nicht erreichbar",
    "AniList's answer could not be read": "Die Antwort von AniList ließ sich nicht lesen",
    "AniList's rate limit is reached": "Das Anfragelimit von AniList ist erreicht",
    "cache-only mode is on, AniList is not asked": "Der Nur-Cache-Modus ist an, AniList wird nicht gefragt",
    "Not Found.": "Nicht gefunden.",
    "extension not found": "Erweiterung nicht gefunden",
    "manga not found": "Manga nicht gefunden",
    "no torrent chosen": "Kein Torrent gewählt",
    "no library folder is set": "Kein Bibliotheksordner festgelegt",
    "downloads are not available here": "Downloads sind hier nicht verfügbar",
    "DLNA is not available here": "DLNA ist hier nicht verfügbar",
    "the secured storage is not available here": "Der sichere Speicher ist hier nicht verfügbar",
    "debrid: the stream was cancelled": "Debrid: Der Stream wurde abgebrochen",
    "the torrent has neither a magnet link nor an info hash, and its provider gave none": "Der Torrent hat weder Magnet-Link noch Info-Hash, und sein Anbieter liefert keinen",
    "no file of the torrent fits episode {0}": "Keine Datei des Torrents passt zu Folge {0}",
    "auto select found no torrent for episode {0} ({1} looked at)": "Die automatische Auswahl fand keinen Torrent für Folge {0} ({1} geprüft)",
    "{0}: no matching entry found, choose one by hand": "{0}: Kein passender Eintrag gefunden, wähle einen von Hand",
    "torrent provider not found: {0}": "Torrent-Anbieter nicht gefunden: {0}",
    "online stream provider not found: {0}": "Online-Stream-Anbieter nicht gefunden: {0}",
    "manga provider not found: {0}": "Manga-Anbieter nicht gefunden: {0}",
    "the torrent stopped: {0}": "Der Torrent wurde gestoppt: {0}",
    "the backup was made by a newer app version ({0}); update the app first": "Die Sicherung stammt von einer neueren App-Version ({0}), aktualisiere zuerst die App",
    "this file is not a backup of the app (not JSON)": "Diese Datei ist keine Sicherung der App (kein JSON)",
    "this file is not a backup of the app": "Diese Datei ist keine Sicherung der App",
    "the backup has no valid format version": "Die Sicherung hat keine gültige Formatversion",
    "the backup's tables are broken": "Die Tabellen der Sicherung sind beschädigt",
    "the backup's part \"{0}\" is broken": "Der Teil „{0}“ der Sicherung ist beschädigt",
    "Nakama is turned off": "Nakama ist ausgeschaltet",
    "No Nakama host is set up": "Kein Nakama-Host eingerichtet",
    "The Nakama passcode is missing": "Das Nakama-Passwort fehlt",
}

const german = compileCatalog(CORE_ERRORS_DE, "de")

/** A core error's text in the app language, English when the table does not have it. */
export function coreErrorText(message: string): string {
    return tr(message, translateText(german, message))
}
