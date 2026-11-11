// Package mobileoffline keeps episodes on the phone: a persistent download queue that resolves a source only when a
// download slot is free, the offline index with its artwork, and the "Wi-Fi only" rule.
//
// Ported from the old app's offline/EpisodeBatchQueue.kt, EpisodeDownloads.kt, OfflineLibrary.kt, OfflineBridge.kt and
// OfflinePolicy.kt. The server runs in the app's foreground service, so downloads go on without the app's screens;
// the queue is a file in the data folder and survives restarts.
package mobileoffline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// Slots is how many episodes download at once (Media3's maxParallelDownloads of the old app).
	Slots = 2
	// minFree: below 256 MB free no download starts.
	minFree        = 256 << 20
	maxSubtitles   = 20
	captureBackoff = time.Minute
)

// Statuses of an item.
const (
	StatusQueued      = "queued"
	StatusResolving   = "resolving"
	StatusDownloading = "downloading"
	StatusPaused      = "paused"
	StatusFailed      = "failed"
	StatusReady       = "ready"
)

var errNoSpace = errors.New("less than 256 MB free")

// SourceSubtitle is a subtitle offered by a source.
type SourceSubtitle struct {
	URL       string `json:"url"`
	Language  string `json:"language"`
	IsDefault bool   `json:"isDefault"`
}

// VideoSource is one stream of an episode as a provider offers it.
type VideoSource struct {
	Server    string            `json:"server"`
	URL       string            `json:"url"`
	Quality   string            `json:"quality"`
	Type      string            `json:"type"`
	Headers   map[string]string `json:"headers,omitempty"`
	Subtitles []SourceSubtitle  `json:"subtitles,omitempty"`
}

// ResolveFunc asks the online-stream provider for the sources of an episode.
type ResolveFunc func(ctx context.Context, provider string, mediaID, episode int, dubbed bool) ([]VideoSource, error)

// MediaDetails is what the offline view shows about an anime.
type MediaDetails struct {
	Description   string   `json:"description"`
	Genres        []string `json:"genres"`
	Year          int      `json:"year"`
	Format        string   `json:"format"`
	TotalEpisodes int      `json:"totalEpisodes"`
	Duration      int      `json:"duration"`
	Score         int      `json:"score"`
	CoverURL      string   `json:"coverUrl"`
	BannerURL     string   `json:"bannerUrl"`
}

// MediaFunc fetches the details of an anime.
type MediaFunc func(ctx context.Context, mediaID int) (*MediaDetails, error)

// Details are the descriptions kept for offline use, with artwork saved in the data folder (the *Asset names).
type Details struct {
	Title              string   `json:"title,omitempty"`
	Description        string   `json:"description,omitempty"`
	Genres             []string `json:"genres,omitempty"`
	Year               int      `json:"year,omitempty"`
	Format             string   `json:"format,omitempty"`
	TotalEpisodes      int      `json:"totalEpisodes,omitempty"`
	Duration           int      `json:"duration,omitempty"`
	Score              int      `json:"score,omitempty"`
	CoverURL           string   `json:"coverUrl,omitempty"`
	BannerURL          string   `json:"bannerUrl,omitempty"`
	EpisodeTitle       string   `json:"episodeTitle,omitempty"`
	EpisodeImageURL    string   `json:"episodeImageUrl,omitempty"`
	EpisodeDescription string   `json:"episodeDescription,omitempty"`
	AirDate            string   `json:"airDate,omitempty"`
	CoverAsset         string   `json:"coverAsset,omitempty"`
	BannerAsset        string   `json:"bannerAsset,omitempty"`
	EpisodeImageAsset  string   `json:"episodeImageAsset,omitempty"`
	MetadataSaved      bool     `json:"metadataSaved"`
}

// SavedSubtitle is a subtitle file of a download.
type SavedSubtitle struct {
	File     string `json:"file"`
	Language string `json:"language"`
	Label    string `json:"label"`
	Default  bool   `json:"default"`
	Mime     string `json:"mime"`
}

