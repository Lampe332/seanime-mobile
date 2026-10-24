package handlers

import (
	"errors"
	"seanime/internal/api/anilist"
	"seanime/internal/api/metadata"
	"seanime/internal/database/models"
	debrid_client "seanime/internal/debrid/client"
	"seanime/internal/debrid/debrid"
	"seanime/internal/events"
	hibiketorrent "seanime/internal/extension/hibike/torrent"

	"github.com/labstack/echo/v4"
)

// HandleSaveDebridSettings
//
//	@summary save debrid settings.
//	@desc This saves the debrid settings.
//	@desc The client should refetch the server status.
//	@returns models.DebridSettings
//	@route /api/v1/debrid/settings [PATCH]
func (h *Handler) HandleSaveDebridSettings(c echo.Context) error {

	type body struct {
		Settings models.DebridSettings `json:"settings"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	settings, err := h.App.Database.UpsertDebridSettings(&b.Settings)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	h.App.InitOrRefreshDebridSettings()

	return h.RespondWithData(c, settings)
}

// HandleDebridAddTorrents
//
//	@summary add torrent to debrid.
//	@desc This adds a torrent to the debrid service.
//	@returns bool
//	@route /api/v1/debrid/torrents [POST]
func (h *Handler) HandleDebridAddTorrents(c echo.Context) error {

	type body struct {
		Torrents    []hibiketorrent.AnimeTorrent `json:"torrents"`
		Media       *anilist.BaseAnime           `json:"media"`
		Destination string                       `json:"destination"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	if err := h.guardStrictLocalOnlyAction(c); err != nil {
		return err
	}

	if err := h.guardStrictFilesystemPath(c, b.Destination); err != nil {
		return err
	}

	if !h.App.DebridClientRepository.HasProvider() {
		return h.RespondWithError(c, errors.New("debrid provider not set"))
	}

	for _, torrent := range b.Torrents {
		magnet, err := h.App.TorrentRepository.ResolveMagnetLink(&torrent)
		if err != nil {
			if len(b.Torrents) == 1 {
				return h.RespondWithError(c, err)
			} else {
				h.App.Logger.Err(err).Msg("debrid: Failed to get magnet link")
				h.App.WSEventManager.SendEvent(events.ErrorToast, err.Error())
				continue
			}
		}

		torrent.MagnetLink = magnet

		// Add the torrent to the debrid service
		_, err = h.App.DebridClientRepository.AddAndQueueTorrent(debrid.AddTorrentOptions{
			MagnetLink:   magnet,
			InfoHash:     torrent.InfoHash,
			SelectFileId: "all",
		}, b.Destination, b.Media.ID)
		if err != nil {
			// If there is only one torrent, return the error
			if len(b.Torrents) == 1 {
				return h.RespondWithError(c, err)
			} else {
				// If there are multiple torrents, send an error toast and continue to the next torrent
				h.App.Logger.Err(err).Msg("debrid: Failed to add torrent to debrid")
				h.App.WSEventManager.SendEvent(events.ErrorToast, err.Error())
				continue
			}
		}
	}

	return h.RespondWithData(c, true)
}

// HandleDebridGetTorrents
//
//	@summary get torrents from debrid.
//	@desc This gets the torrents from the debrid service.
//	@returns []debrid.TorrentItem
//	@route /api/v1/debrid/torrents [GET]
func (h *Handler) HandleDebridGetTorrents(c echo.Context) error {

	provider, err := h.App.DebridClientRepository.GetProvider()
	if err != nil {
		return h.RespondWithError(c, err)
	}

	torrents, err := provider.GetTorrents()
	if err != nil {
		h.App.Logger.Err(err).Msg("debrid: Failed to get torrents")
		return h.RespondWithError(c, err)
	}

	queuedItems, err := h.App.Database.GetDebridTorrentItems()
	if err != nil {
		h.App.Logger.Err(err).Msg("debrid: Failed to get queued torrent items")
		return h.RespondWithError(c, err)
	}

	providerId := provider.GetSettings().ID
	queuedIds := make(map[string]struct{}, len(queuedItems))
	for _, item := range queuedItems {
		if item == nil || (item.Provider != "" && item.Provider != providerId) {
			continue
		}

		queuedIds[item.TorrentItemID] = struct{}{}
	}

	for _, torrent := range torrents {
		if torrent == nil {
			continue
		}

		_, torrent.IsQueuedForLocalDownload = queuedIds[torrent.ID]
		torrent.IsDownloadingLocally = h.App.DebridClientRepository.IsDownloadActive(torrent.ID)
	}

	return h.RespondWithData(c, torrents)
}

// HandleDebridGetTorrentFilePreviews
//
//	@summary get list of torrent files
//	@returns []debrid_client.FilePreview
//	@route /api/v1/debrid/torrents/file-previews [POST]
func (h *Handler) HandleDebridGetTorrentFilePreviews(c echo.Context) error {
	type body struct {
		Torrent       *hibiketorrent.AnimeTorrent `json:"torrent"`
		EpisodeNumber int                         `json:"episodeNumber"`
		Media         *anilist.BaseAnime          `json:"media"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	magnet, err := h.App.TorrentRepository.ResolveMagnetLink(b.Torrent)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	b.Torrent.MagnetLink = magnet

	// Get the media
	animeMetadata, _ := h.App.MetadataProviderRef.Get().GetAnimeMetadata(metadata.AnilistPlatform, b.Media.ID)
	absoluteOffset := 0
	if animeMetadata != nil {
		absoluteOffset = animeMetadata.GetOffset()
	}

	torrentInfo, err := h.App.DebridClientRepository.GetTorrentFilePreviewsFromManualSelection(&debrid_client.GetTorrentFilePreviewsOptions{
		Torrent:        b.Torrent,
		Magnet:         magnet,
		EpisodeNumber:  b.EpisodeNumber,
		Media:          b.Media,
		AbsoluteOffset: absoluteOffset,
	})
	if err != nil {
		return h.RespondWithError(c, err)
	}

	return h.RespondWithData(c, torrentInfo)
}

// HandleDebridStartStream
//
//	@summary start stream from debrid.
//	@desc This starts streaming a torrent from the debrid service.
//	@returns bool
//	@route /api/v1/debrid/stream/start [POST]
func (h *Handler) HandleDebridStartStream(c echo.Context) error {
	type body struct {
		MediaId           int                              `json:"mediaId"`
		EpisodeNumber     int                              `json:"episodeNumber"`
		AniDBEpisode      string                           `json:"aniDBEpisode"`
		AutoSelect        bool                             `json:"autoSelect"`
		Torrent           *hibiketorrent.AnimeTorrent      `json:"torrent"`
		FileId            string                           `json:"fileId"`
		FileIndex         *int                             `json:"fileIndex"`
		PlaybackType      debrid_client.StreamPlaybackType `json:"playbackType"` // "default" or "externalPlayerLink"
		ClientId          string                           `json:"clientId"`
		BatchEpisodeFiles *hibiketorrent.BatchEpisodeFiles `json:"batchEpisodeFiles"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	b.ClientId = getRequestClientId(c, b.ClientId)

	userAgent := c.Request().Header.Get("User-Agent")

	if b.Torrent != nil {
		magnet, err := h.App.TorrentRepository.ResolveMagnetLink(b.Torrent)
		if err != nil {
			return h.RespondWithError(c, err)
		}

		b.Torrent.MagnetLink = magnet
	}

	err := h.App.DebridClientRepository.StartStream(c.Request().Context(), &debrid_client.StartStreamOptions{
		MediaId:           b.MediaId,
		EpisodeNumber:     b.EpisodeNumber,
		AniDBEpisode:      b.AniDBEpisode,
		Torrent:           b.Torrent,
		FileId:            b.FileId,
		FileIndex:         b.FileIndex,
		UserAgent:         userAgent,
		ClientId:          b.ClientId,
		PlaybackType:      b.PlaybackType,
		AutoSelect:        b.AutoSelect,
		BatchEpisodeFiles: b.BatchEpisodeFiles,
	})
	if err != nil {
		return h.RespondWithError(c, err)
	}

	return h.RespondWithData(c, true)
}

// HandleDebridCancelStream
//
//	@summary cancel stream from debrid.
//	@desc This cancels a stream from the debrid service.
//	@returns bool
//	@route /api/v1/debrid/stream/cancel [POST]
func (h *Handler) HandleDebridCancelStream(c echo.Context) error {
	type body struct {
		Options *debrid_client.CancelStreamOptions `json:"options"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	h.App.DebridClientRepository.CancelStream(b.Options)

	return h.RespondWithData(c, true)
}
