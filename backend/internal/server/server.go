package server

import (
	"embed"
	"seanime/internal/core"
	"seanime/internal/cron"
	"seanime/internal/handlers"
)

// StartServer runs the server for the Android app's SeanimeService and blocks forever.
func StartServer(webFS embed.FS) {
	// Print the header
	core.PrintHeader()

	// Get the flags
	flags := core.GetSeanimeFlags()

	// Create the app instance
	app := core.NewApp(&core.ConfigOptions{
		Flags: flags,
	})

	app.InitLogging()

	// Create the echo app instance
	echoApp := core.NewEchoApp(app, &webFS)

	// Initialize the routes
	handlers.InitRoutes(app, echoApp)

	// Run the server
	core.RunEchoServer(app, echoApp)

	// Run the jobs in the background
	cron.RunJobs(app)

	select {}
}
