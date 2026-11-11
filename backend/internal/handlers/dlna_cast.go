package handlers

import (
	"errors"
	"seanime/internal/dlnacast"

	"github.com/labstack/echo/v4"
)

// The DLNA cast API of the native app (the old app's SeanimeCast bridge). Every call returns at once; results arrive
// as "dlna-cast" WebSocket events: searching, devices, connecting, started, status, idle, stopped, error.

var errCastUnavailable = errors.New("casting is not available")

func (h *Handler) dlnaCast() (*dlnacast.Controller, error) {
	if h.App.DlnaCast == nil {
		return nil, errCastUnavailable
	}
	return h.App.DlnaCast, nil
}

// HandleDlnaCastDiscover
//
//	@summary searches the network for DLNA renderers (TVs).
//	@desc Emits "searching", then "devices" with the found renderers.
//	@route /api/v1/dlna-cast/discover [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastDiscover(c echo.Context) error {
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.Discover()
	return h.RespondWithData(c, true)
}

// HandleDlnaCastStart
//
//	@summary casts a stream of this server to a renderer of the last search.
//	@desc The stream URL must point to this server (127.0.0.1); the TV gets it through a random path on the phone's Wi-Fi address.
//	@desc Emits "connecting", then "started" or "error".
//	@route /api/v1/dlna-cast/start [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastStart(c echo.Context) error {
	type body struct {
		DeviceId   string `json:"deviceId"`
		Url        string `json:"url"`
		Title      string `json:"title"`
		PositionMs int64  `json:"positionMs"`
		ArtworkUrl string `json:"artworkUrl"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.Start(b.DeviceId, b.Url, b.Title, b.PositionMs, b.ArtworkUrl)
	return h.RespondWithData(c, true)
}

// HandleDlnaCastSwitchStream
//
//	@summary plays another stream of the same video on the TV from where it is (other audio/subtitle track).
//	@desc Pick tracks with ?audioTrack=N / ?subtitleTrack=N|-1 on the direct stream URL.
//	@route /api/v1/dlna-cast/switch-stream [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastSwitchStream(c echo.Context) error {
	type body struct {
		Url string `json:"url"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.SwitchStream(b.Url)
	return h.RespondWithData(c, true)
}

// HandleDlnaCastLoad
//
//	@summary plays another video (the next episode) on the TV in use.
//	@route /api/v1/dlna-cast/load [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastLoad(c echo.Context) error {
	type body struct {
		Url        string `json:"url"`
		Title      string `json:"title"`
		PositionMs int64  `json:"positionMs"`
		ArtworkUrl string `json:"artworkUrl"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.Load(b.Url, b.Title, b.PositionMs, b.ArtworkUrl)
	return h.RespondWithData(c, true)
}

// HandleDlnaCastControl
//
//	@summary controls the TV: play, pause, seek (to value ms), skip (by value ms), volume (to value percent).
//	@desc Emits a "status" afterwards.
//	@route /api/v1/dlna-cast/control [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastControl(c echo.Context) error {
	type body struct {
		Action string `json:"action"`
		Value  int64  `json:"value"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	switch b.Action {
	case "play", "pause", "seek", "skip", "volume":
	default:
		return h.RespondWithError(c, errors.New("unknown cast action"))
	}
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.Control(b.Action, b.Value)
	return h.RespondWithData(c, true)
}

// HandleDlnaCastStatus
//
//	@summary asks the TV for its state; emits "status", or "idle" when nothing casts.
//	@route /api/v1/dlna-cast/status [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastStatus(c echo.Context) error {
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.Status()
	return h.RespondWithData(c, true)
}

// HandleDlnaCastStop
//
//	@summary ends casting; emits "stopped" with the TV's position (resume: the phone continues there).
//	@route /api/v1/dlna-cast/stop [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastStop(c echo.Context) error {
	type body struct {
		Resume bool `json:"resume"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.Stop(b.Resume)
	return h.RespondWithData(c, true)
}

// HandleDlnaCastForward
//
//	@summary makes a stream of this server reachable for a Google Cast receiver.
//	@desc Google Cast runs in the app; the receiver (host = its IP address) gets the stream through a random path on the
//	@desc phone's Wi-Fi address, like a DLNA TV. A new forward closes the previous one. Fails with an error code
//	@desc (invalid-stream, no-wifi).
//	@route /api/v1/dlna-cast/forward [POST]
//	@returns string
func (h *Handler) HandleDlnaCastForward(c echo.Context) error {
	type body struct {
		Host string `json:"host"`
		Url  string `json:"url"`
	}
	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	castURL, code := cast.Forward(b.Host, b.Url)
	if code != "" {
		return h.RespondWithError(c, errors.New(code))
	}
	return h.RespondWithData(c, castURL)
}

// HandleDlnaCastForwardClose
//
//	@summary closes the Google Cast forward; its path stops working.
//	@route /api/v1/dlna-cast/forward-close [POST]
//	@returns bool
func (h *Handler) HandleDlnaCastForwardClose(c echo.Context) error {
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	cast.CloseForward()
	return h.RespondWithData(c, true)
}

// HandleDlnaCastCurrent
//
//	@summary returns the casting device, or null when nothing casts (the app asks after it restarts).
//	@route /api/v1/dlna-cast/current [GET]
//	@returns dlnacast.Current
func (h *Handler) HandleDlnaCastCurrent(c echo.Context) error {
	cast, err := h.dlnaCast()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, cast.Current())
}
