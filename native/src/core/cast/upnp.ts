// geschrieben nach: öffentlicher UPnP-Spezifikation (UPnP Device Architecture 1.0: SSDP M-SEARCH, Geräte-Beschreibung, SOAP-Steuerung; AVTransport:1; RenderingControl:1; DIDL-Lite aus ContentDirectory:1); keine Vorlage

/*
 * The words of UPnP the core speaks with a TV: the search sent into the home network (SSDP), reading a device's
 * description, and building and reading the SOAP messages that control it. Plain text in, plain values out; nothing
 * here talks to the network.
 */

export const SSDP_HOST = "239.255.255.250"
export const SSDP_PORT = 1900
export const MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1"
export const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1"
export const RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1"

/** The search for renderers (Device Architecture 1.0, 1.2.2): answers come back within `mx` seconds, sent to the asker */
export function searchMessage(target: string = MEDIA_RENDERER, mx: number = 2): string {
    return [
        "M-SEARCH * HTTP/1.1",
        `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
        "MAN: \"ssdp:discover\"",
        `MX: ${mx}`,
        `ST: ${target}`,
        "",
        "",
    ].join("\r\n")
}

export type SearchReply = { location: string, target: string, usn: string, server: string }

/** One answer to the search (an HTTP response over UDP); null when it is not a usable "200 OK" with a LOCATION */
export function readSearchReply(text: string): SearchReply | null {
    const lines = text.split(/\r?\n/)
    if (!/^HTTP\/1\.[01]\s+200\b/i.test(lines[0] ?? "")) return null
    const headers = new Map<string, string>()
    for (const line of lines.slice(1)) {
        const colon = line.indexOf(":")
        if (colon <= 0) continue
        headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
    const location = headers.get("location") ?? ""
    if (!/^https?:\/\/[^\s/]+/i.test(location)) return null
    return { location, target: headers.get("st") ?? "", usn: headers.get("usn") ?? "", server: headers.get("server") ?? "" }
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" }

export function xmlUnescape(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, name: string) => {
        if (name[0] === "#") {
            const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
        }
        return ENTITIES[name.toLowerCase()] ?? whole
    })
}

export function xmlEscape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

/** The text of the first element with this local name (any namespace prefix), unescaped; null when there is none */
export function elementText(xml: string, name: string): string | null {
    const found = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`).exec(xml)
    if (found) return xmlUnescape((found[1] ?? "").trim())
    // an empty element written short
    return new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?/>`).test(xml) ? "" : null
}

/** Every element with this local name, each as its inner XML */
function elements(xml: string, name: string): string[] {
    const pattern = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`, "g")
    return [...xml.matchAll(pattern)].map(match => match[1] ?? "")
}

