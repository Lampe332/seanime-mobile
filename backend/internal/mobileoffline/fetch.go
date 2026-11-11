package mobileoffline

import (
	"bufio"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const userAgent = "Mozilla/5.0 SeanimeMobile/3.0"

// fetcher downloads from providers. It sends the provider's own headers and never anything of the app (no server
// token, no cookies): sources and their iframes are foreign.
type fetcher struct {
	client  *http.Client
	headers map[string]string
}

func (f *fetcher) get(ctx context.Context, rawURL string, rangeFrom int64) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	for k, v := range f.headers {
		req.Header.Set(k, v)
	}
	if rangeFrom > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(rangeFrom, 10)+"-")
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, &HTTPError{Status: resp.StatusCode}
	}
	return resp, nil
}

func (f *fetcher) bytes(ctx context.Context, rawURL string, limit int64) ([]byte, error) {
	resp, err := f.get(ctx, rawURL, 0)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("response too large")
	}
	return data, nil
}

// ValidURL accepts http(s) URLs with a host.
func ValidURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// providerURL turns a source URL into what the server downloads directly. URLs of the server's own /api/v1/proxy
// (sources that need headers) are unwrapped into the provider URL and its headers; other loopback URLs are refused, so a
// download can never reach the server's own routes.
func providerURL(raw string, headers map[string]string) (string, map[string]string, error) {
	u, err := url.Parse(raw)
	if err != nil || !ValidURL(raw) {
		return "", nil, errors.New("invalid source URL")
	}
	if !serverHost(u.Hostname()) {
		return raw, headers, nil
	}
	if u.Path != "/api/v1/proxy" {
		return "", nil, errors.New("local URLs cannot be downloaded")
	}
	inner := u.Query().Get("url")
	if !ValidURL(inner) {
		return "", nil, errors.New("invalid proxied URL")
	}
	if innerURL, _ := url.Parse(inner); serverHost(innerURL.Hostname()) {
		return "", nil, errors.New("local URLs cannot be downloaded")
	}
	merged := map[string]string{}
	if h := u.Query().Get("headers"); h != "" {
		if err := json.Unmarshal([]byte(h), &merged); err != nil {
			return "", nil, errors.New("invalid proxied headers")
		}
	}
	for k, v := range headers {
		merged[k] = v
	}
	return inner, merged, nil
}

// serverHost tells hosts of the phone itself apart; tests narrow it so their provider fixtures on 127.0.0.1 count as
// foreign.
var serverHost = isLoopback

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

// progress reports downloaded bytes of the current file and how far the episode is (0..1).
type progress func(bytes int64, fraction float64)

var contentRangeTotal = regexp.MustCompile(`/(\d+)$`)

// downloadFile downloads a progressive file (mp4) into path, continuing a partial file with a byte range. A server that
// ignores the range, or a re-resolved source of another size than knownTotal, starts it over. Returns the file size.
func (f *fetcher) downloadFile(ctx context.Context, rawURL, path string, knownTotal int64, onTotal func(int64), report progress) (int64, error) {
	var have int64
	if info, err := os.Stat(path); err == nil {
		have = info.Size()
	}
	resp, err := f.get(ctx, rawURL, have)
	if err != nil {
		var httpErr *HTTPError
		// 416: the partial file is already complete (or the source changed); start over once
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusRequestedRangeNotSatisfiable && have > 0 {
			_ = os.Remove(path)
			return f.downloadFile(ctx, rawURL, path, 0, onTotal, report)
		}
		return 0, err
	}
	defer resp.Body.Close()
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if resp.StatusCode != http.StatusPartialContent {
		have = 0
		flags = os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	}
	total := int64(-1)
	if resp.ContentLength >= 0 {
		total = have + resp.ContentLength
	}
	if m := contentRangeTotal.FindStringSubmatch(resp.Header.Get("Content-Range")); m != nil {
		total, _ = strconv.ParseInt(m[1], 10, 64)
	}
	if have > 0 && knownTotal > 0 && total != knownTotal {
		// another file than the partial one
		resp.Body.Close()
		_ = os.Remove(path)
		return f.downloadFile(ctx, rawURL, path, 0, onTotal, report)
	}
	if total > 0 {
		onTotal(total)
	}
	out, err := os.OpenFile(path, flags, 0o644)
	if err != nil {
		return 0, err
	}
	defer out.Close()
	written := have
	buffer := make([]byte, 128*1024)
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			if _, err := out.Write(buffer[:n]); err != nil {
				return written, err
			}
			written += int64(n)
			fraction := 0.0
			if total > 0 {
				fraction = float64(written) / float64(total)
			}
			report(written, fraction)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return written, readErr
		}
	}
	if total > 0 && written != total {
		return written, io.ErrUnexpectedEOF
	}
	return written, nil
}

// --- HLS ---

