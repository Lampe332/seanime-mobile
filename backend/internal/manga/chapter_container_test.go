package manga

import (
	"testing"

	hibikemanga "seanime/internal/extension/hibike/manga"

	"github.com/stretchr/testify/require"
)

func TestGetLatestMangaChapterNumberUsesChapterValue(t *testing.T) {
	chapters := []*hibikemanga.ChapterDetails{
		{Chapter: "205", Index: 0},
		{Chapter: "204.5", Index: 1},
		{Chapter: "1", Index: 205},
	}

	require.Equal(t, 205, getLatestMangaChapterNumber(chapters))
}

func TestTiedBestSearchResultsFindsEquallyRatedDuplicates(t *testing.T) {
	// MangaFire search for "Overgeared" lists the full entry and an old duplicate with the same title and rating.
	searchRes := []*hibikemanga.SearchResult{
		{ID: "728q1", Title: "Overgeared (Team Argo)", SearchRating: 0.6},
		{ID: "yqwpx", Title: "Overgeared (Team Argo)", SearchRating: 0.6},
		{ID: "qn0o3", Title: "Fanpai", SearchRating: 0.6},
		{ID: "728q1", Title: "Overgeared (Team Argo)", SearchRating: 0.6},
		{ID: "k9mnr", Title: "Overgeared (Team Argo)", SearchRating: 0.2},
	}

	best := GetBestSearchResult(searchRes)
	tied := TiedBestSearchResults(searchRes, best)

	require.Equal(t, "728q1", best.ID)
	require.Len(t, tied, 2)
	require.Equal(t, "728q1", tied[0].ID)
	require.Equal(t, "yqwpx", tied[1].ID)
	require.Len(t, TiedBestSearchResults(searchRes[2:3], searchRes[2]), 1)
}