// Files are the saved files of a ready episode, served under /api/v1/mobile-offline/file/{id}/{file}.
type Files struct {
	Video     string          `json:"video,omitempty"`
	Audio     string          `json:"audio,omitempty"`
	Subtitles []SavedSubtitle `json:"subtitles,omitempty"`
}

// Item is one episode of the queue or the offline library.
type Item struct {
	Details
	ID            string  `json:"id"`
	Key           string  `json:"key"`
	Status        string  `json:"status"`
	Ready         bool    `json:"ready"`
	MediaID       int     `json:"mediaId"`
	Provider      string  `json:"provider"`
	Episode       string  `json:"episode"`
	Dubbed        bool    `json:"dubbed"`
	Quality       string  `json:"quality"`
	Server        string  `json:"server"`
	AudioLanguage string  `json:"audioLanguage"`
	Progress      int     `json:"progress"`
	Bytes         int64   `json:"bytes"`
	PositionMs    int64   `json:"position"`
	Failure       Failure `json:"failure,omitempty"`
	Error         string  `json:"error,omitempty"`
	Files         Files   `json:"files"`
	Order         int64   `json:"order"`
}

// chosen is the stream picked for a download (resolved by the queue or given with a single download).
type chosen struct {
	URL       string            `json:"url"`
	Type      string            `json:"type"`
	Headers   map[string]string `json:"headers,omitempty"`
	Subtitles []SourceSubtitle  `json:"subtitles,omitempty"`
}

// record is an item with what the server needs to continue it; only Item goes to the app.
type record struct {
	Item
	Source     *chosen  `json:"source,omitempty"`
	VideoTotal int64    `json:"videoTotal,omitempty"` // mp4: file size; HLS: segment count
	Video      hlsState `json:"video"`
	AudioTotal int64    `json:"audioTotal,omitempty"`
	Audio      hlsState `json:"audioState"`
}

// Network is what the app reports about the connection (NetInfo); Known is false until it did.
type Network struct {
	Known     bool `json:"known"`
	Connected bool `json:"connected"`
	Metered   bool `json:"metered"`
}

// Snapshot is the whole offline state for the app.
type Snapshot struct {
	Items    []Item  `json:"items"`
	WifiOnly bool    `json:"wifiOnly"`
	Network  Network `json:"network"`
	// Waiting is "wifi" or "internet" while queued episodes wait for the network, else "".
	Waiting string `json:"waiting"`
}

type persisted struct {
	Version  int                 `json:"version"`
	WifiOnly bool                `json:"wifiOnly"`
	Items    map[string]*record  `json:"items"`
	Manga    map[string]*Details `json:"manga"`
}

// Options configure a Manager.
type Options struct {
	// Dir is the folder of the queue, the files and the artwork (<data dir>/mobile-offline).
	Dir     string
	Resolve ResolveFunc
	Media   MediaFunc
	// Changed gets every new state, at most every 500 ms (WebSocket event).
	Changed func(Snapshot)
	// Client downloads from providers; nil: a client without the app's credentials.
	Client *http.Client
	// FreeSpace overrides the free-space check (tests).
	FreeSpace func(dir string) (uint64, error)
	// Tick is how often the queue looks for work without being woken (default 1.5 s).
	Tick time.Duration
	// LegacyDir is the files folder of Seanime Mobile 2.0.33 (Android filesDir, the same folder as the server's data
	// folder after the update); its downloads are taken over once in the background (legacy.go). "": off.
	LegacyDir string
}

// Manager is the download queue and offline library.
type Manager struct {
	opts   Options
	client *http.Client

	mu        sync.Mutex
	state     persisted
	network   Network
	running   map[string]context.CancelFunc
	attempts  map[string]time.Time
	lastSave  time.Time
	emitTimer *time.Timer
	wake      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
}

