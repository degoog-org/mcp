package logger

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

const (
	COLOR_RESET  = "\033[0m"
	COLOR_GRAY   = "\033[90m"
	COLOR_BLUE   = "\033[34m"
	COLOR_YELLOW = "\033[33m"
	COLOR_RED    = "\033[31m"
	ENV_LEVEL    = "DEGOOG_MCP_LOG_LEVEL"
	TS_LAYOUT    = "2006-01-02 15:04:05"
	TAG_DEBUG    = "DEBUG"
	TAG_INFO     = "INFO "
	TAG_WARN     = "WARN "
	TAG_ERROR    = "ERROR"
)

type Logger struct {
	level Level
	mu    sync.Mutex
}

var (
	instance *Logger
	once     sync.Once
)

func Get() *Logger {
	once.Do(func() {
		instance = &Logger{level: parseLvl(os.Getenv(ENV_LEVEL))}
	})
	return instance
}

func parseLvl(raw string) Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return LevelDebug
	case "warn", "warning":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

func (l *Logger) emit(lvl Level, color, tag, msg string, args ...any) {
	if lvl < l.level {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	body := fmt.Sprintf(msg, args...)
	line := fmt.Sprintf("%s%s [%s] %s%s\n", color, time.Now().Format(TS_LAYOUT), tag, body, COLOR_RESET)
	if _, err := os.Stderr.WriteString(line); err != nil {
		fmt.Println("logger stderr write failed:", err)
	}
}

func (l *Logger) Debug(msg string, args ...any) { l.emit(LevelDebug, COLOR_GRAY, TAG_DEBUG, msg, args...) }
func (l *Logger) Info(msg string, args ...any)  { l.emit(LevelInfo, COLOR_BLUE, TAG_INFO, msg, args...) }
func (l *Logger) Warn(msg string, args ...any)  { l.emit(LevelWarn, COLOR_YELLOW, TAG_WARN, msg, args...) }
func (l *Logger) Error(msg string, args ...any) { l.emit(LevelError, COLOR_RED, TAG_ERROR, msg, args...) }
