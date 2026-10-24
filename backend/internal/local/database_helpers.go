package local

import (
	"seanime/internal/api/anilist"
	"seanime/internal/customsource"

	"github.com/goccy/go-json"
)

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Simulated collections
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// filterOutCustomSourceAnime creates a copy of the collection without custom source entries
func (ldb *Database) filterOutCustomSourceAnime(ac *anilist.AnimeCollection) *anilist.AnimeCollection {
	if ac == nil || ac.MediaListCollection == nil {
		return ac
	}

	// Create a deep copy
	filtered := &anilist.AnimeCollection{
		MediaListCollection: &anilist.AnimeCollection_MediaListCollection{
			Lists: make([]*anilist.AnimeCollection_MediaListCollection_Lists, 0),
		},
	}

	// Filter out custom source entries
	for _, list := range ac.MediaListCollection.Lists {
		if list == nil {
			continue
		}

		filteredList := &anilist.AnimeCollection_MediaListCollection_Lists{
			Status:  list.Status,
			Entries: make([]*anilist.AnimeCollection_MediaListCollection_Lists_Entries, 0),
		}

		for _, entry := range list.Entries {
			if entry == nil || entry.Media == nil {
				continue
			}

			// Skip custom source entries
			if customsource.IsExtensionId(entry.Media.ID) {
				continue
			}

			filteredList.Entries = append(filteredList.Entries, entry)
		}

		// Only add the list if it has entries
		if len(filteredList.Entries) > 0 {
			filtered.MediaListCollection.Lists = append(filtered.MediaListCollection.Lists, filteredList)
		}
	}

	return filtered
}

// filterOutCustomSourceManga creates a copy of the collection without custom source entries
func (ldb *Database) filterOutCustomSourceManga(mc *anilist.MangaCollection) *anilist.MangaCollection {
	if mc == nil || mc.MediaListCollection == nil {
		return mc
	}

	// Create a deep copy
	filtered := &anilist.MangaCollection{
		MediaListCollection: &anilist.MangaCollection_MediaListCollection{
			Lists: make([]*anilist.MangaCollection_MediaListCollection_Lists, 0),
		},
	}

	// Filter out custom source entries
	for _, list := range mc.MediaListCollection.Lists {
		if list == nil {
			continue
		}

		filteredList := &anilist.MangaCollection_MediaListCollection_Lists{
			Status:  list.Status,
			Entries: make([]*anilist.MangaCollection_MediaListCollection_Lists_Entries, 0),
		}

		for _, entry := range list.Entries {
			if entry == nil || entry.Media == nil {
				continue
			}

			// Skip custom source entries
			if customsource.IsExtensionId(entry.Media.ID) {
				continue
			}

			filteredList.Entries = append(filteredList.Entries, entry)
		}

		// Only add the list if it has entries
		if len(filteredList.Entries) > 0 {
			filtered.MediaListCollection.Lists = append(filtered.MediaListCollection.Lists, filteredList)
		}
	}

	return filtered
}

func (ldb *Database) _getSimulatedCollection(collectionType string) (*SimulatedCollection, bool) {
	var lc SimulatedCollection
	err := ldb.gormdb.Where("type = ?", collectionType).First(&lc).Error
	return &lc, err == nil
}

func (ldb *Database) _saveSimulatedCollection(collectionType string, value interface{}) error {

	marshalledValue, err := json.Marshal(value)
	if err != nil {
		return err
	}

	// Check if collection already exists
	lc, ok := ldb._getSimulatedCollection(collectionType)
	if ok {
		lc.Value = marshalledValue
		return ldb.gormdb.Save(&lc).Error
	}

	lcN := SimulatedCollection{
		Type:  collectionType,
		Value: marshalledValue,
	}

	return ldb.gormdb.Save(&lcN).Error
}

func (ldb *Database) SaveSimulatedAnimeCollection(ac *anilist.AnimeCollection) error {
	// Filter out custom sources
	filtered := ldb.filterOutCustomSourceAnime(ac)
	return ldb._saveSimulatedCollection(AnimeType, filtered)
}

func (ldb *Database) SaveSimulatedMangaCollection(mc *anilist.MangaCollection) error {
	// Filter out custom sources
	filtered := ldb.filterOutCustomSourceManga(mc)
	return ldb._saveSimulatedCollection(MangaType, filtered)
}

func (ldb *Database) GetSimulatedAnimeCollection() (*anilist.AnimeCollection, bool) {
	lc, ok := ldb._getSimulatedCollection(AnimeType)
	if !ok {
		return nil, false
	}

	var ac anilist.AnimeCollection
	err := json.Unmarshal(lc.Value, &ac)

	return &ac, err == nil
}

func (ldb *Database) GetSimulatedMangaCollection() (*anilist.MangaCollection, bool) {
	lc, ok := ldb._getSimulatedCollection(MangaType)
	if !ok {
		return nil, false
	}

	var mc anilist.MangaCollection
	err := json.Unmarshal(lc.Value, &mc)

	return &mc, err == nil
}
