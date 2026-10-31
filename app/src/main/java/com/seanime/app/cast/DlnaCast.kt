package com.seanime.app.cast

import android.content.Context
import android.net.wifi.WifiManager
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.security.SecureRandom

/** A TV or other UPnP media renderer on the network. */
data class Renderer(val name: String, val avTransportUrl: String, val renderingControlUrl: String?)

/** A refused UPnP action; 701 ("transition not available") is what LG TVs answer while they are off or in standby. */
class UpnpException(val code: Int) : Exception("UPnP error $code")

/** What a renderer reports: play state, place and length in ms, volume 0..100 (-1 unknown). */
data class CastStatus(val playing: Boolean, val positionMs: Long, val durationMs: Long, val volume: Int, val ended: Boolean)

/**
 * Casting to DLNA renderers (LG, Samsung, Sony TVs …): find them by SSDP, hand them a stream URL and control playback
 * over UPnP AVTransport. The app's server only listens on the phone itself, so [CastProxy] makes the one cast stream
 * reachable for the TV while casting.
 */
object DlnaCast {
    private const val AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1"
    private const val RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1"

    /** Renderers that answer an SSDP search within [timeoutMs]. Blocks; needs Wi-Fi. */
    fun discover(context: Context, timeoutMs: Int = 3000): List<Renderer> {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val lock = wifi.createMulticastLock("seanime-cast").apply { setReferenceCounted(false); acquire() }
        val locations = linkedSetOf<String>()
        try {
            MulticastSocket(null).use { socket ->
                socket.reuseAddress = true
                socket.bind(InetSocketAddress(0))
                socket.soTimeout = 500
                val search = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n" +
                    "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n").toByteArray()
                val group = InetAddress.getByName("239.255.255.250")
                repeat(2) { socket.send(DatagramPacket(search, search.size, group, 1900)) }
                val buffer = ByteArray(4096)
                val end = System.currentTimeMillis() + timeoutMs
                while (System.currentTimeMillis() < end) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    String(packet.data, 0, packet.length).lineSequence()
                        .firstOrNull { it.startsWith("location:", ignoreCase = true) }
                        ?.substringAfter(':')?.trim()?.let { locations.add(it) }
                }
            }
        } finally {
            lock.release()
        }
        return locations.mapNotNull { describe(it) }.distinctBy { it.avTransportUrl }
    }

    /** Name and AVTransport control URL from a renderer's device description. */
    private fun describe(location: String): Renderer? = try {
        val xml = http(location, null, null)
        val name = Regex("<friendlyName>(.*?)</friendlyName>").find(xml)?.groupValues?.get(1)?.let(::unescape) ?: "TV"
        fun control(service: String) = Regex("<serviceType>${Regex.escape(service)}</serviceType>.*?<controlURL>(.*?)</controlURL>", RegexOption.DOT_MATCHES_ALL)
            .find(xml)?.groupValues?.get(1)?.let { URL(URL(location), it).toString() }
        control(AV_TRANSPORT)?.let { Renderer(name, it, control(RENDERING_CONTROL)) }
    } catch (_: Exception) {
        null
    }

    fun play(renderer: Renderer, url: String, title: String, startSeconds: Long, artworkUrl: String = "") {
        val metadata = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" " +
            "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"-1\" restricted=\"1\">" +
            "<dc:title>${escape(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class>" +
            (if (artworkUrl.isNotBlank()) "<upnp:albumArtURI>${escape(artworkUrl)}</upnp:albumArtURI>" else "") +
            "<res protocolInfo=\"http-get:*:video/x-matroska:$DLNA_FEATURES\">${escape(url)}</res></item></DIDL-Lite>"
        // LG refuses a new video (701) while an earlier one is still loaded or loading
        try {
            soap(renderer, "Stop", "")
        } catch (_: Exception) {
        }
        soap(renderer, "SetAVTransportURI", "<CurrentURI>${escape(url)}</CurrentURI><CurrentURIMetaData>${escape(metadata)}</CurrentURIMetaData>")
        // the TV answers Play only once it has opened the video
        soap(renderer.avTransportUrl, AV_TRANSPORT, "Play", "<Speed>1</Speed>", 30_000)
        if (startSeconds > 5) {
            // the TV answers a seek before it plays, but only follows it once it plays
            for (attempt in 0 until 15) {
                Thread.sleep(1000)
                val state = try { Regex("<CurrentTransportState>(\\w+)").find(soap(renderer, "GetTransportInfo", ""))?.groupValues?.get(1) } catch (_: Exception) { null }
                if (state != "PLAYING") continue
                try {
                    seek(renderer, startSeconds * 1000)
                } catch (_: Exception) {
                }
                break
            }
        }
    }

    /** DLNA flags for the stream: byte-range seeking (OP=01), streaming transfer; without them LG does not seek. */
    const val DLNA_FEATURES = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"

    fun pause(renderer: Renderer) = soap(renderer, "Pause", "")
    fun resume(renderer: Renderer) = soap(renderer, "Play", "<Speed>1</Speed>")
    fun stop(renderer: Renderer) = soap(renderer, "Stop", "")
    fun seek(renderer: Renderer, ms: Long) = soap(renderer, "Seek", "<Unit>REL_TIME</Unit><Target>${clock(ms / 1000)}</Target>")

    fun setVolume(renderer: Renderer, percent: Int) {
        val url = renderer.renderingControlUrl ?: return
        soap(url, RENDERING_CONTROL, "SetVolume", "<Channel>Master</Channel><DesiredVolume>${percent.coerceIn(0, 100)}</DesiredVolume>")
    }

    fun status(renderer: Renderer): CastStatus {
        val position = soap(renderer, "GetPositionInfo", "")
        val state = Regex("<CurrentTransportState>(\\w+)").find(soap(renderer, "GetTransportInfo", ""))?.groupValues?.get(1) ?: ""
        val volume = renderer.renderingControlUrl?.let { url ->
            try {
                Regex("<CurrentVolume>(\\d+)").find(soap(url, RENDERING_CONTROL, "GetVolume", "<Channel>Master</Channel>"))?.groupValues?.get(1)?.toInt()
            } catch (_: Exception) {
                null
            }
        } ?: -1
        // LG reports its own LG_TRANSITIONING while it loads
        return CastStatus(state == "PLAYING" || state.endsWith("TRANSITIONING"), seconds(position, "RelTime") * 1000, seconds(position, "TrackDuration") * 1000,
            volume, state == "STOPPED" || state == "NO_MEDIA_PRESENT")
    }

    /** Where the TV is in the video, in seconds; 0 when it does not say. */
    fun position(renderer: Renderer): Long = try {
        seconds(soap(renderer, "GetPositionInfo", ""), "RelTime")
    } catch (_: Exception) {
        0
    }

    private fun seconds(reply: String, element: String) =
        Regex("<$element>(\\d+):(\\d+):(\\d+)").find(reply)?.destructured?.let { (h, m, s) -> h.toLong() * 3600 + m.toLong() * 60 + s.toLong() } ?: 0

    private fun soap(renderer: Renderer, action: String, arguments: String) = soap(renderer.avTransportUrl, AV_TRANSPORT, action, arguments)

    private fun soap(url: String, service: String, action: String, arguments: String, timeoutMs: Int = 8000): String {
        val body = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
            "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:$action xmlns:u=\"$service\">" +
            "<InstanceID>0</InstanceID>$arguments</u:$action></s:Body></s:Envelope>"
        return http(url, body, "\"$service#$action\"", timeoutMs)
    }

    private fun http(url: String, body: String?, soapAction: String?, timeoutMs: Int = 8000): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 5000
        conn.readTimeout = timeoutMs
        try {
            if (body != null) {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"")
                soapAction?.let { conn.setRequestProperty("SOAPACTION", it) }
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            if (conn.responseCode >= 400) {
                val fault = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val code = Regex("<errorCode>(\\d+)</errorCode>").find(fault)?.groupValues?.get(1)?.toInt() ?: conn.responseCode
                throw UpnpException(code)
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun clock(seconds: Long) = String.format(java.util.Locale.US, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    private fun escape(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
    private fun unescape(text: String) = text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&")
}

/**
 * Makes one stream of the app's local server reachable on the Wi-Fi network for the TV, under a random path, while casting.
 * It forwards byte ranges so the TV can seek; every other path gets 404.
 */
class CastProxy(private val target: String) {
    private val token = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private var server: ServerSocket? = null

    /** The URL the TV opens, or null without a Wi-Fi address. */
    fun start(): String? {
        val address = wifiAddress() ?: return null
        val socket = ServerSocket(0, 8, address)
        server = socket
        Thread {
            while (!socket.isClosed) {
                val client = try {
                    socket.accept()
                } catch (_: Exception) {
                    break
                }
                Thread { serve(client) }.start()
            }
        }.start()
        return "http://${address.hostAddress}:${socket.localPort}/$token"
    }

    fun stop() {
        try {
            server?.close()
        } catch (_: Exception) {
        }
        server = null
    }

    private fun serve(client: Socket) = client.use {
        client.soTimeout = 30_000
        val input = BufferedInputStream(client.getInputStream())
        val request = readLine(input) ?: return
        val headers = generateSequence { readLine(input)?.takeIf { it.isNotEmpty() } }.associate {
            it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim()
        }
        val (method, path) = request.split(' ').let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "") }
        val out = client.getOutputStream()
        if (path != "/$token" || (method != "GET" && method != "HEAD")) {
            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            return
        }
        val upstream = URL(target).openConnection() as HttpURLConnection
        try {
            upstream.connectTimeout = 10_000
            upstream.readTimeout = 60_000
            headers["range"]?.let { upstream.setRequestProperty("Range", it) }
            if (method == "HEAD") upstream.requestMethod = "HEAD"
            val status = upstream.responseCode
            val reply = StringBuilder("HTTP/1.1 $status ${if (status == 206) "Partial Content" else "OK"}\r\n")
            reply.append("Content-Type: video/x-matroska\r\n")
            listOf("Content-Length", "Content-Range", "Accept-Ranges").forEach { name ->
                upstream.getHeaderField(name)?.let { reply.append("$name: $it\r\n") }
            }
            reply.append("transferMode.dlna.org: Streaming\r\n")
            reply.append("contentFeatures.dlna.org: ${DlnaCast.DLNA_FEATURES}\r\n")
            reply.append("Connection: close\r\n\r\n")
            out.write(reply.toString().toByteArray())
            if (method == "GET") copy(if (status >= 400) upstream.errorStream else upstream.inputStream, out)
        } catch (_: Exception) {
            // the TV closes connections when it seeks
        } finally {
            upstream.disconnect()
        }
    }

    private fun copy(source: java.io.InputStream?, out: OutputStream) {
        source?.use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
            }
        }
    }

    private fun readLine(input: BufferedInputStream): String? {
        val line = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return if (line.isEmpty()) null else line.toString()
            if (c == '\n'.code) return line.toString().trimEnd('\r')
            if (line.length > 8192) return null
            line.append(c.toChar())
        }
    }

    private fun wifiAddress(): InetAddress? = NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback && (it.name.startsWith("wlan") || it.name.startsWith("eth")) }
        .flatMap { it.inetAddresses.toList() }
        .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
}
