package handlers

import (
	"seanime/internal/util"
	"strings"

	"github.com/labstack/echo/v4"
)

// HandleGetFileCacheTotalSize
//
//	@summary returns the total size of cache files.
//	@desc The total size of the cache files is returned in human-readable format.
//	@route /api/v1/filecache/total-size [GET]
//	@returns string
func (h *Handler) HandleGetFileCacheTotalSize(c echo.Context) error {
	// Get the cache size
	size, err := h.App.FileCacher.GetTotalSize()
	if err != nil {
		return h.RespondWithError(c, err)
	}

	// Return the cache size
	return h.RespondWithData(c, util.Bytes(uint64(size)))
}

// HandleRemoveFileCacheBucket
//
//	@summary deletes all buckets with the given prefix.
//	@desc The bucket value is the prefix of the cache files that should be deleted.
//	@desc Returns 'true' if the operation was successful.
//	@route /api/v1/filecache/bucket [DELETE]
//	@returns bool
func (h *Handler) HandleRemoveFileCacheBucket(c echo.Context) error {
	if err := h.guardStrictLocalOnlyAction(c); err != nil {
		return err
	}

	type body struct {
		Bucket string `json:"bucket"` // e.g. "onlinestream_"
	}

	// Parse the request body
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	// Remove all files in the cache directory that match the given filter
	err := h.App.FileCacher.RemoveAllBy(func(filename string) bool {
		return strings.HasPrefix(filename, b.Bucket)
	})

	if err != nil {
		return h.RespondWithError(c, err)
	}

	// Return a success response
	return h.RespondWithData(c, true)
}
