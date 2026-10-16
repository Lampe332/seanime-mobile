package adultguard

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// CacheEpoch is raised whenever cached AniList data must be discarded because the content rules changed
// (the cache may still hold media that the current rules hide). Raise it by one to clear the cache once on the next start.
const CacheEpoch = 1

const cacheEpochFile = ".content-policy-epoch"

// ResetStaleCache clears the AniList cache directory once per CacheEpoch when content rules are active.
// It returns true when it cleared the directory.
func ResetStaleCache(cacheDir string) (bool, error) {
	if !Active() || cacheDir == "" {
		return false, nil
	}
	markerPath := filepath.Join(cacheDir, cacheEpochFile)
	if b, err := os.ReadFile(markerPath); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && n >= CacheEpoch {
			return false, nil
		}
	}
	entries, err := os.ReadDir(cacheDir)
	if err != nil && !os.IsNotExist(err) {
		return false, err
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(cacheDir, e.Name())); err != nil {
			return false, err
		}
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return false, err
	}
	return true, os.WriteFile(markerPath, []byte(strconv.Itoa(CacheEpoch)), 0o644)
}
