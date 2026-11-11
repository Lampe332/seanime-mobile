package directstream

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"seanime/internal/mkvparser"
	"sort"
	"strings"
)

// Short codes the native player turns into a message (subtitle translation).
var (
	ErrSubtitleNoStream      = errors.New("no-stream")
	ErrSubtitleNoTrack       = errors.New("no-subtitle-track")
	ErrSubtitleTrackNotText  = errors.New("unsupported-format")
	ErrSubtitleTrackNoLines  = errors.New("no-subtitle-lines")
	ErrSubtitleReaderMissing = errors.New("no-stream-reader")
)

const (
	assEventsFormat = "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
	// a line whose end the file never told (the last one of a track without durations) stays this long
	fallbackSubtitleDurationMs = 5000
)

// SubtitleTrackFile reads one embedded text subtitle track of the current stream from start to end and returns it as a
// subtitle file: an ASS/SSA track keeps its header and styles, a plain text track becomes SRT.
// The native player renders embedded tracks with mpv, which cannot hand out their text; the translation needs the file.
func (m *Manager) SubtitleTrackFile(ctx context.Context, trackNumber int64) (string, error) {
	m.playbackMu.Lock()
	stream, ok := m.currentStream.Get()
	m.playbackMu.Unlock()
	if !ok {
		return "", ErrSubtitleNoStream
	}

	info, err := stream.LoadPlaybackInfo()
	if err != nil || info == nil || info.MkvMetadata == nil {
		return "", ErrSubtitleNoTrack
	}
	track := info.MkvMetadata.GetTrackByNumber(trackNumber)
	if track == nil || !track.IsSubtitleTrack() {
		return "", ErrSubtitleNoTrack
	}
	parser, ok := info.MkvMetadataParser.Get()
	if !ok {
		return "", ErrSubtitleNoTrack
	}

	reader, err := subtitleFileReader(stream)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	return extractSubtitleTrackFile(ctx, parser, reader, track)
}

// subtitleFileReader opens a fresh reader on the stream, the same kind the subtitle streams use (stream.go).
func subtitleFileReader(stream Stream) (io.ReadSeekCloser, error) {
	switch s := stream.(type) {
	case *LocalFileStream:
		return s.newReader()
	case *TorrentStream:
		return s.newSubtitleReader(), nil
	case *DebridStream:
		return s.newMetadataReader()
	case *UrlStream:
		return s.newMetadataReader()
	case *Nakama:
		return s.newMetadataReader()
	}
	return nil, ErrSubtitleReaderMissing
}

// extractSubtitleTrackFile collects every event of the track and writes the file.
func extractSubtitleTrackFile(ctx context.Context, parser *mkvparser.MetadataParser, reader io.ReadSeekCloser, track *mkvparser.TrackInfo) (string, error) {
	format := subtitleTrackFileFormat(track.CodecID)
	if format == "" {
		return "", ErrSubtitleTrackNotText
	}

	events, errCh, _ := parser.ExtractSubtitles(ctx, reader, 0, 0, 0)
	collected := make([]*mkvparser.SubtitleEvent, 0, 512)
	for event := range events {
		if event != nil && event.TrackNumber == uint64(track.Number) {
			collected = append(collected, event)
		}
	}
	if err := <-errCh; err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if len(collected) == 0 {
		return "", ErrSubtitleTrackNoLines
	}

	if format == "ass" {
		return buildAssSubtitleFile(track.CodecPrivate, collected), nil
	}
	return buildSrtSubtitleFile(collected), nil
}

// subtitleTrackFileFormat: "ass" for ASS/SSA tracks, "srt" for plain text ones, "" for image tracks (PGS, VobSub).
func subtitleTrackFileFormat(codecID string) string {
	switch strings.ToUpper(strings.TrimSpace(codecID)) {
	case "S_TEXT/ASS", "S_TEXT/SSA", "S_ASS", "S_SSA":
		return "ass"
	case "S_TEXT/UTF8", "S_TEXT/ASCII", "S_TEXT/WEBVTT":
		return "srt"
	}
	return ""
}

// orderedSubtitleEvents sorts by start and drops repeats (the parser can send a line twice around a cluster edge).
func orderedSubtitleEvents(events []*mkvparser.SubtitleEvent) []*mkvparser.SubtitleEvent {
	ret := make([]*mkvparser.SubtitleEvent, 0, len(events))
	seen := make(map[string]struct{}, len(events))
	for _, event := range events {
		key := fmt.Sprintf("%.0f|%s|%s", event.StartTime, event.ExtraData["layer"], event.Text)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		ret = append(ret, event)
	}
	sort.SliceStable(ret, func(i, j int) bool { return ret[i].StartTime < ret[j].StartTime })
	return ret
}

func subtitleEventEndMs(event *mkvparser.SubtitleEvent) float64 {
	if event.Duration > 0 {
		return event.StartTime + event.Duration
	}
	return event.StartTime + fallbackSubtitleDurationMs
}

// buildAssSubtitleFile writes the track's own header (CodecPrivate) and one Dialogue line per event.
func buildAssSubtitleFile(codecPrivate string, events []*mkvparser.SubtitleEvent) string {
	header := strings.TrimRight(strings.ReplaceAll(codecPrivate, "\r\n", "\n"), "\x00 \n")
	if !strings.Contains(header, "[Events]") {
		header += "\n\n[Events]\n" + assEventsFormat
	} else if !strings.Contains(header[strings.Index(header, "[Events]"):], "Format:") {
		header += "\n" + assEventsFormat
	}

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	for _, event := range orderedSubtitleEvents(events) {
		extra := event.ExtraData
		b.WriteString("Dialogue: ")
		b.WriteString(strings.Join([]string{
			valueOr(extra["layer"], "0"),
			assTime(event.StartTime),
			assTime(subtitleEventEndMs(event)),
			valueOr(extra["style"], "Default"),
			extra["name"],
			valueOr(extra["marginl"], "0"),
			valueOr(extra["marginr"], "0"),
			valueOr(extra["marginv"], "0"),
			extra["effect"],
			strings.ReplaceAll(strings.ReplaceAll(event.Text, "\r\n", "\\N"), "\n", "\\N"),
		}, ","))
		b.WriteString("\n")
	}
	return b.String()
}

// buildSrtSubtitleFile writes a numbered SRT file.
func buildSrtSubtitleFile(events []*mkvparser.SubtitleEvent) string {
	var b strings.Builder
	for i, event := range orderedSubtitleEvents(events) {
		text := strings.TrimSpace(strings.ReplaceAll(event.Text, "\r\n", "\n"))
		if text == "" {
			continue
		}
		fmt.Fprintf(&b, "%d\n%s --> %s\n%s\n\n", i+1, srtTime(event.StartTime), srtTime(subtitleEventEndMs(event)), text)
	}
	return b.String()
}

func valueOr(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// assTime: h:mm:ss.cc
func assTime(ms float64) string {
	cs := int64(math.Round(math.Max(ms, 0) / 10))
	return fmt.Sprintf("%d:%02d:%02d.%02d", cs/360000, cs/6000%60, cs/100%60, cs%100)
}

// srtTime: hh:mm:ss,mmm
func srtTime(ms float64) string {
	total := int64(math.Round(math.Max(ms, 0)))
	return fmt.Sprintf("%02d:%02d:%02d,%03d", total/3600000, total/60000%60, total/1000%60, total%1000)
}
