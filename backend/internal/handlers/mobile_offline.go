package handlers

import (
	"errors"
	"net/http"
	"seanime/internal/mobileoffline"

	"github.com/labstack/echo/v4"
)

// The episode download API of the native app (the old app's SeanimeOffline bridge). Changes arrive as
// "mobile-offline-updated" WebSocket events carrying the whole snapshot.

var errOfflineUnavailable = errors.New("episode downloads are not available")

func (h *Handler) mobileOffline() (*mobileoffline.Manager, error) {
	if h.App.MobileOffline == nil {
		return nil, errOfflineUnavailable
	}
	return h.App.MobileOffline, nil
}

// HandleGetMobileOfflineSnapshot
//
//	@summary returns all saved and queued episodes, the "Wi-Fi only" setting and what the queue waits for.
//	@route /api/v1/mobile-offline/snapshot [GET]
//	@returns mobileoffline.Snapshot
func (h *Handler) HandleGetMobileOfflineSnapshot(c echo.Context) error {
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, m.Snapshot())
}

// HandleMobileOfflineBatch
//
//	@summary queues episodes of an anime from an online-stream provider (one episode, a season or the missing ones).
//	@desc The source of each episode is resolved only when a download slot is free. Returns how many were added.
//	@route /api/v1/mobile-offline/batch [POST]
//	@returns int
func (h *Handler) HandleMobileOfflineBatch(c echo.Context) error {
	type body struct {
		MediaId   int                          `json:"mediaId"`
		Provider  string                       `json:"provider"`
		Dubbed    bool                         `json:"dubbed"`
		Quality   string                       `json:"quality"`
		Server    string                       `json:"server"`
		Title     string                       `json:"title"`
		CoverUrl  string                       `json:"coverUrl"`
		BannerUrl string                       `json:"bannerUrl"`
		Episodes  []mobileoffline.BatchEpisode `json:"episodes"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	added, err := m.Submit(mobileoffline.BatchRequest{MediaID: b.MediaId, Provider: b.Provider, Dubbed: b.Dubbed, Quality: b.Quality,
		Server: b.Server, Title: b.Title, CoverURL: b.CoverUrl, BannerURL: b.BannerUrl, Episodes: b.Episodes})
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, added)
}

// HandleMobileOfflineDownload
//
//	@summary saves one episode from a source the app already has (the player's stream).
//	@desc Provider URLs only (or this server's /api/v1/proxy, which is unwrapped); the server never sends its own token to them.
//	@route /api/v1/mobile-offline/download [POST]
//	@returns mobileoffline.Item
func (h *Handler) HandleMobileOfflineDownload(c echo.Context) error {
	type body struct {
		Key                string                         `json:"key"`
		Url                string                         `json:"url"`
		Type               string                         `json:"type"`
		Headers            map[string]string              `json:"headers"`
		Subtitles          []mobileoffline.SourceSubtitle `json:"subtitles"`
		MediaId            int                            `json:"mediaId"`
		Episode            string                         `json:"episode"`
		Dubbed             bool                           `json:"dubbed"`
		Quality            string                         `json:"quality"`
		Title              string                         `json:"title"`
		CoverUrl           string                         `json:"coverUrl"`
		BannerUrl          string                         `json:"bannerUrl"`
		EpisodeTitle       string                         `json:"episodeTitle"`
		EpisodeImageUrl    string                         `json:"episodeImageUrl"`
		EpisodeDescription string                         `json:"episodeDescription"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	item, err := m.Download(mobileoffline.DownloadRequest{Key: b.Key, URL: b.Url, Type: b.Type, Headers: b.Headers, Subtitles: b.Subtitles,
		MediaID: b.MediaId, Episode: b.Episode, Dubbed: b.Dubbed, Quality: b.Quality,
		Details: mobileoffline.Details{Title: b.Title, CoverURL: b.CoverUrl, BannerURL: b.BannerUrl, EpisodeTitle: b.EpisodeTitle,
			EpisodeImageURL: b.EpisodeImageUrl, EpisodeDescription: b.EpisodeDescription}})
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, item)
}

