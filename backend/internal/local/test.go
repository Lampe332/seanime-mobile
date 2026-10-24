package local

import (
	"seanime/internal/api/anilist"
	"seanime/internal/database/db"
	"seanime/internal/events"
	"seanime/internal/extension"
	"seanime/internal/platforms/anilist_platform"
	"seanime/internal/platforms/platform"
	"seanime/internal/testutil"
	"seanime/internal/util"
	"testing"

	"github.com/stretchr/testify/require"
)

func NewTestManager(t *testing.T, db *db.Database) Manager {
	env := testutil.NewTestEnv(t)

	logger := env.Logger()

	wsEventManager := events.NewMockWSEventManager(logger)
	anilistClient := anilist.NewFixtureAnilistClient()
	anilistClientRef := util.NewRef[anilist.AnilistClient](anilistClient)
	extensionBankRef := util.NewRef(extension.NewUnifiedBank())
	anilistPlatform := anilist_platform.NewAnilistPlatform(anilistClientRef, extensionBankRef, logger, db)
	anilistPlatformRef := util.NewRef[platform.Platform](anilistPlatform)

	localDir := env.MustMkdirData("offline")

	m, err := NewManager(&NewManagerOptions{
		LocalDir:           localDir,
		Logger:             logger,
		WSEventManager:     wsEventManager,
		AnilistPlatformRef: anilistPlatformRef,
	})
	require.NoError(t, err)

	return m
}
