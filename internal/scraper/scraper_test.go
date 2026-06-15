package scraper

import (
	"context"
	"strings"
	"testing"
	"time"

	"degoog-mcp/internal/cache"
)

const TEST_UA = "TestAgent/9.9"

func TestFillOptsDefaults(t *testing.T) {
	opts := fillOpts(Options{})

	if opts.MaxURLs != DEFAULT_MAX_URLS {
		t.Fatalf("MaxURLs: want %d, got %d", DEFAULT_MAX_URLS, opts.MaxURLs)
	}
	if opts.Concurrency != DEFAULT_CONCURRENCY {
		t.Fatalf("Concurrency: want %d, got %d", DEFAULT_CONCURRENCY, opts.Concurrency)
	}
	if opts.MaxBytes != DEFAULT_MAX_BYTES {
		t.Fatalf("MaxBytes: want %d, got %d", DEFAULT_MAX_BYTES, opts.MaxBytes)
	}
}

func TestFillOptsOverrides(t *testing.T) {
	opts := fillOpts(Options{
		MaxLength:   99,
		MaxURLs:     3,
		Concurrency: 2,
		MaxBytes:    1024,
	})

	if opts.MaxLength != 99 {
		t.Fatalf("MaxLength: got %d", opts.MaxLength)
	}
	if opts.MaxURLs != 3 {
		t.Fatalf("MaxURLs: got %d", opts.MaxURLs)
	}
	if opts.Concurrency != 2 {
		t.Fatalf("Concurrency: got %d", opts.Concurrency)
	}
	if opts.MaxBytes != 1024 {
		t.Fatalf("MaxBytes: got %d", opts.MaxBytes)
	}
}

func TestScrapeManyKeepsFailureRows(t *testing.T) {
	store, err := cache.New(time.Minute, 1)
	if err != nil {
		t.Fatalf("cache: %v", err)
	}
	defer store.Close()

	s := NewWithOptions(store, TEST_UA, time.Second, Options{MaxURLs: 2, Concurrency: 1})
	results := s.ScrapeMany(context.Background(), []string{"notaurl"})
	if len(results) != 1 {
		t.Fatalf("results: want one failure row, got %d", len(results))
	}
	if results[0].URL != "notaurl" {
		t.Fatalf("url preserved: got %q", results[0].URL)
	}
	if results[0].Error == "" {
		t.Fatalf("expected error row, got %+v", results[0])
	}
	if !strings.Contains(results[0].Error, "blocked url") {
		t.Fatalf("expected blocked url error, got %q", results[0].Error)
	}
}
