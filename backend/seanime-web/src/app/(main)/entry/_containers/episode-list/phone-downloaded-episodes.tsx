import { OfflineEpisode, offlinePollDelay, offlineStateLabel, showsProgress } from "@/app/(main)/android-downloads/offline-library"
import { OFFLINE_CHANGED_EVENT } from "@/lib/android-offline"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import React from "react"
import { LuArrowDownToLine, LuChevronRight, LuPause, LuPlay } from "react-icons/lu"
import "@/components/shared/mobile-surface.css"
import "./phone-downloaded-episodes.css"

/** Episodes of this anime saved on the phone by the Android download manager (not part of the Seanime library scan). */
export function usePhoneDownloadedEpisodes(mediaId: number | undefined) {
    const [episodes, setEpisodes] = React.useState<OfflineEpisode[]>([])
    const refresh = React.useCallback(() => {
        if (!mediaId) return true
        if (!window.SeanimeOffline || !window.__seanimeOfflineToken) return false
        try {
            const all = JSON.parse(window.SeanimeOffline.snapshot(window.__seanimeOfflineToken)) as OfflineEpisode[]
            const mine = all.filter(episode => episode.mediaId === mediaId).sort((a, b) => Number(a.episode) - Number(b.episode))
            setEpisodes(previous => JSON.stringify(previous) === JSON.stringify(mine) ? previous : mine)
        } catch { /* The offline bridge is unavailable while the page reloads. */ }
        return true
    }, [mediaId])
    React.useEffect(() => {
        // On a cold start the bridge token can arrive after the first render; look again until it is there.
        let wait = 0, timer = 0
        const first = () => { if (!refresh() && wait < 40) { wait++; timer = window.setTimeout(first, 500) } }
        first()
        window.addEventListener("focus", refresh)
        window.addEventListener(OFFLINE_CHANGED_EVENT, refresh)
        return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); window.removeEventListener(OFFLINE_CHANGED_EVENT, refresh) }
    }, [refresh])
    // Download progress changes natively; follow it only while one of these episodes moves, like the Downloads page.
    const moving = offlinePollDelay(episodes) !== null
    React.useEffect(() => {
        if (!moving) return
        const timer = window.setInterval(refresh, 2000)
        return () => clearInterval(timer)
    }, [moving, refresh])
    return episodes
}

const asset = (key?: string) => key && /^[a-f0-9]{64}\.jpg$/.test(key) ? `/__android_offline/${key}` : undefined

export function PhoneDownloadedEpisodes({ episodes }: { episodes: OfflineEpisode[] }) {
    const t = useTr()
    const router = useRouter()
    if (!episodes.length) return null
    const play = (episode: OfflineEpisode) => {
        if (episode.ready && window.__seanimeOfflineToken) window.SeanimeOffline?.action(window.__seanimeOfflineToken, episode.id, "play")
    }
    return (
        <section className="phone-downloads" aria-labelledby="phone-downloads-title" data-phone-downloaded-episodes>
            <div className="phone-downloads-head">
                <h2 id="phone-downloads-title">{t("On this device", "Auf diesem Gerät")}</h2>
                <button type="button" onClick={() => router.push(`/android-downloads?anime=${encodeURIComponent(`media-${episodes[0].mediaId}`)}`)}>
                    {t("Manage", "Verwalten")}<LuChevronRight aria-hidden />
                </button>
            </div>
            <ul className="phone-downloads-list">
                {episodes.map(episode => {
                    const image = asset(episode.episodeImageAsset || episode.bannerAsset)
                    const label = `${t("Episode", "Folge")} ${episode.episode}`
                    return <li key={episode.id}>
                        <button type="button" disabled={!episode.ready} onClick={() => play(episode)} data-ready={episode.ready}
                            aria-label={episode.ready ? t(`Play episode ${episode.episode} offline`, `Folge ${episode.episode} offline abspielen`) : label}>
                            <span className="phone-downloads-thumb">
                                {image ? <img src={image} alt="" loading="lazy" /> : <LuArrowDownToLine aria-hidden />}
                                {episode.ready && <span className="phone-downloads-play"><LuPlay aria-hidden /></span>}
                            </span>
                            <span className="phone-downloads-text">
                                <span className="phone-downloads-number">{label}</span>
                                <span className="phone-downloads-title">{episode.episodeTitle || label}</span>
                                <span className="phone-downloads-state">
                                    {episode.ready
                                        ? t("Saved offline", "Offline gespeichert")
                                        : <>{episode.status === "paused" && <LuPause aria-hidden />}{offlineStateLabel(episode, t)}{showsProgress(episode) ? ` · ${Math.round(episode.progress)} %` : ""}</>}
                                </span>
                            </span>
                        </button>
                    </li>
                })}
            </ul>
        </section>
    )
}
