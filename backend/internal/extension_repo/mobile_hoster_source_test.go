package extension_repo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"seanime/internal/extension"
	"strings"
	"testing"
)

func TestMobileHosterSourceHasNoLauncher(t *testing.T) {
	for _, removed := range []string{"ensureLauncher", "updateVisibility", "hpLauncher", "hp-launcher", "let launcher"} {
		if strings.Contains(mobileHosterSource, removed) {
			t.Fatalf("launcher source remains: %s", removed)
		}
	}
	for _, retained := range []string{"async function playHoster(", "async function renderHosters(", "async function doSearch(", "async function openOverlay(", "ctx.screen.loadCurrent()"} {
		if !strings.Contains(mobileHosterSource, retained) {
			t.Fatalf("player function lost: %s", retained)
		}
	}
}

func TestMobileHosterSourcePreservesOtherRevisions(t *testing.T) {
	for _, id := range []string{"hoster-player", "another-plugin"} {
		ext := &extension.Extension{ID: id, Type: extension.TypePlugin, Payload: "user edited source"}
		if err := migrateMobileHosterSource("must-not-be-written.json", ext); err != nil {
			t.Fatal(err)
		}
		if ext.Payload != "user edited source" {
			t.Fatal("unrecognized source overwritten")
		}
	}
}

func TestMobileHosterSourcePersistsOnlyPayload(t *testing.T) {
	file := filepath.Join(t.TempDir(), "hoster-player.json")
	ext := &extension.Extension{ID: "hoster-player", Name: "Hoster Player", Version: "1.0.0", Type: extension.TypePlugin, Payload: "old"}
	if err := writeMobileHosterSource(file, ext); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var saved extension.Extension
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Payload != mobileHosterSource || saved.ID != ext.ID || saved.Name != ext.Name || saved.Version != ext.Version {
		t.Fatal("incorrect persisted extension")
	}
	ext.Payload = "unchanged on write failure"
	if err := writeMobileHosterSource(filepath.Join(file, "invalid"), ext); err == nil {
		t.Fatal("expected write error")
	}
	if ext.Payload != "unchanged on write failure" {
		t.Fatal("source changed after failed write")
	}
}
