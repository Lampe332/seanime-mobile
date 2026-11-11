package mobileoffline

// Taking over the downloads of Seanime Mobile 2.0.33 (E6). The native app is installed as an update in the same package
// and runs this server with the same data folder (filesDir), but the old app kept its episodes outside of it: Media3's
// download index and cache (offline/EpisodeDownloads.kt), the offline descriptions, playback positions, "Wi-Fi only"
// and the batch queue in SharedPreferences (OfflineLibrary.kt, OfflineActivity.kt, EpisodeBatchQueue.kt), the artwork
// in filesDir/offline-artwork. The first start after the update turns them into items of this queue, once:
//
//   - finished episodes: the video (and audio) is put back together from the cache files into episodes/<id>/ like a
//     download of this app, with their saved subtitles, descriptions, artwork and position;
//   - unfinished or queued episodes: queued again (their partial cache data cannot continue here);
//   - a finished episode that cannot be put together: failed, so "Retry" downloads it again.
//
// Media3 1.8.1 formats (read from its classes): databases/exoplayer_internal.db with the tables ExoPlayerDownloads
// (DefaultDownloadIndex) and ExoPlayerCacheIndex<uid> (CachedContentIndex: id, key, metadata with "exo_len"); cache
// files <cache>/<0-9>/<id>.<position>.<timestamp>.v3.exo (SimpleCacheSpan). Cache keys are the request URIs.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/glebarez/go-sqlite" // database/sql driver "sqlite" (pure Go, already used through gorm)
)

const legacyMarker = "legacy-import.json"

// Media3 Download.STATE_*
const (
	legacyQueued     = 0
	legacyStopped    = 1
	legacyCompleted  = 3
	legacyFailed     = 4
	legacyRemoving   = 5
	legacyRestarting = 7
)

type legacyResult struct {
	Version int               `json:"version"`
	Done    bool              `json:"done"`
	Items   map[string]string `json:"items"`
	At      string            `json:"at"`
}

type legacyRow struct {
	id, mime, uri, customKey string
	data                     []byte
	state, stopReason        int
	startMs, bytes           int64
}

// importLegacy runs once in the background after New (Options.LegacyDir). A run that could not finish (no space, the
// server stopped) leaves the marker open and continues on the next start; items already taken over are skipped.
func (m *Manager) importLegacy() {
	defer m.wg.Done()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		select {
		case <-m.done:
			cancel()
		case <-ctx.Done():
		}
	}()
	markerPath := filepath.Join(m.opts.Dir, legacyMarker)
	result := legacyResult{Version: 1, Items: map[string]string{}}
	if data, err := os.ReadFile(markerPath); err == nil {
		_ = json.Unmarshal(data, &result)
		if result.Done {
			return
		}
		if result.Items == nil {
			result.Items = map[string]string{}
		}
	}
	done := m.runLegacyImport(ctx, &result)
	if ctx.Err() != nil {
		return
	}
	result.Done = done
	result.At = time.Now().UTC().Format(time.RFC3339)
	if data, err := json.MarshalIndent(result, "", "  "); err == nil {
		_ = os.WriteFile(markerPath, data, 0o644)
	}
}

