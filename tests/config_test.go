package tests

import (
	"testing"
	"time"

	"degoog-mcp/internal/config"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv(config.ENV_PORT, "")
	t.Setenv(config.ENV_BIND_HOST, "")
	t.Setenv(config.ENV_TIMEOUT, "")
	t.Setenv(config.ENV_MAX_LENGTH, "")
	t.Setenv(config.ENV_MAX_URLS, "")
	t.Setenv(config.ENV_CONCURRENCY, "")
	t.Setenv(config.ENV_MAX_BYTES, "")
	t.Setenv(config.ENV_CACHE_EXP, "")
	t.Setenv(config.ENV_CACHE_SIZE, "")
	t.Setenv(config.ENV_USER_AGENT, "")
	t.Setenv(config.ENV_DISABLE_SCRAPE, "")

	cfg := config.Load()

	if cfg.Port != config.DEFAULT_PORT {
		t.Errorf("Port default: want %s, got %s", config.DEFAULT_PORT, cfg.Port)
	}
	if cfg.BindHost != config.DEFAULT_BIND_HOST {
		t.Errorf("BindHost default: want %s, got %s", config.DEFAULT_BIND_HOST, cfg.BindHost)
	}
	if cfg.Timeout != config.DEFAULT_TIMEOUT {
		t.Errorf("Timeout default: want %s, got %s", config.DEFAULT_TIMEOUT, cfg.Timeout)
	}
	if cfg.MaxLength != config.DEFAULT_MAX_LENGTH {
		t.Errorf("MaxLength default: want %d, got %d", config.DEFAULT_MAX_LENGTH, cfg.MaxLength)
	}
	if cfg.MaxURLs != config.DEFAULT_MAX_URLS {
		t.Errorf("MaxURLs default: want %d, got %d", config.DEFAULT_MAX_URLS, cfg.MaxURLs)
	}
	if cfg.Concurrency != config.DEFAULT_CONCURRENCY {
		t.Errorf("Concurrency default: want %d, got %d", config.DEFAULT_CONCURRENCY, cfg.Concurrency)
	}
	if cfg.MaxBytes != config.DEFAULT_MAX_BYTES {
		t.Errorf("MaxBytes default: want %d, got %d", config.DEFAULT_MAX_BYTES, cfg.MaxBytes)
	}
	if cfg.CacheExpiry != config.DEFAULT_CACHE_EXP {
		t.Errorf("CacheExpiry default: want %s, got %s", config.DEFAULT_CACHE_EXP, cfg.CacheExpiry)
	}
	if cfg.CacheSizeMB != config.DEFAULT_CACHE_SIZE {
		t.Errorf("CacheSizeMB default: want %d, got %d", config.DEFAULT_CACHE_SIZE, cfg.CacheSizeMB)
	}
	if cfg.UserAgent != config.DEFAULT_USER_AGENT {
		t.Errorf("UserAgent default mismatch")
	}
	if cfg.DisableScrape {
		t.Errorf("DisableScrape default: want false")
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv(config.ENV_PORT, "9090")
	t.Setenv(config.ENV_BIND_HOST, "127.0.0.1")
	t.Setenv(config.ENV_TIMEOUT, "5s")
	t.Setenv(config.ENV_MAX_LENGTH, "42")
	t.Setenv(config.ENV_MAX_URLS, "3")
	t.Setenv(config.ENV_CONCURRENCY, "2")
	t.Setenv(config.ENV_MAX_BYTES, "2048")
	t.Setenv(config.ENV_CACHE_EXP, "2m")
	t.Setenv(config.ENV_CACHE_SIZE, "16")
	t.Setenv(config.ENV_USER_AGENT, "CustomAgent/1.0")
	t.Setenv(config.ENV_DISABLE_SCRAPE, "true")

	cfg := config.Load()

	if cfg.Port != "9090" {
		t.Errorf("Port override: got %s", cfg.Port)
	}
	if cfg.BindHost != "127.0.0.1" {
		t.Errorf("BindHost override: got %s", cfg.BindHost)
	}
	if cfg.Timeout != 5*time.Second {
		t.Errorf("Timeout override: got %s", cfg.Timeout)
	}
	if cfg.MaxLength != 42 {
		t.Errorf("MaxLength override: got %d", cfg.MaxLength)
	}
	if cfg.MaxURLs != 3 {
		t.Errorf("MaxURLs override: got %d", cfg.MaxURLs)
	}
	if cfg.Concurrency != 2 {
		t.Errorf("Concurrency override: got %d", cfg.Concurrency)
	}
	if cfg.MaxBytes != 2048 {
		t.Errorf("MaxBytes override: got %d", cfg.MaxBytes)
	}
	if cfg.CacheExpiry != 2*time.Minute {
		t.Errorf("CacheExpiry override: got %s", cfg.CacheExpiry)
	}
	if cfg.CacheSizeMB != 16 {
		t.Errorf("CacheSizeMB override: got %d", cfg.CacheSizeMB)
	}
	if cfg.UserAgent != "CustomAgent/1.0" {
		t.Errorf("UserAgent override mismatch")
	}
	if !cfg.DisableScrape {
		t.Errorf("DisableScrape override: want true")
	}
}

func TestDisableScrapeBoolParsing(t *testing.T) {
	for _, value := range []string{"1", "true", "TRUE", "yes", "on"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv(config.ENV_DISABLE_SCRAPE, value)
			if !config.Load().DisableScrape {
				t.Fatalf("DisableScrape %q: want true", value)
			}
		})
	}
}

func TestAuthTokenDefaultEmpty(t *testing.T) {
	t.Setenv(config.ENV_AUTH_TOKEN, "")

	cfg := config.Load()

	if cfg.AuthToken != "" {
		t.Errorf("AuthToken default: want empty, got %q", cfg.AuthToken)
	}
}

func TestAuthTokenTrimmed(t *testing.T) {
	t.Setenv(config.ENV_AUTH_TOKEN, "  s3cret  ")

	cfg := config.Load()

	if cfg.AuthToken != "s3cret" {
		t.Errorf("AuthToken override: want %q, got %q", "s3cret", cfg.AuthToken)
	}
}

func TestLoadBadValuesFallback(t *testing.T) {
	t.Setenv(config.ENV_TIMEOUT, "not-a-duration")
	t.Setenv(config.ENV_MAX_LENGTH, "not-an-int")
	t.Setenv(config.ENV_MAX_URLS, "-1")
	t.Setenv(config.ENV_CONCURRENCY, "0")
	t.Setenv(config.ENV_MAX_BYTES, "nope")

	cfg := config.Load()

	if cfg.Timeout != config.DEFAULT_TIMEOUT {
		t.Errorf("bad duration should fall back to default, got %s", cfg.Timeout)
	}
	if cfg.MaxLength != config.DEFAULT_MAX_LENGTH {
		t.Errorf("bad int should fall back to default, got %d", cfg.MaxLength)
	}
	if cfg.MaxURLs != config.DEFAULT_MAX_URLS {
		t.Errorf("bad max urls should fall back to default, got %d", cfg.MaxURLs)
	}
	if cfg.Concurrency != config.DEFAULT_CONCURRENCY {
		t.Errorf("bad concurrency should fall back to default, got %d", cfg.Concurrency)
	}
	if cfg.MaxBytes != config.DEFAULT_MAX_BYTES {
		t.Errorf("bad max bytes should fall back to default, got %d", cfg.MaxBytes)
	}
}
