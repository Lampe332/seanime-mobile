package mobilestorage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVolumeRoot(t *testing.T) {
	cases := map[string]string{
		"/storage/emulated/0/Anime/Sub":  "/storage/emulated/0",
		"/storage/emulated/0":            "/storage/emulated/0",
		"/storage/emulated/10/Anime":     "/storage/emulated/10",
		"/storage/1A2B-3C4D/Anime":       "/storage/1A2B-3C4D",
		"/storage/1A2B-3C4D":             "/storage/1A2B-3C4D",
		"/sdcard/Anime":                  "/sdcard",
		"/storage/emulated/0/../0/Anime": "/storage/emulated/0",
		"/storage/self/primary/Anime":    "",
		"/storage/emulated":              "",
		"/data/local/tmp/SeanimeTest":    "",
		"/data/user/0/com.seanime.app":   "",
		"":                               "",
	}
	for input, want := range cases {
		if got := VolumeRoot(input); got != want {
			t.Errorf("VolumeRoot(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCanCreateInLeavesNothingBehind(t *testing.T) {
	dir := t.TempDir()
	if !CanCreateIn(dir) {
		t.Fatal("a writable folder must pass")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("probe file left behind: %v", entries)
	}
	if CanCreateIn(filepath.Join(dir, "missing")) {
		t.Fatal("a missing folder must fail")
	}
}

func TestCheck(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "Dr. STONE - 01.mkv"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := Check(dir, "")
	if !got.Exists || !got.Readable || !got.AllFilesAccess {
		t.Fatalf("existing folder outside shared storage: %+v", got)
	}

	got = Check(dir, filepath.Join(dir, "no-volume"))
	if !got.Exists || !got.Readable || got.AllFilesAccess {
		t.Fatalf("a volume root that refuses new files means no access: %+v", got)
	}

	got = Check(filepath.Join(dir, "missing"), "")
	if got.Exists || got.Readable {
		t.Fatalf("missing folder: %+v", got)
	}

	got = Check(filepath.Join(dir, "Dr. STONE - 01.mkv"), "")
	if got.Exists || got.Readable {
		t.Fatalf("a file is not a folder: %+v", got)
	}

	empty := filepath.Join(dir, "empty")
	if err := os.Mkdir(empty, 0o700); err != nil {
		t.Fatal(err)
	}
	if got = Check(empty, ""); !got.Exists || !got.Readable {
		t.Fatalf("an empty folder is readable: %+v", got)
	}
}
