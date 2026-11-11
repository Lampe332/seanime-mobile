//go:build nowebui

package main

import "embed"

// WebFS is empty in the native app's build (native/scripts/build-android.ps1 builds with -tags nowebui): the app draws
// its own screens and only uses the API, so the web UI (about 15 MB of backend/web) stays out of libseanime.so.
// The server then runs API-only, like the iOS entry point (backend/mobile/mobile.go).
var WebFS embed.FS