// New loads the queue from opts.Dir and starts it. Episodes that were resolving or downloading when the server stopped
// go back to the queue and continue where their files end.
func New(opts Options) (*Manager, error) {
	if opts.Tick == 0 {
		opts.Tick = 1500 * time.Millisecond
	}
	if opts.FreeSpace == nil {
		opts.FreeSpace = freeSpace
	}
	client := opts.Client
	if client == nil {
		client = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 30 * time.Second}}
	}
	for _, sub := range []string{"episodes", "artwork"} {
		if err := os.MkdirAll(filepath.Join(opts.Dir, sub), 0o755); err != nil {
			return nil, err
		}
	}
	m := &Manager{opts: opts, client: client, running: map[string]context.CancelFunc{}, attempts: map[string]time.Time{},
		wake: make(chan struct{}, 1), done: make(chan struct{})}
	m.state = persisted{Version: 1, Items: map[string]*record{}, Manga: map[string]*Details{}}
	if data, err := os.ReadFile(m.statePath()); err == nil {
		if err := json.Unmarshal(data, &m.state); err != nil {
			return nil, fmt.Errorf("mobileoffline: queue file unreadable: %w", err)
		}
		if m.state.Items == nil {
			m.state.Items = map[string]*record{}
		}
		if m.state.Manga == nil {
			m.state.Manga = map[string]*Details{}
		}
	}
	for _, r := range m.state.Items {
		if r.Status == StatusResolving || r.Status == StatusDownloading {
			r.Status = StatusQueued
		}
	}
	m.saveLocked(true)
	m.wg.Add(1)
	go m.loop()
	if opts.LegacyDir != "" {
		m.wg.Add(1)
		go m.importLegacy()
	}
	for id, r := range m.state.Items {
		if !m.detailsComplete(&r.Details) {
			m.capture(id)
		}
	}
	return m, nil
}

// Close stops the queue; running downloads keep their place for the next start.
func (m *Manager) Close() {
	m.closeOnce.Do(func() {
		close(m.done)
		m.mu.Lock()
		for _, cancel := range m.running {
			cancel()
		}
		m.mu.Unlock()
		m.wg.Wait()
		m.mu.Lock()
		for _, r := range m.state.Items {
			if r.Status == StatusResolving || r.Status == StatusDownloading {
				r.Status = StatusQueued
			}
		}
		m.saveLocked(true)
		if m.emitTimer != nil {
			m.emitTimer.Stop()
		}
		m.mu.Unlock()
	})
}

func (m *Manager) statePath() string { return filepath.Join(m.opts.Dir, "queue.json") }

// saveLocked writes the queue file (atomically); progress-only saves at most every 2 s.
func (m *Manager) saveLocked(force bool) {
	if !force && time.Since(m.lastSave) < 2*time.Second {
		return
	}
	m.lastSave = time.Now()
	data, err := json.Marshal(m.state)
	if err != nil {
		return
	}
	tmp := m.statePath() + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, m.statePath())
	}
}

func (m *Manager) changedLocked() {
	if m.opts.Changed == nil || m.emitTimer != nil {
		return
	}
	m.emitTimer = time.AfterFunc(500*time.Millisecond, func() {
		m.mu.Lock()
		m.emitTimer = nil
		snapshot := m.snapshotLocked()
		m.mu.Unlock()
		m.opts.Changed(snapshot)
	})
}

func (m *Manager) poke() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

// IDFor is the id of a job key: the first 32 hex digits of its SHA-256, as in the old app.
func IDFor(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])[:32]
}

var idPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

// ValidID reports whether id has the form of an item id.
func ValidID(id string) bool { return idPattern.MatchString(id) }

// --- network ---

// SetNetwork stores the connection the app reports. Running downloads stop at once on a metered connection while
// "Wi-Fi only" is on, and continue on Wi-Fi.
func (m *Manager) SetNetwork(connected, metered bool) {
	m.mu.Lock()
	m.network = Network{Known: true, Connected: connected, Metered: metered}
	m.changedLocked()
	m.mu.Unlock()
	m.poke()
}

// SetWifiOnly turns "Wi-Fi only" on or off (off by default: any connection, as in the old app).
func (m *Manager) SetWifiOnly(enabled bool) {
	m.mu.Lock()
	m.state.WifiOnly = enabled
	m.saveLocked(true)
	m.changedLocked()
	m.mu.Unlock()
	m.poke()
}

