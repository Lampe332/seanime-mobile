// Package adultguard enforces the content policy of the Google Play build only.
//
// Google Play build (build tag "play", see package storeflavor):
//   - adult media (AniList isAdult == true) is never listed, searched, loaded or streamed,
//     and the user settings that would enable it are ignored,
//   - media carrying a sexual-content tag with rank >= SuggestiveTagHideRank is hidden like adult media,
//   - every other "Ecchi" media is marked isSuggestive so the UI can blur its cover.
//
// Every other build (including the GitHub APK) keeps upstream behavior: adult content is a user
// setting (off by default).
package adultguard

import (
	"errors"
	"sync/atomic"

	"seanime/internal/storeflavor"
)

// ErrBlocked is returned when a request targets adult media on a platform where it is blocked.
var ErrBlocked = errors.New("adult content is not available on this platform")

var blocked atomic.Bool
var suggestiveRules atomic.Bool

func init() {
	blocked.Store(storeflavor.Play)
	suggestiveRules.Store(storeflavor.Play)
}

// Active reports whether any filtering rule is on, i.e. whether AniList responses must be passed through FilterJSON.
func Active() bool {
	return Blocked() || SuggestiveRulesEnabled()
}

// Blocked reports whether adult content must be suppressed on this platform.
func Blocked() bool {
	return blocked.Load()
}

// SetBlockedForTest overrides the platform check and returns a function that restores the previous value.
func SetBlockedForTest(v bool) (restore func()) {
	prev := blocked.Swap(v)
	return func() { blocked.Store(prev) }
}

// FilterJSON removes adult media from a decoded AniList JSON document (map/slice tree).
//
//   - An array element that is an adult media object, or that directly contains one
//     (list entry -> media, airing schedule -> media, relation edge -> node), is dropped.
//   - A non-array value that is an adult media object makes the whole document fail with ErrBlocked.
//
// It returns the number of removed array elements.
func FilterJSON(v interface{}) (removed int, err error) {
	switch t := v.(type) {
	case map[string]interface{}:
		markSuggestive(t)
		for _, child := range t {
			if isAdultObject(child) {
				return removed, ErrBlocked
			}
		}
		for k, child := range t {
			switch c := child.(type) {
			case []interface{}:
				kept, n, e := filterSlice(c)
				if e != nil {
					return removed, e
				}
				removed += n
				t[k] = kept
			case map[string]interface{}:
				n, e := FilterJSON(c)
				if e != nil {
					return removed, e
				}
				removed += n
			}
		}
	case []interface{}:
		// top-level slices are not expected; nothing to mutate in place
		_, n, e := filterSlice(t)
		return n, e
	}
	return removed, nil
}

func filterSlice(s []interface{}) ([]interface{}, int, error) {
	kept := make([]interface{}, 0, len(s))
	removed := 0
	for _, el := range s {
		if isAdultObject(el) || hasAdultChild(el) {
			removed++
			continue
		}
		switch e := el.(type) {
		case map[string]interface{}:
			n, err := FilterJSON(e)
			if err != nil {
				// an adult object nested deeper inside a non-adult element: drop the element
				removed++
				continue
			}
			removed += n
		case []interface{}:
			k, n, err := filterSlice(e)
			if err != nil {
				removed++
				continue
			}
			removed += n
			el = k
		}
		kept = append(kept, el)
	}
	return kept, removed, nil
}

func isAdultObject(v interface{}) bool {
	m, ok := v.(map[string]interface{})
	if !ok {
		return false
	}
	if b, ok := m["isAdult"].(bool); ok && b && Blocked() {
		return true
	}
	return SuggestiveRulesEnabled() && hasHiddenSuggestiveTag(m)
}

func hasAdultChild(v interface{}) bool {
	m, ok := v.(map[string]interface{})
	if !ok {
		return false
	}
	for _, child := range m {
		if isAdultObject(child) {
			return true
		}
	}
	return false
}
