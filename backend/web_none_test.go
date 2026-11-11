//go:build nowebui

package main

import (
	"io/fs"
	"net/http"
	"strings"
	"testing"
)

// The native app's server (tag nowebui) carries no web UI and answers "/" with a plain 404 instead of a page.
func TestNoWebUI(t *testing.T) {
	if entries, err := fs.ReadDir(WebFS, "."); err != nil || len(entries) != 0 {
		t.Fatalf("WebFS should be empty, got %d entries (err %v)", len(entries), err)
	}
	e := buildServer(t)
	for _, path := range []string{"/", "/index.html", "/anime"} {
		rec := get(e, path)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("GET %s = %d, want 404, body %.200s", path, rec.Code, rec.Body.String())
		}
		if strings.Contains(strings.ToLower(rec.Body.String()), "<html") {
			t.Fatalf("GET %s served HTML: %.200s", path, rec.Body.String())
		}
	}
	if rec := get(e, "/api/v1/status"); rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/status = %d", rec.Code)
	}
}
