// Package dlnacast casts streams of the local server to DLNA renderers (LG webOS, Samsung, Sony TVs ...): it finds them
// by SSDP, hands them a stream URL and controls playback over UPnP AVTransport and RenderingControl.
//
// Ported from the old app's cast/DlnaCast.kt and cast/CastController.kt; every LG fix of those files lives on here.
package dlnacast

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	avTransport      = "urn:schemas-upnp-org:service:AVTransport:1"
	renderingControl = "urn:schemas-upnp-org:service:RenderingControl:1"
	mediaRenderer    = "urn:schemas-upnp-org:device:MediaRenderer:1"
	ssdpGroup        = "239.255.255.250:1900"

	// DLNAFeatures marks the stream as byte-range seekable (OP=01) and streamed; without them LG does not seek.
	DLNAFeatures = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
	// castMime is what the TV is told it gets; the direct streams of the server are Matroska.
	castMime = "video/x-matroska"
)

// Renderer is a TV or other UPnP media renderer on the network.
type Renderer struct {
	Name                string
	AVTransportURL      string
	RenderingControlURL string
}

// Status is what a renderer reports: play state, place and length in ms, volume 0..100 (-1 unknown).
type Status struct {
	Playing    bool
	PositionMs int64
	DurationMs int64
	Volume     int
	Ended      bool
}

// UpnpError is a refused UPnP action; 701 ("transition not available") is what LG TVs answer while they are off or in standby.
type UpnpError struct{ Code int }

func (e *UpnpError) Error() string { return fmt.Sprintf("UPnP error %d", e.Code) }

// IsTVOff reports whether err is the 701 an LG TV answers while it is off or in standby.
func IsTVOff(err error) bool {
	var upnp *UpnpError
	return errors.As(err, &upnp) && upnp.Code == 701
}

// upnp talks SOAP to renderers. The timeouts and the seek polling are fields so tests can shorten them.
type upnp struct {
	http *http.Client
	// actionTimeout bounds every action but Play.
	actionTimeout time.Duration
	// playTimeout bounds Play: the TV answers it only once it has opened the video.
	playTimeout time.Duration
	// seekPoll and seekAttempts: how often and how long to wait for PLAYING before seeking to the start position.
	seekPoll     time.Duration
	seekAttempts int
	// ssdpAddr is where M-SEARCH goes (the SSDP multicast group; a unicast address in tests).
	ssdpAddr string
}

func newUpnp() *upnp {
	return &upnp{
		http:          &http.Client{Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext}},
		actionTimeout: 8 * time.Second,
		playTimeout:   30 * time.Second,
		seekPoll:      time.Second,
		seekAttempts:  15,
		ssdpAddr:      ssdpGroup,
	}
}

// discover returns the renderers that answer an SSDP search within timeout.
func (u *upnp) discover(ctx context.Context, timeout time.Duration) ([]*Renderer, error) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{})
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	target, err := net.ResolveUDPAddr("udp4", u.ssdpAddr)
	if err != nil {
		return nil, err
	}
	search := []byte("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + mediaRenderer + "\r\n\r\n")
	// UDP may drop one of them
	for i := 0; i < 2; i++ {
		if _, err := conn.WriteToUDP(search, target); err != nil {
			return nil, err
		}
	}
	locations := []string{}
	seen := map[string]bool{}
	buffer := make([]byte, 4096)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) && ctx.Err() == nil {
		_ = conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		n, _, err := conn.ReadFromUDP(buffer)
		if err != nil {
			continue
		}
		if location := ssdpLocation(string(buffer[:n])); location != "" && !seen[location] {
			seen[location] = true
			locations = append(locations, location)
		}
	}
	renderers := []*Renderer{}
	known := map[string]bool{}
	for _, location := range locations {
		renderer, err := u.describe(ctx, location)
		if err != nil || known[renderer.AVTransportURL] {
			continue
		}
		known[renderer.AVTransportURL] = true
		renderers = append(renderers, renderer)
	}
	return renderers, nil
}

func ssdpLocation(reply string) string {
	for _, line := range strings.Split(reply, "\n") {
		if len(line) > 9 && strings.EqualFold(line[:9], "location:") {
			return strings.TrimSpace(line[9:])
		}
	}
	return ""
}

