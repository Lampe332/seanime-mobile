import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import { startActivityAsync } from "expo-intent-launcher"
import { Linking } from "react-native"
import { type IntentLink, parseIntentLink, playerActivityOf } from "./android-player-presets"

/*
 * Opening a stream in another app (web external-player-link + MainActivity's intent:// handling). The presets
 * (android-player-presets.ts) save `intent://<host/path>#Intent;scheme=http;type=video/*;package=…;end`; Linking cannot
 * start such a link, so it becomes an explicit VIEW intent through expo-intent-launcher. That library only targets an
 * app through package + class, so presets carry their player activity; a missing app then fails here and says so.
 * Other links (vlc://, custom schemes) still go to Linking.
 */

async function startViewIntent(intent: IntentLink) {
    try {
        // resolves when the other app returns; a missing app (or activity) throws right away
        await startActivityAsync("android.intent.action.VIEW", {
            data: intent.data,
            type: intent.type,
            ...(intent.className ? { packageName: intent.packageName, className: intent.className } : {}),
        })
        return true
    }
    catch {
        toast.error(tr("That player is not installed", "Dieser Player ist nicht installiert"))
        return false
    }
}

/** Starts the stream in the given player app (VIEW intent with the video's http URL). */
export function openInPlayerApp(url: string, packageName?: string) {
    return startViewIntent({ data: url, type: "video/*", packageName, className: playerActivityOf(packageName) })
}

/** Opens a formatted external player link (handle-play-media, player menu); false when no app took it (toast shown). */
export async function openExternalPlayer(link: string): Promise<boolean> {
    const intent = parseIntentLink(link)
    if (intent) return startViewIntent(intent)
    try {
        await Linking.openURL(link)
        return true
    }
    catch {
        toast.error(tr("No app opens this link", "Keine App öffnet diesen Link"))
        return false
    }
}
