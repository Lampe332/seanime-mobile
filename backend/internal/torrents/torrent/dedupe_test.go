package torrent

import (
	"testing"

	hibiketorrent "seanime/internal/extension/hibike/torrent"

	"github.com/stretchr/testify/require"
)

func TestNormalizeInfoHash(t *testing.T) {
	// upper case, base32 and a broken hash with a usable magnet, as real providers send them
	require.Equal(t, "fa0d098e027bd134bd27cde42ef2abf83ce4a123",
		normalizeInfoHash(&hibiketorrent.AnimeTorrent{InfoHash: "FA0D098E027BD134BD27CDE42EF2ABF83CE4A123"}))
	require.Equal(t, "fa0d098e027bd134bd27cde42ef2abf83ce4a123",
		normalizeInfoHash(&hibiketorrent.AnimeTorrent{InfoHash: "7IGQTDQCPPITJPJHZXSC54VL7A6OJIJD"}))
	require.Equal(t, "fa0d098e027bd134bd27cde42ef2abf83ce4a123",
		normalizeInfoHash(&hibiketorrent.AnimeTorrent{InfoHash: "235D", MagnetLink: "magnet:?xt=urn:btih:FA0D098E027BD134BD27CDE42EF2ABF83CE4A123&dn=x"}))
	require.Equal(t, "235D", normalizeInfoHash(&hibiketorrent.AnimeTorrent{InfoHash: "235D"}))
	require.Equal(t, "Show - 01", normalizeInfoHash(&hibiketorrent.AnimeTorrent{Name: "Show - 01"}))
}

func TestDedupeTorrents(t *testing.T) {
	const hashA = "fa0d098e027bd134bd27cde42ef2abf83ce4a123"
	const hashB = "b9c0fefbd140e6a628e8159268c352bef5eb1baa"
	list := []*hibiketorrent.AnimeTorrent{
		{Provider: "animetosho", Name: "[Erai-raws] Show - 08 [1080p]", InfoHash: hashA, Seeders: 186},
		{Provider: "nyaa", Name: "[Erai-raws] Show - 08 [1080p]", InfoHash: hashA, Seeders: 242, IsBestRelease: false},
		{Provider: "anime-garden", Name: "[LoliHouse] Show - 08", InfoHash: "235D", Seeders: 0},
		{Provider: "nyaa-non-eng", Name: "[LoliHouse] Show - 08", InfoHash: hashB, Seeders: 7},
		{Provider: "x", Name: "Same Name", InfoHash: "1111111111111111111111111111111111111111", Seeders: 1},
		{Provider: "y", Name: "Same Name", InfoHash: "2222222222222222222222222222222222222222", Seeders: 1},
	}

	out := dedupeTorrents(list)
	require.Len(t, out, 4)
	// the first copy stays
	require.Equal(t, "animetosho", out[0].Provider)
	// a broken hash gives way to the copy with a real one
	require.Equal(t, hashB, out[1].InfoHash)
	// different valid hashes are different torrents
	require.Equal(t, "x", out[2].Provider)
	require.Equal(t, "y", out[3].Provider)
}
