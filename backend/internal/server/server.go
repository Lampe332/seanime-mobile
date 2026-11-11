package server

import (
	"embed"
	"seanime/internal/core"
	"seanime/internal/cron"
	"seanime/internal/handlers"

	"github.com/labstack/echo/v4"
)

// StartServer runs the server for the Android app's SeanimeService and blocks forever.
func StartServer(webFS embed.FS) {
	// Print the header
	core.PrintHeader()

	// Get the flags
	flags := core.GetSeanimeFlags()

	app, echoApp := Build(&webFS, flags)
	Run(app, echoApp)

	select {}
}

// Build creates the app and its HTTP routes without listening yet.
// Shared by the Android binary (StartServer) and the iOS gomobile entry point (backend/mobile).
func Build(webFS *embed.FS, flags core.SeanimeFlags) (*core.App, *echo.Echo) {
	// Create the app instance
	app := core.NewApp(&core.ConfigOptions{
		Flags: flags,
	})

	app.InitLogging()

	// Create the echo app instance
	echoApp := core.NewEchoApp(app, webFS)

	// Initialize the routes
	handlers.InitRoutes(app, echoApp)

	return app, echoApp
}

// Run starts the HTTP server and the background jobs. It returns right after starting them.
// If echoApp.Listener is set, the server uses it instead of binding the configured address itself.
func Run(app *core.App, echoApp *echo.Echo) {
	// Run the server
	core.RunEchoServer(app, echoApp)

	// Run the jobs in the background
	cron.RunJobs(app)
}
