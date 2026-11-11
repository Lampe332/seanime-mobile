package mobile

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// Starts the real server through the gomobile entry point, asks /api/v1/status and stops it.
func TestStartStatusStop(t *testing.T) {
	// StartServer sets these like the iOS module would; restore them for the other tests.
	t.Setenv("SEANIME_DATA_DIR", "")
	t.Setenv("TMPDIR", os.Getenv("TMPDIR"))

	// Not t.TempDir: on Windows the server's log file stays open until the process ends, so removal is best effort.
	root, err := os.MkdirTemp("", "seanime-mobile-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	dataDir := filepath.Join(root, "data")
	cacheDir := filepath.Join(root, "cache")

	port := freePort(t)
	if port == 43211 || port == 43212 {
		port = freePort(t)
	}

	if err := StartServer(dataDir, cacheDir, "", port); err != nil {
		t.Fatalf("StartServer: %v", err)
	}
	t.Cleanup(func() { _ = StopServer() })

	if got := Status(); got != StateRunning {
		t.Fatalf("Status() = %q, want %q (LastError %q)", got, StateRunning, LastError())
	}
	if _, err := os.Stat(filepath.Join(dataDir, "config.toml")); err != nil {
		t.Fatalf("config.toml not in the data dir: %v", err)
	}

	url := fmt.Sprintf("http://127.0.0.1:%d/api/v1/status", port)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s = %d, body %s", url, resp.StatusCode, body)
	}
	t.Logf("GET %s = %d, %d bytes", url, resp.StatusCode, len(body))

	// A second start in the same process is a no-op while running.
	if err := StartServer(dataDir, cacheDir, "", port); err != nil {
		t.Fatalf("second StartServer while running: %v", err)
	}

	if err := StopServer(); err != nil {
		t.Fatalf("StopServer: %v", err)
	}
	if got := Status(); got != StateStopped {
		t.Fatalf("Status() after stop = %q", got)
	}

	// The port is free again.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("port %d still in use after StopServer: %v", port, err)
	}
	_ = ln.Close()

	// Restarting in the same process is refused instead of reusing process-wide state.
	if err := StartServer(dataDir, cacheDir, "", port); err == nil {
		t.Fatal("StartServer after StopServer should fail")
	}
}

func TestStartServerRejectsBadArguments(t *testing.T) {
	if err := StartServer("", "", "", 1234); err == nil {
		t.Fatal("empty dataDir should fail")
	}
	if err := StartServer("/tmp/x", "", "", 0); err == nil {
		t.Fatal("port 0 should fail")
	}
	if Status() == StateStarting {
		t.Fatal("rejected arguments must not change the state")
	}
}
