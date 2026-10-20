import React from "react"
import { createRoot } from "react-dom/client"
import Page from "../backend/seanime-web/src/app/(main)/android-downloads/page"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

const key = (n: number) => n.toString(16).padStart(64, "0") + ".jpg"
const w = window as any
w.routes = []; w.fetches = []; w.actions = []; w.snapshots = 0
w.mangaQueue = [{ provider: "comick", mediaId: 30013, chapterId: "c3", chapterNumber: "3", status: "downloading", id: 1 }]
const base = { quality: "1080p", provider: "animetoast", format: "TV", year: 2023, duration: 24, score: 91 }
w.library = [
    ...[1, 2, 3].map(n => ({ ...base, id: `fr-${n}`, mediaId: 154587, title: "Frieren: Beyond Journey's End", episode: String(n), ready: true, status: "ready", progress: 100,
        bytes: 312 * 1024 ** 2 + n * 9e6, position: n === 2 ? 12 * 60000 + 31000 : 0, coverAsset: key(1), bannerAsset: key(2), episodeImageAsset: key(10 + n),
        episodeTitle: ["The Journey's End", "It Didn't Have to Be Magic...", "Killing Magic"][n - 1], genres: ["Adventure", "Drama", "Fantasy"],
        description: "The adventure is over but life goes on for an elf mage just beginning to learn what living is all about." })),
    { ...base, id: "dd-1", mediaId: 171018, title: "Dandadan", episode: "1", ready: true, status: "ready", progress: 100, bytes: 280 * 1024 ** 2, position: 0, coverAsset: key(3), episodeImageAsset: key(20), episodeTitle: "That's How Love Starts, Ya Know!" },
    { ...base, id: "dd-2", mediaId: 171018, title: "Dandadan", episode: "2", ready: false, status: "downloading", progress: 42, bytes: 118 * 1024 ** 2, position: 0, coverAsset: key(3), episodeImageAsset: key(21), episodeTitle: "That's a Space Alien, Ain't It?!" },
    { ...base, id: "hm-1", mediaId: 209983, title: "HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing", episode: "1", ready: false, status: "paused", progress: 12, bytes: 40 * 1024 ** 2, position: 0, coverAsset: key(4) },
]
// "#late-token": the native shell injects the bridge token only after the page has rendered (cold start).
if (location.hash === "#late-token") setTimeout(() => { w.__seanimeOfflineToken = "token" }, 1500)
else w.__seanimeOfflineToken = "token"
w.SeanimeOffline = {
    snapshot: () => { w.snapshots++; return JSON.stringify(w.library) },
    action: (_t: string, id: string, value: string) => w.actions.push([id, value]),
    cacheManga: () => JSON.stringify({ coverAsset: key(5) }),
}
createRoot(document.getElementById("root")!).render(<Page />)
