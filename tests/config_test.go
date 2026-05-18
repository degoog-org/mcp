package tests

import (
	"testing"
	"time"

	"degoog-mcp/internal/config"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv(config.ENV_PORT, "")
	t.Setenv(config.ENV_TIMEOUT, "")
	t.Setenv(config.ENV_MAX_LENGTH, "")
	t.Setenv(config.ENV_CACHE_EXP, "")
	t.Setenv(config.ENV_CACHE_SIZE, "")
	t.Setenv(config.ENV_USER_AGENT, "")

	cfg := config.Load()

	if cfg.Port != config.DEFAULT_PORT {
		t.Errorf("Port default: want %s, got %s", config.DEFAULT_PORT, cfg.Port)
	}
	if cfg.Timeout != config.DEFAULT_TIMEOUT {
		t.Errorf("Timeout default: want %s, got %s", config.DEFAULT_TIMEOUT, cfg.Timeout)
	}
	if cfg.MaxLength != config.DEFAULT_MAX_LENGTH {
		t.Errorf("MaxLength default: want %d, got %d", config.DEFAULT_MAX_LENGTH, cfg.MaxLength)
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
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv(config.ENV_PORT, "9090")
	t.Setenv(config.ENV_TIMEOUT, "5s")
	t.Setenv(config.ENV_MAX_LENGTH, "42")
	t.Setenv(config.ENV_CACHE_EXP, "2m")
	t.Setenv(config.ENV_CACHE_SIZE, "16")
	t.Setenv(config.ENV_USER_AGENT, "CustomAgent/1.0")

	cfg := config.Load()

	if cfg.Port != "9090" {
		t.Errorf("Port override: got %s", cfg.Port)
	}
	if cfg.Timeout != 5*time.Second {
		t.Errorf("Timeout override: got %s", cfg.Timeout)
	}
	if cfg.MaxLength != 42 {
		t.Errorf("MaxLength override: got %d", cfg.MaxLength)
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
}

func TestLoadBadValuesFallback(t *testing.T) {
	t.Setenv(config.ENV_TIMEOUT, "not-a-duration")
	t.Setenv(config.ENV_MAX_LENGTH, "not-an-int")

	cfg := config.Load()

	if cfg.Timeout != config.DEFAULT_TIMEOUT {
		t.Errorf("bad duration should fall back to default, got %s", cfg.Timeout)
	}
	if cfg.MaxLength != config.DEFAULT_MAX_LENGTH {
		t.Errorf("bad int should fall back to default, got %d", cfg.MaxLength)
	}
}