type variant struct {
	uri       string
	bandwidth int
	height    int
	audio     string
}

type rendition struct {
	group, language, name, uri string
	isDefault                  bool
}

type segment struct {
	uri            string
	offset, length int64 // byte range; length 0: the whole resource
	key            *segmentKey
	sequence       uint64
}

type segmentKey struct {
	uri string
	iv  []byte // nil: the media sequence number
}

type mediaPlaylist struct {
	init     *segment
	segments []segment
}

var attributePattern = regexp.MustCompile(`([A-Z0-9-]+)=("[^"]*"|[^,]*)`)

func attributes(line string) map[string]string {
	result := map[string]string{}
	if i := strings.Index(line, ":"); i >= 0 {
		line = line[i+1:]
	}
	for _, m := range attributePattern.FindAllStringSubmatch(line, -1) {
		result[m[1]] = strings.Trim(m[2], `"`)
	}
	return result
}

func resolveRef(base *url.URL, ref string) (string, error) {
	r, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return "", err
	}
	return base.ResolveReference(r).String(), nil
}

// parseMaster returns the variants and audio renditions of a master playlist; no variants means a media playlist.
func parseMaster(base *url.URL, text string) ([]variant, []rendition) {
	var variants []variant
	var renditions []rendition
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	var pending *variant
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case strings.HasPrefix(line, "#EXT-X-STREAM-INF"):
			a := attributes(line)
			v := variant{audio: a["AUDIO"]}
			v.bandwidth, _ = strconv.Atoi(a["BANDWIDTH"])
			if res := strings.Split(a["RESOLUTION"], "x"); len(res) == 2 {
				v.height, _ = strconv.Atoi(res[1])
			}
			pending = &v
		case strings.HasPrefix(line, "#EXT-X-MEDIA:"):
			a := attributes(line)
			if a["TYPE"] != "AUDIO" || a["URI"] == "" {
				continue
			}
			uri, err := resolveRef(base, a["URI"])
			if err != nil {
				continue
			}
			renditions = append(renditions, rendition{group: a["GROUP-ID"], language: a["LANGUAGE"], name: a["NAME"], uri: uri, isDefault: a["DEFAULT"] == "YES"})
		case line != "" && !strings.HasPrefix(line, "#") && pending != nil:
			if uri, err := resolveRef(base, line); err == nil {
				pending.uri = uri
				variants = append(variants, *pending)
			}
			pending = nil
		}
	}
	return variants, renditions
}

// pickVariant takes the best variant up to maxHeight (the lowest one when all are higher); unknown heights count as fitting.
func pickVariant(variants []variant, maxHeight int) variant {
	sorted := append([]variant(nil), variants...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].height != sorted[j].height {
			return sorted[i].height > sorted[j].height
		}
		return sorted[i].bandwidth > sorted[j].bandwidth
	})
	for _, v := range sorted {
		if v.height <= maxHeight {
			return v
		}
	}
	return sorted[len(sorted)-1]
}