// runLegacyImport takes over what it finds; false when it has to run again (no space yet).
func (m *Manager) runLegacyImport(ctx context.Context, result *legacyResult) bool {
	filesDir := m.opts.LegacyDir
	appDir := filepath.Dir(filesDir)
	prefs := func(name string) map[string]prefEntry {
		return readPrefs(filepath.Join(appDir, "shared_prefs", name+".xml"))
	}
	library := prefs("offline-library-v1")
	positions := prefs("offline-playback")
	batch := prefs("episode-batch-queue")
	settings := prefs("episode-downloads")

	if wifi, ok := settings["wifiOnly"]; ok && result.Items["_wifiOnly"] == "" {
		m.SetWifiOnly(wifi.Value == "true")
		result.Items["_wifiOnly"] = "imported"
	}

	rows, cache, err := readLegacyDownloads(appDir, filepath.Join(filesDir, "offline-video"))
	if err != nil {
		result.Items["_database"] = "failed: " + err.Error()
	}
	byID := map[string]legacyRow{}
	for _, row := range rows {
		byID[row.id] = row
	}

	// retry: an episode waits for space, so the marker stays open; cleanAll: every finished episode was taken over,
	// so nothing in the old cache is needed any more (a failed one keeps its data, also on later starts)
	retry, cleanAll := false, err == nil
	imported := []string{}
	for _, row := range rows {
		if ctx.Err() != nil {
			return false
		}
		if strings.Contains(row.id, ":sub:") || row.state == legacyRemoving || m.has(row.id) {
			continue
		}
		payload := legacyPayload(row.data, library[row.id].Text)
		r := legacyRecord(row.id, payload)
		if r.Order == 0 {
			r.Order = row.startMs
		}
		if p, ok := positions[row.id]; ok {
			r.PositionMs, _ = strconv.ParseInt(p.Value, 10, 64)
		}
		switch {
		case row.state == legacyCompleted:
			files, ok, err := m.legacyFiles(ctx, row, byID, payload, cache)
			if ctx.Err() != nil {
				return false
			}
			if errors.Is(err, errNoSpace) {
				// stays in the old cache; the next start tries again
				result.Items[row.id] = "waiting: " + err.Error()
				retry, cleanAll = true, false
				continue
			}
			if !ok {
				r.Status, r.Failure = StatusFailed, FailureUnknown
				r.Error = FailureText(FailureUnknown)
				result.Items[row.id] = "failed: " + err.Error()
			} else {
				r.Status, r.Ready, r.Progress, r.Files = StatusReady, true, 100, files
				r.Bytes = dirSize(filepath.Join(m.opts.Dir, "episodes", row.id))
				result.Items[row.id] = "imported"
				imported = append(imported, row.id)
			}
		case row.state == legacyFailed:
			r.Status, r.Failure = StatusFailed, FailureUnknown
			r.Error = FailureText(FailureUnknown)
			result.Items[row.id] = "queued (failed before)"
		case row.state == legacyStopped || row.stopReason != 0:
			r.Status = StatusPaused
			result.Items[row.id] = "queued (paused)"
		default: // queued, downloading, restarting: start over here
			r.Status = StatusQueued
			result.Items[row.id] = "queued"
		}
		m.copyLegacyArtwork(filesDir, &r.Details)
		m.addLegacy(r)
	}

	// batch jobs whose source was not resolved yet (EpisodeBatchQueue.kt)
	for id, entry := range batch {
		if !ValidID(id) || m.has(id) {
			continue
		}
		payload := legacyPayload([]byte(entry.Text), library[id].Text)
		r := legacyRecord(id, payload)
		r.Source = nil
		switch string(payload["status"]) {
		case `"paused"`:
			r.Status = StatusPaused
		case `"failed"`:
			r.Status, r.Failure = StatusFailed, FailureUnknown
			r.Error = FailureText(FailureUnknown)
		default:
			r.Status = StatusQueued
		}
		m.copyLegacyArtwork(filesDir, &r.Details)
		m.addLegacy(r)
		result.Items[id] = "queued (batch)"
	}

	for _, status := range result.Items {
		if strings.HasPrefix(status, "failed") {
			cleanAll = false
		}
	}
	// the old cache only holds data of taken-over or restarted episodes now
	if cleanAll {
		_ = os.RemoveAll(filepath.Join(filesDir, "offline-video"))
		_ = os.RemoveAll(filepath.Join(filesDir, "offline-artwork"))
	} else if cache != nil {
		for _, id := range imported {
			cache.removeUsedBy(id)
		}
	}
	return !retry
}

func (m *Manager) has(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state.Items[id] != nil
}

func (m *Manager) addLegacy(r *record) {
	m.mu.Lock()
	if m.state.Items[r.ID] == nil {
		m.state.Items[r.ID] = r
		m.saveLocked(true)
		m.changedLocked()
	}
	m.mu.Unlock()
	m.capture(r.ID)
	m.poke()
}

// legacyPayload is the download's JSON (DownloadRequest.data / a batch job) with the saved descriptions over it, as
// EpisodeDownloads.metadata() merged them (OfflineLibrary.merge).
func legacyPayload(data []byte, details string) map[string]json.RawMessage {
	payload := map[string]json.RawMessage{}
	_ = json.Unmarshal(data, &payload)
	extra := map[string]json.RawMessage{}
	if details != "" && json.Unmarshal([]byte(details), &extra) == nil {
		for k, v := range extra {
			payload[k] = v
		}
	}
	return payload
}

