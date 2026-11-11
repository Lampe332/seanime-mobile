package mobileoffline

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"syscall"
	"testing"
)

// Ported from app/src/test/.../offline/OfflinePolicyTest.kt.

func TestNetworkAndStorageErrorsAreNamed(t *testing.T) {
	cases := []struct {
		err  error
		want Failure
	}{
		{&net.DNSError{Err: "no such host", Name: "cdn.example"}, FailureConnection},
		{fmt.Errorf("read: %w", context.DeadlineExceeded), FailureConnection},
		{&net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}, FailureConnection},
		{fmt.Errorf("copy: %w", io.ErrUnexpectedEOF), FailureConnection},
		{fmt.Errorf("write failed: %w", &os.PathError{Op: "write", Path: "x", Err: syscall.ENOSPC}), FailureStorageFull},
		{errors.New("write failed: ENOSPC (No space left on device)"), FailureStorageFull},
		{errNoSpace, FailureStorageFull},
		{fmt.Errorf("segment: %w", &HTTPError{Status: 403}), FailureSourceRefused},
		{fmt.Errorf("%w: provider down", errUnavailable), FailureUnavailable},
		{errors.New("odd"), FailureUnknown},
		{nil, FailureUnknown},
	}
	for _, c := range cases {
		if got := classify(c.err); got != c.want {
			t.Errorf("classify(%v) = %s, want %s", c.err, got, c.want)
		}
	}
}

func TestEveryFailureHasAText(t *testing.T) {
	seen := map[string]bool{}
	for _, f := range Failures {
		text := FailureText(f)
		if text == "" || seen[text] {
			t.Errorf("%s has no own text", f)
		}
		seen[text] = true
	}
}

func TestSubtitleLanguagesFromCodesAndNames(t *testing.T) {
	for raw, want := range map[string]string{
		"de":                  "de",
		"pt-BR":               "pt",
		"pt_BR":               "pt",
		"English":             "en",
		"Deutsch":             "de",
		"german":              "de",
		"Portuguese (Brazil)": "pt",
		"Español - Latino":    "es",
		"":                    "",
		"   ":                 "",
		"Full Subs [CR]":      "",
		"und":                 "",
	} {
		if got := SubtitleLanguage(raw); got != want {
			t.Errorf("SubtitleLanguage(%q) = %q, want %q", raw, got, want)
		}
	}
}
