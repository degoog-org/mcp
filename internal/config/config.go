package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"degoog-mcp/internal/logger"
)

const (
	ENV_BIND_HOST   = "DEGOOG_MCP_BIND_HOST"
	ENV_PORT        = "DEGOOG_MCP_PORT"
	ENV_TIMEOUT     = "DEGOOG_MCP_TIMEOUT"
	ENV_MAX_LENGTH  = "DEGOOG_MCP_MAX_LENGTH"
	ENV_MAX_URLS    = "DEGOOG_MCP_MAX_URLS"
	ENV_CONCURRENCY = "DEGOOG_MCP_SCRAPE_CONCURRENCY"
	ENV_MAX_BYTES   = "DEGOOG_MCP_MAX_RESPONSE_BYTES"
	ENV_CACHE_EXP   = "DEGOOG_MCP_CACHE_EXPIRY"
	ENV_CACHE_SIZE  = "DEGOOG_MCP_CACHE_SIZE_MB"
	ENV_USER_AGENT  = "DEGOOG_MCP_USER_AGENT"
	ENV_DEGOOG_URL  = "DEGOOG_MCP_DEGOOG_URL"
	ENV_API_KEY     = "DEGOOG_MCP_API_KEY"
	ENV_MAX_RESULTS = "DEGOOG_MCP_MAX_RESULTS"
	ENV_ENGINES     = "DEGOOG_MCP_ENGINES"

	DEFAULT_BIND_HOST   = ""
	DEFAULT_PORT        = "4443"
	DEFAULT_TIMEOUT     = 15 * time.Second
	DEFAULT_MAX_LENGTH  = 12000
	DEFAULT_MAX_URLS    = 8
	DEFAULT_CONCURRENCY = 4
	DEFAULT_MAX_BYTES   = 2 * 1024 * 1024
	DEFAULT_CACHE_EXP   = 30 * time.Minute
	DEFAULT_CACHE_SIZE  = 64
	DEFAULT_USER_AGENT  = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
	DEFAULT_DEGOOG_URL  = "http://degoog:4444"
	DEFAULT_MAX_RESULTS = 0

	LIST_SEP = ","
)

type Config struct {
	BindHost    string
	Port        string
	Timeout     time.Duration
	MaxLength   int
	MaxURLs     int
	Concurrency int
	MaxBytes    int64
	CacheExpiry time.Duration
	CacheSizeMB int
	UserAgent   string
	DegoogURL   string
	APIKey      string
	MaxResults  int
	Engines     []string
}

// Load returns a Config populated with values from environment variables, using defaults for unset or invalid variables.
func Load() *Config {
	return &Config{
		BindHost:    readStr(ENV_BIND_HOST, DEFAULT_BIND_HOST),
		Port:        readStr(ENV_PORT, DEFAULT_PORT),
		Timeout:     readDur(ENV_TIMEOUT, DEFAULT_TIMEOUT),
		MaxLength:   readInt(ENV_MAX_LENGTH, DEFAULT_MAX_LENGTH),
		MaxURLs:     readPosInt(ENV_MAX_URLS, DEFAULT_MAX_URLS),
		Concurrency: readPosInt(ENV_CONCURRENCY, DEFAULT_CONCURRENCY),
		MaxBytes:    int64(readPosInt(ENV_MAX_BYTES, DEFAULT_MAX_BYTES)),
		CacheExpiry: readDur(ENV_CACHE_EXP, DEFAULT_CACHE_EXP),
		CacheSizeMB: readInt(ENV_CACHE_SIZE, DEFAULT_CACHE_SIZE),
		UserAgent:   readStr(ENV_USER_AGENT, DEFAULT_USER_AGENT),
		DegoogURL:   readStr(ENV_DEGOOG_URL, DEFAULT_DEGOOG_URL),
		APIKey:      readStr(ENV_API_KEY, ""),
		MaxResults:  readNonNeg(ENV_MAX_RESULTS, DEFAULT_MAX_RESULTS),
		Engines:     readList(ENV_ENGINES),
	}
}

// readNonNeg reads an integer from the environment variable key and returns it if non-negative, or def otherwise.
func readNonNeg(key string, def int) int {
	n := readInt(key, def)
	if n < 0 {
		logger.Get().Warn("config: negative value for %s=%d, falling back to %d", key, n, def)
		return def
	}
	return n
}

// readList reads an environment variable and parses it as a comma-separated list of strings, excluding empty values. It returns nil if the variable is unset or empty.
func readList(key string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil
	}
	parts := strings.Split(v, LIST_SEP)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// readStr reads the environment variable specified by key and returns its value, or def if the variable is unset or empty.
func readStr(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

readInt reads the environment variable with the given key and returns its integer value, or the default value if the variable is unset, empty, or cannot be parsed as an integer.
func readInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		logger.Get().Warn("config: invalid int for %s=%q, falling back to %d: %v", key, v, def, err)
		return def
	}
	return n
}

readPosInt reads an integer from an environment variable and returns it if positive, otherwise returns the default.
func readPosInt(key string, def int) int {
	n := readInt(key, def)
	if n <= 0 {
		logger.Get().Warn("config: invalid positive int for %s=%d, falling back to %d", key, n, def)
		return def
	}
	return n
}

// readDur reads an environment variable, parses it as a time.Duration, and returns the parsed value. If the environment variable is unset, empty, or cannot be parsed as a duration, the default value is returned.
func readDur(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		logger.Get().Warn("config: invalid duration for %s=%q, falling back to %s: %v", key, v, def, err)
		return def
	}
	return d
}
