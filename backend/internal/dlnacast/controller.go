package dlnacast

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Event is one "dlna-cast" WebSocket event, the same states the old app's CastController emitted:
// searching, devices, connecting, started, status, idle, stopped, error.
type Event map[string]any

// Error codes of error events; the app shows its own text for each (German/English).
const (
	ErrGone          = "gone"           // the TV is no longer in the last search
	ErrNoWifi        = "no-wifi"        // the phone has no address in the TV's network
	ErrTVOff         = "tv-off"         // 701: off or in standby
	ErrNoAnswer      = "no-answer"      // the connect timeout passed
	ErrRejected      = "rejected"       // the TV did not take the video
	ErrControl       = "control-failed" // play/pause/seek/volume got no answer
	ErrTrack         = "track-failed"   // the TV did not take the other track
	ErrNotConnected  = "not-connected"  // load without a session
	ErrInvalidStream = "invalid-stream" // the stream URL is not one of the server's own
)

// Device is a renderer as the app lists it.
type Device struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Kind is "webos" for LG TVs, "dlna" for other renderers.
	Kind string `json:"kind"`
}

// Current is the device in use.
type Current struct {
	Device string `json:"device"`
	Kind   string `json:"kind"`
}

type session struct {
	id, name, kind string
	renderer       *Renderer
	forwarder      *forwarder
	title, artwork string
}

// Controller is the cast session behind the player's cast panel. All methods return at once; results come as events.
type Controller struct {
	emit func(Event)
	upnp *upnp
	// serverPort: stream URLs must point to this port on loopback (0: any port, tests).
	serverPort int
	// connectTimeout: LG answers Play only once the video is open, then the start position is sought.
	connectTimeout  time.Duration
	discoverTimeout time.Duration

	mu      sync.Mutex
	devices map[string]*Renderer
	current *session
	// receiver: the forwarder of the Google Cast session (the app runs Google Cast itself, react-native-google-cast)
	receiver *forwarder
}

// New creates a controller that sends its events through emit and casts streams of the server on serverPort.
func New(serverPort int, emit func(Event)) *Controller {
	return &Controller{
		emit:            emit,
		upnp:            newUpnp(),
		serverPort:      serverPort,
		connectTimeout:  50 * time.Second,
		discoverTimeout: 3 * time.Second,
		devices:         map[string]*Renderer{},
	}
}

// DisplayName turns "[LG] webOS TV OLED65B59LA" into "webOS TV OLED65B59LA"; LG lists its TVs with this prefix.
func DisplayName(name string) string {
	return strings.TrimSpace(strings.TrimPrefix(name, "[LG]"))
}

// IsWebOS tells LG TVs apart: their GetVolume is unreliable and their Google Cast receiver shows no AV1/subtitles.
func IsWebOS(name string) bool {
	return strings.Contains(name, "[LG]") || strings.Contains(strings.ToLower(name), "webos")
}

func kindOf(r *Renderer) string {
	if IsWebOS(r.Name) {
		return "webos"
	}
	return "dlna"
}

// Discover searches the network and emits searching, then devices.
func (c *Controller) Discover() {
	c.emit(Event{"state": "searching"})
	go func() {
		found, err := c.upnp.discover(context.Background(), c.discoverTimeout)
		if err != nil {
			found = nil
		}
		devices := []Device{}
		c.mu.Lock()
		c.devices = map[string]*Renderer{}
		for _, r := range found {
			id := "dlna:" + r.AVTransportURL
			c.devices[id] = r
			devices = append(devices, Device{ID: id, Name: DisplayName(r.Name), Kind: kindOf(r)})
		}
		c.mu.Unlock()
		c.emit(Event{"state": "devices", "devices": devices})
	}()
}

// Start casts streamURL (a stream of the local server) to the device id from positionMs.
func (c *Controller) Start(id, streamURL, title string, positionMs int64, artworkURL string) {
	c.mu.Lock()
	renderer := c.devices[id]
	previous := c.current
	c.current = nil
	c.mu.Unlock()
	if renderer == nil {
		c.fail(ErrGone)
		return
	}
	name, kind := DisplayName(renderer.Name), kindOf(renderer)
	if previous != nil {
		go c.stopNow(previous)
	}
	c.emit(Event{"state": "connecting", "device": name, "kind": kind})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), c.connectTimeout)
		defer cancel()
		fwd, castURL, code := c.forward(ctx, renderer, streamURL)
		if code != "" {
			c.fail(code)
			return
		}
		err := c.upnp.play(ctx, renderer, castURL, title, positionMs/1000, artworkURL)
		if err != nil {
			fwd.close()
			c.fail(playFailure(ctx, err))
			return
		}
		c.mu.Lock()
		c.current = &session{id: id, name: name, kind: kind, renderer: renderer, forwarder: fwd, title: title, artwork: artworkURL}
		c.mu.Unlock()
		c.emit(Event{"state": "started", "device": name, "kind": kind})
	}()
}

