package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"degoog-mcp/internal/logger"
)

const (
	ENV_BIND_HOST      = "DEGOOG_MCP_BIND_HOST"
	ENV_PORT           = "DEGOOG_MCP_PORT"
	ENV_TIMEOUT        = "DEGOOG_MCP_TIMEOUT"
	ENV_MAX_LENGTH     = "DEGOOG_MCP_MAX_LENGTH"
	ENV_MAX_URLS       = "DEGOOG_MCP_MAX_URLS"
	ENV_CONCURRENCY    = "DEGOOG_MCP_SCRAPE_CONCURRENCY"
	ENV_MAX_BYTES      = "DEGOOG_MCP_MAX_RESPONSE_BYTES"
	ENV_CACHE_EXP      = "DEGOOG_MCP_CACHE_EXPIRY"
	ENV_CACHE_SIZE     = "DEGOOG_MCP_CACHE_SIZE_MB"
	ENV_USER_AGENT     = "DEGOOG_MCP_USER_AGENT"
	ENV_DEGOOG_URL     = "DEGOOG_MCP_DEGOOG_URL"
	ENV_API_KEY        = "DEGOOG_MCP_DEGOOG_API_KEY"
	ENV_MAX_RESULTS    = "DEGOOG_MCP_MAX_RESULTS"
	ENV_ENGINES        = "DEGOOG_MCP_ENGINES"
	ENV_AUTH_TOKEN     = "DEGOOG_MCP_AUTH_TOKEN"
	ENV_DISABLE_SCRAPE = "DEGOOG_MCP_DISABLE_SCRAPE"

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
	BindHost      string
	Port          string
	Timeout       time.Duration
	MaxLength     int
	MaxURLs       int
	Concurrency   int
	MaxBytes      int64
	CacheExpiry   time.Duration
	CacheSizeMB   int
	UserAgent     string
	DegoogURL     string
	APIKey        string
	MaxResults    int
	Engines       []string
	AuthToken     string
	DisableScrape bool
}

func Load() *Config {
	return &Config{
		BindHost:      readStr(ENV_BIND_HOST, DEFAULT_BIND_HOST),
		Port:          readStr(ENV_PORT, DEFAULT_PORT),
		Timeout:       readDur(ENV_TIMEOUT, DEFAULT_TIMEOUT),
		MaxLength:     readInt(ENV_MAX_LENGTH, DEFAULT_MAX_LENGTH),
		MaxURLs:       readPosInt(ENV_MAX_URLS, DEFAULT_MAX_URLS),
		Concurrency:   readPosInt(ENV_CONCURRENCY, DEFAULT_CONCURRENCY),
		MaxBytes:      int64(readPosInt(ENV_MAX_BYTES, DEFAULT_MAX_BYTES)),
		CacheExpiry:   readDur(ENV_CACHE_EXP, DEFAULT_CACHE_EXP),
		CacheSizeMB:   readInt(ENV_CACHE_SIZE, DEFAULT_CACHE_SIZE),
		UserAgent:     readStr(ENV_USER_AGENT, DEFAULT_USER_AGENT),
		DegoogURL:     readStr(ENV_DEGOOG_URL, DEFAULT_DEGOOG_URL),
		APIKey:        readStr(ENV_API_KEY, ""),
		MaxResults:    readNonNeg(ENV_MAX_RESULTS, DEFAULT_MAX_RESULTS),
		Engines:       readList(ENV_ENGINES),
		AuthToken:     strings.TrimSpace(os.Getenv(ENV_AUTH_TOKEN)),
		DisableScrape: readBool(ENV_DISABLE_SCRAPE, false),
	}
}

func readBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		logger.Get().Warn("config: invalid bool for %s=%q, falling back to %t", key, os.Getenv(key), def)
		return def
	}
}

func readNonNeg(key string, def int) int {
	n := readInt(key, def)
	if n < 0 {
		logger.Get().Warn("config: negative value for %s=%d, falling back to %d", key, n, def)
		return def
	}
	return n
}

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

func readStr(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

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

func readPosInt(key string, def int) int {
	n := readInt(key, def)
	if n <= 0 {
		logger.Get().Warn("config: invalid positive int for %s=%d, falling back to %d", key, n, def)
		return def
	}
	return n
}

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
