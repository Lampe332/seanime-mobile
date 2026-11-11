//go:build !nowebui

package main

import "embed"

// WebFS is the web UI the old app's WebView loads (Build.ps1 builds seanime-web into backend/web).
//
//go:embed all:web
var WebFS embed.FS
