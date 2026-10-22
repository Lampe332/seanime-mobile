package builtin_client

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/segments"
	"github.com/anacrolix/torrent/storage"
)

const (
	classicStorageDirPerm  os.FileMode = 0755
	classicStorageFilePerm os.FileMode = 0644
	// Hidden folder in the destination for the parts of unwanted files (see classicTorrent.filePath)
	classicPartsDirName = ".seanime-parts"
)

type classicFileStorage struct {
	baseDir string
	pc      storage.PieceCompletion

	mu       sync.Mutex
	unwanted map[int]bool
	opened   *classicTorrent
}

type classicTorrent struct {
	hash     metainfo.Hash
	info     *metainfo.Info
	files    []classicFile
	index    segments.Index
	pc       storage.PieceCompletion
	partsDir string

	// Files the user does not want (priority 0). A piece that spans a wanted and an unwanted file still has to be stored
	// whole to be verified; the unwanted share goes to a part file, so no half episode lands next to the wanted ones
	// (and in the library). kept: unwanted files already complete on disk, which stay where they are.
	mu       sync.RWMutex
	unwanted map[int]bool
	kept     map[int]bool
}

type classicFile struct {
	path string
}

type classicPiece struct {
	t *classicTorrent
	p metainfo.Piece
}

func newClassicFileStorage(baseDir string, pc storage.PieceCompletion) storage.ClientImplCloser {
	return &classicFileStorage{baseDir: baseDir, pc: pc}
}

func (s *classicFileStorage) Close() error {
	return nil
}

func (s *classicFileStorage) OpenTorrent(_ context.Context, info *metainfo.Info, hash metainfo.Hash) (storage.TorrentImpl, error) {
	if s.baseDir == "" {
		return storage.TorrentImpl{}, errors.New("base directory is empty")
	}
	if err := os.MkdirAll(s.baseDir, classicStorageDirPerm); err != nil {
		return storage.TorrentImpl{}, err
	}

	metaFiles := info.UpvertedFiles()
	files := make([]classicFile, len(metaFiles))
	for i := range metaFiles {
		path, err := classicTorrentFilePath(s.baseDir, info, &metaFiles[i])
		if err != nil {
			return storage.TorrentImpl{}, fmt.Errorf("file %d: %w", i, err)
		}
		files[i] = classicFile{path: path}
		if metaFiles[i].Length == 0 {
			if err := createClassicStorageFile(path); err != nil {
				return storage.TorrentImpl{}, err
			}
		}
	}

	t := &classicTorrent{
		hash:     hash,
		info:     info,
		files:    files,
		index:    info.FileSegmentsIndex(),
		pc:       s.pc,
		partsDir: classicPartsDir(s.baseDir, hash),
		unwanted: map[int]bool{},
		kept:     map[int]bool{},
	}
	s.mu.Lock()
	s.opened = t
	unwanted := s.unwanted
	s.mu.Unlock()
	t.setUnwanted(unwanted)
	return storage.TorrentImpl{
		Piece: t.Piece,
		Close: t.Close,
	}, nil
}

func classicPartsDir(baseDir string, hash metainfo.Hash) string {
	return filepath.Join(baseDir, classicPartsDirName, hash.HexString())
}

// SetUnwanted tells the storage which files the user does not want (file priority 0), before or after the torrent opened.
func (s *classicFileStorage) SetUnwanted(unwanted map[int]bool) {
	s.mu.Lock()
	s.unwanted = unwanted
	t := s.opened
	s.mu.Unlock()
	if t != nil {
		t.setUnwanted(unwanted)
	}
}

