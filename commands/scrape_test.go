package commands

import (
	"context"
	"errors"
	"testing"
	"time"

	"degoog-mcp/internal/scraper"
	"degoog-mcp/tools"
)

func TestScrapeRejectsTooManyURLs(t *testing.T) {
	sc := scraper.NewWithOptions(nil, "TestAgent/1.0", time.Second, scraper.Options{MaxURLs: 1})
	h := newScrapeH(sc)

	_, _, err := h.handle(context.Background(), nil, tools.ScrapeInput{
		URLs: []string{"https://example.com/one", "https://example.com/two"},
	})
	if !errors.Is(err, ErrTooManyURLs) {
		t.Fatalf("want ErrTooManyURLs, got %v", err)
	}
}
