//go:build !nowebui

package main

import (
	"net/http"
	"strings"
	"testing"
)

// The old app's server (Build.ps1, no tag) still embeds and serves the web UI its WebView loads.
func TestWebUIServed(t *testing.T) {
	e := buildServer(t)
	rec := get(e, "/")
	if rec.Code != http.StatusOK || !strings.Contains(strings.ToLower(rec.Body.String()), "<html") {
		t.Fatalf("GET / = %d, body %.200s", rec.Code, rec.Body.String())
	}
}