// HandleMobileOfflineAction
//
//	@summary pauses, resumes, retries or removes a saved or queued episode.
//	@route /api/v1/mobile-offline/action [POST]
//	@returns bool
func (h *Handler) HandleMobileOfflineAction(c echo.Context) error {
	type body struct {
		Id     string `json:"id"`
		Action string `json:"action"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	if !mobileoffline.ValidID(b.Id) {
		return h.RespondWithError(c, errors.New("invalid id"))
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	ok, err := m.Action(b.Id, b.Action)
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, ok)
}

// HandleMobileOfflineNetwork
//
//	@summary tells the server the phone's connection (from NetInfo); downloads wait while it is metered and "Wi-Fi only" is on.
//	@route /api/v1/mobile-offline/network [POST]
//	@returns bool
func (h *Handler) HandleMobileOfflineNetwork(c echo.Context) error {
	type body struct {
		Connected bool `json:"connected"`
		Metered   bool `json:"metered"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	m.SetNetwork(b.Connected, b.Metered)
	return h.RespondWithData(c, true)
}

// HandleMobileOfflineSettings
//
//	@summary turns "Wi-Fi only" for episode downloads on or off.
//	@route /api/v1/mobile-offline/settings [POST]
//	@returns bool
func (h *Handler) HandleMobileOfflineSettings(c echo.Context) error {
	type body struct {
		WifiOnly bool `json:"wifiOnly"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	m.SetWifiOnly(b.WifiOnly)
	return h.RespondWithData(c, true)
}

// HandleMobileOfflinePosition
//
//	@summary stores where the offline player stopped in an episode.
//	@route /api/v1/mobile-offline/position [POST]
//	@returns bool
func (h *Handler) HandleMobileOfflinePosition(c echo.Context) error {
	type body struct {
		Id         string `json:"id"`
		PositionMs int64  `json:"positionMs"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, m.SetPosition(b.Id, b.PositionMs))
}

// HandleMobileOfflineCacheManga
//
//	@summary saves a manga's descriptions and cover for the offline list and returns them.
//	@desc The chapters themselves are downloaded by the manga downloader (/api/v1/manga/download-chapters).
//	@route /api/v1/mobile-offline/manga [POST]
//	@returns mobileoffline.Details
func (h *Handler) HandleMobileOfflineCacheManga(c echo.Context) error {
	type body struct {
		MediaId     int      `json:"mediaId"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Genres      []string `json:"genres"`
		Year        int      `json:"year"`
		Format      string   `json:"format"`
		CoverUrl    string   `json:"coverUrl"`
		BannerUrl   string   `json:"bannerUrl"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	m, err := h.mobileOffline()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	details, err := m.CacheManga(c.Request().Context(), mobileoffline.MangaRequest{MediaID: b.MediaId, Details: mobileoffline.Details{
		Title: b.Title, Description: b.Description, Genres: b.Genres, Year: b.Year, Format: b.Format, CoverURL: b.CoverUrl, BannerURL: b.BannerUrl}})
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, details)
}

// HandleMobileOfflineFile
//
//	@summary serves a file of a saved episode (video, separate audio, subtitles) with byte ranges.
//	@route /api/v1/mobile-offline/file/{id}/{name} [GET]
//	@param id - string - true - "Item id"
//	@param name - string - true - "File name from the item's files"
func (h *Handler) HandleMobileOfflineFile(c echo.Context) error {
	m, err := h.mobileOffline()
	if err != nil {
		return c.NoContent(http.StatusNotFound)
	}
	path := m.FilePath(c.Param("id"), c.Param("name"))
	if path == "" {
		return c.NoContent(http.StatusNotFound)
	}
	return c.File(path)
}

// HandleMobileOfflineArtwork
//
//	@summary serves saved artwork (the *Asset names of an item).
//	@route /api/v1/mobile-offline/artwork/{name} [GET]
//	@param name - string - true - "Artwork file name"
func (h *Handler) HandleMobileOfflineArtwork(c echo.Context) error {
	m, err := h.mobileOffline()
	if err != nil {
		return c.NoContent(http.StatusNotFound)
	}
	path := m.ArtworkPath(c.Param("name"))
	if path == "" {
		return c.NoContent(http.StatusNotFound)
	}
	return c.File(path)
}
