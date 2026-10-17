package updater

import (
	"errors"
	"runtime"
)

var errDesktopUpdateOnMobile = errors.New("desktop server updates are unavailable on mobile")

// Mobile packages are updated by Android or their distribution channel, never by the desktop server updater.
func desktopUpdatesSupported(goos string) bool {
	return goos != "android" && goos != "ios"
}

func desktopUpdatesAvailable() bool { return desktopUpdatesSupported(runtime.GOOS) }
