package mobileoffline

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// legacyApp builds the private folder of Seanime Mobile 2.0.33 as Media3 1.8.1 and the old Kotlin left it:
// databases/exoplayer_internal.db (DefaultDownloadIndex + CachedContentIndex tables, schemas copied from media3),
// files/offline-video/<0-9>/<id>.<pos>.<ts>.v3.exo, files/offline-artwork, shared_prefs/*.xml.
type legacyApp struct {
	t        *testing.T
	root     string
	files    string
	db       *sql.DB
	nextID   int64
	prefs    map[string][]string
	contents map[string]int64
}

func newLegacyApp(t *testing.T) *legacyApp {
	root := t.TempDir()
	app := &legacyApp{t: t, root: root, files: filepath.Join(root, "files"), prefs: map[string][]string{}, contents: map[string]int64{}}
	for _, dir := range []string{"files/offline-video", "files/offline-artwork", "databases", "shared_prefs"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// the uid file SimpleCache keeps next to its spans; the table name carries the same uid in hex
	_ = os.WriteFile(filepath.Join(app.files, "offline-video", "1a2b3c.uid"), nil, 0o644)
	db, err := sql.Open("sqlite", filepath.Join(root, "databases", "exoplayer_internal.db"))
	if err != nil {
		t.Fatal(err)
	}
	app.db = db
	for _, stmt := range []string{
		"CREATE TABLE ExoPlayerDownloads (id TEXT PRIMARY KEY NOT NULL,mime_type TEXT,uri TEXT NOT NULL,stream_keys TEXT NOT NULL,custom_cache_key TEXT,data BLOB NOT NULL,state INTEGER NOT NULL,start_time_ms INTEGER NOT NULL,update_time_ms INTEGER NOT NULL,content_length INTEGER NOT NULL,stop_reason INTEGER NOT NULL,failure_reason INTEGER NOT NULL,percent_downloaded REAL NOT NULL,bytes_downloaded INTEGER NOT NULL,key_set_id BLOB NOT NULL)",
		"CREATE TABLE ExoPlayerCacheIndex1a2b3c (id INTEGER PRIMARY KEY NOT NULL,key TEXT NOT NULL,metadata BLOB NOT NULL)",
		"CREATE TABLE ExoPlayerCacheFileMetadata1a2b3c (name TEXT PRIMARY KEY NOT NULL,length INTEGER NOT NULL,last_touch_timestamp INTEGER NOT NULL)",
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	return app
}

// metadata is CachedContentIndex.writeContentMetadata with exo_len.
func metadata(length int64) []byte {
	var b bytes.Buffer
	_ = binary.Write(&b, binary.BigEndian, int32(1))
	_ = binary.Write(&b, binary.BigEndian, uint16(len("exo_len")))
	b.WriteString("exo_len")
	_ = binary.Write(&b, binary.BigEndian, int32(8))
	_ = binary.Write(&b, binary.BigEndian, length)
	return b.Bytes()
}

// cache stores content under key, split into spans at the given positions, in random-looking subfolders.
func (a *legacyApp) cache(key string, content []byte, cuts ...int) {
	a.nextID++
	id := a.nextID
	a.contents[key] = id
	if _, err := a.db.Exec("INSERT INTO ExoPlayerCacheIndex1a2b3c (id, key, metadata) VALUES (?, ?, ?)", id, key, metadata(int64(len(content)))); err != nil {
		a.t.Fatal(err)
	}
	bounds := append(append([]int{0}, cuts...), len(content))
	for i := 0; i+1 < len(bounds); i++ {
		dir := filepath.Join(a.files, "offline-video", fmt.Sprint((int(id)+i*3)%10))
		_ = os.MkdirAll(dir, 0o755)
		name := fmt.Sprintf("%d.%d.%d.v3.exo", id, bounds[i], 1700000000000+i)
		if err := os.WriteFile(filepath.Join(dir, name), content[bounds[i]:bounds[i+1]], 0o644); err != nil {
			a.t.Fatal(err)
		}
	}
}

func (a *legacyApp) download(id, mime, uri string, data any, state, stopReason int, bytesDownloaded int64) {
	raw, _ := json.Marshal(data)
	if _, err := a.db.Exec(`INSERT INTO ExoPlayerDownloads VALUES (?, ?, ?, '', NULL, ?, ?, ?, ?, -1, ?, 0, 100, ?, x'')`,
		id, mime, uri, raw, state, 1000, 2000, stopReason, bytesDownloaded); err != nil {
		a.t.Fatal(err)
	}
}

func (a *legacyApp) pref(file, xmlLine string) { a.prefs[file] = append(a.prefs[file], xmlLine) }

func (a *legacyApp) writePrefs() {
	for file, lines := range a.prefs {
		text := "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    " + strings.Join(lines, "\n    ") + "\n</map>\n"
		if err := os.WriteFile(filepath.Join(a.root, "shared_prefs", file+".xml"), []byte(text), 0o644); err != nil {
			a.t.Fatal(err)
		}
	}
	_ = a.db.Close()
}

func jsonPref(name string, value any) string {
	raw, _ := json.Marshal(value)
	return fmt.Sprintf(`<string name="%s">%s</string>`, name, html.EscapeString(string(raw)))
}

func encryptSegment(t *testing.T, plain, key []byte, sequence uint64) []byte {
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	data := append(append([]byte{}, plain...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	iv := make([]byte, 16)
	binary.BigEndian.PutUint64(iv[8:], sequence)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	out := make([]byte, len(data))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, data)
	return out
}

func startLegacy(t *testing.T, a *legacyApp) *Manager {
	t.Helper()
	m, err := New(Options{Dir: filepath.Join(a.files, "mobile-offline"), Tick: 20 * time.Millisecond, LegacyDir: a.files,
		FreeSpace: func(string) (uint64, error) { return 10 << 30, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	waitFor(t, "legacy import marker", func() bool {
		_, err := os.Stat(filepath.Join(a.files, "mobile-offline", legacyMarker))
		return err == nil
	})
	return m
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestLegacyDownloadsAreTakenOver(t *testing.T) {
	a := newLegacyApp(t)

	// 1. finished MP4 in two cache spans, with a subtitle, descriptions, artwork and a playback position
	mp4Key := "21:5:anime-provider:false:Auto"
	mp4ID := IDFor(mp4Key)
	video := bytes.Repeat([]byte("mp4-video-bytes-"), 400)
	a.cache("https://cdn.example/ep5.mp4", video, 1000)
	a.download(mp4ID, "video/mp4", "https://cdn.example/ep5.mp4", map[string]any{
		"key": mp4Key, "mediaId": 21, "provider": "anime-provider", "episode": "5", "dubbed": false, "quality": "Auto",
		"server": "vidcloud", "title": "One Piece", "url": "https://cdn.example/ep5.mp4", "type": "mp4", "audioLanguage": "ja",
		"order": 100, "episodeTitle": "The Fifth",
		"subtitles": []map[string]any{{"url": "https://cdn.example/ep5.en.vtt", "language": "English", "label": "English", "default": true, "mime": "text/vtt"}},
	}, legacyCompleted, 0, int64(len(video)))
	subtitle := []byte("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n")
	a.cache("https://cdn.example/ep5.en.vtt", subtitle)
	a.download(mp4ID+":sub:0", "text/vtt", "https://cdn.example/ep5.en.vtt", map[string]any{}, legacyCompleted, 0, int64(len(subtitle)))
	coverURL := "https://img.example/cover.png"
	sum := sha256.Sum256([]byte(coverURL))
	cover := hex.EncodeToString(sum[:]) + ".jpg"
	if err := os.WriteFile(filepath.Join(a.files, "offline-artwork", cover), []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}
	a.pref("offline-library-v1", jsonPref(mp4ID, map[string]any{"description": "Pirates.", "coverUrl": coverURL, "coverAsset": cover, "metadataSaved": true, "genres": []string{"Action"}, "year": 1999}))
	a.pref("offline-playback", fmt.Sprintf(`<long name="%s" value="61000" />`, mp4ID))

	// 2. finished HLS: master with a 1080p variant Media3 did not take and the 720p one it took, AES-128 video segments,
	//    a separate Japanese audio rendition
	hlsKey := "166:12:anime-provider:false:720p"
	hlsID := IDFor(hlsKey)
	aesKey := []byte("0123456789abcdef")
	a.cache("https://hls.example/master.m3u8", []byte("#EXTM3U\n"+
		"#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"en\",NAME=\"English\",URI=\"audio/en.m3u8\"\n"+
		"#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"ja\",NAME=\"Japanese\",DEFAULT=YES,URI=\"audio/ja.m3u8\"\n"+
		"#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO=\"aud\"\n1080/index.m3u8\n"+
		"#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO=\"aud\"\n720/index.m3u8\n"))
	a.cache("https://hls.example/720/index.m3u8", []byte("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n"+
		"#EXT-X-KEY:METHOD=AES-128,URI=\"../key.bin\"\n#EXTINF:4,\ns0.ts\n#EXTINF:4,\ns1.ts\n#EXT-X-ENDLIST\n"))
	a.cache("https://hls.example/key.bin", aesKey)
	seg0, seg1 := bytes.Repeat([]byte{0x47, 1}, 300), bytes.Repeat([]byte{0x47, 2}, 250)
	a.cache("https://hls.example/720/s0.ts", encryptSegment(t, seg0, aesKey, 0))
	a.cache("https://hls.example/720/s1.ts", encryptSegment(t, seg1, aesKey, 1), 100)
	a.cache("https://hls.example/audio/ja.m3u8", []byte("#EXTM3U\n#EXTINF:8,\na0.ts\n#EXT-X-ENDLIST\n"))
	audio := bytes.Repeat([]byte{0x47, 9}, 128)
	a.cache("https://hls.example/audio/a0.ts", audio)
	a.download(hlsID, "application/x-mpegURL", "https://hls.example/master.m3u8", map[string]any{
		"key": hlsKey, "mediaId": 166, "provider": "anime-provider", "episode": "12", "quality": "720p", "title": "Frieren",
		"audioLanguage": "ja", "url": "https://hls.example/master.m3u8", "type": "m3u8",
	}, legacyCompleted, 0, 4096)

	// 3. a download that was still running: starts over here (its partial cache data is of no use)
	runningKey := "21:6:anime-provider:false:Auto"
	a.cache("https://cdn.example/ep6.mp4", []byte("partial"))
	a.download(IDFor(runningKey), "video/mp4", "https://cdn.example/ep6.mp4", map[string]any{"key": runningKey, "mediaId": 21, "provider": "anime-provider", "episode": "6"}, 2, 0, 7)

	// 4. a paused batch job that never got a source, and "Wi-Fi only"
	batchKey := "21:7:anime-provider:false:Auto"
	a.pref("episode-batch-queue", jsonPref(IDFor(batchKey), map[string]any{"id": IDFor(batchKey), "key": batchKey, "mediaId": 21, "provider": "anime-provider",
		"episode": "7", "status": "paused", "order": 300, "progress": 0, "position": 0, "bytes": 0, "ready": false}))
	a.pref("episode-downloads", `<boolean name="wifiOnly" value="true" />`)
	a.writePrefs()

	m := startLegacy(t, a)
	dir := filepath.Join(a.files, "mobile-offline")

	mp4 := item(m, mp4ID)
	if mp4.Status != StatusReady || !mp4.Ready || mp4.Files.Video != "video.mp4" || mp4.PositionMs != 61000 || mp4.MediaID != 21 ||
		mp4.Episode != "5" || mp4.Title != "One Piece" || mp4.Description != "Pirates." || mp4.EpisodeTitle != "The Fifth" || mp4.Year != 1999 {
		t.Fatalf("mp4 item: %+v", mp4)
	}
	if got := readFile(t, m.FilePath(mp4ID, "video.mp4")); !bytes.Equal(got, video) {
		t.Fatalf("mp4 video: %d bytes, want %d", len(got), len(video))
	}
	if len(mp4.Files.Subtitles) != 1 || mp4.Files.Subtitles[0].Language != "en" || !mp4.Files.Subtitles[0].Default ||
		!bytes.Equal(readFile(t, m.FilePath(mp4ID, mp4.Files.Subtitles[0].File)), subtitle) {
		t.Fatalf("mp4 subtitles: %+v", mp4.Files.Subtitles)
	}
	if mp4.CoverAsset != cover || m.ArtworkPath(cover) == "" {
		t.Fatalf("artwork not taken over: %q", mp4.CoverAsset)
	}

	hls := item(m, hlsID)
	if hls.Status != StatusReady || hls.Files.Video != "video.ts" || hls.Files.Audio != "audio.ts" {
		t.Fatalf("hls item: %+v", hls)
	}
	if got := readFile(t, m.FilePath(hlsID, "video.ts")); !bytes.Equal(got, append(append([]byte{}, seg0...), seg1...)) {
		t.Fatalf("hls video: %d bytes", len(got))
	}
	if got := readFile(t, m.FilePath(hlsID, "audio.ts")); !bytes.Equal(got, audio) {
		t.Fatalf("hls audio: %d bytes", len(got))
	}

	if s := statusOf(m, IDFor(runningKey)); s != StatusQueued {
		t.Fatalf("running download: %s, want queued", s)
	}
	if b := item(m, IDFor(batchKey)); b.Status != StatusPaused || b.Provider != "anime-provider" || b.Episode != "7" {
		t.Fatalf("batch job: %+v", b)
	}
	if !m.Snapshot().WifiOnly {
		t.Fatal("Wi-Fi only not taken over")
	}

	// everything finished was taken over: the old cache and artwork are gone, the marker says done
	for _, old := range []string{"offline-video", "offline-artwork"} {
		if _, err := os.Stat(filepath.Join(a.files, old)); !os.IsNotExist(err) {
			t.Fatalf("%s still there (%v)", old, err)
		}
	}
	var marker legacyResult
	_ = json.Unmarshal(readFile(t, filepath.Join(dir, legacyMarker)), &marker)
	if !marker.Done || marker.Items[mp4ID] != "imported" || marker.Items[hlsID] != "imported" {
		t.Fatalf("marker: %+v", marker)
	}

	// a restart neither imports twice nor touches the items
	m.Close()
	m2, err := New(Options{Dir: dir, Tick: 20 * time.Millisecond, LegacyDir: a.files, FreeSpace: func(string) (uint64, error) { return 10 << 30, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer m2.Close()
	if n := len(m2.Snapshot().Items); n != 4 {
		t.Fatalf("after restart: %d items, want 4", n)
	}
	if got := item(m2, mp4ID); got.PositionMs != 61000 || got.Status != StatusReady {
		t.Fatalf("after restart: %+v", got)
	}
}

func TestLegacyDownloadWithMissingDataFailsAndKeepsTheOldCache(t *testing.T) {
	a := newLegacyApp(t)
	key := "21:8:anime-provider:false:Auto"
	content := bytes.Repeat([]byte("x"), 3000)
	a.cache("https://cdn.example/ep8.mp4", content, 1000, 2000)
	// a span went missing
	_ = filepath.WalkDir(filepath.Join(a.files, "offline-video"), func(path string, d os.DirEntry, err error) error {
		if err == nil && strings.Contains(d.Name(), ".1000.") {
			_ = os.Remove(path)
		}
		return nil
	})
	a.download(IDFor(key), "video/mp4", "https://cdn.example/ep8.mp4", map[string]any{"key": key, "mediaId": 21, "provider": "anime-provider", "episode": "8"}, legacyCompleted, 0, 3000)
	a.writePrefs()

	m := startLegacy(t, a)
	got := item(m, IDFor(key))
	if got.Status != StatusFailed || got.Ready || got.Failure != FailureUnknown || got.Provider != "anime-provider" {
		t.Fatalf("item: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(a.files, "mobile-offline", "episodes", IDFor(key))); !os.IsNotExist(err) {
		t.Fatalf("half episode left behind (%v)", err)
	}
	if _, err := os.Stat(filepath.Join(a.files, "offline-video")); err != nil {
		t.Fatalf("old cache removed although an episode failed: %v", err)
	}
}

func TestLegacyImportWaitsForSpace(t *testing.T) {
	a := newLegacyApp(t)
	key := "21:9:anime-provider:false:Auto"
	a.cache("https://cdn.example/ep9.mp4", bytes.Repeat([]byte("y"), 2048))
	a.download(IDFor(key), "video/mp4", "https://cdn.example/ep9.mp4", map[string]any{"key": key, "episode": "9"}, legacyCompleted, 0, 2048)
	a.writePrefs()

	dir := filepath.Join(a.files, "mobile-offline")
	m, err := New(Options{Dir: dir, Tick: 20 * time.Millisecond, LegacyDir: a.files, FreeSpace: func(string) (uint64, error) { return 100 << 20, nil }})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "marker", func() bool { _, err := os.Stat(filepath.Join(dir, legacyMarker)); return err == nil })
	m.Close()
	if n := len(m.Snapshot().Items); n != 0 {
		t.Fatalf("%d items without space, want 0", n)
	}

	m2 := startLegacyAgain(t, a)
	if s := statusOf(m2, IDFor(key)); s != StatusReady {
		t.Fatalf("after space came back: %s", s)
	}
}

func startLegacyAgain(t *testing.T, a *legacyApp) *Manager {
	dir := filepath.Join(a.files, "mobile-offline")
	m, err := New(Options{Dir: dir, Tick: 20 * time.Millisecond, LegacyDir: a.files, FreeSpace: func(string) (uint64, error) { return 10 << 30, nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	waitFor(t, "import done", func() bool {
		var marker legacyResult
		data, _ := os.ReadFile(filepath.Join(dir, legacyMarker))
		return json.Unmarshal(data, &marker) == nil && marker.Done
	})
	return m
}

func TestNoLegacyAppNothingHappens(t *testing.T) {
	files := filepath.Join(t.TempDir(), "files")
	m, err := New(Options{Dir: filepath.Join(files, "mobile-offline"), Tick: 20 * time.Millisecond, LegacyDir: files,
		FreeSpace: func(string) (uint64, error) { return 10 << 30, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	waitFor(t, "marker", func() bool { _, err := os.Stat(filepath.Join(files, "mobile-offline", legacyMarker)); return err == nil })
	if s := m.Snapshot(); len(s.Items) != 0 || s.WifiOnly {
		t.Fatalf("snapshot: %+v", s)
	}
}