// waitingLocked says what the queue waits for: "internet" when the app reported no connection, "wifi" while "Wi-Fi
// only" is on and the connection is metered or not reported yet (after a restart before the app said anything).
func (m *Manager) waitingLocked() string {
	if m.network.Known && !m.network.Connected {
		return "internet"
	}
	if m.state.WifiOnly && (!m.network.Known || m.network.Metered) {
		return "wifi"
	}
	return ""
}

// --- queue ---

func (m *Manager) loop() {
	defer m.wg.Done()
	ticker := time.NewTicker(m.opts.Tick)
	defer ticker.Stop()
	for {
		m.schedule()
		select {
		case <-m.done:
			return
		case <-m.wake:
		case <-ticker.C:
		}
	}
}

// schedule starts queued episodes while slots are free and the network allows it, and stops running ones when it no
// longer does (resolved source links expire, so nothing is resolved ahead).
func (m *Manager) schedule() {
	m.mu.Lock()
	defer m.mu.Unlock()
	select {
	case <-m.done:
		return
	default:
	}
	if m.waitingLocked() != "" {
		for id, cancel := range m.running {
			if r := m.state.Items[id]; r != nil {
				r.Status = StatusQueued
			}
			cancel()
			delete(m.running, id)
		}
		m.changedLocked()
		return
	}
	for len(m.running) < Slots {
		next := m.nextQueuedLocked()
		if next == nil {
			return
		}
		next.Status = StatusResolving
		next.Error, next.Failure = "", ""
		ctx, cancel := context.WithCancel(context.Background())
		m.running[next.ID] = cancel
		m.saveLocked(true)
		m.changedLocked()
		m.wg.Add(1)
		go m.run(ctx, next.ID)
	}
}

func (m *Manager) nextQueuedLocked() *record {
	var next *record
	for _, r := range m.state.Items {
		if r.Status == StatusQueued && (next == nil || r.Order < next.Order) {
			next = r
		}
	}
	return next
}

// update changes the record while it is still the run of ctx; false when it was paused, removed or stopped meanwhile.
func (m *Manager) update(ctx context.Context, id string, change func(r *record), force bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.state.Items[id]
	if r == nil || ctx.Err() != nil {
		return false
	}
	change(r)
	m.saveLocked(force)
	m.changedLocked()
	return true
}

func (m *Manager) run(ctx context.Context, id string) {
	defer m.wg.Done()
	defer func() {
		m.mu.Lock()
		if ctx.Err() == nil {
			delete(m.running, id)
		}
		m.mu.Unlock()
		m.poke()
	}()
	err := m.download(ctx, id)
	if ctx.Err() != nil {
		// paused, removed, or stopped for the network: whoever stopped it set the status
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.running, id)
	r := m.state.Items[id]
	if r == nil {
		return
	}
	if err != nil {
		r.Status = StatusFailed
		r.Failure = classify(err)
		r.Error = FailureText(r.Failure)
	} else {
		r.Status, r.Ready, r.Progress = StatusReady, true, 100
	}
	m.saveLocked(true)
	m.changedLocked()
}

