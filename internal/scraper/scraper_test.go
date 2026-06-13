package scraper

import "testing"

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
