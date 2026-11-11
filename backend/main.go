package main

import (
	"seanime/internal/server"
)

// WebFS is the embedded web UI (web_embed.go), or empty in the native app's build (web_none.go, tag nowebui).
func main() {
	server.StartServer(WebFS)
}
