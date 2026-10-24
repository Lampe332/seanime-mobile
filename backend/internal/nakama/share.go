package nakama

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"seanime/internal/api/anilist"
	"seanime/internal/api/metadata_provider"
	"seanime/internal/customsource"
	"seanime/internal/directstream"
	"seanime/internal/events"
	"seanime/internal/library/anime"
	"seanime/internal/library/playbackmanager"
	"seanime/internal/player"
	"seanime/internal/util"
	"strconv"
	"strings"

	"github.com/imroc/req/v3"
)

type (
	HydrateHostAnimeLibraryOptions struct {
		AnimeCollection     *anilist.AnimeCollection
		LibraryCollection   *anime.LibraryCollection
		MetadataProviderRef *util.Ref[metadata_provider.Provider]
	}

	NakamaAnimeLibrary struct {
		LocalFiles      []*anime.LocalFile       `json:"localFiles"`
		AnimeCollection *anilist.AnimeCollection `json:"animeCollection"`
	}

	NakamaCustomSourceMap map[int]string

	NakamaLocalFiles struct {
		LocalFiles []*anime.LocalFile `json:"localFiles"`
		// CustomSourceMap maps a generated ID to custom source extension ID
		CustomSourceMap NakamaCustomSourceMap `json:"customSourceMap"`
	}
)

// hostUnreachable drops the host connection when a request to the host could not get through. A host gone to sleep keeps
// the websocket open for up to a minute, and every page would wait for the request timeout until then; without the
// connection the next pages load at once from this device's own library and the usual reconnection takes over.
func (m *Manager) hostUnreachable(ctx context.Context, err error) {
	// The page was left, the host did not fail
	if ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return
	}
	m.hostMu.RLock()
	hostConn := m.hostConnection
	m.hostMu.RUnlock()
	if hostConn == nil {
		return
	}
	m.logger.Warn().Err(err).Msg("nakama: Host did not answer, dropping the connection")
	hostConn.Close()
}

func (m *Manager) GetHostAnimeLibraryFiles(ctx context.Context, mId ...int) (lfs []*anime.LocalFile, customSourceMap NakamaCustomSourceMap, hydrated bool) {
	if !m.settings.Enabled || !m.settings.IncludeNakamaAnimeLibrary || !m.IsConnectedToHost() || m.IsRoomConnection() {
		return nil, nil, false
	}

	// If we're trying to fetch a custom extension, get the entire local files instead
	// This is because the custom source media ID is different on the host
	// The host will return all the shared local files and a map allowing us to pinpoint the local files that match the custom source media
	if len(mId) > 0 && customsource.IsExtensionId(mId[0]) {
		mId = []int{}
	}

	var response *req.Response
	var err error
	if len(mId) > 0 {
		response, err = m.reqClient.R().
			SetContext(ctx).
			SetHeader("X-Seanime-Nakama-Token", m.settings.RemoteServerPassword).
			Get(m.GetHostBaseServerURL() + "/api/v1/nakama/host/anime/library/files/" + strconv.Itoa(mId[0]))
		if err != nil {
			m.hostUnreachable(ctx, err)
			return nil, nil, false
		}
	} else {
		response, err = m.reqClient.R().
			SetContext(ctx).
			SetHeader("X-Seanime-Nakama-Token", m.settings.RemoteServerPassword).
			Get(m.GetHostBaseServerURL() + "/api/v1/nakama/host/anime/library/files")
		if err != nil {
			m.hostUnreachable(ctx, err)
			return nil, nil, false
		}
	}

	if !response.IsSuccessState() {
		return nil, nil, false
	}

	body := response.Bytes()

	var entryResponse struct {
		Data *NakamaLocalFiles `json:"data"`
	}
	err = json.Unmarshal(body, &entryResponse)
	if err != nil {
		return nil, nil, false
	}

	return entryResponse.Data.LocalFiles, entryResponse.Data.CustomSourceMap, true
}

func (m *Manager) GetHostAnimeLibrary(ctx context.Context) (ac *NakamaAnimeLibrary, hydrated bool) {
	if !m.settings.Enabled || !m.settings.IncludeNakamaAnimeLibrary || !m.IsConnectedToHost() || m.IsRoomConnection() {
		return nil, false
	}

	var response *req.Response
	var err error

	response, err = m.reqClient.R().
		SetContext(ctx).
		SetHeader("X-Seanime-Nakama-Token", m.settings.RemoteServerPassword).
		Get(m.GetHostBaseServerURL() + "/api/v1/nakama/host/anime/library")
	if err != nil {
		m.hostUnreachable(ctx, err)
		return nil, false
	}

	if !response.IsSuccessState() {
		return nil, false
	}

	body := response.Bytes()

	var entryResponse struct {
		Data *NakamaAnimeLibrary `json:"data"`
	}
	err = json.Unmarshal(body, &entryResponse)
	if err != nil {
		return nil, false
	}

	if entryResponse.Data == nil {
		return nil, false
	}

	return entryResponse.Data, true
}

