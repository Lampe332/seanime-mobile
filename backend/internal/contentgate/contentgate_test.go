package contentgate

import "testing"

func TestLocked(t *testing.T) {
	defer SetEnabledForTest(true)()
	tok, ext := false, false
	Configure(func() bool { return tok }, func() bool { return ext })
	defer Configure(nil, nil)

	if !Locked() {
		t.Fatal("fresh install (no token, no extension) must be locked")
	}
	if LockedFor("abc") {
		t.Fatal("a request with its own token (login) must pass")
	}
	tok = true
	if Locked() {
		t.Fatal("AniList token must unlock")
	}
	tok, ext = false, true
	if Locked() {
		t.Fatal("installed extension must unlock")
	}
}

func TestDisabledPlatform(t *testing.T) {
	defer SetEnabledForTest(false)()
	Configure(nil, nil)
	if Locked() {
		t.Fatal("gate must be inactive off Android")
	}
}

func TestNilChecksAreLocked(t *testing.T) {
	defer SetEnabledForTest(true)()
	Configure(nil, nil)
	if !Locked() {
		t.Fatal("unconfigured checks must count as no source")
	}
}
