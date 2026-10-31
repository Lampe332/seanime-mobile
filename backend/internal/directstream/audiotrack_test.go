package directstream

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"seanime/internal/mkvparser"
	"seanime/internal/player"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTrackPatches(t *testing.T) {
	info := &player.PlaybackInfo{MkvMetadata: &mkvparser.Metadata{
		AudioTracks: []*mkvparser.TrackInfo{
			{Number: 2, TypeOffset: 100, CodecIDOffset: 110},
			{Number: 3, TypeOffset: 200, CodecIDOffset: 210},
		},
		SubtitleTracks: []*mkvparser.TrackInfo{
			{Number: 4, TypeOffset: 300, CodecIDOffset: 310},
			{Number: 5, TypeOffset: 400},
		},
	}}
	patches := func(query string) map[int64]byte {
		return trackPatches(httptest.NewRequest(http.MethodGet, "/stream?id=x"+query, nil), info)
	}

	require.Equal(t, map[int64]byte{100: skippedTrackType, 110: skippedCodecStart}, patches("&audioTrack=3"))
	require.Equal(t, map[int64]byte{300: skippedTrackType, 310: skippedCodecStart}, patches("&subtitleTrack=5"))
	// Both at once, and -1 for no subtitles at all
	require.Equal(t, map[int64]byte{200: skippedTrackType, 210: skippedCodecStart, 300: skippedTrackType, 310: skippedCodecStart, 400: skippedTrackType},
		patches("&audioTrack=2&subtitleTrack=-1"))

	// No choice, an unknown track or no metadata leave the stream untouched
	require.Nil(t, patches(""))
	require.Nil(t, patches("&audioTrack=9&subtitleTrack=9"))
	require.Nil(t, trackPatches(httptest.NewRequest(http.MethodGet, "/stream?audioTrack=3", nil), &player.PlaybackInfo{}))
}

func TestPatchWriterUsesTheRangeOffset(t *testing.T) {
	file := bytes.Repeat([]byte{2}, 1000)
	rec := httptest.NewRecorder()
	w := &patchWriter{ResponseWriter: rec, patches: map[int64]byte{100: skippedTrackType, 900: skippedTrackType}}

	w.Header().Set("Content-Range", "bytes 50-349/1000")
	w.WriteHeader(http.StatusPartialContent)
	// Written in two chunks, the patched byte in the second one
	_, _ = w.Write(file[50:120])
	_, _ = w.Write(file[120:350])

	body := rec.Body.Bytes()
	require.Len(t, body, 300)
	require.Equal(t, byte(skippedTrackType), body[100-50])
	require.Equal(t, byte(2), body[99-50])
	require.Equal(t, byte(2), file[100], "the source buffer stays unchanged")
}

func TestPatchWriterLeavesMultipartAlone(t *testing.T) {
	rec := httptest.NewRecorder()
	w := &patchWriter{ResponseWriter: rec, patches: map[int64]byte{0: skippedTrackType}}
	w.Header().Set("Content-Type", "multipart/byteranges; boundary=x")
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write([]byte{2, 2})
	require.Equal(t, []byte{2, 2}, rec.Body.Bytes())
}