// setUnwanted moves what this torrent already wrote of a newly unwanted file into its part file (a complete file stays),
// and a part file back to the real path when the file is wanted again, so verified pieces keep their data.
func (t *classicTorrent) setUnwanted(unwanted map[int]bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := range t.files {
		was, now := t.unwanted[i], unwanted[i]
		switch {
		case now && !was:
			if t.fileCompleteLocked(i) {
				t.kept[i] = true
				continue
			}
			if _, err := os.Stat(t.files[i].path); err == nil {
				if err := os.MkdirAll(t.partsDir, classicStorageDirPerm); err == nil {
					_ = os.Rename(t.files[i].path, t.partPath(i))
				}
			}
		case !now && was:
			if !t.kept[i] {
				if _, err := os.Stat(t.files[i].path); errors.Is(err, os.ErrNotExist) {
					_ = os.MkdirAll(filepath.Dir(t.files[i].path), classicStorageDirPerm)
					_ = os.Rename(t.partPath(i), t.files[i].path)
				}
				_ = os.Remove(t.partPath(i))
			}
			delete(t.kept, i)
		}
	}
	t.unwanted = make(map[int]bool, len(unwanted))
	for i, v := range unwanted {
		if v {
			t.unwanted[i] = true
		}
	}
}

// fileCompleteLocked reports whether every piece of file i is verified and the file is on disk at its full length.
func (t *classicTorrent) fileCompleteLocked(i int) bool {
	files := t.info.UpvertedFiles()
	if i < 0 || i >= len(files) || t.info.PieceLength <= 0 {
		return false
	}
	stat, err := os.Stat(t.files[i].path)
	if err != nil || stat.Size() < files[i].Length {
		return false
	}
	if files[i].Length == 0 {
		return true
	}
	first := files[i].TorrentOffset / t.info.PieceLength
	last := (files[i].TorrentOffset + files[i].Length - 1) / t.info.PieceLength
	for piece := first; piece <= last; piece++ {
		c, err := t.pc.Get(metainfo.PieceKey{InfoHash: t.hash, Index: int(piece)})
		if err != nil || !c.Ok || !c.Complete {
			return false
		}
	}
	return true
}

func (t *classicTorrent) partPath(i int) string {
	return filepath.Join(t.partsDir, strconv.Itoa(i)+".part")
}

// filePath is where file i's bytes live: its own path, or its part file while it is unwanted.
func (t *classicTorrent) filePath(i int) string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if t.unwanted[i] && !t.kept[i] {
		return t.partPath(i)
	}
	return t.files[i].path
}

func classicTorrentFilePath(baseDir string, info *metainfo.Info, file *metainfo.FileInfo) (string, error) {
	parts := make([]string, 0, len(file.BestPath())+1)
	if name := info.BestName(); name != "" && name != metainfo.NoName {
		parts = append(parts, name)
	}
	parts = append(parts, file.BestPath()...)

	rel, err := storage.ToSafeFilePath(parts...)
	if err != nil {
		return "", err
	}
	if rel == "" {
		return "", errors.New("path is empty")
	}

	base, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	path, err := filepath.Abs(filepath.Join(base, rel))
	if err != nil {
		return "", err
	}
	if !isSubPath(base, path) {
		return "", errors.New("path escapes destination")
	}
	return path, nil
}

func isSubPath(base, path string) bool {
	rel, err := filepath.Rel(base, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func createClassicStorageFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), classicStorageDirPerm); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_TRUNC, classicStorageFilePerm)
	if err != nil {
		if stat, statErr := os.Stat(path); statErr == nil && stat.Mode().IsRegular() && stat.Size() == 0 {
			return nil
		}
		return err
	}
	return f.Close()
}

func (t *classicTorrent) Close() error {
	return nil
}

func (t *classicTorrent) Piece(p metainfo.Piece) storage.PieceImpl {
	return &classicPiece{t: t, p: p}
}

func (t *classicTorrent) readAt(b []byte, off int64) (int, error) {
	read := 0
	for i, extent := range t.index.LocateIter(segments.Extent{Start: off, Length: int64(len(b))}) {
		if i < 0 || i >= len(t.files) {
			return read, fmt.Errorf("file index %d is out of range", i)
		}
		n, err := readClassicStorageFile(t.filePath(i), b[:int(extent.Length)], extent.Start)
		read += n
		b = b[n:]
		if err != nil {
			return read, err
		}
		if int64(n) != extent.Length {
			return read, io.EOF
		}
	}
	if len(b) > 0 {
		return read, io.EOF
	}
	return read, nil
}

