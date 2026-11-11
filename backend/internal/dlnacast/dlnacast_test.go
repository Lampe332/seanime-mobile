package dlnacast

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeTV is a UPnP renderer fixture: it records the SOAP actions it gets and answers like an LG TV.
type fakeTV struct {
	t      *testing.T
	server *httptest.Server
	name   string

	mu       sync.Mutex
	actions  []string
	bodies   map[string]string
	states   []string       // GetTransportInfo answers in order; the last one repeats
	failWith map[string]int // action -> UPnP error code
	delay    map[string]time.Duration
	volume   int
	position string
}

func newFakeTV(t *testing.T, name string) *fakeTV {
	tv := &fakeTV{t: t, name: name, bodies: map[string]string{}, states: []string{"PLAYING"}, failWith: map[string]int{},
		delay: map[string]time.Duration{}, volume: 37, position: "0:12:34"}
	tv.server = httptest.NewServer(http.HandlerFunc(tv.serve))
	t.Cleanup(tv.server.Close)
	return tv
}

var soapAction = regexp.MustCompile(`#(\w+)"`)

func (tv *fakeTV) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/desc.xml" {
		fmt.Fprintf(w, `<root><device><friendlyName>%s</friendlyName><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av</controlURL></service>
</serviceList></device></root>`, tv.name)
		return
	}
	m := soapAction.FindStringSubmatch(r.Header.Get("SOAPACTION"))
	if m == nil {
		http.NotFound(w, r)
		return
	}
	action := m[1]
	body, _ := io.ReadAll(r.Body)
	tv.mu.Lock()
	tv.actions = append(tv.actions, action)
	tv.bodies[action] = string(body)
	code := tv.failWith[action]
	delay := tv.delay[action]
	state := tv.states[0]
	if action == "GetTransportInfo" && len(tv.states) > 1 {
		tv.states = tv.states[1:]
	}
	volume, position := tv.volume, tv.position
	tv.mu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
	}
	if code != 0 {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>%d</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>`, code)
		return
	}
	switch action {
	case "GetTransportInfo":
		fmt.Fprintf(w, "<CurrentTransportState>%s</CurrentTransportState>", state)
	case "GetPositionInfo":
		fmt.Fprintf(w, "<TrackDuration>0:24:00</TrackDuration><RelTime>%s</RelTime>", position)
	case "GetVolume":
		fmt.Fprintf(w, "<CurrentVolume>%d</CurrentVolume>", volume)
	default:
		fmt.Fprint(w, "<ok/>")
	}
}

func (tv *fakeTV) recorded() []string {
	tv.mu.Lock()
	defer tv.mu.Unlock()
	return append([]string(nil), tv.actions...)
}

func (tv *fakeTV) body(action string) string {
	tv.mu.Lock()
	defer tv.mu.Unlock()
	return tv.bodies[action]
}

func (tv *fakeTV) renderer() *Renderer {
	return &Renderer{Name: tv.name, AVTransportURL: tv.server.URL + "/av", RenderingControlURL: tv.server.URL + "/rc"}
}

// stream is the local server fixture: a 1000-byte video with byte ranges.
func newStream(t *testing.T) (*httptest.Server, *[]string) {
	var ranges []string
	var mu sync.Mutex
	content := strings.Repeat("v", 1000)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		ranges = append(ranges, r.Header.Get("Range"))
		mu.Unlock()
		http.ServeContent(w, r, "video.mkv", time.Time{}, strings.NewReader(content))
	}))
	t.Cleanup(server.Close)
	return server, &ranges
}

type recorder struct{ events chan Event }

func newController(t *testing.T) (*Controller, *recorder) {
	rec := &recorder{events: make(chan Event, 64)}
	c := New(0, func(e Event) { rec.events <- e })
	c.upnp.seekPoll = 10 * time.Millisecond
	c.upnp.actionTimeout = 2 * time.Second
	c.connectTimeout = 5 * time.Second
	t.Cleanup(c.Release)
	return c, rec
}

func (r *recorder) next(t *testing.T, state string) Event {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case e := <-r.events:
			if e["state"] == state {
				return e
			}
			if e["state"] == "error" && state != "error" {
				t.Fatalf("got error %v while waiting for %s", e, state)
			}
		case <-deadline:
			t.Fatalf("no %s event", state)
		}
	}
}

func addDevice(c *Controller, tv *fakeTV) string {
	id := "dlna:" + tv.renderer().AVTransportURL
	c.mu.Lock()
	c.devices[id] = tv.renderer()
	c.mu.Unlock()
	return id
}

func TestStartStopsBeforeSetURIThenPlaysAndSeeksOnlyWhenPlaying(t *testing.T) {
	tv := newFakeTV(t, "[LG] webOS TV OLED65B59LA")
	tv.states = []string{"TRANSITIONING", "LG_TRANSITIONING", "PLAYING"}
	stream, _ := newStream(t)
	c, rec := newController(t)
	id := addDevice(c, tv)

	c.Start(id, stream.URL+"/api/v1/directstream/stream?id=1&audioTrack=2", "Episode 1", 600_000, "")
	connecting := rec.next(t, "connecting")
	if connecting["device"] != "webOS TV OLED65B59LA" || connecting["kind"] != "webos" {
		t.Fatalf("connecting = %v", connecting)
	}
	rec.next(t, "started")

	actions := tv.recorded()
	want := []string{"Stop", "SetAVTransportURI", "Play", "GetTransportInfo", "GetTransportInfo", "GetTransportInfo", "Seek"}
	if strings.Join(actions, ",") != strings.Join(want, ",") {
		t.Fatalf("actions = %v, want %v", actions, want)
	}
	if !strings.Contains(tv.body("Seek"), "<Target>0:10:00</Target>") {
		t.Fatalf("seek body = %s", tv.body("Seek"))
	}
	setURI := tv.body("SetAVTransportURI")
	if !strings.Contains(setURI, "DLNA.ORG_OP=01") || !strings.Contains(setURI, "video/x-matroska") {
		t.Fatalf("protocolInfo without DLNA.ORG_OP=01: %s", setURI)
	}
	if strings.Contains(setURI, "audioTrack") || strings.Contains(setURI, "directstream") {
		t.Fatalf("the TV must only see the forwarder path: %s", setURI)
	}
}

func TestStartWithoutStartPositionDoesNotSeek(t *testing.T) {
	tv := newFakeTV(t, "Living room")
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 3000, "")
	rec.next(t, "started")
	if got := strings.Join(tv.recorded(), ","); got != "Stop,SetAVTransportURI,Play" {
		t.Fatalf("actions = %s", got)
	}
}

func TestTVOffAnswers701(t *testing.T) {
	tv := newFakeTV(t, "[LG] webOS TV")
	tv.failWith["SetAVTransportURI"] = 701
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 0, "")
	e := rec.next(t, "error")
	if e["code"] != ErrTVOff {
		t.Fatalf("error = %v", e)
	}
	if c.Current() != nil {
		t.Fatal("no session after a refused start")
	}
	// Play is never sent after a refused SetAVTransportURI
	for _, a := range tv.recorded() {
		if a == "Play" {
			t.Fatal("Play after 701")
		}
	}
}

func TestStopFailureBeforeSetURIIsIgnored(t *testing.T) {
	tv := newFakeTV(t, "TV")
	tv.failWith["Stop"] = 701
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 0, "")
	rec.next(t, "started")
}

func TestConnectTimeoutMeansNoAnswer(t *testing.T) {
	tv := newFakeTV(t, "TV")
	tv.delay["Play"] = 5 * time.Second
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.connectTimeout = 300 * time.Millisecond
	started := time.Now()
	c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 0, "")
	e := rec.next(t, "error")
	if e["code"] != ErrNoAnswer {
		t.Fatalf("error = %v", e)
	}
	if time.Since(started) > 3*time.Second {
		t.Fatal("the connect timeout did not end the start")
	}
}

func TestPlayMayTakeLongerThanOtherActions(t *testing.T) {
	tv := newFakeTV(t, "TV")
	tv.delay["Play"] = 400 * time.Millisecond
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.upnp.actionTimeout = 200 * time.Millisecond
	c.upnp.playTimeout = 2 * time.Second
	c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 0, "")
	rec.next(t, "started")
}

func TestDefaultTimeouts(t *testing.T) {
	c := New(43212, func(Event) {})
	if c.upnp.playTimeout != 30*time.Second || c.connectTimeout != 50*time.Second {
		t.Fatalf("play %v connect %v", c.upnp.playTimeout, c.connectTimeout)
	}
}

func TestForwarderServesOnlyTheRandomPathWhileCasting(t *testing.T) {
	tv := newFakeTV(t, "TV")
	stream, ranges := newStream(t)
	c, rec := newController(t)
	c.Start(addDevice(c, tv), stream.URL+"/api/v1/directstream/stream?id=7", "Episode", 0, "")
	rec.next(t, "started")

	castURL := regexp.MustCompile(`<CurrentURI>(http://[^<]+)</CurrentURI>`).FindStringSubmatch(tv.body("SetAVTransportURI"))
	if castURL == nil {
		t.Fatalf("no stream URL in %s", tv.body("SetAVTransportURI"))
	}
	if !regexp.MustCompile(`^http://127\.0\.0\.1:\d+/[0-9a-f]{32}$`).MatchString(castURL[1]) {
		t.Fatalf("cast URL = %s", castURL[1])
	}

	req, _ := http.NewRequest(http.MethodGet, castURL[1], nil)
	req.Header.Set("Range", "bytes=100-199")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || len(data) != 100 || resp.Header.Get("Content-Range") != "bytes 100-199/1000" {
		t.Fatalf("status %d len %d range %q", resp.StatusCode, len(data), resp.Header.Get("Content-Range"))
	}
	if resp.Header.Get("contentFeatures.dlna.org") != DLNAFeatures || resp.Header.Get("transferMode.dlna.org") != "Streaming" {
		t.Fatalf("DLNA headers missing: %v", resp.Header)
	}
	if got := (*ranges)[len(*ranges)-1]; got != "bytes=100-199" {
		t.Fatalf("range not forwarded: %q", got)
	}

	base := castURL[1][:strings.LastIndex(castURL[1], "/")]
	for _, path := range []string{"/", "/api/v1/status", "/" + strings.Repeat("0", 32)} {
		resp, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s answered %d", path, resp.StatusCode)
		}
	}
	post, err := http.Post(castURL[1], "text/plain", strings.NewReader("x"))
	if err != nil {
		t.Fatal(err)
	}
	post.Body.Close()
	if post.StatusCode != http.StatusNotFound {
		t.Fatalf("POST answered %d", post.StatusCode)
	}

	c.Stop(false)
	stopped := rec.next(t, "stopped")
	if stopped["positionMs"] != int64(754_000) {
		t.Fatalf("stopped = %v", stopped)
	}
	client := &http.Client{Timeout: 2 * time.Second}
	if resp, err := client.Get(castURL[1]); err == nil {
		resp.Body.Close()
		t.Fatal("the path still answers after the session ended")
	}
}

