package handlers

import (
	"errors"
	"seanime/internal/api/mal"

	"github.com/labstack/echo/v4"
)

// HandleEditMALListEntryProgress
//
//	@summary updates the progress of a MAL list entry.
//	@route /api/v1/mal/list-entry/progress [POST]
//	@returns bool
func (h *Handler) HandleEditMALListEntryProgress(c echo.Context) error {

	type body struct {
		MediaId  *int `json:"mediaId"`
		Progress *int `json:"progress"`
	}

	b := new(body)
	if err := c.Bind(b); err != nil {
		return h.RespondWithError(c, err)
	}

	if b.MediaId == nil || b.Progress == nil {
		return h.RespondWithError(c, errors.New("mediaId and progress is required"))
	}

	// Get MAL info
	_malInfo, err := h.App.Database.GetMalInfo()
	if err != nil {
		return h.RespondWithError(c, err)
	}

	// Verify MAL auth
	malInfo, err := mal.VerifyMALAuth(_malInfo, h.App.Database, h.App.Logger)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	// Get MAL Wrapper
	malWrapper := mal.NewWrapper(malInfo.AccessToken, h.App.Logger)

	// Update MAL list entry
	err = malWrapper.UpdateAnimeProgress(&mal.AnimeListProgressParams{
		NumEpisodesWatched: b.Progress,
	}, *b.MediaId)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	h.App.Logger.Debug().Msgf("mal: Updated MAL list entry for mediaId %d", *b.MediaId)

	return h.RespondWithData(c, true)
}