// legacyRecord fills an item from the old JSON field by field: the names are the same (this queue was ported from it),
// and a field of an unexpected type is skipped instead of losing the whole episode.
func legacyRecord(id string, payload map[string]json.RawMessage) *record {
	var item Item
	for key, value := range payload {
		switch key {
		case "id", "status", "ready", "progress", "bytes", "files", "failure", "error", "subtitles", "url", "type":
			continue
		}
		one, _ := json.Marshal(map[string]json.RawMessage{key: value})
		var probe Item
		if json.Unmarshal(one, &probe) == nil {
			_ = json.Unmarshal(one, &item)
		}
	}
	item.ID = id
	if item.Key == "" {
		item.Key = id
	}
	if item.AudioLanguage == "" {
		item.AudioLanguage = audioLanguage(item.Dubbed)
	}
	r := &record{Item: item}
	// a direct download keeps its source for "Retry"; batch jobs resolve through their provider again
	var source chosen
	if raw, ok := payload["url"]; ok && json.Unmarshal(raw, &source.URL) == nil && source.URL != "" && item.Provider == "" {
		source.Type = "mp4"
		var kind string
		if raw, ok := payload["type"]; ok && json.Unmarshal(raw, &kind) == nil && kind == "m3u8" {
			source.Type = "m3u8"
		}
		var subs []struct {
			URL      string `json:"url"`
			Language string `json:"language"`
			Default  bool   `json:"default"`
		}
		if raw, ok := payload["subtitles"]; ok {
			_ = json.Unmarshal(raw, &subs)
		}
		for _, s := range subs {
			source.Subtitles = append(source.Subtitles, SourceSubtitle{URL: s.URL, Language: s.Language, IsDefault: s.Default})
		}
		r.Source = &source
	}
	return r
}

// copyLegacyArtwork brings the saved artwork along (same names: SHA-256 of the URL + ".jpg").
func (m *Manager) copyLegacyArtwork(filesDir string, d *Details) {
	for _, asset := range []*string{&d.CoverAsset, &d.BannerAsset, &d.EpisodeImageAsset} {
		if !artworkName.MatchString(*asset) {
			*asset = ""
			continue
		}
		if m.ArtworkPath(*asset) != "" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(filesDir, "offline-artwork", *asset))
		target := filepath.Join(m.opts.Dir, "artwork", *asset)
		if err != nil || os.WriteFile(target+".tmp", data, 0o644) != nil || os.Rename(target+".tmp", target) != nil {
			*asset = ""
		}
	}
}

// legacyFiles writes the episode's files from the old cache into episodes/<id>/.
func (m *Manager) legacyFiles(ctx context.Context, row legacyRow, rows map[string]legacyRow, payload map[string]json.RawMessage, cache *legacyCache) (Files, bool, error) {
	if cache == nil {
		return Files{}, false, errors.New("old download cache missing")
	}
	key := row.uri
	if row.customKey != "" {
		key = row.customKey
	}
	// Media3's bytes_downloaded of the episode (video, audio and segments; subtitles are small)
	if free, err := m.opts.FreeSpace(m.opts.Dir); err == nil && free < uint64(max(row.bytes, 0))+minFree {
		return Files{}, false, errNoSpace
	}
	dir := filepath.Join(m.opts.Dir, "episodes", row.id)
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Files{}, false, err
	}
	files, err := m.legacyMedia(ctx, row, key, payload, cache, dir)
	if err == nil {
		files.Subtitles = legacySubtitles(row.id, rows, payload, cache, dir)
	}
	if err != nil {
		_ = os.RemoveAll(dir)
		return Files{}, false, err
	}
	return files, true, nil
}

