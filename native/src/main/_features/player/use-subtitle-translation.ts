import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { VideoCore_TranslatedLines } from "@/api/generated/types"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { isAxiosError } from "axios"
import { Directory, File, Paths } from "expo-file-system"
import type { ExpoMpvViewRef } from "expo-mpv"
import { getDefaultStore } from "jotai"
import React from "react"
import type { PlayerTrack } from "./player-logic"
import {
    applyTranslations,
    isInLanguage,
    parseSubtitleFile,
    translatedTrackTitle,
    TranslatedTracks,
    translationBatches,
    translationErrorText,
    translationFileName,
    translationOrder,
    type TranslationSource,
    translationSource,
    type TranslationSourceContext,
} from "./subtitle-translation"

const TOAST_ID = "subtitle-translation"
/** translated files (two per track: the file and its "done" mark) */
const CACHE_FILES = 100
const NONE: ReadonlySet<number> = new Set()

/** Why the player looks at the playing track again: a menu change and a picked track may retry a failure, the rest not */
type Reason = "auto" | "settings" | "pick"

type Job = { key: string, cancelled: boolean }

class TranslationError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}

function errorCode(error: unknown) {
    if (error instanceof TranslationError) return error.code
    if (isAxiosError(error)) {
        if (!error.response) return "server-unreachable"
        const code = (error.response.data as { error?: unknown } | undefined)?.error
        return typeof code === "string" ? code : ""
    }
    return ""
}

const password = () => getDefaultStore().get(serverAuthTokenAtom)

async function readSource(source: TranslationSource): Promise<string> {
    if (source.kind === "content") return source.content
    if (source.kind === "embedded") {
        const endpoint = API_ENDPOINTS.VIDEOCORE.VideoCoreGetSubtitleTrack
        return await buildSeaQuery<string>({ endpoint: endpoint.endpoint, method: "POST", data: { trackNumber: source.trackNumber }, password: password() }) ?? ""
    }
    const res = await fetch(source.url)
    if (!res.ok) throw new TranslationError("no-subtitle-track")
    return await res.text()
}

async function translateLines(lines: string[]) {
    const endpoint = API_ENDPOINTS.VIDEOCORE.VideoCoreTranslateSubtitleLines
    const res = await buildSeaQuery<VideoCore_TranslatedLines>({ endpoint: endpoint.endpoint, method: "POST", data: { lines }, password: password() })
    if (!res?.lines || res.lines.length !== lines.length) throw new TranslationError("translation-failed")
    return res
}

/** mpv takes a plain path */
const localPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ""))

export type SubtitleTranslationOptions = {
    mpv: React.RefObject<ExpoMpvViewRef | null>
    /** one playback in one mpv view; a new one forgets everything */
    sessionKey: string | null
    tracks: PlayerTrack[]
    subId: number
    tracksReady: boolean
    selectSubtitle: (track: PlayerTrack | null, remember?: boolean) => void
    /** reads mpv's track list into the player and returns it */
    refreshTracks: () => Promise<PlayerTrack[]>
    positionMs: () => number
    sources: Omit<TranslationSourceContext, "translatedIds">
}

/**
 * "Translate subtitles" in the native player. While the server setting `vcTranslate` is on, the playing subtitle track
 * is translated into `vcTranslateTargetLanguage` and the translation is shown as an extra track "<name> (translated)"
 * (2.0.x: every selected track was translated while the switch was on). Turning the switch off goes back to the original.
 * Picking the original by hand keeps it. One translation runs at a time; a new one stops the old.
 */
