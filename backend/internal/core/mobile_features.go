package core

import (
	"context"
	"path/filepath"
	"runtime"
	"seanime/internal/dlnacast"
	"seanime/internal/events"
	"seanime/internal/mobileoffline"
)

// initMobileFeatures starts what the native mobile app gets from the server instead of its own Kotlin/Swift code:
// DLNA casting and the episode downloads (see docs/NATIVE-UMBAU.md, E4).
func (a *App) initMobileFeatures() {
	a.DlnaCast = dlnacast.New(a.Config.Server.Port, func(e dlnacast.Event) {
		a.WSEventManager.SendEvent(events.DlnaCast, e)
	})
	a.AddCleanupFunction(a.DlnaCast.Release)

	// On Android the data folder is the app's filesDir (SeanimeServerService --datadir). After the update over
	// Seanime Mobile 2.0.33 (same package) it still holds that app's downloads; they are taken over once (E6).
	legacyDir := ""
	if runtime.GOOS == "android" {
		legacyDir = a.Config.Data.AppDataDir
	}
	manager, err := mobileoffline.New(mobileoffline.Options{
		Dir:     filepath.Join(a.Config.Data.AppDataDir, "mobile-offline"),
		Resolve: a.resolveOfflineEpisode,
		Media:   a.offlineMediaDetails,
		Changed: func(s mobileoffline.Snapshot) {
			a.WSEventManager.SendEvent(events.MobileOfflineUpdated, s)
		},
		LegacyDir: legacyDir,
	})
	if err != nil {
		a.Logger.Error().Err(err).Msg("app: Episode downloads unavailable")
		return
	}
	a.MobileOffline = manager
	a.AddCleanupFunction(manager.Close)
}

func (a *App) resolveOfflineEpisode(ctx context.Context, provider string, mediaID, episode int, dubbed bool) ([]mobileoffline.VideoSource, error) {
	media, err := a.OnlinestreamRepository.GetMedia(ctx, mediaID)
	if err != nil {
		return nil, err
	}
	source, err := a.OnlinestreamRepository.GetEpisodeSources(ctx, provider, mediaID, episode, dubbed, media.GetStartYearSafe(), false)
	if err != nil {
		return nil, err
	}
	result := make([]mobileoffline.VideoSource, 0, len(source.VideoSources))
	for _, s := range source.VideoSources {
		if s == nil {
			continue
		}
		subs := make([]mobileoffline.SourceSubtitle, 0, len(s.Subtitles))
		for _, sub := range s.Subtitles {
			if sub != nil {
				subs = append(subs, mobileoffline.SourceSubtitle{URL: sub.URL, Language: sub.Language, IsDefault: sub.IsDefault})
			}
		}
		result = append(result, mobileoffline.VideoSource{Server: s.Server, URL: s.URL, Quality: s.Quality, Type: string(s.Type), Headers: s.Headers, Subtitles: subs})
	}
	return result, nil
}

func (a *App) offlineMediaDetails(ctx context.Context, mediaID int) (*mobileoffline.MediaDetails, error) {
	media, err := a.OnlinestreamRepository.GetMedia(ctx, mediaID)
	if err != nil {
		return nil, err
	}
	value := func(p *int) int {
		if p == nil {
			return 0
		}
		return *p
	}
	details := &mobileoffline.MediaDetails{
		Year:          value(media.GetSeasonYear()),
		TotalEpisodes: value(media.GetEpisodes()),
		Duration:      value(media.GetDuration()),
		Score:         value(media.GetMeanScore()),
		CoverURL:      media.GetCoverImageSafe(),
		BannerURL:     media.GetBannerImageSafe(),
	}
	if d := media.GetDescription(); d != nil {
		details.Description = *d
	}
	if f := media.GetFormat(); f != nil {
		details.Format = string(*f)
	}
	for _, g := range media.GetGenres() {
		if g != nil {
			details.Genres = append(details.Genres, *g)
		}
	}
	return details, nil
}