func (m *Manager) download(ctx context.Context, id string) error {
	m.mu.Lock()
	r := m.state.Items[id]
	if r == nil {
		m.mu.Unlock()
		return nil
	}
	job := *r
	m.mu.Unlock()

	source := job.Source
	if job.Provider != "" {
		// queued jobs resolve now that a slot is free; also after a restart, because links expire
		resolved, err := m.resolve(ctx, &job.Item)
		if err != nil {
			return err
		}
		source = resolved
	}
	if source == nil {
		return errUnavailable
	}
	if free, err := m.opts.FreeSpace(m.opts.Dir); err == nil && free < minFree {
		return errNoSpace
	}
	if !m.update(ctx, id, func(r *record) { r.Source = source; r.Status = StatusDownloading }, true) {
		return nil
	}
	dir := filepath.Join(m.opts.Dir, "episodes", id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	rawURL, headers, err := providerURL(source.URL, source.Headers)
	if err != nil {
		return errUnavailable
	}
	f := &fetcher{client: m.client, headers: headers}
	files := Files{}
	if source.Type == "m3u8" {
		video, audio, err := m.downloadHLS(ctx, id, f, rawURL, dir, job.AudioLanguage, height(job.Quality))
		if err != nil {
			return err
		}
		files.Video, files.Audio = video, audio
	} else {
		files.Video = "video.mp4"
		_, err := f.downloadFile(ctx, rawURL, filepath.Join(dir, files.Video), job.VideoTotal,
			func(total int64) { m.update(ctx, id, func(r *record) { r.VideoTotal = total }, true) },
			func(bytes int64, fraction float64) {
				m.update(ctx, id, func(r *record) { r.Bytes = bytes; r.Progress = percent(fraction) }, false)
			})
		if err != nil {
			return err
		}
	}
	files.Subtitles = m.downloadSubtitles(ctx, f, source.Subtitles, dir)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	size := dirSize(dir)
	m.update(ctx, id, func(r *record) { r.Files = files; r.Bytes = size }, true)
	m.capture(id)
	return nil
}

func percent(fraction float64) int {
	return int(math.Max(0, math.Min(99, math.Floor(fraction*100))))
}

var qualityHeight = regexp.MustCompile(`(?i)(\d{3,4})p`)

// height is the highest video height the quality allows (1080 for "Auto").
func height(quality string) int {
	if m := qualityHeight.FindStringSubmatch(quality); m != nil {
		h, _ := strconv.Atoi(m[1])
		return h
	}
	return 1080
}

func (m *Manager) downloadHLS(ctx context.Context, id string, f *fetcher, rawURL, dir, audioLanguage string, maxHeight int) (string, string, error) {
	base, _ := url.Parse(rawURL)
	text, err := f.bytes(ctx, rawURL, 8<<20)
	if err != nil {
		return "", "", err
	}
	mediaURL, audioURL := rawURL, ""
	if variants, renditions := parseMaster(base, string(text)); len(variants) > 0 {
		v := pickVariant(variants, maxHeight)
		mediaURL = v.uri
		if v.audio != "" {
			if r := pickAudio(renditions, v.audio, audioLanguage); r != nil {
				audioURL = r.uri
			}
		}
		if text, err = f.bytes(ctx, mediaURL, 8<<20); err != nil {
			return "", "", err
		}
	}
	mediaBase, _ := url.Parse(mediaURL)
	video, err := parseMedia(mediaBase, string(text))
	if err != nil {
		return "", "", err
	}
	var audio *mediaPlaylist
	if audioURL != "" {
		audioText, err := f.bytes(ctx, audioURL, 8<<20)
		if err != nil {
			return "", "", err
		}
		audioBase, _ := url.Parse(audioURL)
		if audio, err = parseMedia(audioBase, string(audioText)); err != nil {
			return "", "", err
		}
	}
	total := len(video.segments)
	if audio != nil {
		total += len(audio.segments)
	}
	m.mu.Lock()
	r := m.state.Items[id]
	if r == nil {
		m.mu.Unlock()
		return "", "", context.Canceled
	}
	// a re-resolved playlist of another length is another encode: start over
	if r.VideoTotal != int64(len(video.segments)) {
		r.Video, r.VideoTotal = hlsState{}, int64(len(video.segments))
	}
	audioCount := int64(0)
	if audio != nil {
		audioCount = int64(len(audio.segments))
	}
	if r.AudioTotal != audioCount {
		r.Audio, r.AudioTotal = hlsState{}, audioCount
	}
	videoState, audioState := r.Video, r.Audio
	m.mu.Unlock()

	videoFile := "video.ts"
	if video.init != nil {
		videoFile = "video.mp4"
	}
	report := func(offset int) func(done, _ int, bytes int64) {
		return func(done, _ int, bytes int64) {
			m.update(ctx, id, func(r *record) {
				r.Progress = percent(float64(offset+done) / float64(total))
				r.Bytes = r.Video.Bytes + r.Audio.Bytes
			}, false)
		}
	}
	err = f.downloadPlaylist(ctx, video, filepath.Join(dir, videoFile), &videoState,
		func() { m.update(ctx, id, func(r *record) { r.Video = videoState }, false) }, report(0))
	if err != nil {
		return "", "", err
	}
	m.update(ctx, id, func(r *record) { r.Video = videoState }, true)
	audioFile := ""
	if audio != nil {
		audioFile = "audio.ts"
		if audio.init != nil {
			audioFile = "audio.mp4"
		}
		err = f.downloadPlaylist(ctx, audio, filepath.Join(dir, audioFile), &audioState,
			func() { m.update(ctx, id, func(r *record) { r.Audio = audioState }, false) }, report(len(video.segments)))
		if err != nil {
			return "", "", err
		}
		m.update(ctx, id, func(r *record) { r.Audio = audioState }, true)
	}
	return videoFile, audioFile, nil
}

// downloadSubtitles saves up to 20 subtitles. A single unusable subtitle must not fail the episode, and only the saved
// ones are listed, otherwise the player would wait for files that never exist.
func (m *Manager) downloadSubtitles(ctx context.Context, f *fetcher, subtitles []SourceSubtitle, dir string) []SavedSubtitle {
	saved := []SavedSubtitle{}
	for _, sub := range subtitles {
		if len(saved) >= maxSubtitles || ctx.Err() != nil {
			break
		}
		raw, headers, err := providerURL(sub.URL, f.headers)
		if err != nil {
			continue
		}
		data, err := (&fetcher{client: f.client, headers: headers}).bytes(ctx, raw, 10<<20)
		if err != nil || len(data) == 0 {
			continue
		}
		ext, mime := subtitleKind(raw)
		name := "sub-" + strconv.Itoa(len(saved)) + ext
		if os.WriteFile(filepath.Join(dir, name), data, 0o644) != nil {
			continue
		}
		label := sub.Language
		if strings.TrimSpace(label) == "" {
			label = "Subtitles"
		}
		saved = append(saved, SavedSubtitle{File: name, Language: SubtitleLanguage(sub.Language), Label: label, Default: sub.IsDefault, Mime: mime})
	}
	return saved
}

func subtitleKind(raw string) (string, string) {
	u, _ := url.Parse(raw)
	path := strings.ToLower(u.Path)
	switch {
	case strings.HasSuffix(path, ".ass"), strings.HasSuffix(path, ".ssa"):
		return ".ass", "text/x-ssa"
	case strings.HasSuffix(path, ".srt"):
		return ".srt", "application/x-subrip"
	default:
		return ".vtt", "text/vtt"
	}
}

func dirSize(dir string) int64 {
	var size int64
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if info, err := e.Info(); err == nil {
			size += info.Size()
		}
	}
	return size
}

