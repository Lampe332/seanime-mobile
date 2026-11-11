package dlnacast

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// forwarder makes one stream of the local server reachable for the TV while casting.
//
// The server itself listens on 127.0.0.1 only. The forwarder listens on the address the phone uses towards the TV and
// answers only GET/HEAD on one path made of 128 random bits; every other path gets 404. It lives as long as one cast
// stream: stopping, switching tracks or loading the next episode closes it, and the old path dies with it. So someone
// else in the Wi-Fi can neither guess the path nor reach any other route of the server through it.
type forwarder struct {
	token    string
	target   string
	listener net.Listener
	server   *http.Server
	client   *http.Client
}

// startForwarder listens on bind (port chosen by the system) and forwards the random path to target.
func startForwarder(bind net.IP, target string) (*forwarder, string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return nil, "", err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bind.String(), "0"))
	if err != nil {
		return nil, "", err
	}
	f := &forwarder{
		token:    hex.EncodeToString(random),
		target:   target,
		listener: listener,
		// no overall timeout: the TV reads one response for the whole episode
		client: &http.Client{Transport: &http.Transport{Proxy: nil, ResponseHeaderTimeout: 60 * time.Second}},
	}
	f.server = &http.Server{Handler: f, ReadHeaderTimeout: 30 * time.Second}
	go func() { _ = f.server.Serve(listener) }()
	port := listener.Addr().(*net.TCPAddr).Port
	return f, "http://" + net.JoinHostPort(bind.String(), strconv.Itoa(port)) + "/" + f.token, nil
}

func (f *forwarder) close() {
	if f == nil {
		return
	}
	_ = f.server.Close()
	f.client.CloseIdleConnections()
}

func (f *forwarder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/"+f.token || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, f.target, nil)
	if err != nil {
		http.Error(w, "bad target", http.StatusBadGateway)
		return
	}
	if rng := r.Header.Get("Range"); rng != "" {
		upstream.Header.Set("Range", rng)
	}
	resp, err := f.client.Do(upstream)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	header := w.Header()
	header.Set("Content-Type", castMime)
	for _, name := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := resp.Header.Get(name); value != "" {
			header.Set(name, value)
		}
	}
	header.Set("transferMode.dlna.org", "Streaming")
	header.Set("contentFeatures.dlna.org", DLNAFeatures)
	header.Set("Connection", "close")
	w.WriteHeader(resp.StatusCode)
	if r.Method == http.MethodGet {
		// the TV closes connections when it seeks; that ends the copy
		_, _ = io.Copy(w, resp.Body)
	}
}

// localTarget accepts only stream URLs of the server itself (loopback; port when port > 0).
func localTarget(raw string, port int) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" {
		return nil, errors.New("not a local stream")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return nil, errors.New("not a local stream")
	}
	if port > 0 && u.Port() != strconv.Itoa(port) {
		return nil, errors.New("not a local stream")
	}
	return u, nil
}

// addressTowards is the phone's own address on the network it reaches host through (the Wi-Fi for a TV). A UDP
// "connect" picks the route without sending anything; this works on Android 11+, where listing interfaces
// (net.Interfaces) is refused to apps.
func addressTowards(ctx context.Context, host string) (net.IP, error) {
	conn, err := (&net.Dialer{}).DialContext(ctx, "udp4", net.JoinHostPort(host, "1900"))
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	ip := conn.LocalAddr().(*net.UDPAddr).IP
	if ip == nil || ip.IsUnspecified() {
		return nil, errors.New("no network address")
	}
	return ip, nil
}
