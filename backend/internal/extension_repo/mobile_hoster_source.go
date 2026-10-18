package extension_repo

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"seanime/internal/extension"
)

// This locally installed plugin has no manifest or payload URI. Migrate only the
// inspected revision; never replace a different/user-edited extension payload.
const legacyMobileHosterSHA256 = "547e6b1b4f6d5a10edf39dcacf9050ce8ff859c99b8cf540e211fcafcc1ab3fc"

//go:embed mobile/hoster-player.js
var mobileHosterSource string

func migrateMobileHosterSource(filename string, ext *extension.Extension) error {
	if ext.ID != "hoster-player" || ext.Type != extension.TypePlugin || ext.IsDevelopment || ext.PayloadURI != "" || ext.ManifestURI != "" {
		return nil
	}
	sum := sha256.Sum256([]byte(ext.Payload))
	if hex.EncodeToString(sum[:]) != legacyMobileHosterSHA256 {
		return nil
	}
	return writeMobileHosterSource(filename, ext)
}

func writeMobileHosterSource(filename string, ext *extension.Extension) error {
	updated := *ext
	updated.Payload = mobileHosterSource
	data, err := json.Marshal(&updated)
	if err != nil {
		return err
	}
	// Publish a complete file, keeping the original intact if writing fails.
	tmp, err := os.CreateTemp(filepath.Dir(filename), ".hoster-source-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp.Name(), filename); err != nil {
		return err
	}
	ext.Payload = updated.Payload
	return nil
}