// playFailure names why the TV did not start: off (701), no answer within the connect timeout, or refused.
func playFailure(ctx context.Context, err error) string {
	switch {
	case IsTVOff(err):
		return ErrTVOff
	case errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded):
		return ErrNoAnswer
	default:
		return ErrRejected
	}
}

// forward checks the stream URL and opens a forwarder on the phone's address towards the renderer.
func (c *Controller) forward(ctx context.Context, renderer *Renderer, streamURL string) (*forwarder, string, string) {
	target, err := localTarget(streamURL, c.serverPort)
	if err != nil {
		return nil, "", ErrInvalidStream
	}
	tv, err := url.Parse(renderer.AVTransportURL)
	if err != nil {
		return nil, "", ErrGone
	}
	ip, err := addressTowards(ctx, tv.Hostname())
	if err != nil || !(ip.IsPrivate() || ip.IsLoopback()) {
		return nil, "", ErrNoWifi
	}
	fwd, castURL, err := startForwarder(ip, target.String())
	if err != nil {
		return nil, "", ErrNoWifi
	}
	return fwd, castURL, ""
}

// Control runs play, pause, seek (to value ms), skip (by value ms) or volume (to value percent), then emits a status.
func (c *Controller) Control(action string, value int64) {
	s := c.session()
	if s == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), c.upnp.playTimeout)
		defer cancel()
		var err error
		switch action {
		case "play":
			err = c.upnp.resume(ctx, s.renderer)
		case "pause":
			err = c.upnp.pause(ctx, s.renderer)
		case "seek":
			err = c.upnp.seek(ctx, s.renderer, max(0, value))
		case "skip":
			err = c.upnp.seek(ctx, s.renderer, max(0, c.upnp.position(ctx, s.renderer)*1000+value))
		case "volume":
			err = c.upnp.setVolume(ctx, s.renderer, int(value))
		}
		if err != nil {
			c.fail(ErrControl)
			return
		}
		time.Sleep(400 * time.Millisecond)
		c.statusNow()
	}()
}

// SwitchStream plays streamURL on the TV instead, from where it is now: another audio or subtitle track picked on the
// phone (the stream URL carries ?audioTrack=/?subtitleTrack=, see directstream/audiotrack.go).
func (c *Controller) SwitchStream(streamURL string) {
	s := c.session()
	if s == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), c.connectTimeout)
		defer cancel()
		fwd, castURL, code := c.forward(ctx, s.renderer, streamURL)
		if code != "" {
			c.fail(ErrTrack)
			return
		}
		if err := c.upnp.play(ctx, s.renderer, castURL, s.title, c.upnp.position(ctx, s.renderer), s.artwork); err != nil {
			fwd.close()
			c.fail(ErrTrack)
			return
		}
		if !c.replace(s, fwd, s.title, s.artwork) {
			return
		}
		c.statusNow()
	}()
}

// Load plays another video (the next episode) on the TV in use from positionMs, without a new search.
func (c *Controller) Load(streamURL, title string, positionMs int64, artworkURL string) {
	s := c.session()
	if s == nil {
		c.fail(ErrNotConnected)
		return
	}
	c.emit(Event{"state": "connecting", "device": s.name, "kind": s.kind})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), c.connectTimeout)
		defer cancel()
		fwd, castURL, code := c.forward(ctx, s.renderer, streamURL)
		if code != "" {
			c.fail(code)
			return
		}
		if err := c.upnp.play(ctx, s.renderer, castURL, title, positionMs/1000, artworkURL); err != nil {
			fwd.close()
			c.fail(playFailure(ctx, err))
			return
		}
		if !c.replace(s, fwd, title, artworkURL) {
			return
		}
		c.emit(Event{"state": "started", "device": s.name, "kind": s.kind})
		c.statusNow()
	}()
}