/** A URL of the description against its base (Device Architecture 1.0, 2.1: URLBase, else where the description came from) */
export function resolveUrl(url: string, base: string): string {
    if (/^https?:\/\//i.test(url)) return url
    const origin = /^(https?:\/\/[^/?#]+)/i.exec(base)?.[1] ?? ""
    if (url.startsWith("/")) return origin + url
    const path = base.slice(origin.length).replace(/[?#].*$/, "")
    const folder = path.slice(0, path.lastIndexOf("/") + 1) || "/"
    return origin + folder + url
}

export type ServiceAddress = { serviceType: string, controlUrl: string }

export type DeviceDescription = {
    /** The device's UDN ("uuid:…"), its lasting name */
    id: string
    name: string
    manufacturer: string
    model: string
    avTransport: ServiceAddress | null
    renderingControl: ServiceAddress | null
}

/** The device's description (Device Architecture 1.0, 2.1), read for the services the core uses; null when it is no device */
export function readDeviceDescription(xml: string, location: string): DeviceDescription | null {
    const device = elements(xml, "device")[0]
    if (device === undefined) return null
    const base = elementText(xml, "URLBase") || location
    const services = elements(xml, "service").map(service => ({
        serviceType: elementText(service, "serviceType") ?? "",
        controlUrl: resolveUrl(elementText(service, "controlURL") ?? "", base),
    }))
    // version 1 is what the core speaks; a later version answers the same actions (UPnP keeps them backwards compatible)
    const service = (kind: string) => services.find(entry => entry.serviceType.startsWith(`urn:schemas-upnp-org:service:${kind}:`) && entry.controlUrl) ?? null
    return {
        id: elementText(device, "UDN") ?? location,
        name: elementText(device, "friendlyName") ?? "",
        manufacturer: elementText(device, "manufacturer") ?? "",
        model: elementText(device, "modelName") ?? "",
        avTransport: service("AVTransport"),
        renderingControl: service("RenderingControl"),
    }
}

/** A control request (Device Architecture 1.0, 3.2.1): its body and the two headers it needs */
export function soapRequest(serviceType: string, action: string, args: [string, string | number][]): { body: string, headers: Record<string, string> } {
    const inner = args.map(([name, value]) => `<${name}>${xmlEscape(String(value))}</${name}>`).join("")
    const body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
        + `<s:Body><u:${action} xmlns:u="${xmlEscape(serviceType)}">${inner}</u:${action}></s:Body></s:Envelope>`
    return { body, headers: { "Content-Type": "text/xml; charset=\"utf-8\"", "SOAPAction": `"${serviceType}#${action}"` } }
}

export type SoapAnswer = { ok: true, values: Record<string, string> } | { ok: false, code: number, description: string }

/** The answer to a control request (Device Architecture 1.0, 3.2.2): the action's out values, or the UPnP error */
export function readSoapAnswer(xml: string, action: string): SoapAnswer {
    const fault = elementText(xml, "Fault")
    if (fault !== null) {
        return { ok: false, code: Number(elementText(fault, "errorCode") ?? 0) || 0, description: elementText(fault, "errorDescription") ?? elementText(fault, "faultstring") ?? "" }
    }
    const response = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${action}Response(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${action}Response\\s*>)`).exec(xml)
    if (!response) return { ok: false, code: 0, description: `no ${action}Response in the answer` }
    const values: Record<string, string> = {}
    for (const match of (response[1] ?? "").matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g)) {
        values[match[1]] = xmlUnescape((match[2] ?? "").trim())
    }
    return { ok: true, values }
}

const TYPES: Record<string, string> = {
    mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", ts: "video/mp2t", avi: "video/x-msvideo",
    m3u8: "application/vnd.apple.mpegurl", mpd: "application/dash+xml",
}

/** The media type by the address' file ending; "*" (any) when the address does not tell */
export function mediaTypeOf(url: string): string {
    const ending = /\.([A-Za-z0-9]{2,4})(?:[?#]|$)/.exec(url.replace(/^https?:\/\/[^/]+/i, ""))?.[1]?.toLowerCase()
    return (ending && TYPES[ending]) || "*"
}

/**
 * What the outlet sends a TV for a video in `contentFeatures.dlna.org` (modules/core-torrent/cpp/StreamServer.cpp
 * dlnaHeadersOf, the same string): read by byte range (OP=01), not converted, streaming + DLNA 1.5 flags. LG (webOS 25)
 * only seeks a video whose DIDL-Lite resource says so in the 4th field of protocolInfo; with "*" it answers Seek, shows
 * "this function is not available" and plays on from the start.
 */
export const DLNA_VIDEO_FEATURES = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"

/** protocolInfo of a resource: HTTP GET, any network, its media type, the DLNA features for a video ("*" for anything else) */
export function protocolInfoOf(url: string): string {
    const type = mediaTypeOf(url)
    return `http-get:*:${type}:${type.startsWith("video/") ? DLNA_VIDEO_FEATURES : "*"}`
}

/** The item's metadata for SetAVTransportURI (DIDL-Lite of ContentDirectory:1, a video item with one resource) */
export function didlLite(url: string, title: string, artworkUrl: string = ""): string {
    const art = artworkUrl ? `<upnp:albumArtURI>${xmlEscape(artworkUrl)}</upnp:albumArtURI>` : ""
    return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
        + `<item id="0" parentID="-1" restricted="1"><dc:title>${xmlEscape(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class>${art}`
        + `<res protocolInfo="${protocolInfoOf(url)}">${xmlEscape(url)}</res></item></DIDL-Lite>`
}

/** Milliseconds as AVTransport writes a time ("H+:MM:SS") */
export function upnpTime(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

/** An AVTransport time ("H+:MM:SS[.F+]" or "H+:MM:SS.F0/F1") in milliseconds; 0 when it is none ("NOT_IMPLEMENTED", "") */
export function upnpTimeMs(text: string | undefined): number {
    const found = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+)(?:\/(\d+))?)?\s*$/.exec(text ?? "")
    if (!found) return 0
    let ms = (Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3])) * 1000
    if (found[4] !== undefined) ms += found[5] !== undefined ? Math.round(Number(found[4]) / Math.max(1, Number(found[5])) * 1000) : Math.round(Number(`0.${found[4]}`) * 1000)
    return ms
}