func (m *Manager) legacyMedia(ctx context.Context, row legacyRow, key string, payload map[string]json.RawMessage, cache *legacyCache, dir string) (Files, error) {
	if !strings.Contains(strings.ToLower(row.mime), "mpegurl") {
		// progressive MP4: one cache entry under the request URI
		id, ok := cache.lookup(key)
		if !ok {
			return Files{}, errors.New("video not in the old cache")
		}
		path := filepath.Join(dir, "video.mp4")
		out, err := os.Create(path + ".tmp")
		if err != nil {
			return Files{}, err
		}
		_, err = cache.copyAll(ctx, out, id, row.id)
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err == nil {
			err = os.Rename(path+".tmp", path)
		}
		if err != nil {
			_ = os.Remove(path + ".tmp")
			return Files{}, err
		}
		return Files{Video: "video.mp4"}, nil
	}
	// HLS: the playlists, keys and segments are cache entries under their URIs; the HLS code of this queue reads them
	// through a transport that answers from the cache instead of the network
	f := &fetcher{client: &http.Client{Transport: cache.transport(row.id)}}
	base, _ := url.Parse(key)
	text, err := f.bytes(ctx, key, 8<<20)
	if err != nil {
		return Files{}, err
	}
	mediaURL, mediaText, audioURL := key, text, ""
	if variants, renditions := parseMaster(base, string(text)); len(variants) > 0 {
		// the variant Media3 downloaded is the one whose playlist is in the cache (highest first)
		sort.SliceStable(variants, func(i, j int) bool { return variants[i].height > variants[j].height })
		found := false
		for _, v := range variants {
			if t, err := f.bytes(ctx, v.uri, 8<<20); err == nil {
				mediaURL, mediaText, found = v.uri, t, true
				if v.audio != "" {
					var cached []rendition
					for _, r := range renditions {
						if _, ok := cache.lookup(r.uri); ok {
							cached = append(cached, r)
						}
					}
					var lang string
					_ = json.Unmarshal(payload["audioLanguage"], &lang)
					if r := pickAudio(cached, v.audio, lang); r != nil {
						audioURL = r.uri
					}
				}
				break
			}
		}
		if !found {
			return Files{}, errors.New("no variant playlist in the old cache")
		}
	}
	mediaBase, _ := url.Parse(mediaURL)
	video, err := parseMedia(mediaBase, string(mediaText))
	if err != nil {
		return Files{}, err
	}
	files := Files{Video: "video.ts"}
	if video.init != nil {
		files.Video = "video.mp4"
	}
	noop := func() {}
	noReport := func(int, int, int64) {}
	if err := f.downloadPlaylist(ctx, video, filepath.Join(dir, files.Video), &hlsState{}, noop, noReport); err != nil {
		return Files{}, err
	}
	if audioURL != "" {
		audioText, err := f.bytes(ctx, audioURL, 8<<20)
		if err != nil {
			return Files{}, err
		}
		audioBase, _ := url.Parse(audioURL)
		audio, err := parseMedia(audioBase, string(audioText))
		if err != nil {
			return Files{}, err
		}
		files.Audio = "audio.ts"
		if audio.init != nil {
			files.Audio = "audio.mp4"
		}
		if err := f.downloadPlaylist(ctx, audio, filepath.Join(dir, files.Audio), &hlsState{}, noop, noReport); err != nil {
			return Files{}, err
		}
	}
	return files, nil
}

// legacySubtitles saves the subtitles the old app downloaded as "<id>:sub:<n>" next to the episode (the payload lists
// them in the same order, EpisodeDownloads.enqueue). A missing one is left out, like a failed subtitle of a download.
func legacySubtitles(id string, rows map[string]legacyRow, payload map[string]json.RawMessage, cache *legacyCache, dir string) []SavedSubtitle {
	var subs []struct {
		URL      string `json:"url"`
		Language string `json:"language"`
		Label    string `json:"label"`
		Default  bool   `json:"default"`
		Mime     string `json:"mime"`
	}
	if raw, ok := payload["subtitles"]; ok {
		_ = json.Unmarshal(raw, &subs)
	}
	saved := []SavedSubtitle{}
	for n, sub := range subs {
		row, ok := rows[id+":sub:"+strconv.Itoa(n)]
		if !ok || row.state != legacyCompleted || len(saved) >= maxSubtitles {
			continue
		}
		key := row.uri
		if row.customKey != "" {
			key = row.customKey
		}
		cid, ok := cache.lookup(key)
		if !ok {
			continue
		}
		var buffer bytes.Buffer
		if _, err := cache.copyAll(context.Background(), &buffer, cid, id); err != nil || buffer.Len() == 0 || buffer.Len() > 10<<20 {
			continue
		}
		ext, mime := ".vtt", "text/vtt"
		switch sub.Mime {
		case "text/x-ssa":
			ext, mime = ".ass", sub.Mime
		case "application/x-subrip":
			ext, mime = ".srt", sub.Mime
		}
		name := "sub-" + strconv.Itoa(len(saved)) + ext
		if os.WriteFile(filepath.Join(dir, name), buffer.Bytes(), 0o644) != nil {
			continue
		}
		label := sub.Label
		if strings.TrimSpace(label) == "" {
			label = sub.Language
		}
		if strings.TrimSpace(label) == "" {
			label = "Subtitles"
		}
		saved = append(saved, SavedSubtitle{File: name, Language: SubtitleLanguage(sub.Language), Label: label, Default: sub.Default, Mime: mime})
	}
	return saved
}

