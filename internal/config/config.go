package config

import (
	"os"
	"strconv"
	"time"

	"degoog-mcp/internal/logger"
)

const (
	ENV_PORT       = "DEGOOG_MCP_PORT"
	ENV_TIMEOUT    = "DEGOOG_MCP_TIMEOUT"
	ENV_MAX_LENGTH = "DEGOOG_MCP_MAX_LENGTH"
	ENV_CACHE_EXP  = "DEGOOG_MCP_CACHE_EXPIRY"
	ENV_CACHE_SIZE = "DEGOOG_MCP_CACHE_SIZE_MB"
	ENV_USER_AGENT = "DEGOOG_MCP_USER_AGENT"
	ENV_DEGOOG_URL = "DEGOOG_MCP_DEGOOG_URL"
	ENV_API_KEY    = "DEGOOG_MCP_API_KEY"

	DEFAULT_PORT       = "4443"
	DEFAULT_TIMEOUT    = 15 * time.Second
	DEFAULT_MAX_LENGTH = 12000
	DEFAULT_CACHE_EXP  = 30 * time.Minute
	DEFAULT_CACHE_SIZE = 64
	DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
	DEFAULT_DEGOOG_URL = "http://degoog:4444"
)

type Config struct {
	Port        string
	Timeout     time.Duration
	MaxLength   int
	CacheExpiry time.Duration
	CacheSizeMB int
	UserAgent   string
	DegoogURL   string
	APIKey      string
}

func Load() *Config {
	return &Config{
		Port:        readStr(ENV_PORT, DEFAULT_PORT),
		Timeout:     readDur(ENV_TIMEOUT, DEFAULT_TIMEOUT),
		MaxLength:   readInt(ENV_MAX_LENGTH, DEFAULT_MAX_LENGTH),
		CacheExpiry: readDur(ENV_CACHE_EXP, DEFAULT_CACHE_EXP),
		CacheSizeMB: readInt(ENV_CACHE_SIZE, DEFAULT_CACHE_SIZE),
		UserAgent:   readStr(ENV_USER_AGENT, DEFAULT_USER_AGENT),
		DegoogURL:   readStr(ENV_DEGOOG_URL, DEFAULT_DEGOOG_URL),
		APIKey:      readStr(ENV_API_KEY, ""),
	}
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
