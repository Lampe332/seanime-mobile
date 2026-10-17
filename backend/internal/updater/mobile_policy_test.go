package updater

import "testing"

func TestDesktopUpdatesPlatformPolicy(t *testing.T) {
	for _, os := range []string{"android", "ios"} {
		if desktopUpdatesSupported(os) {
			t.Fatalf("desktop updates enabled on %s", os)
		}
	}
	for _, os := range []string{"windows", "linux", "darwin"} {
		if !desktopUpdatesSupported(os) {
			t.Fatalf("desktop updates disabled on %s", os)
		}
	}
}
