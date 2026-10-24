package scanner

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// ScanLogger buffers the log of one scan and writes it to a file when the scan is done.
type ScanLogger struct {
	logger  *zerolog.Logger
	logFile *os.File
	buffer  *bytes.Buffer
	mu      sync.Mutex
}

func NewScanLogger(outputDir string) (*ScanLogger, error) {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, err
	}

	logFileName := fmt.Sprintf("%s-scan.log", time.Now().Format("2006-01-02_15-04-05"))
	logFile, err := os.OpenFile(filepath.Join(outputDir, logFileName), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, err
	}

	sl := &ScanLogger{logFile: logFile, buffer: new(bytes.Buffer)}
	logger := zerolog.New(ThreadSafeWriteSyncer{sl.buffer, &sl.mu}).With().Logger()
	sl.logger = &logger
	return sl, nil
}

// NewConsoleScanLogger logs to stdout, for tests.
func NewConsoleScanLogger() (*ScanLogger, error) {
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.DateTime}).With().Logger()
	return &ScanLogger{logger: &logger}, nil
}

func (sl *ScanLogger) LogMediaContainer(level zerolog.Level) *zerolog.Event {
	return sl.logger.WithLevel(level).Str("context", "MediaContainer")
}

func (sl *ScanLogger) LogMatcher(level zerolog.Level) *zerolog.Event {
	return sl.logger.WithLevel(level).Str("context", "Matcher")
}

func (sl *ScanLogger) LogFileHydrator(level zerolog.Level) *zerolog.Event {
	return sl.logger.WithLevel(level).Str("context", "FileHydrator")
}

func (sl *ScanLogger) LogMediaFetcher(level zerolog.Level) *zerolog.Event {
	return sl.logger.WithLevel(level).Str("context", "MediaFetcher")
}

// Done flushes the buffer to the log file and closes the file.
func (sl *ScanLogger) Done() error {
	if sl.logFile == nil {
		return nil
	}

	sl.mu.Lock()
	defer sl.mu.Unlock()

	if _, err := sl.logFile.Write(sl.buffer.Bytes()); err != nil {
		return err
	}
	if err := sl.logFile.Sync(); err != nil {
		return err
	}
	return sl.logFile.Close()
}

type ThreadSafeWriteSyncer struct {
	w  *bytes.Buffer
	mu *sync.Mutex
}

func (t ThreadSafeWriteSyncer) Write(p []byte) (n int, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.w.Write(p)
}
