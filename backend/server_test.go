package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"seanime/internal/core"
	"seanime/internal/server"

	"github.com/labstack/echo/v4"
)

// buildServer builds the real app with WebFS as this binary embeds it (web UI or none, see web_*.go) and a fresh data
// folder. Nothing listens: requests go straight to the echo handler.
func buildServer(t *testing.T) *echo.Echo {
	t.Helper()
	// Not t.TempDir: on Windows the server's log file stays open until the process ends, so removal is best effort.
	root, err := os.MkdirTemp("", "seanime-main-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	dataDir := filepath.Join(root, "data")
	t.Setenv("SEANIME_DATA_DIR", dataDir)
	t.Setenv("TMPDIR", filepath.Join(root, "tmp"))

	a, e := server.Build(&WebFS, core.SeanimeFlags{DataDir: dataDir, Host: "127.0.0.1", Port: 43299})
	t.Cleanup(func() {
		a.Cleanup()
		if a.Database != nil {
			if sqlDB, err := a.Database.Gorm().DB(); err == nil {
				_ = sqlDB.Close()
			}
		}
	})
	return e
}

func get(e *echo.Echo, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	// as the app asks: from the phone itself to the server on 127.0.0.1
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:43299"+path, nil)
	req.RemoteAddr = "127.0.0.1:50000"
	e.ServeHTTP(rec, req)
	return rec
}

func TestStatusAnswers(t *testing.T) {
	e := buildServer(t)
	rec := get(e, "/api/v1/status")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/status = %d, body %.200s", rec.Code, rec.Body.String())
	}
	t.Logf("GET /api/v1/status = %d, %d bytes", rec.Code, rec.Body.Len())
}
