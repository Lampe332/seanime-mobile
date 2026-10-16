package adultguard

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResetStaleCache_ClearsOnceThenKeeps(t *testing.T) {
	defer SetBlockedForTest(true)()
	dir := t.TempDir()
	old := filepath.Join(dir, "anilist_media_1")
	require.NoError(t, os.WriteFile(old, []byte("x"), 0o644))

	cleared, err := ResetStaleCache(dir)
	require.NoError(t, err)
	require.True(t, cleared)
	_, err = os.Stat(old)
	require.True(t, os.IsNotExist(err))

	fresh := filepath.Join(dir, "anilist_media_2")
	require.NoError(t, os.WriteFile(fresh, []byte("y"), 0o644))
	cleared, err = ResetStaleCache(dir)
	require.NoError(t, err)
	require.False(t, cleared)
	_, err = os.Stat(fresh)
	require.NoError(t, err)
}

func TestResetStaleCache_NoopWhenInactive(t *testing.T) {
	defer SetBlockedForTest(false)()
	defer SetSuggestiveRulesForTest(false)()
	dir := t.TempDir()
	f := filepath.Join(dir, "keep")
	require.NoError(t, os.WriteFile(f, []byte("x"), 0o644))
	cleared, err := ResetStaleCache(dir)
	require.NoError(t, err)
	require.False(t, cleared)
	_, err = os.Stat(f)
	require.NoError(t, err)
}
