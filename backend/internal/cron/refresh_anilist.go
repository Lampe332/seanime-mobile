package cron

import (
	"seanime/internal/events"
)

func RefreshAnilistDataJob(c *JobCtx) {
	defer func() {
		if r := recover(); r != nil {
		}
	}()

	if c.App.Settings == nil || c.App.Settings.Library == nil {
		return
	}

	// Refresh the Anilist Collection
	animeCollection, _ := c.App.RefreshAnimeCollection()
	c.App.WSEventManager.SendEvent(events.RefreshedAnilistAnimeCollection, animeCollection)

	mangaCollection, _ := c.App.RefreshMangaCollection()
	c.App.WSEventManager.SendEvent(events.RefreshedAnilistMangaCollection, mangaCollection)
}
