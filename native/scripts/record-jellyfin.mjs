#!/usr/bin/env node
/*
 * Records the answers of a real Jellyfin server for src/core/jellyfin/jellyfin.recorded.json.
 *
 *   JELLYFIN_URL=http://localhost:8096 JELLYFIN_USER=… JELLYFIN_PASSWORD=… node scripts/record-jellyfin.mjs
 *   … node scripts/record-jellyfin.mjs --refresh   only asks the server to read its library again, records nothing
 *
 * It asks what core/jellyfin/client.ts asks (same paths, same query), plus PlaybackInfo and the external subtitle of
 * the first episode that has one, and the ani.zip entries named in ANILIST_IDS (cut down to what the matching reads).
 * Before writing, everything secret or personal is replaced: token, password, user, session, device and server ids,
 * the user's name, the remote address and every absolute path of the PC. The run fails rather than write a file that
 * still holds one of them.
 */
import { writeFileSync } from "node:fs"
import { userInfo } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "core", "jellyfin", "jellyfin.recorded.json")
// the AniList titles the test library holds: Cowboy Bebop, Mob Psycho 100, Mob Psycho 100 II
const ANILIST_IDS = [1, 21507, 101338]
const IDENTITY = { device: "recorder", deviceId: "record-device", version: "0.0.0" }

const base = (process.env.JELLYFIN_URL ?? "").replace(/\/+$/, "")
const username = process.env.JELLYFIN_USER ?? ""
const password = process.env.JELLYFIN_PASSWORD ?? ""
if (!base || !username || !password) {
    console.error("JELLYFIN_URL, JELLYFIN_USER and JELLYFIN_PASSWORD must be set")
    process.exit(2)
}

const authorization = token =>
    `MediaBrowser Client="Seanime Mobile", Device="${IDENTITY.device}", DeviceId="${IDENTITY.deviceId}", Version="${IDENTITY.version}"` + (token ? `, Token="${token}"` : "")

async function call(path, { token, method = "GET", body, raw = false } = {}) {
    const headers = { Accept: raw ? "*/*" : "application/json" }
    if (token !== null) headers.Authorization = authorization(token)
    if (body) headers["Content-Type"] = "application/json"
    const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (raw) return { status: response.status, contentType: response.headers.get("content-type") ?? "", text: await response.text() }
    if (response.status < 200 || response.status > 299) throw new Error(`${method} ${path.split("?")[0]} answered ${response.status}`)
    return response.status === 204 ? null : response.json()
}

const query = pairs => Object.entries(pairs).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")

/** ani.zip, cut down to the fields core/library/metadata.ts reads for the matching */
async function anizipOf(id) {
    const response = await fetch(`https://api.ani.zip/mappings?anilist_id=${id}`, { headers: { Accept: "application/json" } })
    if (response.status !== 200) throw new Error(`ani.zip answered ${response.status} for ${id}`)
    const full = await response.json()
    const episodes = {}
    for (const [key, episode] of Object.entries(full.episodes ?? {})) {
        episodes[key] = { episodeNumber: episode.episodeNumber, seasonNumber: episode.seasonNumber, absoluteEpisodeNumber: episode.absoluteEpisodeNumber }
    }
    return { titles: full.titles, episodes, episodeCount: full.episodeCount, specialCount: full.specialCount, mappings: full.mappings }
}

const info = await call("/System/Info/Public", {})
const auth = await call("/Users/AuthenticateByName", { method: "POST", body: { Username: username, Pw: password } })
const token = auth.AccessToken
const userId = auth.User.Id

if (process.argv.includes("--refresh")) {
    await call("/Library/Refresh", { token, method: "POST" })
    console.log("library refresh asked")
}
else await record()