// --- Media3 download index and cache ---

func readLegacyDownloads(appDir, cacheDir string) ([]legacyRow, *legacyCache, error) {
	dbPath := filepath.Join(appDir, "databases", "exoplayer_internal.db")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, nil, nil
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, nil, err
	}
	defer db.Close()
	var tables []string
	list, err := db.Query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
	if err != nil {
		return nil, nil, err
	}
	for list.Next() {
		var name string
		if list.Scan(&name) == nil {
			tables = append(tables, name)
		}
	}
	list.Close()
	hasDownloads, indexTables := false, []string{}
	for _, name := range tables {
		if name == "ExoPlayerDownloads" {
			hasDownloads = true
		}
		if strings.HasPrefix(name, "ExoPlayerCacheIndex") && regexp.MustCompile(`^ExoPlayerCacheIndex[0-9a-f]+$`).MatchString(name) {
			indexTables = append(indexTables, name)
		}
	}
	if !hasDownloads {
		return nil, nil, nil
	}
	query, err := db.Query(`SELECT id, IFNULL(mime_type, ''), uri, IFNULL(custom_cache_key, ''), data, state, stop_reason, start_time_ms, bytes_downloaded FROM ExoPlayerDownloads`)
	if err != nil {
		return nil, nil, err
	}
	var rows []legacyRow
	for query.Next() {
		var r legacyRow
		if err := query.Scan(&r.id, &r.mime, &r.uri, &r.customKey, &r.data, &r.state, &r.stopReason, &r.startMs, &r.bytes); err == nil {
			rows = append(rows, r)
		}
	}
	query.Close()
	cache := &legacyCache{ids: map[string]int64{}, norm: map[string]int64{}, lengths: map[int64]int64{}, spans: map[int64][]legacySpan{}, used: map[string]map[int64]bool{}}
	for _, table := range indexTables {
		entries, err := db.Query(`SELECT id, key, metadata FROM "` + table + `"`)
		if err != nil {
			continue
		}
		for entries.Next() {
			var id int64
			var key string
			var meta []byte
			if entries.Scan(&id, &key, &meta) == nil {
				cache.ids[key] = id
				cache.norm[normalizeKey(key)] = id
				cache.lengths[id] = contentLength(meta)
			}
		}
		entries.Close()
	}
	cache.scan(cacheDir)
	return rows, cache, nil
}

