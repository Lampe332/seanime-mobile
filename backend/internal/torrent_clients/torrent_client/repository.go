package torrent_client

import (
	"context"
	"errors"
	"seanime/internal/api/metadata_provider"
	"seanime/internal/events"
	"seanime/internal/torrent_clients/builtin_client"
	"seanime/internal/torrents/torrent"
	"seanime/internal/util"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

const (
	// SeanimeClient is the built-in torrent client, the only one the app has.
	SeanimeClient = "seanime"
	NoneClient    = "none"
)

type (
	Repository struct {
		logger                      *zerolog.Logger
		seanimeClient               *builtin_client.Client
		torrentRepository           *torrent.Repository
		provider                    string
		metadataProviderRef         *util.Ref[metadata_provider.Provider]
		activeTorrentCountCtxCancel context.CancelFunc
		activeTorrentCount          *ActiveCount
	}

	NewRepositoryOptions struct {
		Logger              *zerolog.Logger
		SeanimeClient       *builtin_client.Client
		TorrentRepository   *torrent.Repository
		Provider            string
		MetadataProviderRef *util.Ref[metadata_provider.Provider]
	}

	ActiveCount struct {
		Downloading int `json:"downloading"`
		Seeding     int `json:"seeding"`
		Paused      int `json:"paused"`
	}
)

func NewRepository(opts *NewRepositoryOptions) *Repository {
	if opts.Provider != NoneClient {
		opts.Provider = SeanimeClient
	}
	return &Repository{
		logger:              opts.Logger,
		seanimeClient:       opts.SeanimeClient,
		torrentRepository:   opts.TorrentRepository,
		provider:            opts.Provider,
		metadataProviderRef: opts.MetadataProviderRef,
		activeTorrentCount:  &ActiveCount{},
	}
}

func (r *Repository) Shutdown() {
	if r.activeTorrentCountCtxCancel != nil {
		r.activeTorrentCountCtxCancel()
		r.activeTorrentCountCtxCancel = nil
	}
	if r.seanimeClient != nil {
		r.seanimeClient.Close()
	}
}

func (r *Repository) InitActiveTorrentCount(enabled bool, wsEventManager events.WSEventManagerInterface) {
	if r.activeTorrentCountCtxCancel != nil {
		r.activeTorrentCountCtxCancel()
	}

	if !enabled {
		return
	}

	var ctx context.Context
	ctx, r.activeTorrentCountCtxCancel = context.WithCancel(context.Background())
	go func(ctx context.Context) {
		ticker := time.NewTicker(time.Second * 5)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.GetActiveCount(r.activeTorrentCount)
				wsEventManager.SendEvent(events.ActiveTorrentCountUpdated, r.activeTorrentCount)
			}
		}
	}(ctx)
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

func (r *Repository) GetProvider() string {
	return r.provider
}

func (r *Repository) Start() bool {
	switch r.provider {
	case SeanimeClient:
		return r.seanimeClient != nil && r.seanimeClient.Start()
	case NoneClient:
		return true
	default:
		return false
	}
}
func (r *Repository) TorrentExists(hash string) bool {
	switch r.provider {
	case SeanimeClient:
		return r.seanimeClient != nil && r.seanimeClient.TorrentExists(hash)
	default:
		return false
	}
}

type GetListOptions struct {
	Category *string // unused (external clients only)
	Sort     string  // name, name-desc, newest, oldest
}

// GetList will return all torrents from the torrent client.
func (r *Repository) GetList(opts *GetListOptions) ([]*Torrent, error) {
	// Normalize sort options
	sortBy := "added_on"
	reverse := true

	if opts.Sort != "" {
		switch opts.Sort {
		case "name":
			sortBy = "name"
			reverse = false
		case "name-desc":
			sortBy = "name"
			reverse = true
		case "newest":
			sortBy = "added_on"
			reverse = true
		case "oldest":
			sortBy = "added_on"
			reverse = false
		case "queue":
			sortBy = "queue"
			reverse = false
		default:
		}
	}

	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return nil, errors.New("torrent client: Seanime client is not available")
		}
		torrents := r.FromSeanimeTorrents(r.seanimeClient.Snapshots())
		sort.SliceStable(torrents, func(i, j int) bool {
			if sortBy == "name" {
				if reverse {
					return strings.ToLower(torrents[i].Name) > strings.ToLower(torrents[j].Name)
				}
				return strings.ToLower(torrents[i].Name) < strings.ToLower(torrents[j].Name)
			}
			if sortBy == "queue" {
				if reverse {
					return torrents[i].QueueIndex > torrents[j].QueueIndex
				}
				return torrents[i].QueueIndex < torrents[j].QueueIndex
			}
			if reverse {
				return torrents[i].AddedAt.After(torrents[j].AddedAt)
			}
			return torrents[i].AddedAt.Before(torrents[j].AddedAt)
		})
		return torrents, nil

	default:
		return nil, errors.New("torrent client: No torrent client provider found")
	}
}