func TestSwitchStreamReplacesTheForwarder(t *testing.T) {
	tv := newFakeTV(t, "TV")
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.Start(addDevice(c, tv), stream.URL+"/v?audioTrack=1", "Episode", 0, "")
	rec.next(t, "started")
	first := c.session().forwarder

	c.SwitchStream(stream.URL + "/v?audioTrack=2")
	rec.next(t, "status")
	second := c.session().forwarder
	if first == second || first.token == second.token || second.target != stream.URL+"/v?audioTrack=2" {
		t.Fatal("the switched stream did not get its own forwarder")
	}
	// resumes from the TV's position (0:12:34)
	if !strings.Contains(tv.body("Seek"), "<Target>0:12:34</Target>") {
		t.Fatalf("seek = %s", tv.body("Seek"))
	}
	if _, err := net.DialTimeout("tcp", first.listener.Addr().String(), time.Second); err == nil {
		t.Fatal("the old forwarder still listens")
	}
}

func TestStatusHidesWebOSVolume(t *testing.T) {
	for _, tc := range []struct {
		name   string
		volume int
	}{{"[LG] webOS TV", -1}, {"Bravia", 37}} {
		tv := newFakeTV(t, tc.name)
		tv.states = []string{"PLAYING"}
		stream, _ := newStream(t)
		c, rec := newController(t)
		c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 0, "")
		rec.next(t, "started")
		c.Status()
		status := rec.next(t, "status")
		if status["volume"] != tc.volume || status["playing"] != true || status["positionMs"] != int64(754_000) || status["durationMs"] != int64(1_440_000) {
			t.Fatalf("%s: status = %v", tc.name, status)
		}
	}
}