// resolve picks the source of a queued job: the preferred server first, then the wanted quality, then "auto".
func (m *Manager) resolve(ctx context.Context, job *Item) (*chosen, error) {
	if m.opts.Resolve == nil {
		return nil, errUnavailable
	}
	episode, err := strconv.Atoi(job.Episode)
	if err != nil {
		return nil, errUnavailable
	}
	sources, err := m.opts.Resolve(ctx, job.Provider, job.MediaID, episode, job.Dubbed)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %v", errUnavailable, err)
	}
	return pickSource(sources, job.Server, job.Quality)
}

func pickSource(sources []VideoSource, server, quality string) (*chosen, error) {
	var candidates []VideoSource
	for _, s := range sources {
		if ValidURL(s.URL) {
			candidates = append(candidates, s)
		}
	}
	if len(candidates) == 0 {
		return nil, errUnavailable
	}
	score := func(s VideoSource) int {
		n := 0
		if strings.EqualFold(s.Server, server) {
			n += 100
		}
		if strings.EqualFold(s.Quality, quality) {
			n += 20
		}
		if strings.EqualFold(s.Quality, "auto") {
			n += 10
		}
		return n
	}
	sort.SliceStable(candidates, func(i, j int) bool { return score(candidates[i]) > score(candidates[j]) })
	best := candidates[0]
	kind := "mp4"
	if best.Type == "m3u8" || strings.Contains(best.URL, ".m3u8") {
		kind = "m3u8"
	}
	subs := []SourceSubtitle{}
	for _, s := range best.Subtitles {
		if ValidURL(s.URL) {
			subs = append(subs, s)
		}
	}
	return &chosen{URL: best.URL, Type: kind, Headers: best.Headers, Subtitles: subs}, nil
}

