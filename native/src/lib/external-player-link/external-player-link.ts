import { withoutServerError } from "@/lib/server/without-server"
import { toast } from "@/components/ui/toast/toast-store"
import { logger } from "@/lib/helpers/debug"
import { withoutTokens } from "@/lib/helpers/log-safe"

const log = logger("EXTERNAL PLAYER LINK")

export class ExternalPlayerLink {

    private _playerLink = ""
    private _urlToSend = ""
    private _subtitleUrls: string[] = []
    private _episodeNumber: number | null = null
    private _mediaTitle: string | null = null

    constructor(playerLink: string) {
        this._playerLink = playerLink
    }

    setUrl(url: string) {
        this._urlToSend = url
    }

    setSubtitleUrls(urls: string[]) {
        this._subtitleUrls = urls
    }

    setEpisodeNumber(ep: number | undefined) {
        this._episodeNumber = ep ?? null
    }

    setMediaTitle(title: string | undefined) {
        this._mediaTitle = title ?? null
    }

    /** A stream address of the server (endpoint): the app has no server, so there is none to send (toast) */
    to(props: { endpoint: string }) {
        toast.error(withoutServerError(props.endpoint.split("?")[0]).message)
    }

    getFullUrl() {
        const urlToSend = this._getUrlToSend()
        log.info("Sending URL to external player", withoutTokens(urlToSend))
        return this._formatFinalUrl(urlToSend)
    }

    private _getUrlToSend() {
        return this._formatTemplateUrl(this._urlToSend)
    }

    private _formatTemplateUrl(url: string) {
        const urlToSend = url
        if (this._playerLink.includes("?")) {
            return encodeURIComponent(urlToSend)
        }
        return urlToSend
    }

    private _cleanTitle(title: string) {
        return title.replace(/[\\/:*?"<>|]/g, "")
    }

    private _formatFinalUrl(url: string): string {
        let link = this._playerLink
        link = link.replace("{mediaTitle}", this._cleanTitle(this._mediaTitle ?? ""))
        link = link.replace("{episodeNumber}", this._episodeNumber?.toString?.() ?? "")
        link = link.replace("{mime}", "video/webm")
        const subtitleUrls = this._subtitleUrls.map(url => this._formatTemplateUrl(url))
        link = link.replaceAll("{subtitleUrl}", subtitleUrls[0] ?? "")
        link = link.replaceAll("{subtitleUrls}", subtitleUrls.join(","))
        if (link.includes("{formattedTitle}")) {
            let title = this._mediaTitle ?? ""
            if (this._episodeNumber !== null && !!title.length) {
                title = `Episode ${this._episodeNumber} - ${title}`
            }
            link = link.replace("{formattedTitle}", this._cleanTitle(title ?? ""))
        }
        log.info("Formatted external player link", withoutTokens(link))
        // e.g. "mpv://http://localhost:43214/stream/..."
        // e.g. "intent://http://localhost:43214/stream/...#Intent;package=org.videolan.vlc;scheme=http;end"
        let retUrl = link.replace("{url}", url)

        if (link.startsWith("intent://")) {
            // e.g. "intent://localhost:43214/stream/...#Intent;package=org.videolan.vlc;scheme=http;end"
            retUrl = retUrl.replace("intent://http://", "intent://").replace("intent://https://", "intent://")
        }

        return retUrl
    }
}
