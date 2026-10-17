// Package contentgate keeps the Android app empty until the user brings a content source.
//
// On Android (every variant) no AniList media (anime or manga) is requested or shown
// until the user has either
//   - added an AniList token (logged in), or
//   - installed at least one content provider extension that is not built in (e.g. from a custom
//     marketplace repository; plugins do not count).
//
// On every other platform the gate is inactive and upstream behavior is unchanged.
package contentgate

import (
	"errors"
	"runtime"
	"sync/atomic"
)

// ErrLocked is returned instead of AniList data while the gate is locked.
var ErrLocked = errors.New("no content source yet: add an AniList token or install an extension")

var enabled atomic.Bool
var hasToken atomic.Pointer[func() bool]
var hasExtension atomic.Pointer[func() bool]

func init() {
	enabled.Store(runtime.GOOS == "android")
}

// Configure sets the checks used by Locked. Nil checks count as "no".
func Configure(tokenCheck func() bool, extensionCheck func() bool) {
	hasToken.Store(&tokenCheck)
	hasExtension.Store(&extensionCheck)
}

// Enabled reports whether the gate applies on this platform.
func Enabled() bool {
	return enabled.Load()
}

// Locked reports whether AniList content must be withheld right now.
func Locked() bool {
	if !enabled.Load() {
		return false
	}
	return !call(hasToken.Load()) && !call(hasExtension.Load())
}

// LockedFor is Locked, but a request that carries its own AniList token is always allowed
// (needed while logging in, before the token is stored).
func LockedFor(requestToken string) bool {
	if requestToken != "" {
		return false
	}
	return Locked()
}

func call(f *func() bool) bool {
	if f == nil || *f == nil {
		return false
	}
	return (*f)()
}

// SetEnabledForTest overrides the platform check and returns a function that restores the previous value.
func SetEnabledForTest(v bool) (restore func()) {
	prev := enabled.Swap(v)
	return func() { enabled.Store(prev) }
}
