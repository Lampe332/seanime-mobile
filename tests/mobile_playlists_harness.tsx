import React from 'react'
import { createRoot } from 'react-dom/client'
import { MobilePlaylists } from '../backend/seanime-web/src/app/(main)/_features/playlists/_components/mobile-playlists'
import { probe } from './mobile_playlists_stubs'
const entries = [1, 2].map(mediaId => ({ mediaId, media: { id: mediaId, title: { userPreferred: mediaId === 1 ? 'A very long anime title that should wrap safely without hiding content on a narrow mobile display' : 'Second Anime', romaji: mediaId === 1 ? 'First Anime' : 'Second Anime' } } }))
function Harness() { return <><button onClick={() => probe.update({ open: true })}>Open playlists</button><main style={{ height: 1800 }}>Controlled Home</main><MobilePlaylists libraryCollection={{ lists: [{ type: 'CURRENT', entries: [entries[0]] }, { type: 'PLANNING', entries: [entries[1]] }] } as any} libraryLoading={false} /></> }
createRoot(document.getElementById('root')!).render(<Harness />)
