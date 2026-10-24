package local

import (
	"seanime/internal/api/anilist"
	"seanime/internal/database/db"
	"seanime/internal/platforms/platform"
	"seanime/internal/testmocks"
	"seanime/internal/testutil"
	"seanime/internal/util"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSynchronizeSimulatedCollectionToAnilistCreatesMissingEntries(t *testing.T) {
	manager := newClosingTestManager(t)
	managerImpl := manager.(*ManagerImpl)

	animeStatus := anilist.MediaListStatusCurrent
	animeEntry := &anilist.AnimeListEntry{
		Media:    testmocks.NewBaseAnimeBuilder(130003, "Bocchi the Rock!").Build(),
		Progress: new(3),
		Score:    new(0.0),
		Repeat:   new(0),
		Status:   &animeStatus,
	}
	mangaStatus := anilist.MediaListStatusPlanning
	mangaEntry := &anilist.MangaListEntry{
		Media:    testmocks.NewBaseMangaBuilder(101517, "Jujutsu Kaisen").Build(),
		Progress: new(0),
		Score:    new(0.0),
		Repeat:   new(0),
		Status:   &mangaStatus,
	}

	manager.SaveSimulatedAnimeCollection(&anilist.AnimeCollection{
		MediaListCollection: &anilist.AnimeCollection_MediaListCollection{
			Lists: []*anilist.AnimeCollection_MediaListCollection_Lists{{Status: &animeStatus, Entries: []*anilist.AnimeListEntry{animeEntry}}},
		},
	})
	manager.SaveSimulatedMangaCollection(&anilist.MangaCollection{
		MediaListCollection: &anilist.MangaCollection_MediaListCollection{
			Lists: []*anilist.MangaCollection_MediaListCollection_Lists{{Status: &mangaStatus, Entries: []*anilist.MangaListEntry{mangaEntry}}},
		},
	})

	// The AniList account has neither entry yet.
	manager.SetAnimeCollection(&anilist.AnimeCollection{MediaListCollection: &anilist.AnimeCollection_MediaListCollection{}})
	manager.SetMangaCollection(&anilist.MangaCollection{MediaListCollection: &anilist.MangaCollection_MediaListCollection{}})

	fakePlatform := testmocks.NewFakePlatformBuilder().Build()
	managerImpl.anilistPlatformRef = util.NewRef[platform.Platform](fakePlatform)

	require.NoError(t, manager.SynchronizeSimulatedCollectionToAnilist())

	updateCalls := fakePlatform.UpdateEntryCalls()
	require.Len(t, updateCalls, 2)
	for _, call := range updateCalls {
		switch call.MediaID {
		case 130003:
			require.Equal(t, &animeStatus, call.Status)
		case 101517:
			require.Equal(t, &mangaStatus, call.Status)
		default:
			t.Fatalf("unexpected update for media %d", call.MediaID)
		}
	}
}

func TestSynchronizeAnilistToSimulatedCollectionCopiesAccountLists(t *testing.T) {
	manager := newClosingTestManager(t)

	status := anilist.MediaListStatusCompleted
	entry := &anilist.AnimeListEntry{
		Media:  testmocks.NewBaseAnimeBuilder(21, "One Piece").Build(),
		Status: &status,
	}
	manager.SetAnimeCollection(&anilist.AnimeCollection{
		MediaListCollection: &anilist.AnimeCollection_MediaListCollection{
			Lists: []*anilist.AnimeCollection_MediaListCollection_Lists{{Status: &status, Entries: []*anilist.AnimeListEntry{entry}}},
		},
	})

	require.True(t, manager.GetSimulatedAnimeCollection().IsAbsent())
	require.NoError(t, manager.SynchronizeAnilistToSimulatedCollection())

	collection, ok := manager.GetSimulatedAnimeCollection().Get()
	require.True(t, ok)
	_, found := collection.GetListEntryFromAnimeId(21)
	require.True(t, found)
}

// newClosingTestManager closes both databases after the test, so the temp dir can be removed on Windows.
func newClosingTestManager(t *testing.T) Manager {
	env := testutil.NewTestEnv(t)
	database := env.MustNewDatabase(env.Logger())
	manager := NewTestManager(t, database)
	t.Cleanup(func() {
		closeGorm(database)
		if sqlDB, err := manager.(*ManagerImpl).localDb.gormdb.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return manager
}

func closeGorm(database *db.Database) {
	if sqlDB, err := database.Gorm().DB(); err == nil {
		_ = sqlDB.Close()
	}
}
