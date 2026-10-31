package directstream

import (
	"fmt"
	"net/http"
	"seanime/internal/mkvparser"
	"seanime/internal/player"
	"slices"
	"strconv"
	"strings"
)

// Browsers without the audioTracks API (the Android WebView) play the first audio track they can decode and cannot
// switch, and TVs the stream is cast to pick their own tracks. So the stream can leave only the chosen tracks:
// ?audioTrack=<number> and ?subtitleTrack=<number> (-1: no subtitles) turn the other tracks of that kind into control
// tracks with an unknown codec, which demuxers skip (LG TVs go by the codec for audio, not by the type). Only single
// bytes change, so sizes, offsets and seeking stay as they are.
const (
	skippedTrackType  = 0x20
	skippedCodecStart = 'X' // "A_OPUS" → "X_OPUS"
)

// trackPatches returns the bytes to replace in the stream for the requested tracks, or nil.
func trackPatches(r *http.Request, info *player.PlaybackInfo) map[int64]byte {
	if info == nil || info.MkvMetadata == nil {
		return nil
	}
	patches := make(map[int64]byte)
	hideOthers(patches, info.MkvMetadata.AudioTracks, r.URL.Query().Get("audioTrack"))
	hideOthers(patches, info.MkvMetadata.SubtitleTracks, r.URL.Query().Get("subtitleTrack"))
	if len(patches) == 0 {
		return nil
	}
	return patches
}

// hideOthers hides every track but the [selected] one; -1 hides all, an unknown track none.
func hideOthers(patches map[int64]byte, tracks []*mkvparser.TrackInfo, selected string) {
	number, err := strconv.ParseInt(selected, 10, 64)
	if err != nil || (number != -1 && !slices.ContainsFunc(tracks, func(t *mkvparser.TrackInfo) bool { return t.Number == number })) {
		return
	}
	for _, track := range tracks {
		if track.Number == number {
			continue
		}
		if track.TypeOffset > 0 {
			patches[track.TypeOffset] = skippedTrackType
		}
		if track.CodecIDOffset > 0 {
			patches[track.CodecIDOffset] = skippedCodecStart
		}
	}
}

// patchWriter replaces single bytes of the response by their file offset.
type patchWriter struct {
	http.ResponseWriter
	patches map[int64]byte
	pos     int64 // file offset of the next byte written
}

func (w *patchWriter) WriteHeader(code int) {
	if strings.HasPrefix(w.Header().Get("Content-Type"), "multipart/") {
		// Several ranges in one body have no single start offset; players never ask for them
		w.patches = nil
	}
	if code == http.StatusPartialContent {
		var start, end, size int64
		if _, err := fmt.Sscanf(w.Header().Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &size); err == nil {
			w.pos = start
		}
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *patchWriter) Write(p []byte) (int, error) {
	end := w.pos + int64(len(p))
	var out []byte
	for offset, value := range w.patches {
		if offset < w.pos || offset >= end {
			continue
		}
		if out == nil {
			// The caller may reuse p
			out = append([]byte(nil), p...)
		}
		out[offset-w.pos] = value
	}
	if out == nil {
		out = p
	}
	n, err := w.ResponseWriter.Write(out)
	w.pos += int64(n)
	return n, err
}

func (w *patchWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *patchWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