// GetActiveCount will return the count of active torrents (downloading, seeding, paused).
func (r *Repository) GetActiveCount(ret *ActiveCount) {
	ret.Seeding = 0
	ret.Downloading = 0
	ret.Paused = 0
	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return
		}
		for _, torrent := range r.FromSeanimeTorrents(r.seanimeClient.Snapshots()) {
			switch torrent.Status {
			case TorrentStatusDownloading, TorrentStatusQueued:
				ret.Downloading++
			case TorrentStatusSeeding:
				ret.Seeding++
			case TorrentStatusPaused:
				ret.Paused++
			}
		}
		return
	default:
		return
	}
}

// GetActiveTorrents will return all torrents that are currently downloading, paused or seeding.
func (r *Repository) GetActiveTorrents(opts *GetListOptions) ([]*Torrent, error) {
	torrents, err := r.GetList(opts)
	if err != nil {
		return nil, err
	}
	var active []*Torrent
	for _, t := range torrents {
		if t.Status == TorrentStatusDownloading || t.Status == TorrentStatusSeeding || t.Status == TorrentStatusPaused || t.Status == TorrentStatusQueued {
			active = append(active, t)
		}
	}
	return active, nil
}

func (r *Repository) AddMagnets(magnets []string, dest string) error {
	r.logger.Trace().Any("magnets", magnets).Msg("torrent client: Adding magnets")

	if len(magnets) == 0 {
		r.logger.Debug().Msg("torrent client: No magnets to add")
		return nil
	}

	var err error
	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return errors.New("torrent client: Seanime client is not available")
		}
		for _, magnet := range magnets {
			if _, err = r.seanimeClient.AddMagnet(magnet, dest); err != nil {
				break
			}
		}
	case NoneClient:
		return errors.New("torrent client: No torrent client selected")
	}

	if err != nil {
		r.logger.Err(err).Msg("torrent client: Error while adding magnets")
		return err
	}

	r.logger.Debug().Msg("torrent client: Added torrents")

	return nil
}

func (r *Repository) RemoveTorrents(hashes []string) error {
	r.logger.Trace().Msg("torrent client: Removing torrents")

	var err error
	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return errors.New("torrent client: Seanime client is not available")
		}
		for _, hash := range hashes {
			if err = r.seanimeClient.RemoveTorrent(hash, true); err != nil {
				break
			}
		}
	}
	if err != nil {
		r.logger.Err(err).Msg("torrent client: Error while removing torrents")
		return err
	}

	r.logger.Debug().Any("hashes", hashes).Msg("torrent client: Removed torrents")
	return nil
}

func (r *Repository) PauseTorrents(hashes []string) error {
	r.logger.Trace().Msg("torrent client: Pausing torrents")

	var err error
	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return errors.New("torrent client: Seanime client is not available")
		}
		for _, hash := range hashes {
			if err = r.seanimeClient.PauseTorrent(hash); err != nil {
				break
			}
		}
	}

	if err != nil {
		r.logger.Err(err).Msg("torrent client: Error while pausing torrents")
		return err
	}

	r.logger.Debug().Any("hashes", hashes).Msg("torrent client: Paused torrents")

	return nil
}

func (r *Repository) ResumeTorrents(hashes []string) error {
	r.logger.Trace().Msg("torrent client: Resuming torrents")

	var err error
	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return errors.New("torrent client: Seanime client is not available")
		}
		for _, hash := range hashes {
			if err = r.seanimeClient.ResumeTorrent(hash); err != nil {
				break
			}
		}
	}

	if err != nil {
		r.logger.Err(err).Msg("torrent client: Error while resuming torrents")
		return err
	}

	r.logger.Debug().Any("hashes", hashes).Msg("torrent client: Resumed torrents")

	return nil
}

func (r *Repository) DeselectFiles(hash string, indices []int) error {

	var err error
	switch r.provider {
	case SeanimeClient:
		if r.seanimeClient == nil {
			return errors.New("torrent client: Seanime client is not available")
		}
		for _, index := range indices {
			if err = r.seanimeClient.SetFilePriority(hash, index, 0); err != nil {
				break
			}
		}
	}

	if err != nil {
		r.logger.Err(err).Msg("torrent client: Error while deselecting files")
		return err
	}

	r.logger.Debug().Str("hash", hash).Any("indices", indices).Msg("torrent client: Deselected torrent files")

	return nil
}

// GetFiles blocks until the files are retrieved, or until timeout.
func (r *Repository) GetFiles(hash string) (filenames []string, err error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	filenames = make([]string, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	done := make(chan struct{})

	go func() {
		r.logger.Debug().Str("hash", hash).Msg("torrent client: Getting torrent files")
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				err = errors.New("torrent client: Unable to retrieve torrent files (timeout)")
				return
			case <-ticker.C:
				switch r.provider {
				case SeanimeClient:
					if r.seanimeClient == nil {
						err = errors.New("torrent client: Seanime client is not available")
						return
					}
					details, detailsErr := r.seanimeClient.GetTorrentDetails(hash)
					if detailsErr == nil && len(details.Files) > 0 {
						for _, file := range details.Files {
							filenames = append(filenames, file.Path)
						}
						return
					}
				}
			}
		}
	}()

	<-done // wait for the files to be retrieved

	return
}

func (r *Repository) GetSeanimeClient() *builtin_client.Client {
	return r.seanimeClient
}
