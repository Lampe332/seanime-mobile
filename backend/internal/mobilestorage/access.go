// Package mobilestorage answers the native app's question "can the server read the folder the user picked?".
//
// On Android the server reads plain paths, which needs "All files access" (MANAGE_EXTERNAL_STORAGE). The old app asked
// Environment.isExternalStorageManager() before opening the folder picker (MainActivity.startFolderPicker); the native
// app has no Kotlin for that (Karte §2.2), so the server checks it here.
//
// Listing the folder is not enough: without the permission, scoped storage still lists the folder but silently leaves
// out other apps' files, and Download/ and Documents/ even accept new files. Only the volume root refuses a new file
// without "All files access", so the probe creates (and removes at once) a hidden empty file there.
package mobilestorage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type Access struct {
	// Path as checked (cleaned, forward slashes)
	Path string `json:"path"`
	// The path is an existing folder
	Exists bool `json:"exists"`
	// The server could open and list the folder
	Readable bool `json:"readable"`
	// Shared storage: the server has "All files access" on this volume. Paths outside /storage need none (true).
	AllFilesAccess bool `json:"allFilesAccess"`
}

// VolumeRoot is the shared-storage volume a path lives on: "/storage/emulated/0/Anime" → "/storage/emulated/0",
// "/storage/1A2B-3C4D/Anime" → "/storage/1A2B-3C4D", "/sdcard/Anime" → "/sdcard". "" for paths outside shared storage.
func VolumeRoot(p string) string {
	p = path.Clean("/" + strings.TrimPrefix(filepath.ToSlash(p), "/"))
	parts := strings.Split(strings.TrimPrefix(p, "/"), "/")
	switch {
	case len(parts) >= 3 && parts[0] == "storage" && parts[1] == "emulated" && parts[2] != "":
		return "/storage/emulated/" + parts[2]
	case len(parts) >= 2 && parts[0] == "storage" && parts[1] != "emulated" && parts[1] != "self" && parts[1] != "":
		return "/storage/" + parts[1]
	case len(parts) >= 1 && parts[0] == "sdcard":
		return "/sdcard"
	}
	return ""
}

// Check looks at a folder the app picked. root is where the "All files access" probe goes ("" = not shared storage).
func Check(dir string, root string) Access {
	result := Access{Path: filepath.ToSlash(filepath.Clean(dir))}
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		result.Exists = true
		result.Readable = canList(dir)
	}
	result.AllFilesAccess = root == "" || CanCreateIn(root)
	return result
}

func canList(dir string) bool {
	f, err := os.Open(dir)
	if err != nil {
		return false
	}
	defer f.Close()
	_, err = f.Readdirnames(1)
	return err == nil || errors.Is(err, io.EOF)
}

// CanCreateIn tries to create a new hidden empty file in dir and removes it again. Never touches an existing file.
func CanCreateIn(dir string) bool {
	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		return false
	}
	name := filepath.Join(dir, ".seanime-access-"+hex.EncodeToString(suffix))
	f, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return false
	}
	_ = f.Close()
	_ = os.Remove(name)
	return true
}