// replace makes fwd the session's stream; false (and fwd closed) when the session ended meanwhile.
func (c *Controller) replace(s *session, fwd *forwarder, title, artwork string) bool {
	c.mu.Lock()
	if c.current != s {
		c.mu.Unlock()
		fwd.close()
		return false
	}
	c.current = &session{id: s.id, name: s.name, kind: s.kind, renderer: s.renderer, forwarder: fwd, title: title, artwork: artwork}
	c.mu.Unlock()
	s.forwarder.close()
	return true
}

// Status emits the TV's state, or idle when nothing casts.
func (c *Controller) Status() { go c.statusNow() }

func (c *Controller) statusNow() {
	s := c.session()
	if s == nil {
		c.emit(Event{"state": "idle"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), c.upnp.actionTimeout*3)
	defer cancel()
	status, err := c.upnp.status(ctx, s.renderer)
	if err != nil {
		return
	}
	// LG reports the volume last set over DLNA (0 at first), not the one of its remote: unknown, so the app shows no
	// volume buttons
	volume := status.Volume
	if s.kind == "webos" {
		volume = -1
	}
	c.emit(Event{"state": "status", "device": s.name, "kind": s.kind, "playing": status.Playing, "positionMs": status.PositionMs,
		"durationMs": status.DurationMs, "volume": volume, "ended": status.Ended})
}

// Stop ends casting; with resume the phone continues where the TV was (stopped carries positionMs).
func (c *Controller) Stop(resume bool) {
	c.mu.Lock()
	s := c.current
	c.current = nil
	c.mu.Unlock()
	if s == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), c.upnp.actionTimeout)
		positionMs := c.upnp.position(ctx, s.renderer) * 1000
		cancel()
		c.stopNow(s)
		c.emit(Event{"state": "stopped", "positionMs": positionMs, "resume": resume})
	}()
}

// Current is the casting device, or nil when nothing casts (the app asks after it restarts).
func (c *Controller) Current() *Current {
	s := c.session()
	if s == nil {
		return nil
	}
	return &Current{Device: s.name, Kind: s.kind}
}

// Forward makes a stream of the server reachable for a Google Cast receiver at host (its IP address), through the same
// random-path forwarder as DLNA. One at a time: a new one (other track, next episode) closes the previous, so the old
// path dies. Returns the URL for the receiver or an error code.
func (c *Controller) Forward(host, streamURL string) (string, string) {
	target, err := localTarget(streamURL, c.serverPort)
	if err != nil {
		return "", ErrInvalidStream
	}
	receiver := net.ParseIP(host)
	if receiver == nil || !(receiver.IsPrivate() || receiver.IsLoopback()) {
		return "", ErrNoWifi
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ip, err := addressTowards(ctx, receiver.String())
	if err != nil || !(ip.IsPrivate() || ip.IsLoopback()) {
		return "", ErrNoWifi
	}
	fwd, castURL, err := startForwarder(ip, target.String())
	if err != nil {
		return "", ErrNoWifi
	}
	c.mu.Lock()
	old := c.receiver
	c.receiver = fwd
	c.mu.Unlock()
	old.close()
	return castURL, ""
}

// CloseForward ends the Google Cast forwarder (casting stopped or failed).
func (c *Controller) CloseForward() {
	c.mu.Lock()
	old := c.receiver
	c.receiver = nil
	c.mu.Unlock()
	old.close()
}

// Release closes the forwarders without telling the TV (server shutdown).
func (c *Controller) Release() {
	c.mu.Lock()
	s := c.current
	c.current = nil
	c.mu.Unlock()
	if s != nil {
		s.forwarder.close()
	}
	c.CloseForward()
}

func (c *Controller) stopNow(s *session) {
	ctx, cancel := context.WithTimeout(context.Background(), c.upnp.actionTimeout)
	defer cancel()
	_ = c.upnp.stop(ctx, s.renderer)
	s.forwarder.close()
}

func (c *Controller) session() *session {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.current
}

func (c *Controller) fail(code string) {
	c.emit(Event{"state": "error", "code": code, "message": messages[code]})
}

// messages are English fallbacks; the app shows its own translation of the code.
var messages = map[string]string{
	ErrGone:          "This TV is gone, search again.",
	ErrNoWifi:        "No Wi-Fi: the TV can only be reached in the same Wi-Fi.",
	ErrTVOff:         "The TV is off or in standby. Turn it on and try again.",
	ErrNoAnswer:      "The TV does not answer. Is it on?",
	ErrRejected:      "The TV did not take the video.",
	ErrControl:       "The TV did not answer.",
	ErrTrack:         "The TV did not take the other track.",
	ErrNotConnected:  "No TV is connected.",
	ErrInvalidStream: "This video cannot be cast.",
}