// --- requests from the app ---

// BatchEpisode is one episode of a batch.
type BatchEpisode struct {
	Number      float64 `json:"number"`
	Title       string  `json:"title"`
	Image       string  `json:"image"`
	Description string  `json:"description"`
}

// BatchRequest queues episodes of one anime from an online-stream provider (one episode, a season, the missing ones).
type BatchRequest struct {
	MediaID   int            `json:"mediaId"`
	Provider  string         `json:"provider"`
	Dubbed    bool           `json:"dubbed"`
	Quality   string         `json:"quality"`
	Server    string         `json:"server"`
	Title     string         `json:"title"`
	CoverURL  string         `json:"coverUrl"`
	BannerURL string         `json:"bannerUrl"`
	Episodes  []BatchEpisode `json:"episodes"`
}

func audioLanguage(dubbed bool) string {
	if dubbed {
		return "de"
	}
	return "ja"
}

// Submit queues the episodes of req that are neither saved nor queued already; returns how many it added.
func (m *Manager) Submit(req BatchRequest) (int, error) {
	if req.MediaID <= 0 || strings.TrimSpace(req.Provider) == "" || len(req.Episodes) == 0 || len(req.Episodes) > 2000 {
		return 0, errors.New("no episodes selected")
	}
	quality := strings.TrimSpace(req.Quality)
	if quality == "" {
		quality = "Auto"
	}
	audio := audioLanguage(req.Dubbed)
	added := []string{}
	m.mu.Lock()
	now := time.Now().UnixMilli()
	for index, e := range req.Episodes {
		// the providers take whole episode numbers
		if e.Number < 0 || math.IsNaN(e.Number) || math.IsInf(e.Number, 0) || e.Number != math.Trunc(e.Number) {
			continue
		}
		episode := strconv.FormatInt(int64(e.Number), 10)
		key := fmt.Sprintf("%d:%s:%s:%t:%s", req.MediaID, episode, req.Provider, req.Dubbed, quality)
		id := IDFor(key)
		if m.state.Items[id] != nil || m.hasEpisodeLocked(req.MediaID, episode, audio) {
			continue
		}
		m.state.Items[id] = &record{Item: Item{
			Details: Details{Title: req.Title, CoverURL: req.CoverURL, BannerURL: req.BannerURL, EpisodeTitle: e.Title,
				EpisodeImageURL: e.Image, EpisodeDescription: e.Description},
			ID: id, Key: key, Status: StatusQueued, MediaID: req.MediaID, Provider: req.Provider, Episode: episode, Dubbed: req.Dubbed,
			Quality: quality, Server: req.Server, AudioLanguage: audio, Order: now + int64(index),
		}}
		added = append(added, id)
	}
	if len(added) > 0 {
		m.saveLocked(true)
		m.changedLocked()
	}
	m.mu.Unlock()
	for _, id := range added {
		m.capture(id)
	}
	m.poke()
	return len(added), nil
}

// hasEpisodeLocked: a not failed download of the episode in that audio language exists.
func (m *Manager) hasEpisodeLocked(mediaID int, episode, audio string) bool {
	for _, r := range m.state.Items {
		if r.MediaID == mediaID && r.Episode == episode && r.AudioLanguage == audio && r.Status != StatusFailed {
			return true
		}
	}
	return false
}

// DownloadRequest saves one episode from a source the app already has (the player's current stream).
type DownloadRequest struct {
	Key       string            `json:"key"`
	URL       string            `json:"url"`
	Type      string            `json:"type"`
	Headers   map[string]string `json:"headers"`
	Subtitles []SourceSubtitle  `json:"subtitles"`
	MediaID   int               `json:"mediaId"`
	Episode   string            `json:"episode"`
	Dubbed    bool              `json:"dubbed"`
	Quality   string            `json:"quality"`
	Details
}

