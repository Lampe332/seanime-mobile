import { Anime_Episode } from "@/api/generated/types"
import { atom } from "jotai"
import { atomFamily } from "jotai/utils"

export const missingEpisodesAtom = atom<Anime_Episode[]>([])

export const missingSilencedEpisodesAtom = atom<Anime_Episode[]>([])

export const missingEpisodeCountAtom = atom(get => get(missingEpisodesAtom).length)

const missingEpisodesIndexAtom = atom<Record<number, true>>((get) => {
	const index: Record<number, true> = {}

	get(missingEpisodesAtom).forEach(episode => {
		const mediaId = episode.baseAnime?.id
		if (!mediaId) {
			return
		}

		index[mediaId] = true
	})

	return index
})

export const hasMissingEpisodesAtom = atomFamily((mediaId: number) => atom((get) => !!get(missingEpisodesIndexAtom)[mediaId]))