async function record() {
    const items = await call(`/Items?${query({ userId, includeItemTypes: "Series,Movie", recursive: true, fields: "ProviderIds,Path", startIndex: 0, limit: 200 })}`, { token })
    const shows = {}
    let subtitle = null
    let playbackInfo = null
    for (const series of items.Items.filter(item => item.Type === "Series")) {
        const seasons = await call(`/Shows/${series.Id}/Seasons?${query({ userId, fields: "ProviderIds" })}`, { token })
        const episodes = await call(`/Shows/${series.Id}/Episodes?${query({ userId, fields: "ProviderIds,MediaSources", isMissing: false })}`, { token })
        shows[series.Id] = { seasons, episodes }
        for (const episode of episodes.Items) {
            const source = episode.MediaSources?.[0]
            const stream = source?.MediaStreams?.find(one => one.Type === "Subtitle" && one.IsExternal)
            if (subtitle || !stream) continue
            playbackInfo = { episodeId: episode.Id, answer: await call(`/Items/${episode.Id}/PlaybackInfo?${query({ userId })}`, { token }) }
            const path = `/Videos/${episode.Id}/${source.Id}/Subtitles/${stream.Index}/Stream.${{ subrip: "srt", ass: "ass", ssa: "ass" }[stream.Codec] ?? "vtt"}`
            const withHeader = await call(path, { token, raw: true })
            const without = await call(path, { token: null, raw: true })
            subtitle = {
                episodeId: episode.Id, mediaSourceId: source.Id, index: stream.Index, path,
                withAuthorization: withHeader, withoutAuthorization: { status: without.status, contentType: without.contentType },
            }
        }
    }
    const anizip = {}
    for (const id of ANILIST_IDS) anizip[id] = await anizipOf(id)

    const recording = {
        _: `echte Aufzeichnung vom Testserver, geschrieben von scripts/record-jellyfin.mjs am ${new Date().toISOString().slice(0, 10)}, Jellyfin ${info.Version}. `
            + "Aufrufe wie core/jellyfin/client.ts (Anmeldung, /System/Info/Public, /Items, /Shows/{id}/Seasons, /Shows/{id}/Episodes), dazu PlaybackInfo und der "
            + "externe Untertitel einer Folge; ani.zip auf die Felder des Abgleichs gekürzt. Ersetzt: Token, Kennungen von Nutzer, Sitzung, Gerät und Server, "
            + "Nutzername, Gegenstelle, absolute Pfade des PCs. Nicht von Hand ändern, neu aufzeichnen.",
        serverVersion: info.Version,
        info, auth, items, shows, playbackInfo, subtitle, anizip,
    }

    // what must not reach the file, and what stands there instead
    const replaced = [
        [token, "REDACTED"], [password, "REDACTED"], [userId, "recorded-user"], [auth.SessionInfo?.Id, "recorded-session"],
        [auth.ServerId ?? info.Id, "recorded-server"], [username, "tester"], [info.LocalAddress, "http://recorded-server:8096"],
        [auth.SessionInfo?.RemoteEndPoint, "recorded-remote"], [info.ServerName, "recorded-server-name"],
    ].filter(pair => typeof pair[0] === "string" && pair[0] !== "")

    /** An absolute path of the PC becomes a path below /media (or /redacted), with forward slashes */
    function withoutLocalPath(value) {
        if (!/^([A-Za-z]:[\\/]|\\\\|\/(home|Users|mnt)\/)/.test(value)) return value
        const parts = value.split(/[\\/]+/)
        const at = parts.findIndex(part => part.toLowerCase() === "media")
        return at >= 0 ? `/${parts.slice(at).join("/")}` : `/redacted/${parts[parts.length - 1]}`
    }

    function cleaned(value) {
        if (Array.isArray(value)) return value.map(cleaned)
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, cleaned(inner)]))
        if (typeof value !== "string") return value
        let out = withoutLocalPath(value)
        for (const [secret, placeholder] of replaced) out = out.split(secret).join(placeholder)
        return out
    }

    const output = JSON.stringify(cleaned(recording), null, 2) + "\n"
    const forbidden = [token, password, userId, userInfo().username, ":\\\\", auth.SessionInfo?.Id].filter(Boolean)
    const left = forbidden.filter(secret => output.toLowerCase().includes(String(secret).toLowerCase()))
    if (left.length) {
        throw new Error(`not written: ${left.length} secret or personal value(s) would still be in the file`)
    }
    writeFileSync(OUT, output)
    console.log(`recorded Jellyfin ${info.Version}: ${items.Items.length} items, ${Object.keys(shows).length} shows, subtitle ${subtitle ? `index ${subtitle.index}` : "none"}`)
}
