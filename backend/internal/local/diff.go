package local

import (
	"fmt"
	"seanime/internal/api/anilist"
)

// GetAnimeListDataKey returns a key of the entry's list data (status, progress, score, dates).
// Two entries with the same key need no update when the local account is copied to AniList.
func GetAnimeListDataKey(entry *anilist.AnimeListEntry) string {
	return fmt.Sprintf("%s-%d-%f-%d-%v-%v-%v-%v-%v-%v",
		mediaListStatusPointerValue(entry.GetStatus()),
		pointerValue(entry.GetProgress()),
		pointerValue(entry.GetScore()),
		pointerValue(entry.GetRepeat()),
		pointerValue(entry.GetStartedAt().GetYear()),
		pointerValue(entry.GetStartedAt().GetMonth()),
		pointerValue(entry.GetStartedAt().GetDay()),
		pointerValue(entry.GetCompletedAt().GetYear()),
		pointerValue(entry.GetCompletedAt().GetMonth()),
		pointerValue(entry.GetCompletedAt().GetDay()),
	)
}

// GetMangaListDataKey is GetAnimeListDataKey for manga entries.
func GetMangaListDataKey(entry *anilist.MangaListEntry) string {
	return fmt.Sprintf("%s-%d-%f-%d-%v-%v-%v-%v-%v-%v",
		mediaListStatusPointerValue(entry.GetStatus()),
		pointerValue(entry.GetProgress()),
		pointerValue(entry.GetScore()),
		pointerValue(entry.GetRepeat()),
		pointerValue(entry.GetStartedAt().GetYear()),
		pointerValue(entry.GetStartedAt().GetMonth()),
		pointerValue(entry.GetStartedAt().GetDay()),
		pointerValue(entry.GetCompletedAt().GetYear()),
		pointerValue(entry.GetCompletedAt().GetMonth()),
		pointerValue(entry.GetCompletedAt().GetDay()),
	)
}

func pointerValue[A int | float64](a *A) A {
	if a == nil {
		return 0
	}
	return *a
}

func mediaListStatusPointerValue(a *anilist.MediaListStatus) anilist.MediaListStatus {
	if a == nil {
		return anilist.MediaListStatusPlanning
	}
	return *a
}
