package videocore

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"
)

// Short codes the native player turns into a message; the cause stays in the server log.
var (
	ErrTranslationOff         = errors.New("translation-off")
	ErrTranslationUnreachable = errors.New("translation-unreachable")
	ErrTranslationRateLimited = errors.New("translation-rate-limited")
	ErrTranslationFailed      = errors.New("translation-failed")
	ErrTranslationTooMany     = errors.New("too-many-lines")
)

// MaxTranslateLines bounds one request; the player sends a track in small batches anyway.
const MaxTranslateLines = 200

// TranslatedLines is the answer to a batch of subtitle lines.
type TranslatedLines struct {
	Lines []string `json:"lines"`
	// Target language of the saved settings (lower case), the language of the translated track.
	Language string `json:"language"`
}

// TranslateSubtitleLines translates subtitle lines with the saved translation settings, in order, through the same
// line cache as the web player's translations. Unlike TranslateText/TranslateContent it reports a failure instead of
// handing back the original, because the native player shows the reason.
func (vc *VideoCore) TranslateSubtitleLines(ctx context.Context, lines []string) (*TranslatedLines, error) {
	// read once: SetSettings replaces the service when the settings change
	service := vc.translatorService
	if service == nil {
		return nil, ErrTranslationOff
	}
	if len(lines) > MaxTranslateLines {
		return nil, ErrTranslationTooMany
	}
	ret, err := service.translateLines(ctx, lines)
	if err != nil {
		code := translationErrorCode(err)
		if errors.Is(code, context.Canceled) {
			return nil, code
		}
		vc.logger.Warn().Str("reason", code.Error()).Str("type", errorKind(err)).Msg("videocore: Subtitle line translation failed")
		return nil, code
	}
	return &TranslatedLines{Lines: ret, Language: strings.ToLower(service.targetLang)}, nil
}

func (s *TranslatorService) translateLines(ctx context.Context, lines []string) ([]string, error) {
	targetLang := normalizeTargetLang("", s.targetLang)
	ret := make([]string, len(lines))
	missing := make([]int, 0, len(lines))
	for i, line := range lines {
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		if cached, ok := s.cache.Get(generateCacheKey(text, targetLang)); ok {
			ret[i] = cached
			continue
		}
		missing = append(missing, i)
	}

	const batchSize = 50
	for start := 0; start < len(missing); start += batchSize {
		end := min(start+batchSize, len(missing))
		texts := make([]string, 0, end-start)
		for _, i := range missing[start:end] {
			texts = append(texts, strings.TrimSpace(lines[i]))
		}
		batchCtx, cancel := context.WithTimeout(ctx, translationBatchTimeout)
		translated, err := s.translator.TranslateBatch(batchCtx, texts, targetLang)
		cancel()
		if err != nil {
			return nil, err
		}
		if len(translated) != len(texts) {
			return nil, ErrTranslationFailed
		}
		for k, i := range missing[start:end] {
			s.cache.Set(generateCacheKey(texts[k], targetLang), translated[k])
			ret[i] = translated[k]
		}
	}
	return ret, nil
}

// translationErrorCode sorts a provider error into the codes above; a cancelled request stays itself.
func translationErrorCode(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	var urlErr *url.Error
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &urlErr) || errors.As(err, &netErr) {
		return ErrTranslationUnreachable
	}
	if strings.Contains(strings.ToLower(err.Error()), "rate limit") || strings.Contains(err.Error(), "429") {
		return ErrTranslationRateLimited
	}
	return ErrTranslationFailed
}

// errorKind names the error without its text: a provider's URL error carries the subtitle line in its query.
func errorKind(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return "url: " + urlErr.Op
	}
	return "provider"
}