var spanName = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)\.v3\.exo$`)

type legacySpan struct {
	position, length int64
	path             string
}

type legacyCache struct {
	ids     map[string]int64
	norm    map[string]int64
	lengths map[int64]int64 // exo_len, -1 unknown
	spans   map[int64][]legacySpan
	used    map[string]map[int64]bool // item id -> cache entries it was built from
}

func (c *legacyCache) scan(dir string) {
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		match := spanName.FindStringSubmatch(d.Name())
		if match == nil {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() == 0 {
			return nil
		}
		id, _ := strconv.ParseInt(match[1], 10, 64)
		position, _ := strconv.ParseInt(match[2], 10, 64)
		c.spans[id] = append(c.spans[id], legacySpan{position: position, length: info.Size(), path: path})
		return nil
	})
	for id := range c.spans {
		sort.Slice(c.spans[id], func(i, j int) bool { return c.spans[id][i].position < c.spans[id][j].position })
	}
}

func normalizeKey(key string) string {
	if u, err := url.Parse(key); err == nil {
		return u.String()
	}
	return key
}

func (c *legacyCache) lookup(key string) (int64, bool) {
	if id, ok := c.ids[key]; ok {
		return id, true
	}
	id, ok := c.norm[normalizeKey(key)]
	return id, ok
}

// contentLength reads "exo_len" from a CachedContentIndex metadata blob (writeContentMetadata: int count, then per
// entry writeUTF(name), int length, bytes).
func contentLength(meta []byte) int64 {
	r := bytes.NewReader(meta)
	var count int32
	if binary.Read(r, binary.BigEndian, &count) != nil || count < 0 || count > 1000 {
		return -1
	}
	for i := int32(0); i < count; i++ {
		var nameLen uint16
		if binary.Read(r, binary.BigEndian, &nameLen) != nil {
			return -1
		}
		name := make([]byte, nameLen)
		if _, err := io.ReadFull(r, name); err != nil {
			return -1
		}
		var valueLen int32
		if binary.Read(r, binary.BigEndian, &valueLen) != nil || valueLen < 0 || int64(valueLen) > int64(r.Len()) {
			return -1
		}
		value := make([]byte, valueLen)
		if _, err := io.ReadFull(r, value); err != nil {
			return -1
		}
		if string(name) == "exo_len" && valueLen == 8 {
			return int64(binary.BigEndian.Uint64(value))
		}
	}
	return -1
}

// size is the whole length of an entry: exo_len, else where the cached data starting at 0 ends.
func (c *legacyCache) size(id int64) int64 {
	if n := c.lengths[id]; n >= 0 {
		return n
	}
	end := int64(0)
	for _, s := range c.spans[id] {
		if s.position > end {
			break
		}
		end = max(end, s.position+s.length)
	}
	return end
}

var errLegacyGap = errors.New("old cache data incomplete")

// read returns bytes [from, from+n) of an entry; n < 0: to its end.
func (c *legacyCache) read(id, from, n int64) ([]byte, error) {
	var buffer bytes.Buffer
	if _, err := c.copyRange(context.Background(), &buffer, id, from, n); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (c *legacyCache) copyAll(ctx context.Context, w io.Writer, id int64, itemID string) (int64, error) {
	c.markUsed(itemID, id)
	return c.copyRange(ctx, w, id, 0, -1)
}

func (c *legacyCache) copyRange(ctx context.Context, w io.Writer, id, from, n int64) (int64, error) {
	end := from + n
	if n < 0 {
		end = c.size(id)
	}
	if total := c.lengths[id]; total >= 0 && end > total {
		return 0, errLegacyGap
	}
	if end <= from && n != 0 {
		return 0, errLegacyGap
	}
	position := from
	for _, s := range c.spans[id] {
		if position >= end {
			break
		}
		if s.position+s.length <= position {
			continue
		}
		if s.position > position {
			return position - from, errLegacyGap
		}
		if ctx.Err() != nil {
			return position - from, ctx.Err()
		}
		file, err := os.Open(s.path)
		if err != nil {
			return position - from, err
		}
		take := min(end, s.position+s.length) - position
		_, err = io.Copy(w, io.NewSectionReader(file, position-s.position, take))
		file.Close()
		if err != nil {
			return position - from, err
		}
		position += take
	}
	if position < end {
		return position - from, errLegacyGap
	}
	return position - from, nil
}

func (c *legacyCache) markUsed(itemID string, id int64) {
	if c.used[itemID] == nil {
		c.used[itemID] = map[int64]bool{}
	}
	c.used[itemID][id] = true
}

func (c *legacyCache) removeUsedBy(itemID string) {
	for id := range c.used[itemID] {
		for _, s := range c.spans[id] {
			_ = os.Remove(s.path)
		}
	}
}

// transport answers GET requests from the cache (whole entries or one byte range), for the HLS code.
func (c *legacyCache) transport(itemID string) http.RoundTripper {
	return roundTripper(func(req *http.Request) (*http.Response, error) {
		id, ok := c.lookup(req.URL.String())
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("")), Request: req, Header: http.Header{}}, nil
		}
		c.markUsed(itemID, id)
		from, n, status := int64(0), int64(-1), http.StatusOK
		if match := rangeHeader.FindStringSubmatch(req.Header.Get("Range")); match != nil {
			from, _ = strconv.ParseInt(match[1], 10, 64)
			if match[2] != "" {
				to, _ := strconv.ParseInt(match[2], 10, 64)
				n = to - from + 1
			}
			status = http.StatusPartialContent
		}
		data, err := c.read(id, from, n)
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data)), Request: req, Header: http.Header{}}, nil
	})
}

var rangeHeader = regexp.MustCompile(`^bytes=(\d+)-(\d*)$`)

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

// --- SharedPreferences ---

type prefEntry struct {
	XMLName xml.Name
	Name    string `xml:"name,attr"`
	Value   string `xml:"value,attr"`
	Text    string `xml:",chardata"`
}

// readPrefs reads an Android SharedPreferences file (<map><string name="k">v</string><long name="k" value="1"/>…).
func readPrefs(path string) map[string]prefEntry {
	result := map[string]prefEntry{}
	data, err := os.ReadFile(path)
	if err != nil {
		return result
	}
	var doc struct {
		Entries []prefEntry `xml:",any"`
	}
	if xml.Unmarshal(data, &doc) != nil {
		return result
	}
	for _, e := range doc.Entries {
		if e.Name != "" {
			result[e.Name] = e
		}
	}
	return result
}