// Download queues a single pre-resolved episode.
func (m *Manager) Download(req DownloadRequest) (*Item, error) {
	if _, _, err := providerURL(req.URL, req.Headers); err != nil {
		return nil, errors.New("this source cannot be downloaded")
	}
	if strings.TrimSpace(req.Key) == "" {
		req.Key = fmt.Sprintf("%d:%s:direct:%t:%s", req.MediaID, req.Episode, req.Dubbed, req.Quality)
	}
	id := IDFor(req.Key)
	kind := "mp4"
	if req.Type == "m3u8" || strings.Contains(req.URL, ".m3u8") {
		kind = "m3u8"
	}
	m.mu.Lock()
	if r := m.state.Items[id]; r != nil && r.Status != StatusFailed {
		m.mu.Unlock()
		return nil, errors.New("this episode is already saved or being prepared")
	}
	r := &record{Item: Item{Details: req.Details, ID: id, Key: req.Key, Status: StatusQueued, MediaID: req.MediaID, Episode: req.Episode,
		Dubbed: req.Dubbed, Quality: req.Quality, AudioLanguage: audioLanguage(req.Dubbed), Order: time.Now().UnixMilli()},
		Source: &chosen{URL: req.URL, Type: kind, Headers: req.Headers, Subtitles: req.Subtitles}}
	m.state.Items[id] = r
	item := r.Item
	m.saveLocked(true)
	m.changedLocked()
	m.mu.Unlock()
	m.capture(id)
	m.poke()
	return &item, nil
}

// Action runs pause, resume, retry or remove on an item; false when there is no such item.
func (m *Manager) Action(id, action string) (bool, error) {
	m.mu.Lock()
	r := m.state.Items[id]
	if r == nil {
		m.mu.Unlock()
		return false, nil
	}
	cancel := m.running[id]
	switch action {
	case "pause":
		if r.Status == StatusReady {
			m.mu.Unlock()
			return true, nil
		}
		r.Status = StatusPaused
	case "resume", "retry":
		if r.Status != StatusReady {
			r.Status, r.Error, r.Failure = StatusQueued, "", ""
		}
		cancel = nil
	case "remove":
		delete(m.state.Items, id)
	default:
		m.mu.Unlock()
		return false, errors.New("unknown action")
	}
	if cancel != nil {
		cancel()
		delete(m.running, id)
	}
	m.saveLocked(true)
	m.changedLocked()
	m.mu.Unlock()
	if action == "remove" {
		_ = os.RemoveAll(filepath.Join(m.opts.Dir, "episodes", id))
		m.cleanArtwork()
	}
	m.poke()
	return true, nil
}

// SetPosition stores where the offline player stopped.
func (m *Manager) SetPosition(id string, positionMs int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.state.Items[id]
	if r == nil {
		return false
	}
	r.PositionMs = max(0, positionMs)
	m.saveLocked(true)
	m.changedLocked()
	return true
}

// Snapshot is the current state, sorted by queue order.
func (m *Manager) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

func (m *Manager) snapshotLocked() Snapshot {
	items := make([]Item, 0, len(m.state.Items))
	waitingWork := false
	for _, r := range m.state.Items {
		items = append(items, r.Item)
		if r.Status == StatusQueued {
			waitingWork = true
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Order < items[j].Order })
	waiting := ""
	if waitingWork {
		waiting = m.waitingLocked()
	}
	return Snapshot{Items: items, WifiOnly: m.state.WifiOnly, Network: m.network, Waiting: waiting}
}

// FilePath is the saved file name of item id, or "" when the item has no such file.
func (m *Manager) FilePath(id, name string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.state.Items[id]
	if r == nil || !r.Ready {
		return ""
	}
	known := name != "" && (name == r.Files.Video || name == r.Files.Audio)
	for _, s := range r.Files.Subtitles {
		known = known || s.File == name
	}
	if !known {
		return ""
	}
	return filepath.Join(m.opts.Dir, "episodes", id, name)
}
