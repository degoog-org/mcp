package cache

import (
	"context"
	"errors"
	"time"

	"github.com/allegro/bigcache/v3"

	"degoog-mcp/internal/logger"
)

type Cache struct {
	bc *bigcache.BigCache
}

func New(expiry time.Duration, sizeMB int) (*Cache, error) {
	cfg := bigcache.DefaultConfig(expiry)
	cfg.HardMaxCacheSize = sizeMB
	bc, err := bigcache.New(context.Background(), cfg)
	if err != nil {
		logger.Get().Error("cache: init failed: %v", err)
		return nil, err
	}
	logger.Get().Info("cache: ready (expiry=%s, hardMax=%dMB)", expiry, sizeMB)
	return &Cache{bc: bc}, nil
}

func (c *Cache) Get(key string) (string, bool) {
	v, err := c.bc.Get(key)
	if err != nil {
		if errors.Is(err, bigcache.ErrEntryNotFound) {
			return "", false
		}
		logger.Get().Warn("cache: get error key=%s: %v", key, err)
		return "", false
	}
	return string(v), true
}

func (c *Cache) Set(key, val string) {
	if err := c.bc.Set(key, []byte(val)); err != nil {
		logger.Get().Warn("cache: set error key=%s: %v", key, err)
	}
}

func (c *Cache) Close() {
	if err := c.bc.Close(); err != nil {
		logger.Get().Warn("cache: close error: %v", err)
	}
}
