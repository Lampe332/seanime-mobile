package handlers

import (
	"github.com/labstack/echo/v4"
)

// HandleLocalSyncSimulatedDataToAnilist
//
//	@summary syncs the simulated data to AniList.
//	@route /api/v1/local/sync-simulated-to-anilist [POST]
//	@returns bool
func (h *Handler) HandleLocalSyncSimulatedDataToAnilist(c echo.Context) error {
	err := h.App.LocalManager.SynchronizeSimulatedCollectionToAnilist()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, true)
}