func TestControlSkipSeeksFromTheTVPosition(t *testing.T) {
	tv := newFakeTV(t, "TV")
	stream, _ := newStream(t)
	c, rec := newController(t)
	c.Start(addDevice(c, tv), stream.URL+"/v", "Episode", 0, "")
	rec.next(t, "started")
	c.Control("skip", -30_000)
	rec.next(t, "status")
	if !strings.Contains(tv.body("Seek"), "<Target>0:12:04</Target>") {
		t.Fatalf("seek = %s", tv.body("Seek"))
	}
	c.Control("volume", 150)
	rec.next(t, "status")
	if !strings.Contains(tv.body("SetVolume"), "<DesiredVolume>100</DesiredVolume>") {
		t.Fatalf("volume = %s", tv.body("SetVolume"))
	}
}

func TestLoadWithoutSessionAndUnknownDevice(t *testing.T) {
	c, rec := newController(t)
	c.Load("http://127.0.0.1:1/v", "Episode 2", 0, "")
	if e := rec.next(t, "error"); e["code"] != ErrNotConnected {
		t.Fatalf("error = %v", e)
	}
	c.Start("dlna:gone", "http://127.0.0.1:1/v", "Episode", 0, "")
	if e := rec.next(t, "error"); e["code"] != ErrGone {
		t.Fatalf("error = %v", e)
	}
	c.Status()
	rec.next(t, "idle")
}

