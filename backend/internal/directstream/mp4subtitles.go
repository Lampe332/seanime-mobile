package directstream

import (
	"context"
	"fmt"
	"io"
	"seanime/internal/mp4subs"
	"seanime/internal/player"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// mp4SubtitleTimeout bounds reading the subtitle samples of a remote MP4 before playback starts
const mp4SubtitleTimeout = 10 * time.Second

func isMp4Content(mimeType string) bool {
	return mimeType == "video/mp4"
}

// loadMp4SubtitleTracks turns the MP4's embedded text tracks (mov_text) into file tracks,
// browsers don't show them from the video itself
func loadMp4SubtitleTracks(r io.ReadSeeker, firstIndex int, logger *zerolog.Logger) []*player.SubtitleTrack {
	ctx, cancel := context.WithTimeout(context.Background(), mp4SubtitleTimeout)
	defer cancel()

	extracted, err := mp4subs.ExtractTextTracks(ctx, r)
	_, _ = r.Seek(0, io.SeekStart)
	if err != nil {
		logger.Warn().Err(err).Msg("directstream: Failed to read MP4 subtitle tracks")
		return nil
	}

	tracks := make([]*player.SubtitleTrack, 0, len(extracted))
	for i, t := range extracted {
		content := t.SRT
		format := "srt"
		isDefault := false
		label := t.Name
		if label == "" && t.Language != "und" {
			label = strings.ToUpper(t.Language)
		}
		if label == "" {
			label = fmt.Sprintf("Track %d", i+1)
		}
		tracks = append(tracks, &player.SubtitleTrack{
			Index:    firstIndex + i,
			Content:  &content,
			Label:    label,
			Language: t.Language,
			Format:   &format,
			Default:  &isDefault,
		})
	}
	if len(tracks) > 0 {
		logger.Debug().Int("tracks", len(tracks)).Msg("directstream: Loaded MP4 subtitle tracks")
	}
	return tracks
}
