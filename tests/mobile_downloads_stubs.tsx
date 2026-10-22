import React from "react"
import { atom } from "jotai"
// Downloads harness: URL-backed router, fixture server for manga downloads, no reader.
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
export const useRouter = () => ({ push: (href: string) => { history.pushState(null, "", href); (window as any).routes.push(href); notify() } })
export const useSearchParams = () => new URLSearchParams(React.useSyncExternalStore(subscribe, () => location.search))
const h = (n: number) => n.toString(16).padStart(64, "0") + ".jpg"
const media = { id: 30013, title: { userPreferred: "Overgeared" }, genres: ["Action", "Fantasy", "Adventure"], description: "Shin Youngwoo has had an unfortunate life and is now stuck carrying bricks on construction sites." }
export const useSeaQuery = () => ({
    seaFetch: async (url: string) => {
        (window as any).fetches.push(url)
        if (url === "/api/v1/manga/downloads") return [{ mediaId: 30013, media, downloadData: { comick: [{ chapterId: "c1", chapterNumber: "1" }, { chapterId: "c2", chapterNumber: "2" }] } }]
        if (url === "/api/v1/manga/download-queue") return (window as any).mangaQueue
        if (url.startsWith("/api/v1/manga/downloaded-chapters/")) return [{ provider: "comick", mediaId: 30013, chapters: [{ id: "c1", chapter: "1" }, { id: "c2", chapter: "2" }] }]
        return null
    },
})
export const ChapterReaderDrawer = () => <div data-chapter-reader-drawer-content />
export const useHandleMangaDownloadData = () => {}
export const __manga_selectedChapterAtom = atom<any>(undefined)
export const useQueryClient = () => ({ invalidateQueries: async () => {} })
export const usePathname = () => location.pathname
// The Torrents tab's hooks: no torrent provider installed, so the tab stays hidden here (tests/mobile_torrents.py covers it)
const idle = { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: async () => {} }
export const useQuery = () => idle
export const useMutation = () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false })
export const useServerQuery = (options: any) => options?.endpoint === "/api/v1/extensions/list/anime-torrent-provider" ? { ...idle, data: [] } : idle
export const useServerMutation = () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false })
export const buildSeaQuery = async () => null
export const assetKey = h
