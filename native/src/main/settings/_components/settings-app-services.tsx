import type { Translate } from "@/lib/app-language"
import { LinkRow, LocalSwitch, SettingsGroup } from "@/main/settings/_components/settings-kit"

/*
 * Rows of the settings whose modules come from E4: new-episode notifications, Wi-Fi-only downloads, touch feedback and the
 * app update check. They take their state as props; the screens wire them to E4's hooks (Karte §9, E2 2.12):
 *   AiringRows      ← useAiringNotificationsSetting(), useTestAiringNotification() (lib/airing/airing-hooks.ts);
 *                     settings-app.tsx AppServiceRows, App › Episodes after the default source
 *   WifiOnlyRow     ← useMobileOfflineSettings() + the snapshot's wifiOnly (api/hooks/mobile_offline.hooks.ts); same place
 *   FeedbackGroup   ← hapticsEnabledAtom, soundsEnabledAtom, hasVibrator(), playSound("success") (lib/feedback.ts);
 *                     settings-app.tsx AppFeedbackGroup, after Language
 *   UpdateCheckRow  ← useCheckForUpdates(), APP_UPDATE_QUERY_KEY (api/hooks/releases.hooks.ts), updateNoticeOpens
 *                     (lib/app-updates/update-notice.ts) → updateModalOpenAtom (2.14); settings-phone.tsx UpdateCheck,
 *                     About after "Look for new versions"
 */

/** "Notify about new episodes" and, while it is on, the test notification (AiringNotificationsSetting) */
export function AiringRows({ t, enabled, onChange, onTest }: {
    t: Translate
    enabled: boolean
    onChange: (enabled: boolean) => void
    onTest: () => void
}) {
    return <>
        <LocalSwitch label={t("Notify about new episodes", "Neue Folgen melden")} checked={enabled} onCheckedChange={onChange}
            note={t("For the anime you are watching, shortly after an episode airs.", "Für die Anime, die du schaust, kurz nachdem eine Folge ausgestrahlt wurde.")} />
        {enabled && <LinkRow label={t("Send a test notification", "Testbenachrichtigung senden")} onPress={onTest} chevron={false} />}
    </>
}

/** "Notify about new chapters": manga on Reading, checked every few hours by the same background job (lib/updates/chapter-check.ts) */
export function ChapterRow({ t, enabled, onChange }: { t: Translate, enabled: boolean, onChange: (enabled: boolean) => void }) {
    return <LocalSwitch label={t("Notify about new chapters", "Neue Kapitel melden")} checked={enabled} onCheckedChange={onChange}
        note={t("For the manga you are reading, checked with their source every few hours.", "Für die Manga, die du liest, alle paar Stunden bei ihrer Quelle geprüft.")} />
}

/** Episode downloads can wait for Wi-Fi; torrents ask before they start on mobile data either way (WifiOnlyDownloadsSetting) */
export function WifiOnlyRow({ t, enabled, onChange }: { t: Translate, enabled: boolean, onChange: (enabled: boolean) => void }) {
    return <LocalSwitch label={t("Download on Wi-Fi only", "Nur über WLAN herunterladen")} checked={enabled} onCheckedChange={onChange}
        note={t("Episode downloads wait for Wi-Fi instead of using mobile data.", "Folgen-Downloads warten auf WLAN, statt mobile Daten zu verbrauchen.")} />
}

/** Touch feedback (Feedback.kt); vibration only on devices that have a motor (the Pixel Tablet has none) */
export function FeedbackGroup({ t, hasVibrator, haptics, onHaptics, sounds, onSounds }: {
    t: Translate
    hasVibrator: boolean
    haptics: boolean
    onHaptics: (enabled: boolean) => void
    sounds: boolean
    /** turning it on plays the sound once, so its volume is known */
    onSounds: (enabled: boolean) => void
}) {
    return <SettingsGroup title={t("Feedback", "Feedback")}>
        {hasVibrator && <LocalSwitch label={t("Vibration", "Vibration")} checked={haptics} onCheckedChange={onHaptics}
            note={t("A short tick for switches, long presses and finished actions.", "Ein kurzes Ticken bei Schaltern, langem Drücken und erledigten Aktionen.")} />}
        <LocalSwitch label={t("Sounds", "Töne")} checked={sounds} onCheckedChange={onSounds}
            note={t("A quiet sound when a download starts or an episode is marked as watched. Never while something plays.",
                "Ein leiser Ton, wenn ein Download startet oder eine Folge als gesehen markiert wird. Nie während etwas läuft.")} />
    </SettingsGroup>
}

/** Home screen widgets: each row asks the launcher to add the widget (its own "Add" dialog confirms) */
export function WidgetsGroup({ t, onAdd }: { t: Translate, onAdd: (widget: "ContinueWatching" | "UpcomingAnime") => void }) {
    return <SettingsGroup title={t("Home screen widgets", "Widgets für den Startbildschirm")}>
        <LinkRow label={t("Add “Continue watching”", "„Weiterschauen“ hinzufügen")} chevron={false} onPress={() => onAdd("ContinueWatching")}
            note={t("Your next episodes; a tap opens the anime.", "Deine nächsten Folgen; ein Tipp öffnet den Anime.")} />
        <LinkRow label={t("Add “Upcoming anime”", "„Demnächst“ hinzufügen")} chevron={false} onPress={() => onAdd("UpcomingAnime")}
            note={t("Countdowns to the next episodes of your list.", "Countdowns bis zu den nächsten Folgen deiner Liste.")} />
    </SettingsGroup>
}

/** "Check for updates now" (works also when Look for new versions is off) */
export function UpdateCheckRow({ t, checking, onCheck }: { t: Translate, checking: boolean, onCheck: () => void }) {
    return <LinkRow label={checking ? t("Checking for updates…", "Suche nach Updates …") : t("Check for updates now", "Jetzt nach Updates suchen")}
        disabled={checking} onPress={onCheck} />
}
