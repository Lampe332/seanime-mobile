// Package mobile is the gomobile entry point of the Seanime server for iOS (SeanimeCore.xcframework).
//
// Based on upstream 5rahim/seanime mobile/mobile.go (tag v3.10.4, commit 4bdff7b; file last changed in 4c03770),
// adapted to this fork: the app and its routes are built by seanime/internal/server, the same code the Android binary runs.
// Swift sees the functions as MobileStartServer, MobileStopServer, MobileStatus, MobileIsReady, MobileLastError.
//
// Only simple types cross the boundary (string, int, bool, error) so gomobile can bind them.
package mobile

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"seanime/internal/core"
	"seanime/internal/server"

	"github.com/labstack/echo/v4"
)

// The native app has its own UI, so the server runs API-only (upstream embeds the web UI here).
var webFS embed.FS

const (
	StateStopped  = "stopped"
	StateStarting = "starting"
	StateRunning  = "running"
	StateError    = "error"

	defaultHost = "127.0.0.1"
)

var (
	mu      sync.Mutex
	state   = StateStopped
	lastErr string
	started bool // the server keeps process-wide state (config, hooks, jobs), so it starts once per process
	app     *core.App
	echoApp *echo.Echo
)

// StartServer builds the server with the same start environment as the Android service
// (--datadir <dataDir> --host <host> --port <port>, TMPDIR=<cacheDir>) and returns once it listens.
// An empty host means 127.0.0.1. The server is not ready for the UI until IsReady() is true.
// Call it off the main thread: building opens the database and can take a few seconds.
func StartServer(dataDir string, cacheDir string, host string, port int) (err error) {
	mu.Lock()
	defer mu.Unlock()

	if strings.TrimSpace(dataDir) == "" {
		return errors.New("seanime: dataDir is empty")
	}
	if port <= 0 || port > 65535 {
		return fmt.Errorf("seanime: invalid port %d", port)
	}
	if strings.TrimSpace(host) == "" {
		host = defaultHost
	}
	if started {
		if state == StateRunning {
			return nil
		}
		return errors.New("seanime: the server already ran in this process; restart the app to start it again")
	}

	started = true
	state = StateStarting
	lastErr = ""

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("seanime: server start panicked: %v", r)
		}
		if err != nil {
			state = StateError
			lastErr = err.Error()
		}
	}()

	if err = os.Setenv("SEANIME_DATA_DIR", dataDir); err != nil {
		return err
	}
	if cacheDir != "" {
		if err = os.MkdirAll(cacheDir, 0700); err != nil {
			return err
		}
		if err = os.Setenv("TMPDIR", cacheDir); err != nil {
			return err
		}
	}

	a, e := server.Build(&webFS, core.SeanimeFlags{
		DataDir: dataDir,
		Host:    host,
		Port:    port,
	})

	// Bind here so a busy port comes back as an error instead of the server's Fatal (os.Exit would kill the app).
	ln, err := net.Listen("tcp", a.Config.GetServerAddr())
	if err != nil {
		a.Cleanup()
		closeDatabase(a)
		return err
	}
	e.Listener = ln

	server.Run(a, e)

	app = a
	echoApp = e
	state = StateRunning
	return nil
}

// StopServer stops listening, runs the app's cleanups and closes the database.
// The process cannot start the server again afterwards (see StartServer).
func StopServer() error {
	mu.Lock()
	defer mu.Unlock()

	if state != StateRunning || echoApp == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := echoApp.Shutdown(ctx)

	app.Cleanup()
	if app.OnFlushLogs != nil {
		app.OnFlushLogs()
	}
	closeDatabase(app)

	app = nil
	echoApp = nil
	state = StateStopped
	return err
}

// Status returns "stopped", "starting", "running" or "error" (see LastError).
func Status() string {
	mu.Lock()
	defer mu.Unlock()
	return state
}

// IsReady reports whether the server finished loading (the same flag as serverReady in /api/v1/status
// and the server-ready event the Android service waits for).
func IsReady() bool {
	mu.Lock()
	defer mu.Unlock()
	return state == StateRunning && app != nil && app.ServerReady
}

// LastError returns the reason of the last failed start, or "".
func LastError() string {
	mu.Lock()
	defer mu.Unlock()
	return lastErr
}

func closeDatabase(a *core.App) {
	if a == nil || a.Database == nil {
		return
	}
	if sqlDB, err := a.Database.Gorm().DB(); err == nil {
		_ = sqlDB.Close()
	}
}
