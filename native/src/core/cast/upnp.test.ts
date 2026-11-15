// geschrieben nach: öffentlicher UPnP-Spezifikation (Device Architecture 1.0, AVTransport:1, RenderingControl:1); Beispiele erfunden nach der Spezifikation (Adressen aus 192.0.2.0/24, dem Dokumentations-Netz)
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
    AV_TRANSPORT, DLNA_VIDEO_FEATURES, RENDERING_CONTROL, didlLite, elementText, mediaTypeOf, protocolInfoOf, readDeviceDescription, readSearchReply, readSoapAnswer, resolveUrl,
    searchMessage, soapRequest, upnpTime, upnpTimeMs, xmlEscape, xmlUnescape,
} from "./upnp"

const RENDERER_XML = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Living Room TV &amp; Sound</friendlyName>
    <manufacturer>LG Electronics</manufacturer>
    <modelName>OLED Example</modelName>
    <UDN>uuid:00000000-0000-1000-8000-000000000001</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <controlURL>/upnp/control/RenderingControl1</controlURL>
        <eventSubURL>/upnp/event/RenderingControl1</eventSubURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <controlURL>upnp/control/AVTransport1</controlURL>
        <eventSubURL>/upnp/event/AVTransport1</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`

describe("SSDP", () => {
    it("builds the search for renderers as UPnP 1.0 writes it", () => {
        const message = searchMessage()
        expect(message.startsWith("M-SEARCH * HTTP/1.1\r\n")).toBe(true)
        expect(message).toContain("HOST: 239.255.255.250:1900\r\n")
        expect(message).toContain("MAN: \"ssdp:discover\"\r\n")
        expect(message).toContain("ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n")
        expect(message.endsWith("\r\n\r\n")).toBe(true)
    })

    it("reads an answer, headers in any case", () => {
        const reply = readSearchReply("HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nlocation: http://192.0.2.10:1234/desc.xml\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:abc::urn:schemas-upnp-org:device:MediaRenderer:1\r\nServer: Linux/1.0 UPnP/1.0 Example/1.0\r\n\r\n")
        expect(reply).toEqual({ location: "http://192.0.2.10:1234/desc.xml", target: "urn:schemas-upnp-org:device:MediaRenderer:1", usn: "uuid:abc::urn:schemas-upnp-org:device:MediaRenderer:1", server: "Linux/1.0 UPnP/1.0 Example/1.0" })
    })

    it("leaves out what is no usable answer", () => {
        expect(readSearchReply("NOTIFY * HTTP/1.1\r\nLOCATION: http://192.0.2.10/d.xml\r\n\r\n")).toBeNull()
        expect(readSearchReply("HTTP/1.1 200 OK\r\nST: x\r\n\r\n")).toBeNull()
        expect(readSearchReply("HTTP/1.1 200 OK\r\nLOCATION: file:///etc/passwd\r\n\r\n")).toBeNull()
        expect(readSearchReply("")).toBeNull()
    })
})

describe("device description", () => {
    it("reads name, maker and the two control addresses", () => {
        expect(readDeviceDescription(RENDERER_XML, "http://192.0.2.10:1234/dmr/desc.xml")).toEqual({
            id: "uuid:00000000-0000-1000-8000-000000000001",
            name: "Living Room TV & Sound",
            manufacturer: "LG Electronics",
            model: "OLED Example",
            avTransport: { serviceType: AV_TRANSPORT, controlUrl: "http://192.0.2.10:1234/dmr/upnp/control/AVTransport1" },
            renderingControl: { serviceType: RENDERING_CONTROL, controlUrl: "http://192.0.2.10:1234/upnp/control/RenderingControl1" },
        })
    })

    it("takes URLBase before the place of the description", () => {
        const xml = RENDERER_XML.replace("<specVersion>", "<URLBase>http://192.0.2.11:9000/base/</URLBase><specVersion>")
        expect(readDeviceDescription(xml, "http://192.0.2.10:1234/desc.xml")?.avTransport?.controlUrl).toBe("http://192.0.2.11:9000/base/upnp/control/AVTransport1")
    })

    it("has no AVTransport when the device offers none, and nothing for text that is no device", () => {
        const noTransport = RENDERER_XML.replace(/<service>\s*<serviceType>urn:schemas-upnp-org:service:AVTransport[\s\S]*?<\/service>/, "")
        expect(readDeviceDescription(noTransport, "http://192.0.2.10/d.xml")?.avTransport).toBeNull()
        expect(readDeviceDescription("<html>nope</html>", "http://192.0.2.10/d.xml")).toBeNull()
    })

    it("resolves addresses against the base", () => {
        expect(resolveUrl("http://192.0.2.9/x", "http://192.0.2.10/a/b.xml")).toBe("http://192.0.2.9/x")
        expect(resolveUrl("/c", "http://192.0.2.10:80/a/b.xml")).toBe("http://192.0.2.10:80/c")
        expect(resolveUrl("c", "http://192.0.2.10/a/b.xml?q=1")).toBe("http://192.0.2.10/a/c")
        expect(resolveUrl("c", "http://192.0.2.10")).toBe("http://192.0.2.10/c")
    })
})

describe("SOAP", () => {
    it("builds a request with envelope, action and the SOAPAction header", () => {
        const request = soapRequest(AV_TRANSPORT, "Seek", [["InstanceID", 0], ["Unit", "REL_TIME"], ["Target", "0:01:05"]])
        expect(request.headers).toEqual({ "Content-Type": "text/xml; charset=\"utf-8\"", "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#Seek\"" })
        expect(request.body).toContain("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">")
        expect(request.body).toContain("<u:Seek xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>0:01:05</Target></u:Seek>")
    })

    it("escapes the arguments (the metadata is XML inside XML)", () => {
        const request = soapRequest(AV_TRANSPORT, "SetAVTransportURI", [["InstanceID", 0], ["CurrentURI", "http://192.0.2.5/v.mp4?a=1&b=2"], ["CurrentURIMetaData", didlLite("http://192.0.2.5/v.mp4", "A <B>")]])
        expect(request.body).toContain("<CurrentURI>http://192.0.2.5/v.mp4?a=1&amp;b=2</CurrentURI>")
        expect(request.body).toContain("&lt;DIDL-Lite ")
        expect(request.body).toContain("&lt;dc:title&gt;A &amp;lt;B&amp;gt;&lt;/dc:title&gt;")
        expect(request.body).not.toContain("<DIDL-Lite")
    })

    it("reads the out values of an answer", () => {
        const xml = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>
<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PLAYING</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse></s:Body></s:Envelope>`
        expect(readSoapAnswer(xml, "GetTransportInfo")).toEqual({ ok: true, values: { CurrentTransportState: "PLAYING", CurrentTransportStatus: "OK", CurrentSpeed: "1" } })
        const empty = "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><u:PlayResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"/></s:Body></s:Envelope>"
        expect(readSoapAnswer(empty, "Play")).toEqual({ ok: true, values: {} })
        const metadata = `<s:Envelope><s:Body><u:GetPositionInfoResponse xmlns:u="x"><Track>1</Track><TrackMetaData>&lt;DIDL-Lite/&gt;</TrackMetaData><RelTime>0:00:42</RelTime><EmptyOne></EmptyOne></u:GetPositionInfoResponse></s:Body></s:Envelope>`
        expect(readSoapAnswer(metadata, "GetPositionInfo")).toEqual({ ok: true, values: { Track: "1", TrackMetaData: "<DIDL-Lite/>", RelTime: "0:00:42", EmptyOne: "" } })
    })

    it("reads a UPnP error", () => {
        const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>701</errorCode><errorDescription>Transition not available</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`
        expect(readSoapAnswer(xml, "Play")).toEqual({ ok: false, code: 701, description: "Transition not available" })
        expect(readSoapAnswer("<html/>", "Play").ok).toBe(false)
    })
})

describe("DIDL-Lite and times", () => {
    it("describes a video item with its resource", () => {
        const didl = didlLite("http://192.0.2.5/e1.mkv", "Episode 1", "http://192.0.2.5/a.jpg")
        expect(didl).toContain("<upnp:class>object.item.videoItem</upnp:class>")
        expect(didl).toContain("<res protocolInfo=\"http-get:*:video/x-matroska:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\">http://192.0.2.5/e1.mkv</res>")
        expect(didl).toContain("<upnp:albumArtURI>http://192.0.2.5/a.jpg</upnp:albumArtURI>")
        expect(didlLite("http://192.0.2.5/stream", "x")).toContain("http-get:*:*:*")
        expect(didlLite("http://192.0.2.5/stream", "x")).not.toContain("albumArtURI")
    })

    it("gives a video the DLNA features the outlet sends, so LG can seek it", () => {
        const outlet = readFileSync(join(__dirname, "../../../modules/core-torrent/cpp/StreamServer.cpp"), "utf8")
        expect(outlet).toContain(`contentFeatures.dlna.org: ${DLNA_VIDEO_FEATURES}\\r\\n`)
        expect(protocolInfoOf("http://192.0.2.5/t/Dr.%20STONE%20-%2001.mkv?audioTrack=1")).toBe(`http-get:*:video/x-matroska:${DLNA_VIDEO_FEATURES}`)
        expect(protocolInfoOf("http://192.0.2.5/list.m3u8")).toBe("http-get:*:application/vnd.apple.mpegurl:*")
    })

    it("guesses the type by the ending only", () => {
        expect(mediaTypeOf("http://h/v.mp4?x=1")).toBe("video/mp4")
        expect(mediaTypeOf("http://h/master.m3u8")).toBe("application/vnd.apple.mpegurl")
        expect(mediaTypeOf("http://example.com")).toBe("*")
    })

    it("writes and reads AVTransport times", () => {
        expect(upnpTime(0)).toBe("0:00:00")
        expect(upnpTime(3_725_999)).toBe("1:02:05")
        expect(upnpTimeMs("1:02:05")).toBe(3_725_000)
        expect(upnpTimeMs("00:00:01.500")).toBe(1500)
        expect(upnpTimeMs("0:00:01.1/4")).toBe(1250)
        expect(upnpTimeMs("NOT_IMPLEMENTED")).toBe(0)
        expect(upnpTimeMs(undefined)).toBe(0)
    })

    it("escapes and unescapes XML", () => {
        expect(xmlEscape("a<b>&\"'")).toBe("a&lt;b&gt;&amp;&quot;&apos;")
        expect(xmlUnescape("&lt;&#65;&#x42;&amp;amp;")).toBe("<AB&amp;")
        expect(elementText("<a:x y=\"1\"> t </a:x>", "x")).toBe("t")
        expect(elementText("<x/>", "x")).toBe("")
        expect(elementText("<y/>", "x")).toBeNull()
    })
})
