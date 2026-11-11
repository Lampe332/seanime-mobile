package mobileoffline

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	_ "golang.org/x/image/webp"
)

// detailsComplete: the descriptions are saved and every artwork with a URL has its file.
func (m *Manager) detailsComplete(d *Details) bool {
	if !d.MetadataSaved {
		return false
	}
	for _, pair := range [][2]string{{d.CoverURL, d.CoverAsset}, {d.BannerURL, d.BannerAsset}, {d.EpisodeImageURL, d.EpisodeImageAsset}} {
		if pair[0] != "" && m.ArtworkPath(pair[1]) == "" {
			return false
		}
	}
	return true
}

// capture saves the anime's descriptions and the artwork of item id in the background, at most once a minute per item.
// Text sent with the download stays available when the details cannot be fetched.
func (m *Manager) capture(id string) {
	m.mu.Lock()
	r := m.state.Items[id]
	if r == nil || time.Since(m.attempts[id]) < captureBackoff || m.detailsComplete(&r.Details) {
		m.mu.Unlock()
		return
	}
	m.attempts[id] = time.Now()
	details, mediaID := r.Details, r.MediaID
	m.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		m.fill(ctx, &details, mediaID)
		m.mu.Lock()
		defer m.mu.Unlock()
		if r := m.state.Items[id]; r != nil {
			r.Details = details
			m.saveLocked(true)
			m.changedLocked()
		}
	}()
}

// fill adds the anime's details (mediaID > 0) and saves the artwork files.
func (m *Manager) fill(ctx context.Context, d *Details, mediaID int) {
	if mediaID > 0 && !d.MetadataSaved && m.opts.Media != nil {
		if media, err := m.opts.Media(ctx, mediaID); err == nil && media != nil {
			d.Description, d.Genres, d.Year, d.Format = media.Description, media.Genres, media.Year, media.Format
			d.TotalEpisodes, d.Duration, d.Score = media.TotalEpisodes, media.Duration, media.Score
			if media.CoverURL != "" {
				d.CoverURL = media.CoverURL
			}
			if media.BannerURL != "" {
				d.BannerURL = media.BannerURL
			}
			d.MetadataSaved = true
		}
	}
	if d.Description != "" && d.CoverURL != "" {
		d.MetadataSaved = true
	}
	for _, art := range []struct {
		url   string
		asset *string
	}{{d.CoverURL, &d.CoverAsset}, {d.BannerURL, &d.BannerAsset}, {d.EpisodeImageURL, &d.EpisodeImageAsset}} {
		if art.url == "" || m.ArtworkPath(*art.asset) != "" {
			continue
		}
		if name, err := m.saveArtwork(ctx, art.url); err == nil {
			*art.asset = name
		}
	}
}

var artworkName = regexp.MustCompile(`^[a-f0-9]{64}\.(jpg|png|gif|webp)$`)

// ArtworkPath is the file of a saved artwork name, or "" for unknown names.
func (m *Manager) ArtworkPath(name string) string {
	if !artworkName.MatchString(name) {
		return ""
	}
	path := filepath.Join(m.opts.Dir, "artwork", name)
	if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
		return ""
	}
	return path
}

// saveArtwork downloads an image (max 8 MB, must decode) under the hash of its URL. It is kept as sent; the old app
// re-encoded to JPEG, which Go would only do without the WebP encoder.
func (m *Manager) saveArtwork(ctx context.Context, rawURL string) (string, error) {
	raw, headers, err := providerURL(rawURL, nil)
	if err != nil {
		return "", err
	}
	data, err := (&fetcher{client: m.client, headers: headers}).bytes(ctx, raw, 8<<20)
	if err != nil {
		return "", err
	}
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	ext := map[string]string{"jpeg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}[format]
	if ext == "" {
		return "", errors.New("unsupported image")
	}
	sum := sha256.Sum256([]byte(rawURL))
	name := hex.EncodeToString(sum[:]) + "." + ext
	if m.ArtworkPath(name) != "" {
		return name, nil
	}
	path := filepath.Join(m.opts.Dir, "artwork", name)
	if err := os.WriteFile(path+".tmp", data, 0o644); err != nil {
		return "", err
	}
	return name, os.Rename(path+".tmp", path)
}

// cleanArtwork deletes artwork no item and no manga uses any more.
func (m *Manager) cleanArtwork() {
	m.mu.Lock()
	used := map[string]bool{}
	mark := func(d *Details) {
		used[d.CoverAsset], used[d.BannerAsset], used[d.EpisodeImageAsset] = true, true, true
	}
	for _, r := range m.state.Items {
		mark(&r.Details)
	}
	for _, d := range m.state.Manga {
		mark(d)
	}
	m.mu.Unlock()
	entries, _ := os.ReadDir(filepath.Join(m.opts.Dir, "artwork"))
	for _, e := range entries {
		if !used[e.Name()] {
			_ = os.Remove(filepath.Join(m.opts.Dir, "artwork", e.Name()))
		}
	}
}

// MangaRequest describes a manga for the offline list (the old bridge's cacheManga).
type MangaRequest struct {
	MediaID int `json:"mediaId"`
	Details
}

// CacheManga saves a manga's descriptions and cover for offline use and returns them. The chapters themselves are
// downloaded by the server's manga downloader (/api/v1/manga/download-chapters). Manga details never come from the
// anime endpoint.
func (m *Manager) CacheManga(ctx context.Context, req MangaRequest) (*Details, error) {
	if req.MediaID <= 0 {
		return nil, errors.New("invalid manga")
	}
	id := IDFor("manga:" + strconv.Itoa(req.MediaID))
	m.mu.Lock()
	if d := m.state.Manga[id]; d != nil && m.ArtworkPath(d.CoverAsset) != "" {
		copy := *d
		m.mu.Unlock()
		return &copy, nil
	}
	m.mu.Unlock()
	details := req.Details
	details.MetadataSaved = true
	m.fill(ctx, &details, 0)
	m.mu.Lock()
	m.state.Manga[id] = &details
	m.saveLocked(true)
	m.mu.Unlock()
	return &details, nil
}
