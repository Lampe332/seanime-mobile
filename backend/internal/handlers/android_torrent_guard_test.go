package handlers

import "testing"

func TestShouldDisableAndroidTorrentRoute(t *testing.T) {
	tests := []struct {
		name string
		goos string
		path string
		want bool
	}{
		{name: "android torrent search", goos: "android", path: "/api/v1/torrent/search", want: false},
		{name: "android torrent streaming", goos: "android", path: "/api/v1/torrentstream/start", want: false},
		{name: "android built-in torrent client", goos: "android", path: "/api/v1/torrent-client/download", want: false},
		{name: "android debrid", goos: "android", path: "/api/v1/debrid/torrents", want: false},
		{name: "android debrid stream", goos: "android", path: "/api/v1/debrid/stream/start", want: false},
		{name: "android torrent file download", goos: "android", path: "/api/v1/download-torrent-file", want: false},
		{name: "android auto select profile", goos: "android", path: "/api/v1/auto-select/profile", want: false},
		{name: "android torrent provider listing", goos: "android", path: "/api/v1/extensions/list/anime-torrent-provider", want: false},
		{name: "android Nakama torrent stream", goos: "android", path: "/api/v1/nakama/host/torrentstream/stream", want: true},
		{name: "android Nakama debrid stream", goos: "android", path: "/api/v1/nakama/host/debridstream/stream", want: true},
		{name: "android direct online download remains available", goos: "android", path: "/api/v1/directstream/download", want: false},
		{name: "desktop torrent features remain available", goos: "windows", path: "/api/v1/torrent/search", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldDisableAndroidTorrentRoute(test.goos, test.path); got != test.want {
				t.Fatalf("shouldDisableAndroidTorrentRoute(%q, %q) = %v, want %v", test.goos, test.path, got, test.want)
			}
		})
	}
}
