package local

import (
	"context"
	"fmt"
	"os"
	"seanime/internal/api/anilist"
	"seanime/internal/events"
	"seanime/internal/platforms/platform"
	"seanime/internal/util"

	"github.com/rs/zerolog"
	"github.com/samber/mo"
)

const (
	AnimeType = "anime"
	MangaType = "manga"
)

// Manager keeps the lists of the local account (the simulated platform used when not signed in to AniList)
// and copies them from/to the user's AniList account.
type Manager interface {
	// SetAnimeCollection updates the online anime collection in the manager.
	SetAnimeCollection(ac *anilist.AnimeCollection)
	// SetMangaCollection updates the online manga collection in the manager.
	SetMangaCollection(mc *anilist.MangaCollection)
	// SetRefreshAnilistCollectionsFunc sets the function to call to refresh the online AniList collections.
	SetRefreshAnilistCollectionsFunc(func())
	// GetSimulatedAnimeCollection returns the simulated anime collection for unauthenticated users.
	GetSimulatedAnimeCollection() mo.Option[*anilist.AnimeCollection]
	// GetSimulatedMangaCollection returns the simulated manga collection for unauthenticated users.
	GetSimulatedMangaCollection() mo.Option[*anilist.MangaCollection]
	// SaveSimulatedAnimeCollection sets the simulated anime collection for unauthenticated users.
	SaveSimulatedAnimeCollection(ac *anilist.AnimeCollection)
	// SaveSimulatedMangaCollection sets the simulated manga collection for unauthenticated users.
	SaveSimulatedMangaCollection(mc *anilist.MangaCollection)
	// SynchronizeSimulatedCollectionToAnilist synchronizes the simulated anime and manga collections to the user's AniList account.
	SynchronizeSimulatedCollectionToAnilist() error
	// SynchronizeAnilistToSimulatedCollection synchronizes the user's AniList account to the simulated anime and manga collections.
	SynchronizeAnilistToSimulatedCollection() error
}

type (
	ManagerImpl struct {
		localDb            *Database
		logger             *zerolog.Logger
		wsEventManager     events.WSEventManagerInterface
		anilistPlatformRef *util.Ref[platform.Platform]

		// Anime collection from the user's AniList account, changed by ManagerImpl.SetAnimeCollection
		animeCollection mo.Option[*anilist.AnimeCollection]
		// Manga collection from the user's AniList account, changed by ManagerImpl.SetMangaCollection
		mangaCollection mo.Option[*anilist.MangaCollection]

		RefreshAnilistCollectionsFunc func()
	}

	NewManagerOptions struct {
		// LocalDir holds local.db (the local account's lists).
		LocalDir           string
		Logger             *zerolog.Logger
		WSEventManager     events.WSEventManagerInterface
		AnilistPlatformRef *util.Ref[platform.Platform]
	}
)

func NewManager(opts *NewManagerOptions) (Manager, error) {

	_ = os.MkdirAll(opts.LocalDir, os.ModePerm)

	localDb, err := newLocalSyncDatabase(opts.LocalDir, "local", opts.Logger)
	if err != nil {
		return nil, err
	}

	ret := &ManagerImpl{
		localDb:                       localDb,
		logger:                        opts.Logger,
		animeCollection:               mo.None[*anilist.AnimeCollection](),
		mangaCollection:               mo.None[*anilist.MangaCollection](),
		wsEventManager:                opts.WSEventManager,
		anilistPlatformRef:            opts.AnilistPlatformRef,
		RefreshAnilistCollectionsFunc: func() {},
	}

	return ret, nil
}

func (m *ManagerImpl) SetRefreshAnilistCollectionsFunc(f func()) {
	m.RefreshAnilistCollectionsFunc = f
}

func (m *ManagerImpl) SetAnimeCollection(ac *anilist.AnimeCollection) {
	if ac == nil {
		m.animeCollection = mo.None[*anilist.AnimeCollection]()
	} else {
		m.animeCollection = mo.Some[*anilist.AnimeCollection](ac)
	}
}