var friendlyName = regexp.MustCompile(`<friendlyName>(.*?)</friendlyName>`)

func controlURLPattern(service string) *regexp.Regexp {
	return regexp.MustCompile(`(?s)<serviceType>` + regexp.QuoteMeta(service) + `</serviceType>.*?<controlURL>(.*?)</controlURL>`)
}

var (
	avTransportControl      = controlURLPattern(avTransport)
	renderingControlControl = controlURLPattern(renderingControl)
)

// describe reads name and control URLs from a renderer's device description.
func (u *upnp) describe(ctx context.Context, location string) (*Renderer, error) {
	base, err := url.Parse(location)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") {
		return nil, errors.New("invalid location")
	}
	xml, err := u.request(ctx, location, "", "", u.actionTimeout)
	if err != nil {
		return nil, err
	}
	name := "TV"
	if m := friendlyName.FindStringSubmatch(xml); m != nil {
		name = html.UnescapeString(m[1])
	}
	control := func(pattern *regexp.Regexp) string {
		m := pattern.FindStringSubmatch(xml)
		if m == nil {
			return ""
		}
		ref, err := url.Parse(strings.TrimSpace(html.UnescapeString(m[1])))
		if err != nil {
			return ""
		}
		return base.ResolveReference(ref).String()
	}
	av := control(avTransportControl)
	if av == "" {
		return nil, errors.New("no AVTransport")
	}
	return &Renderer{Name: name, AVTransportURL: av, RenderingControlURL: control(renderingControlControl)}, nil
}

// play opens url on the renderer and starts it, then seeks to startSeconds once the TV plays.
func (u *upnp) play(ctx context.Context, r *Renderer, streamURL, title string, startSeconds int64, artworkURL string) error {
	art := ""
	if artworkURL != "" {
		art = "<upnp:albumArtURI>" + escape(artworkURL) + "</upnp:albumArtURI>"
	}
	metadata := `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
		`xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1">` +
		"<dc:title>" + escape(title) + "</dc:title><upnp:class>object.item.videoItem</upnp:class>" + art +
		`<res protocolInfo="http-get:*:` + castMime + ":" + DLNAFeatures + `">` + escape(streamURL) + "</res></item></DIDL-Lite>"
	// LG refuses a new video (701) while an earlier one is still loaded or loading
	_, _ = u.av(ctx, r, "Stop", "")
	if _, err := u.av(ctx, r, "SetAVTransportURI", "<CurrentURI>"+escape(streamURL)+"</CurrentURI><CurrentURIMetaData>"+escape(metadata)+"</CurrentURIMetaData>"); err != nil {
		return err
	}
	// the TV answers Play only once it has opened the video
	if _, err := u.soap(ctx, r.AVTransportURL, avTransport, "Play", "<Speed>1</Speed>", u.playTimeout); err != nil {
		return err
	}
	if startSeconds <= 5 {
		return nil
	}
	// the TV answers a seek before it plays, but only follows it once it plays
	for attempt := 0; attempt < u.seekAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(u.seekPoll):
		}
		state, err := u.transportState(ctx, r)
		if err != nil || state != "PLAYING" {
			continue
		}
		_ = u.seek(ctx, r, startSeconds*1000)
		break
	}
	return nil
}

func (u *upnp) pause(ctx context.Context, r *Renderer) error {
	_, err := u.av(ctx, r, "Pause", "")
	return err
}

func (u *upnp) resume(ctx context.Context, r *Renderer) error {
	_, err := u.av(ctx, r, "Play", "<Speed>1</Speed>")
	return err
}

func (u *upnp) stop(ctx context.Context, r *Renderer) error {
	_, err := u.av(ctx, r, "Stop", "")
	return err
}

func (u *upnp) seek(ctx context.Context, r *Renderer, ms int64) error {
	_, err := u.av(ctx, r, "Seek", "<Unit>REL_TIME</Unit><Target>"+clock(ms/1000)+"</Target>")
	return err
}