// pickAudio picks the rendition of group in language (ja/de), else the default one, else the first.
func pickAudio(renditions []rendition, group, lang string) *rendition {
	var candidates []rendition
	for _, r := range renditions {
		if r.group == group {
			candidates = append(candidates, r)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	for _, r := range candidates {
		if SubtitleLanguage(r.language) == lang || SubtitleLanguage(r.name) == lang {
			return &r
		}
	}
	for _, r := range candidates {
		if r.isDefault {
			return &r
		}
	}
	return &candidates[0]
}

func parseMedia(base *url.URL, text string) (*mediaPlaylist, error) {
	playlist := &mediaPlaylist{}
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	var key *segmentKey
	var sequence uint64
	var pendingRange *[2]int64
	lastEnd := map[string]int64{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case strings.HasPrefix(line, "#EXT-X-MEDIA-SEQUENCE:"):
			sequence, _ = strconv.ParseUint(strings.TrimPrefix(line, "#EXT-X-MEDIA-SEQUENCE:"), 10, 64)
		case strings.HasPrefix(line, "#EXT-X-KEY:"):
			a := attributes(line)
			switch a["METHOD"] {
			case "NONE":
				key = nil
			case "AES-128":
				uri, err := resolveRef(base, a["URI"])
				if err != nil {
					return nil, err
				}
				key = &segmentKey{uri: uri}
				if iv := a["IV"]; iv != "" {
					raw, err := hex.DecodeString(strings.TrimPrefix(strings.TrimPrefix(iv, "0x"), "0X"))
					if err != nil || len(raw) != 16 {
						return nil, errors.New("invalid HLS IV")
					}
					key.iv = raw
				}
			default:
				// SAMPLE-AES and DRM cannot be saved as a plain file
				return nil, errUnavailable
			}
		case strings.HasPrefix(line, "#EXT-X-MAP:"):
			a := attributes(line)
			uri, err := resolveRef(base, a["URI"])
			if err != nil {
				return nil, err
			}
			init := &segment{uri: uri}
			if br := a["BYTERANGE"]; br != "" {
				init.length, init.offset = byteRange(br, 0)
			}
			playlist.init = init
		case strings.HasPrefix(line, "#EXT-X-BYTERANGE:"):
			length, offset := byteRange(strings.TrimPrefix(line, "#EXT-X-BYTERANGE:"), -1)
			pendingRange = &[2]int64{length, offset}
		case line != "" && !strings.HasPrefix(line, "#"):
			uri, err := resolveRef(base, line)
			if err != nil {
				return nil, err
			}
			s := segment{uri: uri, key: key, sequence: sequence}
			if pendingRange != nil {
				s.length, s.offset = pendingRange[0], pendingRange[1]
				if s.offset < 0 {
					s.offset = lastEnd[uri]
				}
				lastEnd[uri] = s.offset + s.length
				pendingRange = nil
			}
			playlist.segments = append(playlist.segments, s)
			sequence++
		}
	}
	if len(playlist.segments) == 0 {
		return nil, errUnavailable
	}
	return playlist, nil
}

// byteRange parses "length[@offset]"; offset is fallback when missing.
func byteRange(value string, fallback int64) (int64, int64) {
	parts := strings.SplitN(value, "@", 2)
	length, _ := strconv.ParseInt(parts[0], 10, 64)
	offset := fallback
	if len(parts) == 2 {
		offset, _ = strconv.ParseInt(parts[1], 10, 64)
	}
	return length, offset
}

func (f *fetcher) segmentBytes(ctx context.Context, s segment, keys map[string][]byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	for k, v := range f.headers {
		req.Header.Set(k, v)
	}
	if s.length > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", s.offset, s.offset+s.length-1))
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, &HTTPError{Status: resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<20))
	if err != nil {
		return nil, err
	}
	if s.length > 0 && resp.StatusCode == http.StatusOK && int64(len(data)) >= s.offset+s.length {
		data = data[s.offset : s.offset+s.length]
	}
	if s.key == nil {
		return data, nil
	}
	key, ok := keys[s.key.uri]
	if !ok {
		key, err = f.bytes(ctx, s.key.uri, 64)
		if err != nil {
			return nil, err
		}
		if len(key) != 16 {
			return nil, errUnavailable
		}
		keys[s.key.uri] = key
	}
	return decryptAES128(data, key, s.key.iv, s.sequence)
}

func decryptAES128(data, key, iv []byte, sequence uint64) ([]byte, error) {
	if len(data) == 0 || len(data)%aes.BlockSize != 0 {
		return nil, errors.New("invalid encrypted segment")
	}
	if iv == nil {
		iv = make([]byte, 16)
		binary.BigEndian.PutUint64(iv[8:], sequence)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	out := make([]byte, len(data))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, data)
	pad := int(out[len(out)-1])
	if pad == 0 || pad > aes.BlockSize || pad > len(out) {
		return nil, errors.New("invalid segment padding")
	}
	return out[:len(out)-pad], nil
}

// hlsState is how far an HLS file got: segments written and the file size after the last whole one.
type hlsState struct {
	Segments int   `json:"segments"`
	Bytes    int64 `json:"bytes"`
}

// downloadPlaylist writes the segments of a media playlist one after another into path (MPEG-TS segments make a .ts
// file, fMP4 segments after their init segment an .mp4 file; both play as one file). It continues after state.Segments
// and calls save after every whole segment, so a restart loses at most one segment.
func (f *fetcher) downloadPlaylist(ctx context.Context, playlist *mediaPlaylist, path string, state *hlsState, save func(), report func(done, total int, bytes int64)) error {
	flags := os.O_CREATE | os.O_WRONLY
	if state.Segments == 0 {
		flags |= os.O_TRUNC
		state.Bytes = 0
	}
	out, err := os.OpenFile(path, flags, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	// cut a segment that was half written when the download stopped
	if err := out.Truncate(state.Bytes); err != nil {
		return err
	}
	if _, err := out.Seek(state.Bytes, io.SeekStart); err != nil {
		return err
	}
	keys := map[string][]byte{}
	if playlist.init != nil && state.Segments == 0 {
		data, err := f.segmentBytes(ctx, *playlist.init, keys)
		if err != nil {
			return err
		}
		if _, err := out.Write(data); err != nil {
			return err
		}
		state.Bytes += int64(len(data))
	}
	total := len(playlist.segments)
	for i := state.Segments; i < total; i++ {
		data, err := f.segmentBytes(ctx, playlist.segments[i], keys)
		if err != nil {
			return err
		}
		if _, err := out.Write(data); err != nil {
			return err
		}
		state.Segments = i + 1
		state.Bytes += int64(len(data))
		save()
		report(state.Segments, total, state.Bytes)
	}
	return nil
}
