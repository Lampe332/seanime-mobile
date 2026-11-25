import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// player-screen.tsx renders mpv and cannot run in Node; these read its source for the two rules of the code check (06.11.).
const source = readFileSync(join(__dirname, "player-screen.tsx"), "utf8")

describe("player screen", () => {
    it("gives every mpv view its open options and subtitle look, also the new view of a refreshed online stream", () => {
        expect(source).toContain("key={viewKey}")
        // the options' key is the view's key (plus the headers of a stream played without the proxy, docs/EIGENER-KERN.md)
        expect(source).toContain("const optionsKey = headerOptions.length ? `${viewKey}|${headerOptions[0][1]}` : viewKey")
        expect(source).toMatch(/setOptionsView\(optionsKey\)\)[\s\S]{0,80}\}, \[optionsKey, headerOptions, anime4k\]\)/)
        // Anime4K's shaders (settings → Playback) go in with the open options, before the file plays
        expect(source).toContain("[...MPV_OPEN_OPTIONS, ...headerOptions, ...shaderOptions]")
        expect(source).toContain("const mpvOptionsSet = optionsView === optionsKey")
        const onLoad = source.slice(source.indexOf("onLoad={"), source.indexOf("onPlaybackStateChange={"))
        expect(onLoad).toContain("applySubtitleStyle()")
    })

    it("hands back the orientation when it goes without close()", () => {
        expect(source).toMatch(/React\.useEffect\(\(\) => \(\) => \{\s*endPlayerOrientation\(\)\s*\}, \[\]\)/)
        // swipes change neither the window brightness nor the media volume (Nick 24.11.)
        expect(source).not.toMatch(/writeBrightness|writeVolume|classifySwipe/)
        // close() and unmount end a fullscreen like leaving it (upright hold), never a bare unlock
        expect(source).not.toContain("releaseOrientation")
    })

    it("counts only played positions for the 80 % mark and treats an early end as an error", () => {
        const onProgress = source.slice(source.indexOf("onProgress={"), source.indexOf("onBuffer={"))
        expect(onProgress).toContain("playedPosition(")
        expect(onProgress).toContain("shouldSendCompleted(completedRef.current, played, d)")
        const ended = source.slice(source.indexOf("const handleEnded = () => {"), source.indexOf("events.ended(autoNext)"))
        expect(ended).toContain("endedEarly(playedRef.current.played, timeRef.current.duration)")
        expect(ended).toContain("onlineEvents.current.error(error)")
        // seeks reset it: the player's own (seekTo) and mpv's (lock screen)
        expect(source).toMatch(/const target = clampTime\(time, timeRef\.current\.duration\)\s*playedRef\.current = \{ played: target/)
        expect(source.slice(source.indexOf("onSeek={"), source.indexOf("onError={"))).toContain("seeking: true")
    })
})
