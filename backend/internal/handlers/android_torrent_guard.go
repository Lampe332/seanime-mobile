package handlers

import "strings"

var androidTorrentAPIPrefixes = [...]string{
	"/api/v1/torrent",
	"/api/v1/debrid",
	"/api/v1/auto-downloader",
	"/api/v1/auto-select",
	"/api/v1/download-torrent-file",
	"/api/v1/nakama/host/torrentstream",
	"/api/v1/nakama/host/debridstream",
	"/api/v1/settings/auto-downloader",
	"/api/v1/extensions/list/anime-torrent-provider",
}

func shouldDisableAndroidTorrentRoute(goos, path string) bool {
	if goos != "android" {
		return false
	}

	for _, prefix := range androidTorrentAPIPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return false
}
