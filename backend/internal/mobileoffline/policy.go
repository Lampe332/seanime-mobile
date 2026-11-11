package mobileoffline

import (
	"context"
	"errors"
	"io/fs"
	"net"
	"regexp"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/text/language"
	"golang.org/x/text/language/display"
)

// Failure is why a download failed, as far as its error tells. Stored by name, so only add entries.
type Failure string

const (
	FailureSourceRefused Failure = "SOURCE_REFUSED"
	FailureConnection    Failure = "CONNECTION"
	FailureStorageFull   Failure = "STORAGE_FULL"
	FailureUnavailable   Failure = "SOURCE_UNAVAILABLE"
	FailureUnknown       Failure = "UNKNOWN"
)

// Failures lists every failure; each has a text.
var Failures = []Failure{FailureSourceRefused, FailureConnection, FailureStorageFull, FailureUnavailable, FailureUnknown}

// HTTPError is a refused request of a source (any status >= 400).
type HTTPError struct{ Status int }

func (e *HTTPError) Error() string { return "source answered " + strconv.Itoa(e.Status) }

// errUnavailable: the provider gave no downloadable source for the episode.
var errUnavailable = errors.New("no downloadable source")

// classify names a download error. The old app had SERVER_OFF for downloads through the local proxy; the server now
// downloads itself, so that case cannot happen any more.
func classify(err error) Failure {
	if err == nil {
		return FailureUnknown
	}
	var httpErr *HTTPError
	var netErr net.Error
	var dnsErr *net.DNSError
	var opErr *net.OpError
	switch {
	case errors.Is(err, syscall.ENOSPC) || strings.Contains(err.Error(), "ENOSPC") || strings.Contains(err.Error(), "no space left") ||
		strings.Contains(err.Error(), "No space left") || errors.Is(err, errNoSpace):
		return FailureStorageFull
	case errors.Is(err, errUnavailable):
		return FailureUnavailable
	case errors.As(err, &httpErr):
		return FailureSourceRefused
	case errors.As(err, &dnsErr) || errors.As(err, &opErr) || errors.As(err, &netErr) || errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.ECONNREFUSED) || isUnexpectedEOF(err):
		return FailureConnection
	default:
		return FailureUnknown
	}
}

func isUnexpectedEOF(err error) bool {
	return strings.Contains(err.Error(), "unexpected EOF") && !errors.Is(err, fs.ErrNotExist)
}

// FailureText is the English text of a failure; the app shows its own translation of the code.
func FailureText(f Failure) string {
	switch f {
	case FailureSourceRefused:
		return "The source link expired or was refused. Retry, or download from another server."
	case FailureConnection:
		return "The connection dropped. Retry when you are online."
	case FailureStorageFull:
		return "The phone's storage is full. Free up space, then retry."
	case FailureUnavailable:
		return "Source unavailable. Try again or pick another provider."
	default:
		return "Unknown error. Retry, or download from another server."
	}
}

var languageCode = regexp.MustCompile(`^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$`)

// SubtitleLanguage is the language code of a subtitle from a source's language field, which holds codes ("de",
// "pt-BR") or names ("English", "Deutsch", "Portuguese (Brazil)"); "" when it names no known language.
func SubtitleLanguage(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if languageCode.MatchString(value) {
		tag, err := language.Parse(strings.ReplaceAll(value, "_", "-"))
		if err != nil {
			return ""
		}
		// "und" (undetermined) only guesses a language
		base, confidence := tag.Base()
		if confidence != language.Exact {
			return ""
		}
		return base.String()
	}
	name := strings.TrimSpace(strings.SplitN(strings.SplitN(value, "(", 2)[0], " - ", 2)[0])
	for _, tag := range display.Supported.Tags() {
		base, _ := tag.Base()
		plain := language.Make(base.String())
		if strings.EqualFold(display.English.Languages().Name(plain), name) || strings.EqualFold(display.Self.Name(plain), name) {
			return base.String()
		}
	}
	return ""
}
