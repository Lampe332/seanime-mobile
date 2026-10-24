package handlers

import "strings"

// Torrent search, torrent streaming, the built-in torrent client and debrid run on Android.
// What stays off: hosting torrent or debrid streams for Nakama peers from a phone.
// (The auto-downloader was removed from the server.)
var androidTorrentAPIPrefixes = [...]string{
	"/api/v1/nakama/host/torrentstream",
	"/api/v1/nakama/host/debridstream",
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