func (m *Manager) PlayHostAnimeLibraryFile(path string, userAgent string, clientId string, media *anilist.BaseAnime, aniDBEpisode string, forcePlaybackMethod string) error {
	if !m.settings.Enabled || !m.IsConnectedToHost() || m.IsRoomConnection() {
		return errors.New("not connected to host")
	}

	m.previousPath = path

	m.logger.Debug().Int("mediaId", media.ID).Msg("nakama: Playing host anime library file")
	m.wsEventManager.SendEvent(events.ShowIndefiniteLoader, "nakama-file")
	m.wsEventManager.SendEvent(events.InfoToast, "Sending stream to player...")

	// Send a HTTP request to the host to get the anime library
	// If we can access it then the host is sharing its anime library
	response, err := m.reqClient.R().
		SetHeader("X-Seanime-Nakama-Token", m.settings.RemoteServerPassword).
		Get(m.GetHostBaseServerURL() + "/api/v1/nakama/host/anime/library/shared")
	if err != nil {
		m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-file")
		m.hostUnreachable(context.Background(), err)
		return fmt.Errorf("cannot access host's anime library: %w", err)
	}

	if !response.IsSuccessState() {
		m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-file")
		body := response.Bytes()
		code := response.StatusCode
		return fmt.Errorf("cannot access host's anime library: %d, %s", code, string(body))
	}

	host := m.serverHost
	if host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	address := fmt.Sprintf("%s:%d", host, m.serverPort)
	ret := fmt.Sprintf("http://%s/api/v1/nakama/stream?type=file&path=%s", address, base64.StdEncoding.EncodeToString([]byte(path)))
	if strings.HasPrefix(ret, "http://http") {
		ret = strings.Replace(ret, "http://http", "http", 1)
	}
	ret += m.directstreamManager.GetHMACTokenQueryParam("/api/v1/nakama/stream", "&")

	windowTitle := media.GetPreferredTitle()
	if !media.IsMovieOrSingleEpisode() {
		windowTitle += " - Episode " + aniDBEpisode
	}

	playbackMethod := forcePlaybackMethod
	if playbackMethod == "" {
		playbackMethod = "playbackmanager"
	}

	// Playback Manager
	switch playbackMethod {
	case "playbackmanager":
		err = m.playbackManager.StartStreamingUsingMediaPlayer(windowTitle, &playbackmanager.StartPlayingOptions{
			Payload:   ret,
			UserAgent: userAgent,
			ClientId:  clientId,
		}, media, aniDBEpisode)
		if err != nil {
			m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-file")
			go m.playbackManager.UnsubscribeFromPlaybackStatus("nakama-file")
			return err
		}

		m.playbackManager.RegisterMediaPlayerCallback(func(event playbackmanager.PlaybackEvent) bool {
			switch event.(type) {
			case playbackmanager.StreamStartedEvent, playbackmanager.StreamStoppedEvent:
				m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-file")
				return false
			}
			return true
		})
	case "nativeplayer":
		// Native Player
		err = m.directstreamManager.PlayNakamaStream(context.Background(), directstream.PlayNakamaStreamOptions{
			StreamUrl:          ret,
			MediaId:            media.ID,
			AnidbEpisode:       aniDBEpisode,
			Media:              media,
			NakamaHostPassword: m.settings.RemoteServerPassword,
			ClientId:           clientId,
		})
		if err != nil {
			m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-file")
			go m.playbackManager.UnsubscribeFromPlaybackStatus("nakama-file")
			return err
		}

		m.registerNativeStreamReadyCallback("nakama-file")
	}

	return nil
}

func (m *Manager) PlayHostAnimeStream(streamType WatchPartyStreamType, userAgent string, clientId string, media *anilist.BaseAnime, aniDBEpisode string) error {
	if !m.settings.Enabled || !m.IsConnectedToHost() {
		return errors.New("not connected to host")
	}

	m.logger.Debug().Int("mediaId", media.ID).Msg("nakama: Playing host anime stream")
	m.wsEventManager.SendEvent(events.ShowIndefiniteLoader, "nakama-stream")
	m.wsEventManager.SendEvent(events.InfoToast, "Sending stream to player...")

	host := m.serverHost
	if host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	address := fmt.Sprintf("%s:%d", host, m.serverPort)

	ret := fmt.Sprintf("http://%s/api/v1/nakama/stream?type=%s", address, string(streamType))
	if strings.HasPrefix(ret, "http://http") {
		ret = strings.Replace(ret, "http://http", "http", 1)
	}
	ret += m.directstreamManager.GetHMACTokenQueryParam("/api/v1/nakama/stream", "&")

	windowTitle := media.GetPreferredTitle()
	if !media.IsMovieOrSingleEpisode() {
		windowTitle += " - Episode " + aniDBEpisode
	}

	// Playback Manager
	err := m.playbackManager.StartStreamingUsingMediaPlayer(windowTitle, &playbackmanager.StartPlayingOptions{
		Payload:   ret,
		UserAgent: userAgent,
		ClientId:  clientId,
	}, media, aniDBEpisode)
	if err != nil {
		m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-stream")
		go m.playbackManager.UnsubscribeFromPlaybackStatus("nakama-stream")
		return err
	}

	m.playbackManager.RegisterMediaPlayerCallback(func(event playbackmanager.PlaybackEvent) bool {
		switch event.(type) {
		case playbackmanager.StreamStartedEvent, playbackmanager.StreamStoppedEvent:
			m.wsEventManager.SendEvent(events.HideIndefiniteLoader, "nakama-stream")
			return false
		}
		return true
	})

	return nil
}

func (m *Manager) registerNativeStreamReadyCallback(loaderID string) {
	if m.mediacoreCoordinator == nil {
		return
	}
	m.mediacoreCoordinator.RegisterEventCallback(func(event player.Event) bool {
		playbackState, ok := m.mediacoreCoordinator.GetActivePlaybackState()
		if !ok || playbackState.PlaybackInfo == nil || playbackState.PlaybackInfo.PlaybackType != player.PlaybackTypeNakama {
			return true
		}
		switch event.(type) {
		case *player.LoadedMetadataEvent, *player.TerminatedEvent:
			m.wsEventManager.SendEvent(events.HideIndefiniteLoader, loaderID)
			return false
		}
		return true
	})
}
