// API and application boundaries only. The complete production workspace/playlist UI is bundled unchanged.
import React from 'react'
const listeners = new Set<() => void>()
export const makeEpisode = (anime: number, number: number) => ({ episode: { baseAnime: { id: anime, title: { userPreferred: `Anime ${anime}` } }, aniDBEpisode: String(number), episodeNumber: number, progressNumber: number }, watchType: '', isCompleted: false, isNakama: false })
let state: any = { open: false, playlists: [{ dbId: 99, name: 'Protected original', episodes: [makeEpisode(1, 9)] }], selectedMedia: null, episodeToAdd: null, loading: false, error: false, fail: false, pending: false, language: 'en' }
export const probe: any = { writes: [], plays: [], update(values: any) { state = { ...state, ...values }; listeners.forEach(f => f()) }, get state() { return state } }
;(window as any).playlistProbe = probe
function useSnapshot() { return React.useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f) } }, () => state) }
export function useTr() { const s = useSnapshot(); return (en: string, de: string) => s.language === 'de' ? de : en }
export function usePlaylistEditorManager() { const s = useSnapshot(); return { isModalOpen: s.open, selectedMedia: s.selectedMedia, episodeToAdd: s.episodeToAdd, setModalOpen: (open: boolean) => probe.update({ open }), setSelectedMedia: (selectedMedia: number) => probe.update({ selectedMedia }), setEpisodeToAdd: (episodeToAdd: string) => probe.update({ episodeToAdd }) } }
export function useGetPlaylists() { const s = useSnapshot(); return { data: s.playlists, isLoading: s.loading, isError: s.error, refetch: () => probe.update({ error: false }) } }
const episodes = { 1: [1, 2, 3].map(n => makeEpisode(1, n)), 2: [1, 2].map(n => makeEpisode(2, n)) }
export function useGetPlaylistEpisodes(id: number) { const s = useSnapshot(); return { data: s.blockedMedia === id ? undefined : episodes[id as 1 | 2], isLoading: s.blockedMedia === id, isError: false, refetch() {} } }
function useMutation(type: string) { const s = useSnapshot(); return { isPending: s.pending, async mutateAsync(value: any) { probe.writes.push({ type, value }); probe.update({ pending: true }); await new Promise(r => setTimeout(r, 100)); probe.update({ pending: false }); if (state.fail) throw new Error('Controlled failure'); if (type === 'create') probe.update({ playlists: [...state.playlists, { dbId: 100, ...value }] }); if (type === 'update') probe.update({ playlists: state.playlists.map((p: any) => p.dbId === value.dbId ? value : p) }); if (type === 'delete') probe.update({ playlists: state.playlists.filter((p: any) => p.dbId !== value.dbId) }); return value } } }
export const useCreatePlaylist = () => useMutation('create')
export const useUpdatePlaylist = () => useMutation('update')
export const useDeletePlaylist = () => useMutation('delete')
export const usePlaylistManager = () => ({ startPlaylist: (p: any) => probe.plays.push(p) })
export const useHasTorrentStreaming = () => ({ hasTorrentStreaming: true })
export const useHasDebridService = () => ({ hasDebridService: true })
export const useHasOnlineStreaming = () => ({ hasOnlineStreaming: true })
export function Button({ children, leftIcon, loading, intent, className, ...props }: any) { return <button className={className} {...props}>{leftIcon}{children}</button> }
export function LoadingSpinner() { return <span role="status">Loading</span> }
export const toast = { error() {} }
