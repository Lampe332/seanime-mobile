import { getServerBaseUrl, SERVER_HOST } from "@/api/client/server-url"
import { logger } from "@/lib/helpers/debug"
import { withoutTokens } from "@/lib/helpers/log-safe"

const log = logger("EXTERNAL PLAYER LINK")

// The web app filled these from the page it was served from; the app always talks to its own server on 127.0.0.1
const SERVER_SCHEME = "http"
const SERVER_HOSTNAME = "127.0.0.1"

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

    async to(props: { endpoint: string, onTokenQueryParam?: () => Promise<string> }) {
        let url = getServerBaseUrl() + props.endpoint
        if (props.onTokenQueryParam) {
            url += await props.onTokenQueryParam()
        }
        logger("MEDIALINKS").info("Formatted URL to send", withoutTokens(url))
        this._urlToSend = url
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
        let urlToSend = url
        urlToSend = urlToSend.replace("{{SCHEME}}", SERVER_SCHEME)
        urlToSend = urlToSend.replace("{{HOST}}", SERVER_HOST)

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
        link = link.replace("{scheme}", SERVER_SCHEME)
        link = link.replace("{host}", SERVER_HOST)
        link = link.replace("{hostname}", SERVER_HOSTNAME)
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
            .replace("127.0.0.1", SERVER_HOSTNAME)
            .replace("localhost", SERVER_HOSTNAME)


        if (link.startsWith("intent://")) {
            // e.g. "intent://localhost:43214/stream/...#Intent;package=org.videolan.vlc;scheme=http;end"
            retUrl = retUrl.replace("intent://http://", "intent://").replace("intent://https://", "intent://")
        }

        return retUrl
    }
}