func (u *upnp) setVolume(ctx context.Context, r *Renderer, percent int) error {
	if r.RenderingControlURL == "" {
		return nil
	}
	percent = max(0, min(100, percent))
	_, err := u.soap(ctx, r.RenderingControlURL, renderingControl, "SetVolume", "<Channel>Master</Channel><DesiredVolume>"+strconv.Itoa(percent)+"</DesiredVolume>", u.actionTimeout)
	return err
}

var (
	transportState = regexp.MustCompile(`<CurrentTransportState>(\w+)`)
	currentVolume  = regexp.MustCompile(`<CurrentVolume>(\d+)`)
)

func (u *upnp) transportState(ctx context.Context, r *Renderer) (string, error) {
	reply, err := u.av(ctx, r, "GetTransportInfo", "")
	if err != nil {
		return "", err
	}
	if m := transportState.FindStringSubmatch(reply); m != nil {
		return m[1], nil
	}
	return "", nil
}

func (u *upnp) status(ctx context.Context, r *Renderer) (*Status, error) {
	position, err := u.av(ctx, r, "GetPositionInfo", "")
	if err != nil {
		return nil, err
	}
	state, err := u.transportState(ctx, r)
	if err != nil {
		return nil, err
	}
	volume := -1
	if r.RenderingControlURL != "" {
		if reply, err := u.soap(ctx, r.RenderingControlURL, renderingControl, "GetVolume", "<Channel>Master</Channel>", u.actionTimeout); err == nil {
			if m := currentVolume.FindStringSubmatch(reply); m != nil {
				volume, _ = strconv.Atoi(m[1])
			}
		}
	}
	return &Status{
		// LG reports its own LG_TRANSITIONING while it loads
		Playing:    state == "PLAYING" || strings.HasSuffix(state, "TRANSITIONING"),
		PositionMs: seconds(position, "RelTime") * 1000,
		DurationMs: seconds(position, "TrackDuration") * 1000,
		Volume:     volume,
		Ended:      state == "STOPPED" || state == "NO_MEDIA_PRESENT",
	}, nil
}

// position is where the TV is in the video, in seconds; 0 when it does not say.
func (u *upnp) position(ctx context.Context, r *Renderer) int64 {
	reply, err := u.av(ctx, r, "GetPositionInfo", "")
	if err != nil {
		return 0
	}
	return seconds(reply, "RelTime")
}

func seconds(reply, element string) int64 {
	m := regexp.MustCompile(`<` + element + `>(\d+):(\d+):(\d+)`).FindStringSubmatch(reply)
	if m == nil {
		return 0
	}
	h, _ := strconv.ParseInt(m[1], 10, 64)
	mi, _ := strconv.ParseInt(m[2], 10, 64)
	s, _ := strconv.ParseInt(m[3], 10, 64)
	return h*3600 + mi*60 + s
}

func (u *upnp) av(ctx context.Context, r *Renderer, action, arguments string) (string, error) {
	return u.soap(ctx, r.AVTransportURL, avTransport, action, arguments, u.actionTimeout)
}

func (u *upnp) soap(ctx context.Context, controlURL, service, action, arguments string, timeout time.Duration) (string, error) {
	body := `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
		`s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:` + action + ` xmlns:u="` + service + `">` +
		"<InstanceID>0</InstanceID>" + arguments + "</u:" + action + "></s:Body></s:Envelope>"
	return u.request(ctx, controlURL, body, `"`+service+"#"+action+`"`, timeout)
}

var errorCode = regexp.MustCompile(`<errorCode>(\d+)</errorCode>`)

func (u *upnp) request(ctx context.Context, target, body, soapAction string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	method := http.MethodGet
	if body != "" {
		method = http.MethodPost
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewBufferString(body))
	if err != nil {
		return "", err
	}
	if body != "" {
		req.Header.Set("Content-Type", `text/xml; charset="utf-8"`)
		req.Header.Set("SOAPACTION", soapAction)
	}
	resp, err := u.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		code := resp.StatusCode
		if m := errorCode.FindSubmatch(data); m != nil {
			code, _ = strconv.Atoi(string(m[1]))
		}
		return "", &UpnpError{Code: code}
	}
	return string(data), nil
}

func clock(seconds int64) string {
	return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds/60%60, seconds%60)
}

func escape(text string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(text)
}