func (m *ManagerImpl) SetMangaCollection(mc *anilist.MangaCollection) {
	if mc == nil {
		m.mangaCollection = mo.None[*anilist.MangaCollection]()
	} else {
		m.mangaCollection = mo.Some[*anilist.MangaCollection](mc)
	}
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

func (m *ManagerImpl) GetSimulatedAnimeCollection() mo.Option[*anilist.AnimeCollection] {
	ac, ok := m.localDb.GetSimulatedAnimeCollection()
	if !ok {
		return mo.None[*anilist.AnimeCollection]()
	}
	return mo.Some(ac)
}

func (m *ManagerImpl) GetSimulatedMangaCollection() mo.Option[*anilist.MangaCollection] {
	mc, ok := m.localDb.GetSimulatedMangaCollection()
	if !ok {
		return mo.None[*anilist.MangaCollection]()
	}
	return mo.Some(mc)
}

func (m *ManagerImpl) SaveSimulatedAnimeCollection(ac *anilist.AnimeCollection) {
	m.logger.Trace().Msg("local manager: Saving simulated anime collection to database")
	//// Remove airing dates from each entry
	//for _, list := range ac.MediaListCollection.Lists {
	//	for _, entry := range list.Entries {
	//		entry.GetMedia().NextAiringEpisode = nil
	//	}
	//}
	_ = m.localDb.SaveSimulatedAnimeCollection(ac)
}

func (m *ManagerImpl) SaveSimulatedMangaCollection(mc *anilist.MangaCollection) {
	m.logger.Trace().Msg("local manager: Saving simulated manga collection to database")
	_ = m.localDb.SaveSimulatedMangaCollection(mc)
}

func (m *ManagerImpl) SynchronizeAnilistToSimulatedCollection() error {
	m.logger.Trace().Msg("local manager: Synchronizing Anilist to simulated (local) collection")

	if animeCollection, ok := m.animeCollection.Get(); ok {
		m.SaveSimulatedAnimeCollection(animeCollection)
	}

	if mangaCollection, ok := m.mangaCollection.Get(); ok {
		m.SaveSimulatedMangaCollection(mangaCollection)
	}

	return nil
}

func (m *ManagerImpl) SynchronizeSimulatedCollectionToAnilist() error {
	if m.animeCollection.IsAbsent() {
		return fmt.Errorf("local manager: Cannot sync to anilist, anime collection not set")
	}

	if m.mangaCollection.IsAbsent() {
		return fmt.Errorf("local manager: Cannot sync to anilist, manga collection not set")
	}

	if localAnimeCollection, ok := m.localDb.GetSimulatedAnimeCollection(); ok {
		for _, list := range localAnimeCollection.MediaListCollection.Lists {
			if list.GetStatus() == nil || list.GetEntries() == nil {
				continue
			}
			for _, entry := range list.GetEntries() {
				if entry.GetStatus() == nil {
					continue
				}

				// Get the entry from AniList
				var originalEntry *anilist.AnimeListEntry
				if e, found := m.animeCollection.MustGet().GetListEntryFromAnimeId(entry.GetMedia().GetID()); found {
					originalEntry = e
				}
				if originalEntry != nil {
					key1 := GetAnimeListDataKey(entry)
					key2 := GetAnimeListDataKey(originalEntry)

					// If the entry is the same, skip
					if key1 == key2 {
						continue
					}
				}

				var startDate *anilist.FuzzyDateInput
				if entry.GetStartedAt() != nil {
					startDate = &anilist.FuzzyDateInput{
						Year:  entry.GetStartedAt().GetYear(),
						Month: entry.GetStartedAt().GetMonth(),
						Day:   entry.GetStartedAt().GetDay(),
					}
				}

				var endDate *anilist.FuzzyDateInput
				if entry.GetCompletedAt() != nil {
					endDate = &anilist.FuzzyDateInput{
						Year:  entry.GetCompletedAt().GetYear(),
						Month: entry.GetCompletedAt().GetMonth(),
						Day:   entry.GetCompletedAt().GetDay(),
					}
				}

				var score *int
				if entry.GetScore() != nil {
					score = new(int(*entry.GetScore()))
				} else {
					score = new(0)
				}

				_ = m.anilistPlatformRef.Get().UpdateEntry(
					context.Background(),
					entry.GetMedia().GetID(),
					entry.GetStatus(),
					score,
					entry.GetProgress(),
					startDate,
					endDate,
				)
			}
		}
	}

	if localMangaCollection, ok := m.localDb.GetSimulatedMangaCollection(); ok {
		for _, list := range localMangaCollection.MediaListCollection.Lists {
			if list.GetStatus() == nil || list.GetEntries() == nil {
				continue
			}
			for _, entry := range list.GetEntries() {
				if entry.GetStatus() == nil {
					continue
				}

				// Get the entry from AniList
				var originalEntry *anilist.MangaListEntry
				if e, found := m.mangaCollection.MustGet().GetListEntryFromMangaId(entry.GetMedia().GetID()); found {
					originalEntry = e
				}
				if originalEntry != nil {
					key1 := GetMangaListDataKey(entry)
					key2 := GetMangaListDataKey(originalEntry)

					// If the entry is the same, skip
					if key1 == key2 {
						continue
					}
				}

				var startDate *anilist.FuzzyDateInput
				if entry.GetStartedAt() != nil {
					startDate = &anilist.FuzzyDateInput{
						Year:  entry.GetStartedAt().GetYear(),
						Month: entry.GetStartedAt().GetMonth(),
						Day:   entry.GetStartedAt().GetDay(),
					}
				}

				var endDate *anilist.FuzzyDateInput
				if entry.GetCompletedAt() != nil {
					endDate = &anilist.FuzzyDateInput{
						Year:  entry.GetCompletedAt().GetYear(),
						Month: entry.GetCompletedAt().GetMonth(),
						Day:   entry.GetCompletedAt().GetDay(),
					}
				}

				var score *int
				if entry.GetScore() != nil {
					score = new(int(*entry.GetScore()))
				} else {
					score = new(0)
				}

				_ = m.anilistPlatformRef.Get().UpdateEntry(
					context.Background(),
					entry.GetMedia().GetID(),
					entry.GetStatus(),
					score,
					entry.GetProgress(),
					startDate,
					endDate,
				)
			}
		}
	}

	m.RefreshAnilistCollectionsFunc()

	m.wsEventManager.SendEvent(events.RefreshedAnilistAnimeCollection, nil)
	m.wsEventManager.SendEvent(events.RefreshedAnilistMangaCollection, nil)

	return nil
}
