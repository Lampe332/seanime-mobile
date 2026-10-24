package main

import (
	"embed"
	"seanime/internal/server"
)

//go:embed all:web
var WebFS embed.FS

func main() {
	server.StartServer(WebFS)
}