export function useSubtitleTranslation(opts: SubtitleTranslationOptions) {
    const t = useTr()
    const media = useServerStatus()?.settings?.mediaPlayer
    const enabled = !!media?.vcTranslate
    // empty values fall back to the old menu's defaults
    const target = media?.vcTranslateTargetLanguage || "en"
    const provider = media?.vcTranslateProvider || "google"

    const latest = React.useRef(opts)
    React.useLayoutEffect(() => {
        latest.current = opts
    })
    const memory = React.useRef(new TranslatedTracks())
    const job = React.useRef<Job | null>(null)
    const reason = React.useRef<Reason>("auto")
    // the translated track ids of the session they belong to (another session sees none)
    const [translated, setTranslated] = React.useState<{ session: string | null, ids: ReadonlySet<number> }>({ session: null, ids: NONE })
    const translatedIds = translated.session === opts.sessionKey ? translated.ids : NONE
    const setTranslatedIds = (ids: ReadonlySet<number>) => setTranslated({ session: latest.current.sessionKey, ids })

    const cancel = React.useCallback(() => {
        if (job.current) job.current.cancelled = true
        job.current = null
    }, [])

    // a new playback or a new mpv view: the old tracks are gone
    React.useEffect(() => {
        memory.current = new TranslatedTracks()
        reason.current = "auto"
        return cancel
    }, [opts.sessionKey, cancel])

    const select = (id: number) => {
        const track = latest.current.tracks.find(tr => tr.type === "sub" && tr.id === id)
        if (track) latest.current.selectSubtitle(track, false)
    }

    /** Puts the translated file into mpv in place of the previous one; keeps the selection where the viewer has it */
    const swapTrack = async (path: string, previous: number | null, title: string, language: string, key: string, origin: number) => {
        const view = latest.current.mpv.current
        if (!view) throw new TranslationError("no-player")
        const show = previous === null || latest.current.subId === previous
        await view.addSubtitle(path, show ? "select" : "auto", title, language)
        if (previous !== null) await view.removeSubtitle(previous).catch(() => {})
        const list = await latest.current.refreshTracks()
        const added = list.filter(tr => tr.type === "sub" && tr.external && tr.title === title).sort((a, b) => b.id - a.id)[0]
        if (!added) throw new TranslationError("no-player")
        if (previous !== null && previous !== added.id) memory.current.forget(previous)
        memory.current.remember(key, added.id, origin)
        setTranslatedIds(memory.current.ids())
        if (show) latest.current.selectSubtitle(added, false)
        return added.id
    }

    const run = async (current: Job, track: PlayerTrack, source: TranslationSource) => {
        let added: number | null = null
        const title = translatedTrackTitle(track)
        const stopped = () => current.cancelled || job.current !== current
        const removeAdded = async () => {
            if (added === null) return
            const id = added
            added = null
            memory.current.forget(id)
            setTranslatedIds(memory.current.ids())
            await latest.current.mpv.current?.removeSubtitle(id).catch(() => {})
            await latest.current.refreshTracks().catch(() => [])
        }
        toast.info(t("Translating subtitles …", "Untertitel werden übersetzt …"), { id: TOAST_ID, duration: 8000 })
        try {
            const content = await readSource(source)
            if (stopped()) return
            const doc = parseSubtitleFile(content)
            if (!doc?.cues.length) throw new TranslationError(doc ? "no-subtitle-lines" : "unsupported-format")

            const folder = new Directory(Paths.cache, "subtitle-translations")
            if (!folder.exists) folder.create({ intermediates: true, idempotent: true })
            // the cache stays small: past this many files it starts over (the server still has its line cache)
            else if (folder.list().length > CACHE_FILES) {
                folder.delete()
                folder.create({ intermediates: true, idempotent: true })
            }
            const name = translationFileName(content, provider, target)
            const file = new File(folder, `${name}.${doc.format}`)
            const complete = new File(folder, `${name}.done`)
            let language = target.toLowerCase()

            // translated before (this or an earlier playback): straight from the cache
            if (file.exists && complete.exists) {
                added = await swapTrack(localPath(file.uri), null, title, language, current.key, track.id)
                toast.dismiss(TOAST_ID)
                return
            }

            if (!file.exists) file.create()
            const translated = new Map<number, string>()
            for (const batch of translationBatches(translationOrder(doc.cues, latest.current.positionMs()))) {
                const res = await translateLines(batch.map(index => doc.cues[index].text))
                if (stopped()) {
                    await removeAdded()
                    return
                }
                batch.forEach((index, k) => translated.set(index, res.lines?.[k] ?? ""))
                language = res.language || language
                file.writeSync(applyTranslations(doc, translated))
                const first = added === null
                added = await swapTrack(localPath(file.uri), added, title, language, current.key, track.id)
                if (first) toast.success(t("Showing translated subtitles", "Übersetzte Untertitel werden angezeigt"), { id: TOAST_ID, duration: 3000 })
            }
            if (!complete.exists) complete.create()
        }
        catch (error) {
            if (stopped()) {
                await removeAdded()
                return
            }
            // back to the original, with the reason
            const wasShown = added !== null && latest.current.subId === added
            await removeAdded()
            if (wasShown) select(track.id)
            memory.current.fail(current.key)
            toast.error(t("Subtitles could not be translated", "Untertitel konnten nicht übersetzt werden"),
                { id: TOAST_ID, description: translationErrorText(errorCode(error), t), duration: 6000 })
        }
        finally {
            if (job.current === current) job.current = null
        }
    }

    const decide = React.useEffectEvent(() => {
        const { tracks, subId, tracksReady, sessionKey, sources } = latest.current
        const why = reason.current
        reason.current = "auto"
        if (!sessionKey || !tracksReady) return
        if (!enabled) {
            cancel()
            const origin = memory.current.originOf(subId)
            if (origin !== undefined) select(origin)
            return
        }
        let track = tracks.find(tr => tr.type === "sub" && tr.id === subId)
        if (!track) return
        if (memory.current.isTranslation(track.id)) {
            // a translation is playing: only a new language (or provider) translates its original again
            if (why !== "settings") return
            const origin = memory.current.originOf(track.id)
            track = tracks.find(tr => tr.type === "sub" && tr.id === origin)
            if (!track) return
        }
        if (isInLanguage(track, target)) {
            if (track.id !== subId) select(track.id)
            return
        }
        const source = translationSource(track, tracks, { ...sources, translatedIds: memory.current.ids() })
        if (!source) {
            if (why !== "auto") {
                toast.error(t("Subtitles could not be translated", "Untertitel konnten nicht übersetzt werden"),
                    { id: TOAST_ID, description: translationErrorText(null, t), duration: 6000 })
            }
            return
        }
        const key = TranslatedTracks.key(source, provider, target)
        const shown = memory.current.shown(key)
        if (shown !== undefined) {
            // switched on again (or a new language came back to one done before): show it; a track picked by hand stays
            if (why === "settings" && shown !== subId) select(shown)
            return
        }
        if (job.current?.key === key) return
        if (memory.current.failed(key) && why === "auto") return

        // 2.0.x for subtitle files: another file already in the target language is shown instead of translating
        if (source.kind === "url") {
            const other = tracks.find(tr => tr.type === "sub" && tr.id !== track.id && !memory.current.isTranslation(tr.id) && isInLanguage(tr, target))
            if (other) {
                memory.current.remember(key, other.id)
                select(other.id)
                return
            }
        }

        cancel()
        const current: Job = { key, cancelled: false }
        job.current = current
        void run(current, track, source)
    })

    React.useEffect(() => {
        decide()
    }, [enabled, target, provider, opts.subId, opts.tracksReady, opts.sessionKey])

    return {
        translatedIds,
        /** before the menu writes a translation setting: the change may start (or retry) a translation */
        onSettingsChange: React.useCallback(() => {
            reason.current = "settings"
        }, []),
        /** before a track picked in the menu is shown */
        onPick: React.useCallback(() => {
            reason.current = "pick"
        }, []),
    }
}
