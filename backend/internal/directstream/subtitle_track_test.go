package directstream

import (
	"context"
	"os"
	"seanime/internal/mkvparser"
	"seanime/internal/util"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildAssSubtitleFile(t *testing.T) {
	header := "[Script Info]\r\nScriptType: v4.00+\r\n\r\n[V4+ Styles]\r\nStyle: Default,Arial,48\r\n\r\n[Events]\r\n" + assEventsFormat + "\r\n\x00"
	events := []*mkvparser.SubtitleEvent{
		{TrackNumber: 4, Text: "Second\nline", StartTime: 5000, Duration: 2500, ExtraData: map[string]string{"layer": "0", "style": "Default", "marginv": "12"}},
		{TrackNumber: 4, Text: "{\\an8}First", StartTime: 0, Duration: 5000, ExtraData: map[string]string{"layer": "1", "style": "Top", "name": "Senku"}},
		// the same line again (cluster edge)
		{TrackNumber: 4, Text: "Second\nline", StartTime: 5000, Duration: 2500, ExtraData: map[string]string{"layer": "0", "style": "Default", "marginv": "12"}},
		// no duration: stays the fallback length
		{TrackNumber: 4, Text: "Last", StartTime: 3_723_450},
	}

	got := buildAssSubtitleFile(header, events)

	assert.Equal(t, "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nStyle: Default,Arial,48\n\n[Events]\n"+assEventsFormat+"\n"+
		"Dialogue: 1,0:00:00.00,0:00:05.00,Top,Senku,0,0,0,,{\\an8}First\n"+
		"Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,12,,Second\\Nline\n"+
		"Dialogue: 0,1:02:03.45,1:02:08.45,Default,,0,0,0,,Last\n", got)
	assert.Equal(t, mkvparser.SubtitleTypeASS, mkvparser.DetectSubtitleType(got))
}

func TestBuildAssSubtitleFileAddsMissingEventsSection(t *testing.T) {
	got := buildAssSubtitleFile("[Script Info]\nScriptType: v4.00+", []*mkvparser.SubtitleEvent{{Text: "Hi", StartTime: 1000, Duration: 1000}})
	assert.Equal(t, "[Script Info]\nScriptType: v4.00+\n\n[Events]\n"+assEventsFormat+"\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi\n", got)
}

func TestBuildSrtSubtitleFile(t *testing.T) {
	got := buildSrtSubtitleFile([]*mkvparser.SubtitleEvent{
		{Text: "Two\r\nlines", StartTime: 61_005, Duration: 1_500},
		{Text: "One", StartTime: 1_000, Duration: 2_000},
	})
	assert.Equal(t, "1\n00:00:01,000 --> 00:00:03,000\nOne\n\n2\n00:01:01,005 --> 00:01:02,505\nTwo\nlines\n\n", got)
}

func TestSubtitleTrackFileFormat(t *testing.T) {
	assert.Equal(t, "ass", subtitleTrackFileFormat("S_TEXT/ASS"))
	assert.Equal(t, "ass", subtitleTrackFileFormat("s_text/ssa"))
	assert.Equal(t, "srt", subtitleTrackFileFormat("S_TEXT/UTF8"))
	assert.Equal(t, "", subtitleTrackFileFormat("S_HDMV/PGS"))
}

// The format test file with two ASS tracks (D:\Anime\_Formattest\gen\07_2ton_2ass.mkv, the S22's "Dr. STONE - 03");
// skipped where it does not exist.
func TestExtractSubtitleTrackFileFromMkv(t *testing.T) {
	path := os.Getenv("SEANIME_TEST_TWO_ASS_MKV")
	if path == "" {
		path = `D:\Anime\_Formattest\gen\07_2ton_2ass.mkv`
	}
	if _, err := os.Stat(path); err != nil {
		t.Skip("test file not found")
	}

	metaFile, err := os.Open(path)
	require.NoError(t, err)
	defer metaFile.Close()
	parser := mkvparser.NewMetadataParser(metaFile, util.NewLogger())
	metadata := parser.GetMetadata(context.Background())
	require.NoError(t, metadata.Error)
	require.Len(t, metadata.SubtitleTracks, 2)

	german := metadata.SubtitleTracks[1]
	reader, err := os.Open(path)
	require.NoError(t, err)
	defer reader.Close()

	got, err := extractSubtitleTrackFile(context.Background(), parser, reader, german)
	require.NoError(t, err)
	assert.Contains(t, got, "[V4+ Styles]")
	assert.Contains(t, got, "Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,DE Untertitel 0 s\n")
	assert.Contains(t, got, "Dialogue: 0,0:00:35.00,0:00:40.00,Default,,0,0,0,,DE Untertitel 35 s\n")
	assert.Equal(t, 8, strings.Count(got, "Dialogue: "))
	assert.NotContains(t, got, "ENG Untertitel")
}
