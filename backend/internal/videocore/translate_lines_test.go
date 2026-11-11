package videocore

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingTranslator struct{ err error }

func (f failingTranslator) TranslateBatch(context.Context, []string, string) ([]string, error) {
	return nil, f.err
}

func TestTranslateSubtitleLinesKeepsOrderAndUsesTheCache(t *testing.T) {
	translator := &recordingTranslator{}
	service := newTestTranslatorService(t, translator)
	vc := &VideoCore{logger: service.vc.logger, translatorService: service}

	got, err := vc.TranslateSubtitleLines(context.Background(), []string{"Hallo", "", "  Welt "})
	require.NoError(t, err)
	assert.Equal(t, []string{"en:Hallo", "", "en:Welt"}, got.Lines)
	assert.Equal(t, "en", got.Language)

	// the second request only sends the line it has not seen
	got, err = vc.TranslateSubtitleLines(context.Background(), []string{"Welt", "Neu"})
	require.NoError(t, err)
	assert.Equal(t, []string{"en:Welt", "en:Neu"}, got.Lines)
	calls := translator.snapshot()
	require.Len(t, calls, 2)
	assert.Equal(t, []string{"Neu"}, calls[1].texts)
}

func TestTranslateSubtitleLinesErrors(t *testing.T) {
	vc := &VideoCore{logger: newTestTranslatorService(t, &recordingTranslator{}).vc.logger}
	_, err := vc.TranslateSubtitleLines(context.Background(), []string{"Hallo"})
	assert.ErrorIs(t, err, ErrTranslationOff)

	cases := map[string]struct {
		err  error
		want error
	}{
		"no network":   {&url.Error{Op: "Get", URL: "https://translate.googleapis.com/?q=Hallo", Err: errors.New("dial tcp: no such host")}, ErrTranslationUnreachable},
		"timeout":      {context.DeadlineExceeded, ErrTranslationUnreachable},
		"rate limited": {fmt.Errorf("google rate limited"), ErrTranslationRateLimited},
		"bad answer":   {fmt.Errorf("google api error: 500"), ErrTranslationFailed},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			service := newTestTranslatorService(t, failingTranslator{err: tc.err})
			vc := &VideoCore{logger: service.vc.logger, translatorService: service}
			_, err := vc.TranslateSubtitleLines(context.Background(), []string{"Hallo"})
			assert.ErrorIs(t, err, tc.want)
			// the line never reaches the answer
			assert.NotContains(t, err.Error(), "Hallo")
		})
	}

	service := newTestTranslatorService(t, &recordingTranslator{})
	vc = &VideoCore{logger: service.vc.logger, translatorService: service}
	_, err = vc.TranslateSubtitleLines(context.Background(), make([]string, MaxTranslateLines+1))
	assert.ErrorIs(t, err, ErrTranslationTooMany)
}