func (t *classicTorrent) writeAt(b []byte, off int64) (int, error) {
	written := 0
	for i, extent := range t.index.LocateIter(segments.Extent{Start: off, Length: int64(len(b))}) {
		if i < 0 || i >= len(t.files) {
			return written, fmt.Errorf("file index %d is out of range", i)
		}
		n, err := writeClassicStorageFile(t.filePath(i), b[:int(extent.Length)], extent.Start)
		written += n
		b = b[n:]
		if err != nil {
			return written, err
		}
		if int64(n) != extent.Length {
			return written, io.ErrShortWrite
		}
	}
	if len(b) > 0 {
		return written, io.ErrShortWrite
	}
	return written, nil
}

func readClassicStorageFile(path string, b []byte, off int64) (int, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, io.EOF
	}
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return f.ReadAt(b, off)
}

func writeClassicStorageFile(path string, b []byte, off int64) (int, error) {
	if err := os.MkdirAll(filepath.Dir(path), classicStorageDirPerm); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, classicStorageFilePerm)
	if err != nil {
		return 0, err
	}
	n, writeErr := f.WriteAt(b, off)
	closeErr := f.Close()
	if writeErr != nil {
		return n, writeErr
	}
	return n, closeErr
}

func (p *classicPiece) ReadAt(b []byte, off int64) (int, error) {
	if off < 0 {
		return 0, os.ErrInvalid
	}
	if off >= p.p.Length() {
		return 0, io.EOF
	}
	requested := len(b)
	if maxLen := p.p.Length() - off; int64(len(b)) > maxLen {
		b = b[:int(maxLen)]
	}
	n, err := p.t.readAt(b, p.p.Offset()+off)
	if err == nil && n < requested {
		err = io.EOF
	}
	return n, err
}

func (p *classicPiece) WriteAt(b []byte, off int64) (int, error) {
	if off < 0 {
		return 0, os.ErrInvalid
	}
	if off+int64(len(b)) > p.p.Length() {
		return 0, io.ErrShortWrite
	}
	return p.t.writeAt(b, p.p.Offset()+off)
}

func (p *classicPiece) MarkComplete() error {
	if err := p.t.pc.Set(p.key(), true); err != nil {
		return err
	}
	return p.sync()
}

func (p *classicPiece) MarkNotComplete() error {
	return p.t.pc.Set(p.key(), false)
}

func (p *classicPiece) Completion() storage.Completion {
	c, err := p.t.pc.Get(p.key())
	c.Err = errors.Join(c.Err, err)
	if c.Err != nil || !c.Ok || !c.Complete {
		return c
	}

	ok, err := p.filesComplete()
	if err != nil {
		c.Err = errors.Join(c.Err, err)
		c.Complete = false
		return c
	}
	if !ok {
		c.Complete = false
		_ = p.MarkNotComplete()
	}
	return c
}

func (p *classicPiece) key() metainfo.PieceKey {
	return metainfo.PieceKey{InfoHash: p.t.hash, Index: p.p.Index()}
}

func (p *classicPiece) filesComplete() (bool, error) {
	for i, extent := range p.t.index.LocateIter(pieceExtent(p.p)) {
		if i < 0 || i >= len(p.t.files) {
			return false, fmt.Errorf("file index %d is out of range", i)
		}
		stat, err := os.Stat(p.t.filePath(i))
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if stat.Size() < extent.Start+extent.Length {
			return false, nil
		}
	}
	return true, nil
}

func (p *classicPiece) sync() error {
	seen := make(map[string]struct{})
	for i := range p.t.index.LocateIter(pieceExtent(p.p)) {
		if i < 0 || i >= len(p.t.files) {
			return fmt.Errorf("file index %d is out of range", i)
		}
		path := p.t.filePath(i)
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		f, err := os.OpenFile(path, os.O_WRONLY, classicStorageFilePerm)
		if err != nil {
			return err
		}
		syncErr := f.Sync()
		closeErr := f.Close()
		if syncErr != nil {
			return syncErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func pieceExtent(piece metainfo.Piece) segments.Extent {
	return segments.Extent{Start: piece.Offset(), Length: piece.Length()}
}
