package mobileoffline

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Provider fixtures: they stand in for online-stream hosts (no real provider in unit tests).

func TestMain(m *testing.M) {
	// the provider fixtures run on 127.0.0.1; only "localhost" stands for the phone itself in these tests
	serverHost = func(host string) bool { return host == "localhost" }
	os.Exit(m.Run())
}

// gatedReader blocks reads past blockAt until release is closed.
type gatedReader struct {
	*bytes.Reader
	blockAt int64
	release <-chan struct{}
	ctx     context.Context
}

func (g *gatedReader) Read(p []byte) (int, error) {
	pos, _ := g.Seek(0, io.SeekCurrent)
	if g.release != nil && pos >= g.blockAt {
		select {
		case <-g.release:
		case <-g.ctx.Done():
			return 0, g.ctx.Err()
		}
	}
	if g.release != nil && pos < g.blockAt && pos+int64(len(p)) > g.blockAt {
		p = p[:g.blockAt-pos]
	}
	return g.Reader.Read(p)
}

type provider struct {
	server  *httptest.Server
	content []byte

	mu       sync.Mutex
	release  chan struct{} // nil: no gate
	blockAt  int64
	ranges   []string
	requests []*http.Request
	status   int // non-zero: answer every request with it
	files    map[string][]byte
}

func newProvider(t *testing.T) *provider {
	p := &provider{content: bytes.Repeat([]byte("0123456789abcdef"), 64*1024), files: map[string][]byte{}}
	p.server = httptest.NewServer(http.HandlerFunc(p.serve))
	t.Cleanup(p.server.Close)
	return p
}

func (p *provider) serve(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	p.ranges = append(p.ranges, r.Header.Get("Range"))
	p.requests = append(p.requests, r.Clone(context.Background()))
	status, release, blockAt := p.status, p.release, p.blockAt
	file, isFile := p.files[r.URL.Path]
	p.mu.Unlock()
	if status != 0 {
		w.WriteHeader(status)
		return
	}
	if isFile {
		http.ServeContent(w, r, "f", time.Time{}, bytes.NewReader(file))
		return
	}
	if r.URL.Path != "/video.mp4" {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, "video.mp4", time.Time{}, &gatedReader{Reader: bytes.NewReader(p.content), blockAt: blockAt, release: release, ctx: r.Context()})
}

func (p *provider) gate(at int64) chan struct{} {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.release, p.blockAt = make(chan struct{}), at
	return p.release
}

func (p *provider) seenRanges() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.ranges...)
}

type resolver struct {
	mu    sync.Mutex
	calls []int
	fn    func(episode int) ([]VideoSource, error)
}

func (r *resolver) resolve(ctx context.Context, provider string, mediaID, episode int, dubbed bool) ([]VideoSource, error) {
	r.mu.Lock()
	r.calls = append(r.calls, episode)
	r.mu.Unlock()
	return r.fn(episode)
}

