package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"seanime/internal/util"

	"github.com/labstack/echo/v4"
)

// DEVNOTE: Transcoding and the mediastream player were removed with the desktop builds.
// What is left serves library files and their subtitle files to external players (medialinks, episode list).

// decodeMediastreamPath decodes the "path" query parameter (URL-escaped or base64) to a physical path.
func decodeMediastreamPath(rawPath string) string {
	fp, _ := url.PathUnescape(rawPath)
	if util.IsBase64(rawPath) {
		decodedPath, err := util.Base64DecodeStr(rawPath)
		if err == nil {
			fp = decodedPath
		}
	}
	return util.ResolvePhysicalPath(fp)
}

func isFileInLibrary(fp string, libraryPaths []string) bool {
	for _, libraryPath := range libraryPaths {
		if util.IsFileUnderDir(fp, libraryPath) {
			return true
		}
	}
	return false
}

//
// Serve file
//

func (h *Handler) HandleMediastreamFile(c echo.Context) error {
	rawPath := c.QueryParam("path")
	fp := decodeMediastreamPath(util.ResolvePhysicalPath(rawPath))

	// Make sure the file is in the library directories
	if !isFileInLibrary(fp, h.App.Settings.GetLibrary().GetLibraryPaths()) {
		return c.NoContent(http.StatusNotFound)
	}

	h.App.Logger.Trace().Str("filepath", fp).Str("payload", rawPath).Msg("mediastream: Served file")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", filepath.Base(fp)))

	return c.File(fp)
}

// HandleMediastreamLocalSubtitles
//
//	@summary get local subtitle files.
//	@desc This returns same-directory subtitle files for a local video file.
//	@returns []util.LocalSubtitleFile
//	@route /api/v1/mediastream/local-subtitles [GET]
func (h *Handler) HandleMediastreamLocalSubtitles(c echo.Context) error {
	if err := h.guardMediaConsumption(c); err != nil {
		return err
	}

	fp := decodeMediastreamPath(c.QueryParam("path"))

	if err := h.guardStrictFilesystemPath(c, fp); err != nil {
		return err
	}

	if !isFileInLibrary(fp, h.App.Settings.GetLibrary().GetLibraryPaths()) {
		return c.NoContent(http.StatusNotFound)
	}

	files, err := util.FindLocalSubtitleFiles(fp)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	return h.RespondWithData(c, files)
}
