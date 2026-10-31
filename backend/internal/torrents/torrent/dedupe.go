package torrent

import (
	"encoding/base32"
	"encoding/hex"
	"strings"

	hibiketorrent "seanime/internal/extension/hibike/torrent"
)

// normalizeInfoHash returns the torrent's info hash as 40 lowercase hex characters.
// Providers send upper case, base32 or broken hashes; the magnet link can still hold the real one.
// Torrents without any hash fall back to their name (the key the search used before).
func normalizeInfoHash(t *hibiketorrent.AnimeTorrent) string {
	hash := strings.TrimSpace(t.InfoHash)
	if v, ok := hexInfoHash(hash); ok {
		return v
	}
	if v, ok := hexInfoHash(magnetInfoHash(t.MagnetLink)); ok {
		return v
	}
	if hash == "" {
		return t.Name
	}
	return hash
}

func hexInfoHash(hash string) (string, bool) {
	switch len(hash) {
	case 40:
		lower := strings.ToLower(hash)
		if _, err := hex.DecodeString(lower); err == nil {
			return lower, true
		}
	case 32:
		if b, err := base32.StdEncoding.DecodeString(strings.ToUpper(hash)); err == nil {
			return hex.EncodeToString(b), true
		}
	}
	return "", false
}

func magnetInfoHash(magnet string) string {
	i := strings.Index(strings.ToLower(magnet), "urn:btih:")
	if i < 0 {
		return ""
	}
	hash := magnet[i+len("urn:btih:"):]
	if end := strings.IndexByte(hash, '&'); end >= 0 {
		hash = hash[:end]
	}
	return hash
}

func isInfoHash(hash string) bool {
	_, err := hex.DecodeString(hash)
	return len(hash) == 40 && err == nil
}

// dedupeTorrents keeps one torrent per info hash, the first copy, in the order they came;
// a later copy only replaces it when it has a real hash and the first does not.
// Torrents without a valid hash also merge with a torrent of the same name,
// two different valid hashes stay apart even when the names match.
func dedupeTorrents(torrents []*hibiketorrent.AnimeTorrent) []*hibiketorrent.AnimeTorrent {
	out := make([]*hibiketorrent.AnimeTorrent, 0, len(torrents))
	byHash := make(map[string]int)
	byName := make(map[string]int)

	merge := func(i int, t *hibiketorrent.AnimeTorrent) {
		cur := out[i]
		if isInfoHash(cur.InfoHash) || !isInfoHash(t.InfoHash) {
			cur.IsBestRelease = cur.IsBestRelease || t.IsBestRelease
			return
		}
		t.IsBestRelease = t.IsBestRelease || cur.IsBestRelease
		out[i] = t
		byHash[t.InfoHash] = i
	}

	for _, t := range torrents {
		name := strings.ToLower(strings.TrimSpace(t.Name))
		valid := isInfoHash(t.InfoHash)
		if i, ok := byHash[t.InfoHash]; ok && t.InfoHash != "" {
			merge(i, t)
			continue
		}
		if i, ok := byName[name]; ok && (!valid || !isInfoHash(out[i].InfoHash)) {
			merge(i, t)
			continue
		}

		out = append(out, t)
		if t.InfoHash != "" {
			byHash[t.InfoHash] = len(out) - 1
		}
		if _, ok := byName[name]; !ok {
			byName[name] = len(out) - 1
		}
	}
	return out
}