func (r *resolver) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func newManager(t *testing.T, dir string, res *resolver) *Manager {
	t.Helper()
	m, err := New(Options{Dir: dir, Resolve: res.resolve, Tick: 20 * time.Millisecond,
		FreeSpace: func(string) (uint64, error) { return 10 << 30, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func item(m *Manager, id string) Item {
	for _, it := range m.Snapshot().Items {
		if it.ID == id {
			return it
		}
	}
	return Item{}
}

func statusOf(m *Manager, id string) string { return item(m, id).Status }

func batch(episodes ...float64) BatchRequest {
	req := BatchRequest{MediaID: 21, Provider: "hianime", Quality: "1080p", Server: "hd-1", Title: "Show"}
	for _, n := range episodes {
		req.Episodes = append(req.Episodes, BatchEpisode{Number: n, Title: fmt.Sprintf("Episode %v", n)})
	}
	return req
}

func idOf(episode int) string {
	return IDFor(fmt.Sprintf("21:%d:hianime:false:1080p", episode))
}

func mp4Source(p *provider) func(int) ([]VideoSource, error) {
	return func(int) ([]VideoSource, error) {
		return []VideoSource{{Server: "hd-1", URL: p.server.URL + "/video.mp4", Quality: "1080p", Type: "mp4", Headers: map[string]string{"Referer": "https://provider.example/"}}}, nil
	}
}

func TestQueueResolvesOnlyWhenASlotIsFree(t *testing.T) {
	p := newProvider(t)
	release := p.gate(1000)
	res := &resolver{fn: mp4Source(p)}
	m := newManager(t, t.TempDir(), res)
	added, err := m.Submit(batch(1, 2, 3))
	if err != nil || added != 3 {
		t.Fatalf("added %d, %v", added, err)
	}
	waitFor(t, "two downloads", func() bool {
		return statusOf(m, idOf(1)) == StatusDownloading && statusOf(m, idOf(2)) == StatusDownloading
	})
	time.Sleep(150 * time.Millisecond)
	if res.count() != Slots || statusOf(m, idOf(3)) != StatusQueued {
		t.Fatalf("resolved %d episodes with %d slots; third is %s", res.count(), Slots, statusOf(m, idOf(3)))
	}
	close(release)
	waitFor(t, "all ready", func() bool {
		return statusOf(m, idOf(1)) == StatusReady && statusOf(m, idOf(2)) == StatusReady && statusOf(m, idOf(3)) == StatusReady
	})
	got, _ := os.ReadFile(m.FilePath(idOf(3), "video.mp4"))
	if !bytes.Equal(got, p.content) {
		t.Fatalf("file has %d bytes, want %d", len(got), len(p.content))
	}
	if it := item(m, idOf(1)); !it.Ready || it.Progress != 100 || it.Bytes != int64(len(p.content)) || it.Files.Video != "video.mp4" {
		t.Fatalf("item = %+v", it)
	}
}

func TestSubmitSkipsKnownAndFractionalEpisodes(t *testing.T) {
	p := newProvider(t)
	p.gate(0)
	m := newManager(t, t.TempDir(), &resolver{fn: mp4Source(p)})
	if added, _ := m.Submit(batch(1, 2.5, -1)); added != 1 {
		t.Fatalf("added %d", added)
	}
	if added, _ := m.Submit(batch(1)); added != 0 {
		t.Fatal("the same episode was queued twice")
	}
	// another quality of an episode that is already saved or queued in this language
	req := batch(1)
	req.Quality = "720p"
	if added, _ := m.Submit(req); added != 0 {
		t.Fatal("the episode was queued again in another quality")
	}
	if _, err := m.Submit(BatchRequest{MediaID: 21}); err == nil {
		t.Fatal("an empty batch was accepted")
	}
}

func TestWifiOnlyWaitsOnMeteredNetworkAndStopsRunningDownloads(t *testing.T) {
	p := newProvider(t)
	release := p.gate(300_000)
	res := &resolver{fn: mp4Source(p)}
	m := newManager(t, t.TempDir(), res)
	m.SetWifiOnly(true)
	m.SetNetwork(true, true)
	m.Submit(batch(1))
	time.Sleep(200 * time.Millisecond)
	if res.count() != 0 || m.Snapshot().Waiting != "wifi" {
		t.Fatalf("resolved %d on mobile data, waiting %q", res.count(), m.Snapshot().Waiting)
	}

	m.SetNetwork(true, false)
	waitFor(t, "download on Wi-Fi", func() bool { return item(m, idOf(1)).Bytes >= 300_000 })

	// back on mobile data: stops at once, waits without failing
	m.SetNetwork(true, true)
	waitFor(t, "stop on mobile data", func() bool { return statusOf(m, idOf(1)) == StatusQueued })
	close(release)
	time.Sleep(150 * time.Millisecond)
	if it := item(m, idOf(1)); it.Status != StatusQueued || it.Failure != "" {
		t.Fatalf("item = %+v", it)
	}

	m.SetNetwork(true, false)
	waitFor(t, "ready on Wi-Fi", func() bool { return statusOf(m, idOf(1)) == StatusReady })
	ranges := p.seenRanges()
	if last := ranges[len(ranges)-1]; !strings.HasPrefix(last, "bytes=") || last == "bytes=0-" {
		t.Fatalf("the download did not continue its file: %v", ranges)
	}
	got, _ := os.ReadFile(m.FilePath(idOf(1), "video.mp4"))
	if !bytes.Equal(got, p.content) {
		t.Fatal("continued file differs")
	}
}

func TestWifiOnlyWaitsWhileTheNetworkIsUnknownAndOfflineWaitsForInternet(t *testing.T) {
	p := newProvider(t)
	res := &resolver{fn: mp4Source(p)}
	m := newManager(t, t.TempDir(), res)
	m.SetWifiOnly(true)
	m.Submit(batch(1))
	time.Sleep(100 * time.Millisecond)
	if res.count() != 0 || m.Snapshot().Waiting != "wifi" {
		t.Fatal("Wi-Fi only must wait until the app reported the network")
	}
	m.SetWifiOnly(false)
	m.SetNetwork(false, false)
	time.Sleep(100 * time.Millisecond)
	if res.count() != 0 || m.Snapshot().Waiting != "internet" {
		t.Fatal("offline must wait")
	}
	m.SetNetwork(true, true)
	waitFor(t, "ready on mobile data without Wi-Fi only", func() bool { return statusOf(m, idOf(1)) == StatusReady })
}

func TestQueueSurvivesARestart(t *testing.T) {
	dir := t.TempDir()
	p := newProvider(t)
	release := p.gate(400_000)
	res := &resolver{fn: mp4Source(p)}
	m := newManager(t, dir, res)
	m.Submit(batch(1, 2, 3))
	m.Action(idOf(3), "pause")
	waitFor(t, "partial file", func() bool { return item(m, idOf(1)).Bytes >= 400_000 })
	m.Close()

	if data, err := os.ReadFile(filepath.Join(dir, "queue.json")); err != nil || !strings.Contains(string(data), idOf(1)) {
		t.Fatalf("queue file: %v", err)
	}
	close(release)
	res2 := &resolver{fn: mp4Source(p)}
	m2 := newManager(t, dir, res2)
	waitFor(t, "ready after restart", func() bool {
		return statusOf(m2, idOf(1)) == StatusReady && statusOf(m2, idOf(2)) == StatusReady
	})
	if statusOf(m2, idOf(3)) != StatusPaused {
		t.Fatal("a paused episode started after the restart")
	}
	// links expire: the restarted queue resolved again, then continued the partial file
	if res2.count() != 2 {
		t.Fatalf("resolved %d after restart", res2.count())
	}
	resumed := false
	for _, r := range p.seenRanges() {
		resumed = resumed || r == "bytes=400000-"
	}
	if !resumed {
		t.Fatalf("no range request after the restart: %v", p.seenRanges())
	}
	got, _ := os.ReadFile(m2.FilePath(idOf(1), "video.mp4"))
	if !bytes.Equal(got, p.content) {
		t.Fatal("restarted file differs")
	}
}

func TestPauseResumeRemove(t *testing.T) {
	p := newProvider(t)
	release := p.gate(200_000)
	m := newManager(t, t.TempDir(), &resolver{fn: mp4Source(p)})
	m.Submit(batch(1))
	waitFor(t, "downloading", func() bool { return item(m, idOf(1)).Bytes >= 200_000 })
	if ok, _ := m.Action(idOf(1), "pause"); !ok {
		t.Fatal("pause refused")
	}
	time.Sleep(100 * time.Millisecond)
	if it := item(m, idOf(1)); it.Status != StatusPaused || it.Failure != "" {
		t.Fatalf("paused item = %+v", it)
	}
	close(release)
	m.Action(idOf(1), "resume")
	waitFor(t, "ready", func() bool { return statusOf(m, idOf(1)) == StatusReady })
	dir := filepath.Dir(m.FilePath(idOf(1), "video.mp4"))
	m.Action(idOf(1), "remove")
	if _, err := os.Stat(dir); !os.IsNotExist(err) || len(m.Snapshot().Items) != 0 {
		t.Fatal("remove left files or the item")
	}
	if ok, _ := m.Action(idOf(1), "pause"); ok {
		t.Fatal("action on a removed item")
	}
	if _, err := m.Action(idOf(1), "explode"); err != nil {
		t.Fatal("unknown action on a missing item should just be false")
	}
}

func TestFailuresAreNamedAndRetried(t *testing.T) {
	p := newProvider(t)
	p.status = http.StatusForbidden
	res := &resolver{fn: func(episode int) ([]VideoSource, error) {
		if episode == 2 {
			return nil, errors.New("provider down")
		}
		return mp4Source(p)(episode)
	}}
	m := newManager(t, t.TempDir(), res)
	m.Submit(batch(1, 2))
	waitFor(t, "failures", func() bool {
		return statusOf(m, idOf(1)) == StatusFailed && statusOf(m, idOf(2)) == StatusFailed
	})
	if f := item(m, idOf(1)).Failure; f != FailureSourceRefused {
		t.Fatalf("refused source = %s", f)
	}
	if it := item(m, idOf(2)); it.Failure != FailureUnavailable || it.Error == "" {
		t.Fatalf("unresolvable = %+v", it)
	}
	p.mu.Lock()
	p.status = 0
	p.mu.Unlock()
	m.Action(idOf(1), "retry")
	waitFor(t, "ready after retry", func() bool { return statusOf(m, idOf(1)) == StatusReady })
}

func TestNoDownloadWithLessThan256MBFree(t *testing.T) {
	p := newProvider(t)
	m, err := New(Options{Dir: t.TempDir(), Resolve: (&resolver{fn: mp4Source(p)}).resolve, Tick: 20 * time.Millisecond,
		FreeSpace: func(string) (uint64, error) { return 100 << 20, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	m.Submit(batch(1))
	waitFor(t, "failure", func() bool { return item(m, idOf(1)).Failure == FailureStorageFull })
	for _, r := range p.seenRanges() {
		_ = r
		t.Fatal("downloaded without space")
	}
}

func TestProviderGetsItsHeadersButNeverTheAppToken(t *testing.T) {
	p := newProvider(t)
	m := newManager(t, t.TempDir(), &resolver{fn: mp4Source(p)})
	m.Submit(batch(1))
	waitFor(t, "ready", func() bool { return statusOf(m, idOf(1)) == StatusReady })
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, r := range p.requests {
		if r.Header.Get("Referer") != "https://provider.example/" {
			t.Fatalf("provider header missing: %v", r.Header)
		}
		for _, name := range []string{"X-Seanime-Token", "Authorization", "Cookie", "X-Seanime-Client-Id"} {
			if r.Header.Get(name) != "" {
				t.Fatalf("%s sent to a provider", name)
			}
		}
	}
}

func TestLocalURLsAreUnwrappedOrRefused(t *testing.T) {
	serverHost = isLoopback
	defer func() { serverHost = func(host string) bool { return host == "localhost" } }()
	raw, headers, err := providerURL(`http://127.0.0.1:43212/api/v1/proxy?url=https%3A%2F%2Fcdn.example%2Fa.m3u8&headers=%7B%22Referer%22%3A%22https%3A%2F%2Fp.example%2F%22%7D`, nil)
	if err != nil || raw != "https://cdn.example/a.m3u8" || headers["Referer"] != "https://p.example/" {
		t.Fatalf("unwrap = %s %v %v", raw, headers, err)
	}
	for _, bad := range []string{
		"http://127.0.0.1:43212/api/v1/settings",
		"http://localhost:43212/api/v1/proxy?url=http%3A%2F%2F127.0.0.1%3A43212%2Fapi%2Fv1%2Fstatus",
		"file:///etc/passwd",
		"ftp://cdn.example/a.mp4",
	} {
		if _, _, err := providerURL(bad, nil); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	if raw, _, err := providerURL("https://cdn.example/v.mp4", nil); err != nil || raw != "https://cdn.example/v.mp4" {
		t.Fatal("foreign URL refused")
	}
}

func TestPickSourcePrefersServerThenQuality(t *testing.T) {
	sources := []VideoSource{
		{Server: "hd-2", URL: "https://a.example/auto.m3u8", Quality: "auto"},
		{Server: "hd-1", URL: "https://a.example/720.mp4", Quality: "720p"},
		{Server: "hd-1", URL: "https://a.example/1080.mp4", Quality: "1080p"},
		{Server: "hd-1", URL: "not a url", Quality: "1080p"},
	}
	got, err := pickSource(sources, "HD-1", "1080p")
	if err != nil || got.URL != "https://a.example/1080.mp4" || got.Type != "mp4" {
		t.Fatalf("picked %+v %v", got, err)
	}
	got, _ = pickSource(sources, "other", "x")
	if got.URL != "https://a.example/auto.m3u8" || got.Type != "m3u8" {
		t.Fatalf("picked %+v", got)
	}
	if _, err := pickSource(sources[3:], "hd-1", "1080p"); !errors.Is(err, errUnavailable) {
		t.Fatal("invalid sources accepted")
	}
}

func encrypt(t *testing.T, plain, key, iv []byte) []byte {
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	data := append(append([]byte(nil), plain...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	out := make([]byte, len(data))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, data)
	return out
}

func TestHLSPicksTheVariantDecryptsAndJoinsSegments(t *testing.T) {
	p := newProvider(t)
	key := []byte("0123456789abcdef")
	ivHex := "000102030405060708090a0b0c0d0e0f"
	iv, _ := hex.DecodeString(ivHex)
	segments := [][]byte{[]byte("segment-one|"), []byte("segment-two-longer|"), []byte("three")}
	p.files["/master.m3u8"] = []byte("#EXTM3U\n" +
		"#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"en\",NAME=\"English\",URI=\"audio/en.m3u8\"\n" +
		"#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"ja\",NAME=\"Japanese\",DEFAULT=YES,URI=\"audio/ja.m3u8\"\n" +
		"#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO=\"aud\"\n1080/index.m3u8\n" +
		"#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO=\"aud\"\n720/index.m3u8\n")
	media := "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI=\"/key.bin\",IV=0x" + ivHex + "\n"
	for i, s := range segments {
		media += "#EXTINF:4.0,\nseg" + fmt.Sprint(i) + ".ts\n"
		p.files[fmt.Sprintf("/720/seg%d.ts", i)] = encrypt(t, s, key, iv)
	}
	p.files["/720/index.m3u8"] = []byte(media + "#EXT-X-ENDLIST\n")
	p.files["/1080/index.m3u8"] = []byte("#EXTM3U\n#EXTINF:4,\nnever.ts\n")
	p.files["/key.bin"] = key
	// audio without encryption, IV from the sequence number is not needed
	p.files["/audio/ja.m3u8"] = []byte("#EXTM3U\n#EXTINF:4,\na0.aac\n#EXTINF:4,\na1.aac\n#EXT-X-ENDLIST\n")
	p.files["/audio/a0.aac"] = []byte("ja-audio-0|")
	p.files["/audio/a1.aac"] = []byte("ja-audio-1")
	p.files["/subs/de.vtt"] = []byte("WEBVTT\n")

	res := &resolver{fn: func(int) ([]VideoSource, error) {
		return []VideoSource{{Server: "hd-1", URL: p.server.URL + "/master.m3u8", Quality: "auto", Type: "m3u8",
			Subtitles: []SourceSubtitle{{URL: p.server.URL + "/subs/de.vtt", Language: "Deutsch", IsDefault: true}, {URL: p.server.URL + "/subs/missing.vtt", Language: "English"}}}}, nil
	}}
	m := newManager(t, t.TempDir(), res)
	req := batch(1)
	req.Quality = "720p"
	m.Submit(req)
	id := IDFor("21:1:hianime:false:720p")
	waitFor(t, "HLS ready", func() bool { return statusOf(m, id) == StatusReady })
	it := item(m, id)
	video, _ := os.ReadFile(m.FilePath(id, it.Files.Video))
	if string(video) != "segment-one|segment-two-longer|three" || it.Files.Video != "video.ts" {
		t.Fatalf("video %q (%s)", video, it.Files.Video)
	}
	audio, _ := os.ReadFile(m.FilePath(id, it.Files.Audio))
	if string(audio) != "ja-audio-0|ja-audio-1" {
		t.Fatalf("audio %q", audio)
	}
	if len(it.Files.Subtitles) != 1 || it.Files.Subtitles[0].Language != "de" || !it.Files.Subtitles[0].Default || it.Files.Subtitles[0].Mime != "text/vtt" {
		t.Fatalf("subtitles = %+v", it.Files.Subtitles)
	}
	if m.FilePath(id, "../queue.json") != "" || m.FilePath(id, "sub-1.vtt") != "" {
		t.Fatal("unknown file names must not be served")
	}
}

func TestHLSWithoutIVUsesTheSequenceNumberAndKeepsFMP4(t *testing.T) {
	key := []byte("fedcba9876543210")
	ivFor := func(seq byte) []byte { iv := make([]byte, 16); iv[15] = seq; return iv }
	p := newProvider(t)
	p.files["/v.m3u8"] = []byte("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:3\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:2,\nf0.m4s\n#EXTINF:2,\nf1.m4s\n")
	p.files["/init.mp4"] = []byte("INIT|")
	p.files["/k"] = key
	p.files["/f0.m4s"] = encrypt(t, []byte("frag3|"), key, ivFor(3))
	p.files["/f1.m4s"] = encrypt(t, []byte("frag4"), key, ivFor(4))
	m := newManager(t, t.TempDir(), &resolver{})
	it, err := m.Download(DownloadRequest{Key: "direct-1", URL: p.server.URL + "/v.m3u8", Type: "m3u8", MediaID: 5, Episode: "1"})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "ready", func() bool { return statusOf(m, it.ID) == StatusReady })
	got := item(m, it.ID)
	data, _ := os.ReadFile(m.FilePath(it.ID, got.Files.Video))
	if got.Files.Video != "video.mp4" || string(data) != "INIT|frag3|frag4" {
		t.Fatalf("%s: %q", got.Files.Video, data)
	}
	if _, err := m.Download(DownloadRequest{Key: "direct-1", URL: p.server.URL + "/v.m3u8"}); err == nil {
		t.Fatal("a saved episode was downloaded again")
	}
	if _, err := m.Download(DownloadRequest{Key: "x", URL: "http://localhost:43212/api/v1/status"}); err == nil {
		t.Fatal("a local URL was accepted")
	}
}

func TestSampleAESIsNotDownloadable(t *testing.T) {
	_, err := parseMedia(nil, "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"k\"\n#EXTINF:2,\na.ts\n")
	if !errors.Is(err, errUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestPickVariant(t *testing.T) {
	vs := []variant{{uri: "a", height: 360, bandwidth: 1}, {uri: "b", height: 1080, bandwidth: 5}, {uri: "c", height: 720, bandwidth: 3}, {uri: "d", height: 720, bandwidth: 4}}
	if v := pickVariant(vs, 1080); v.uri != "b" {
		t.Fatal(v.uri)
	}
	if v := pickVariant(vs, 720); v.uri != "d" {
		t.Fatal(v.uri)
	}
	if v := pickVariant(vs, 240); v.uri != "a" {
		t.Fatal(v.uri)
	}
	if height("Auto") != 1080 || height("480p") != 480 {
		t.Fatal("height")
	}
}

func TestArtworkAndDetailsAreSavedForOfflineUse(t *testing.T) {
	p := newProvider(t)
	var img bytes.Buffer
	pic := image.NewRGBA(image.Rect(0, 0, 4, 4))
	pic.Set(1, 1, color.White)
	png.Encode(&img, pic)
	p.files["/cover.png"] = img.Bytes()
	p.files["/broken.jpg"] = []byte("not an image")
	var mediaCalls atomic.Int32
	m, err := New(Options{Dir: t.TempDir(), Resolve: (&resolver{fn: mp4Source(p)}).resolve, Tick: 20 * time.Millisecond,
		FreeSpace: func(string) (uint64, error) { return 10 << 30, nil },
		Media: func(ctx context.Context, mediaID int) (*MediaDetails, error) {
			mediaCalls.Add(1)
			return &MediaDetails{Description: "A show", Genres: []string{"Action"}, Year: 2024, CoverURL: p.server.URL + "/cover.png", BannerURL: p.server.URL + "/broken.jpg"}, nil
		}})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	m.Submit(batch(1))
	waitFor(t, "details", func() bool { return item(m, idOf(1)).CoverAsset != "" })
	it := item(m, idOf(1))
	if !it.MetadataSaved || it.Description != "A show" || it.BannerAsset != "" || !strings.HasSuffix(it.CoverAsset, ".png") {
		t.Fatalf("details = %+v", it.Details)
	}
	if data, _ := os.ReadFile(m.ArtworkPath(it.CoverAsset)); !bytes.Equal(data, img.Bytes()) {
		t.Fatal("artwork file differs")
	}
	if m.ArtworkPath("../queue.json") != "" {
		t.Fatal("artwork path escapes")
	}

	manga, err := m.CacheManga(context.Background(), MangaRequest{MediaID: 9, Details: Details{Title: "Manga", CoverURL: p.server.URL + "/cover.png"}})
	if err != nil || manga.CoverAsset != it.CoverAsset || mediaCalls.Load() != 1 {
		t.Fatalf("manga = %+v, %v, anime details fetched %d times", manga, err, mediaCalls.Load())
	}

	m.Action(idOf(1), "remove")
	if m.ArtworkPath(it.CoverAsset) == "" {
		t.Fatal("artwork still used by the manga was deleted")
	}
}

func TestPositionAndChangedEvents(t *testing.T) {
	var events atomic.Int32
	m, err := New(Options{Dir: t.TempDir(), Changed: func(Snapshot) { events.Add(1) }, FreeSpace: func(string) (uint64, error) { return 10 << 30, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	m.SetNetwork(false, false)
	m.Submit(batch(1))
	if !m.SetPosition(idOf(1), 61_000) || item(m, idOf(1)).PositionMs != 61_000 {
		t.Fatal("position not stored")
	}
	if m.SetPosition(strings.Repeat("0", 32), 1) {
		t.Fatal("position for a missing item")
	}
	waitFor(t, "a changed event", func() bool { return events.Load() > 0 })
	if !ValidID(idOf(1)) || ValidID("../x") {
		t.Fatal("ValidID")
	}
}