func TestOnlyLocalStreamsAreCast(t *testing.T) {
	for raw, ok := range map[string]bool{
		"http://127.0.0.1:43212/api/v1/directstream/stream": true,
		"http://localhost:43212/v":                          true,
		"http://127.0.0.1:9999/v":                           false,
		"http://192.168.1.20:43212/v":                       false,
		"https://example.com/v.mkv":                         false,
		"file:///data/v.mkv":                                false,
	} {
		if _, err := localTarget(raw, 43212); (err == nil) != ok {
			t.Errorf("%s: accepted=%v", raw, err == nil)
		}
	}
	tv := newFakeTV(t, "TV")
	c, rec := newController(t)
	c.Start(addDevice(c, tv), "https://cdn.example/video.mp4", "Episode", 0, "")
	if e := rec.next(t, "error"); e["code"] != ErrInvalidStream {
		t.Fatalf("error = %v", e)
	}
	if len(tv.recorded()) != 0 {
		t.Fatal("the TV got a command for a foreign URL")
	}
}

func TestDiscoverFindsRenderersOverSSDP(t *testing.T) {
	tv := newFakeTV(t, "[LG] webOS TV OLED65B59LA")
	// SSDP fixture: answers each M-SEARCH for MediaRenderers with the TV's description location
	responder, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { responder.Close() })
	go func() {
		buf := make([]byte, 2048)
		for {
			n, from, err := responder.ReadFromUDP(buf)
			if err != nil {
				return
			}
			if strings.HasPrefix(string(buf[:n]), "M-SEARCH") && strings.Contains(string(buf[:n]), "MediaRenderer:1") {
				reply := "HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nLOCATION: " + tv.server.URL + "/desc.xml\r\n\r\n"
				_, _ = responder.WriteToUDP([]byte(reply), from)
			}
		}
	}()
	c, rec := newController(t)
	c.upnp.ssdpAddr = responder.LocalAddr().String()
	c.discoverTimeout = 700 * time.Millisecond
	c.Discover()
	rec.next(t, "searching")
	devices := rec.next(t, "devices")["devices"].([]Device)
	if len(devices) != 1 {
		t.Fatalf("devices = %v", devices)
	}
	d := devices[0]
	if d.Name != "webOS TV OLED65B59LA" || d.Kind != "webos" || d.ID != "dlna:"+tv.server.URL+"/av" {
		t.Fatalf("device = %+v", d)
	}
	if r := c.devices[d.ID]; r.RenderingControlURL != tv.server.URL+"/rc" {
		t.Fatalf("renderer = %+v", r)
	}
}

func TestForwardForGoogleCastReceiver(t *testing.T) {
	stream, _ := newStream(t)
	c, _ := newController(t)
	if _, code := c.Forward("127.0.0.1", "https://cdn.example/video.mp4"); code != ErrInvalidStream {
		t.Fatalf("foreign stream: code %q", code)
	}
	if _, code := c.Forward("8.8.8.8", stream.URL+"/v"); code != ErrNoWifi {
		t.Fatalf("public receiver: code %q", code)
	}
	if _, code := c.Forward("not-an-ip", stream.URL+"/v"); code != ErrNoWifi {
		t.Fatalf("no ip: code %q", code)
	}
	first, code := c.Forward("127.0.0.1", stream.URL+"/v")
	if code != "" || !regexp.MustCompile(`^http://127\.0\.0\.1:\d+/[0-9a-f]{32}$`).MatchString(first) {
		t.Fatalf("forward = %q %q", first, code)
	}
	get := func(u string) int {
		resp, err := http.Get(u)
		if err != nil {
			return 0
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}
	if s := get(first); s != http.StatusOK {
		t.Fatalf("first forward status %d", s)
	}
	second, _ := c.Forward("127.0.0.1", stream.URL+"/v")
	if get(first) == http.StatusOK {
		t.Fatal("the previous path still works after a new forward")
	}
	if s := get(second); s != http.StatusOK {
		t.Fatalf("second forward status %d", s)
	}
	c.CloseForward()
	if get(second) == http.StatusOK {
		t.Fatal("the path still works after CloseForward")
	}
}
