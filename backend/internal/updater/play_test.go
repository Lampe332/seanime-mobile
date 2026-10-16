//go:build play

package updater

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPlayBuildNeverChecksOrDownloadsUpdates(t *testing.T) {
	u := New("1.0.0", nil, nil)
	u.SetEnabled(true)
	update, err := u.GetLatestUpdate()
	require.NoError(t, err)
	require.Nil(t, update)

	_, err = u.GetLatestRelease("github")
	require.Error(t, err)
	_, err = u.DownloadLatestRelease("https://github.com/x/y/releases/download/v1/a.zip", t.TempDir())
	require.Error(t, err)
}
