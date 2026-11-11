package handlers

import (
	"errors"
	"path/filepath"
	"seanime/internal/mobilestorage"
	"strings"

	"github.com/labstack/echo/v4"
)

// HandleMobileStorageAccess
//
//	@summary tells whether the server can read a folder the native app picked.
//	@desc Android: "allFilesAccess" is false while the app lacks "All files access" for that storage volume.
//	@route /api/v1/mobile-storage/access [POST]
//	@returns mobilestorage.Access
func (h *Handler) HandleMobileStorageAccess(c echo.Context) error {
	type body struct {
		Path string `json:"path"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	if err := h.guardStrictLocalOnlyAction(c); err != nil {
		return err
	}
	if !strings.HasPrefix(b.Path, "/") && !filepath.IsAbs(b.Path) {
		return h.RespondWithError(c, errors.New("an absolute folder path is required"))
	}
	return h.RespondWithData(c, mobilestorage.Check(b.Path, mobilestorage.VolumeRoot(b.Path)))
}
