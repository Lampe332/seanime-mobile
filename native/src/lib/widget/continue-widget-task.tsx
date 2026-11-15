// geschrieben nach: widget-task.tsx (gleiche Bibliothek, gleicher Speicher) – eigener Entwurf für "Continue watching".
import type { Anime_Episode } from "@/api/generated/types"
import { appLanguageAtom, getAppLanguage } from "@/lib/app-language"
import { storage } from "@/lib/storage"
import { useAtomValue } from "jotai"
import React from "react"
import { Platform } from "react-native"
import { requestWidgetUpdate, type WidgetInfo } from "react-native-android-widget"
import { CONTINUE_WIDGET_NAME, ContinueWidget } from "./continue-widget"
import { continueEntries, continueTexts, createContinueStore } from "./continue-widget-data"

/*
 * Ways the "Continue watching" widget updates: Home hands it its "Continue watching" list whenever that list changes
 * (app start, a watched episode or any other progress change refetches the library collection); Android redraws it from
 * the stored list when it is added or resized and every hour (app.json updatePeriodMillis). It never fetches itself:
 * the list needs the app's core, which only runs with the app.
 */
const store = createContinueStore(storage)

export function continueView(info: Pick<WidgetInfo, "height">) {
    const texts = continueTexts(getAppLanguage() === "de")
    return <ContinueWidget entries={store.entries()} heightDp={info.height} title={texts.title} empty={texts.empty} episodeText={texts.episode} />
}

function redraw() {
    return requestWidgetUpdate({ widgetName: CONTINUE_WIDGET_NAME, renderWidget: info => continueView(info), widgetNotFound: () => undefined })
}

/** Home: keeps the widget's list equal to its own "Continue watching" row; redraws only when the list changed. */
export function useContinueWatchingWidget(episodes: readonly Anime_Episode[] | undefined, ready: boolean) {
    const entries = React.useMemo(() => continueEntries(episodes ?? []), [episodes])
    const language = useAtomValue(appLanguageAtom)
    React.useEffect(() => {
        if (Platform.OS !== "android" || !ready) return
        const changed = store.save(entries)
        if (changed) void redraw().catch(() => undefined)
    }, [entries, ready])
    // a language change redraws the texts
    React.useEffect(() => {
        if (Platform.OS === "android") void redraw().catch(() => undefined)
    }, [language])
}
