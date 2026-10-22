package builtin_client

import (
	"context"
	"os"
	"path/filepath"
	"seanime/internal/database/db"
	"seanime/internal/database/models"
	"strings"
	"testing"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

const testMagnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Seanime%20Test"

func TestClientPersistsTorrentState(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	newClient := func() *Client {
		client, clientErr := New(&NewClientOptions{
			Logger:             &logger,
			Database:           database,
			Dir:                t.TempDir(),
			Port:               -1,
			MaxActiveDownloads: 1,
			DisableNetwork:     true,
		})
		if clientErr != nil && strings.Contains(clientErr.Error(), "operation not permitted") {
			t.Skip("environment does not permit the torrent client's localhost listener")
		}
		require.NoError(t, clientErr)
		return client
	}

	client := newClient()
	torrent, err := client.AddMagnet(testMagnet, t.TempDir())
	require.NoError(t, err)
	hash := torrent.InfoHash().HexString()
	require.True(t, client.TorrentExists(hash))

	require.NoError(t, client.PauseTorrent(hash))
	require.NoError(t, client.SetSequential(hash, true))
	require.NoError(t, client.SetForceStart(hash, true))
	snapshots := client.Snapshots()
	require.Len(t, snapshots, 1)
	require.True(t, snapshots[0].ForceStart)
	require.True(t, snapshots[0].Sequential)
	require.False(t, snapshots[0].Paused)
	client.Close()

	restored := newClient()
	t.Cleanup(restored.Close)
	restoredSnapshots := restored.Snapshots()
	require.Len(t, restoredSnapshots, 1)
	require.Equal(t, hash, restoredSnapshots[0].Hash)
	require.True(t, restoredSnapshots[0].ForceStart)
	require.True(t, restoredSnapshots[0].Sequential)

	require.NoError(t, restored.RemoveTorrent(hash, false))
	require.Empty(t, restored.Snapshots())
	persisted, err := database.GetLocalTorrents()
	require.NoError(t, err)
	require.Empty(t, persisted)
}

func TestRemoveTorrentFallsBackToModelNameWhenRuntimeTorrentMissing(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	destDir := t.TempDir()
	rootName := "fallback-folder"
	rootPath := filepath.Join(destDir, rootName)
	require.NoError(t, os.MkdirAll(filepath.Join(rootPath, "nested"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(rootPath, "nested", "episode.mkv"), []byte("hello"), 0644))

	hash := "0123456789abcdef0123456789abcdef01234567"
	item := &models.LocalTorrent{
		Hash:        hash,
		Name:        rootName,
		Destination: destDir,
	}
	require.NoError(t, database.UpsertLocalTorrent(item))

	client := &Client{
		logger:   &logger,
		database: database,
		torrents: map[string]*torrentEntry{
			hash: {model: item},
		},
	}

	require.NoError(t, client.RemoveTorrent(hash, true))
	_, err = os.Stat(rootPath)
	require.True(t, os.IsNotExist(err))

	persisted, err := database.GetLocalTorrents()
	require.NoError(t, err)
	require.Empty(t, persisted)
}

func TestTorrentRootFromModelRejectsEscapingName(t *testing.T) {
	destDir := t.TempDir()
	_, err := torrentRootFromModel(destDir, "../outside")
	require.Error(t, err)
}

func TestClassicStorageWritesHugeFileIncrementally(t *testing.T) {
	dir := t.TempDir()
	pc := storage.NewMapPieceCompletion()
	store := newClassicFileStorage(dir, pc)
	defer store.Close()

	info := &metainfo.Info{
		Name:        "huge-batch-file.mkv",
		Length:      8 << 30,
		PieceLength: 8 << 30,
		Pieces:      make([]byte, metainfo.HashSize),
	}
	torrent, err := store.OpenTorrent(context.Background(), info, metainfo.Hash{})
	require.NoError(t, err)

	piece := torrent.Piece(info.Piece(0))
	_, err = piece.WriteAt([]byte("test"), 0)
	require.NoError(t, err)

	path := filepath.Join(dir, "huge-batch-file.mkv")
	stat, err := os.Stat(path)
	require.NoError(t, err)
	require.EqualValues(t, 4, stat.Size())

	buf := make([]byte, 4)
	_, err = piece.ReadAt(buf, 0)
	require.NoError(t, err)
	require.Equal(t, "test", string(buf))
}

func TestRemovePausedTorrent(t *testing.T) {
	logger := zerolog.Nop()
	database, err := db.NewDatabase("", "seanime-test", &logger)
	require.NoError(t, err)

	client, err := New(&NewClientOptions{
		Logger:             &logger,
		Database:           database,
		Dir:                t.TempDir(),
		Port:               -1,
		MaxActiveDownloads: 1,
		DisableNetwork:     true,
	})
	if err != nil && strings.Contains(err.Error(), "operation not permitted") {
		t.Skip("environment does not permit the torrent client's localhost listener")
	}
	require.NoError(t, err)
	defer client.Close()

	destDir := t.TempDir()
	torrent, err := client.AddMagnet(testMagnet, destDir)
	require.NoError(t, err)
	hash := torrent.InfoHash().HexString()

	require.NoError(t, client.PauseTorrent(hash))
	snapshots := client.Snapshots()
	require.Len(t, snapshots, 1)
	require.True(t, snapshots[0].Paused)

	// Verify we can remove a paused torrent with deleteFiles = true
	err = client.RenameTorrent(hash, "test-paused-torrent-folder")
	require.NoError(t, err)

	// Create a mock folder
	mockFolderPath := filepath.Join(destDir, "test-paused-torrent-folder")
	err = os.MkdirAll(mockFolderPath, 0755)
	require.NoError(t, err)

	// Write a mock file
	mockFilePath := filepath.Join(mockFolderPath, "somefile.txt")
	err = os.WriteFile(mockFilePath, []byte("hello"), 0644)
	require.NoError(t, err)

	// Remove with deleteFiles = true
	require.NoError(t, client.RemoveTorrent(hash, true))
	require.Empty(t, client.Snapshots())

	// Verify files/folder are deleted
	_, err = os.Stat(mockFolderPath)
	require.True(t, os.IsNotExist(err))
}

// Three 300-byte files in 256-byte pieces: pieces 1 and 2 span the middle file and its neighbours.
func openPartsTestTorrent(t *testing.T) (dir string, store *classicFileStorage, impl storage.TorrentImpl, info *metainfo.Info, data []byte) {
	dir = t.TempDir()
	info = &metainfo.Info{
		Name:        "Season",
		PieceLength: 256,
		Files:       []metainfo.FileInfo{{Path: []string{"01.mkv"}, Length: 300}, {Path: []string{"02.mkv"}, Length: 300}, {Path: []string{"03.mkv"}, Length: 300}},
		Pieces:      make([]byte, 4*metainfo.HashSize),
	}
	data = make([]byte, 900)
	for i := range data {
		data[i] = byte(i % 251)
	}
	store = newClassicFileStorage(dir, storage.NewMapPieceCompletion()).(*classicFileStorage)
	var err error
	impl, err = store.OpenTorrent(context.Background(), info, metainfo.Hash{1})
	require.NoError(t, err)
	return
}

func writePieces(t *testing.T, impl storage.TorrentImpl, info *metainfo.Info, data []byte, pieces ...int) {
	for _, index := range pieces {
		piece := info.Piece(index)
		_, err := impl.Piece(piece).WriteAt(data[piece.Offset():piece.Offset()+piece.Length()], 0)
		require.NoError(t, err)
	}
}

func TestClassicStorageKeepsUnwantedShareInPartFile(t *testing.T) {
	dir, store, impl, info, data := openPartsTestTorrent(t)
	store.SetUnwanted(map[int]bool{1: true})

	writePieces(t, impl, info, data, 0, 1, 2, 3)

	_, err := os.Stat(filepath.Join(dir, "Season", "02.mkv"))
	require.True(t, os.IsNotExist(err), "no half episode next to the wanted ones")
	for _, name := range []string{"01.mkv", "03.mkv"} {
		stat, err := os.Stat(filepath.Join(dir, "Season", name))
		require.NoError(t, err)
		require.EqualValues(t, 300, stat.Size())
	}
	buf := make([]byte, 256)
	_, err = impl.Piece(info.Piece(1)).ReadAt(buf, 0)
	require.NoError(t, err)
	require.Equal(t, data[256:512], buf, "a shared piece reads back whole for verification and seeding")
}

func TestClassicStorageMovesEarlyWritesWhenDeselected(t *testing.T) {
	dir, store, impl, info, data := openPartsTestTorrent(t)
	writePieces(t, impl, info, data, 1) // before the selection arrived

	store.SetUnwanted(map[int]bool{1: true})

	_, err := os.Stat(filepath.Join(dir, "Season", "02.mkv"))
	require.True(t, os.IsNotExist(err))
	buf := make([]byte, 256)
	_, err = impl.Piece(info.Piece(1)).ReadAt(buf, 0)
	require.NoError(t, err)
	require.Equal(t, data[256:512], buf)
}

func TestClassicStorageKeepsCompleteFileWhenDeselected(t *testing.T) {
	dir, store, impl, info, data := openPartsTestTorrent(t)
	writePieces(t, impl, info, data, 0, 1, 2, 3)
	for index := 0; index < 4; index++ {
		require.NoError(t, impl.Piece(info.Piece(index)).MarkComplete())
	}

	store.SetUnwanted(map[int]bool{1: true})

	stat, err := os.Stat(filepath.Join(dir, "Season", "02.mkv"))
	require.NoError(t, err, "an episode already on disk stays in the library")
	require.EqualValues(t, 300, stat.Size())
}

func TestClassicStorageRestoresPartWhenWantedAgain(t *testing.T) {
	dir, store, impl, info, data := openPartsTestTorrent(t)
	store.SetUnwanted(map[int]bool{1: true})
	writePieces(t, impl, info, data, 1)

	store.SetUnwanted(map[int]bool{})

	content, err := os.ReadFile(filepath.Join(dir, "Season", "02.mkv"))
	require.NoError(t, err)
	require.Equal(t, data[300:512], content[:212], "the bytes written for the shared piece are back in the real file")
	_, err = os.Stat(filepath.Join(dir, classicPartsDirName, metainfo.Hash{1}.HexString(), "1.part"))
	require.True(t, os.IsNotExist(err))
}
