package models

import (
	"testing"

	"seanime/internal/adultguard"

	"github.com/stretchr/testify/require"
)

func TestEnforcePlatformPolicy_ForcesAdultOffWhenBlocked(t *testing.T) {
	defer adultguard.SetBlockedForTest(true)()
	s := &Settings{Anilist: &AnilistSettings{EnableAdultContent: true, BlurAdultContent: true}}
	s.EnforcePlatformPolicy()
	require.False(t, s.GetAnilist().EnableAdultContent)
	require.False(t, s.GetAnilist().BlurAdultContent)
}

func TestEnforcePlatformPolicy_KeepsValuesWhenNotBlocked(t *testing.T) {
	defer adultguard.SetBlockedForTest(false)()
	s := &Settings{Anilist: &AnilistSettings{EnableAdultContent: true}}
	s.EnforcePlatformPolicy()
	require.True(t, s.GetAnilist().EnableAdultContent)
}

func TestEnforcePlatformPolicy_NilSafe(t *testing.T) {
	defer adultguard.SetBlockedForTest(true)()
	var s *Settings
	s.EnforcePlatformPolicy()
	(&Settings{}).EnforcePlatformPolicy()
}
