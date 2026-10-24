import React from "react"
import { createRoot } from "react-dom/client"
import { AnilistMediaEntryModal } from "../backend/seanime-web/src/app/(main)/_features/media/_containers/anilist-media-entry-modal"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"
import "../backend/seanime-web/src/app/(main)/entry/_components/mobile-anime.css"
const media: any = { id: 209983, status: "FINISHED", episodes: 13, title: { userPreferred: "HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing Season 2" }, coverImage: {} }
const listData: any = { status: "CURRENT", progress: 10, score: 75, repeat: 0, startedAt: "2026-09-05" }
const manga: any = { id: 5, status: "RELEASING", chapters: 40, title: { userPreferred: "Controlled manga" }, coverImage: {} }
createRoot(document.getElementById("root")!).render(<div data-mobile-anime="true" style={{ padding: 16 }}>
    <div id="mobile"><AnilistMediaEntryModal mobileEntry listData={listData} media={media} type="anime" /></div>
    <div id="desktop"><AnilistMediaEntryModal listData={listData} media={media} type="anime" /></div>
    <div id="manga"><AnilistMediaEntryModal mobileEntry listData={{ ...listData, repeat: 2 }} media={manga} type="manga" /></div>
</div>)
