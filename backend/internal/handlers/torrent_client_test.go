package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/goccy/go-json"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	"seanime/internal/core"
	"seanime/internal/torrent_clients/torrent_client"
)

func TestTorrentClientGetFilesReportsUnavailableClient(t *testing.T) {
	h := &Handler{App: &core.App{
		TorrentClientRepository: torrent_client.NewRepository(&torrent_client.NewRepositoryOptions{
			Provider: "unavailable",
		}),
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/torrent-client/get-files", strings.NewReader(`{"torrent":{"infoHash":"hash"}}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	require.NoError(t, h.HandleTorrentClientGetFiles(echo.New().NewContext(req, rec)))
	var res SeaResponse[any]
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
	require.Contains(t, res.Error, "could not contact torrent client")
}
