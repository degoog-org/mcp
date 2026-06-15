package commands

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/logger"
	"degoog-mcp/internal/scraper"
	"degoog-mcp/tools"
)

var ErrNoURLs = errors.New("scrape: at least one url is required")
var ErrTooManyURLs = errors.New("scrape: too many urls requested")

type scrapeHandler struct {
	sc *scraper.Scraper
}

func newScrapeH(sc *scraper.Scraper) *scrapeHandler {
	return &scrapeHandler{sc: sc}
}

func (h *scrapeHandler) handle(ctx context.Context, req *mcp.CallToolRequest, in tools.ScrapeInput) (*mcp.CallToolResult, tools.ScrapeOutput, error) {
	if len(in.URLs) == 0 {
		logger.Get().Error("scrape: rejected empty url list")
		return nil, tools.ScrapeOutput{}, ErrNoURLs
	}
	if len(in.URLs) > h.sc.MaxURLs() {
		logger.Get().Error("scrape: rejected %d url(s), max is %d", len(in.URLs), h.sc.MaxURLs())
		return nil, tools.ScrapeOutput{}, ErrTooManyURLs
	}
	logger.Get().Info("scrape: dispatching %d url(s)", len(in.URLs))
	results := h.sc.ScrapeMany(ctx, in.URLs)
	successes, failures := scrapeCounts(results)
	logger.Get().Info("scrape: returning %d successful and %d failed result(s) out of %d", successes, failures, len(in.URLs))
	out := tools.ScrapeOutput{
		Results:      results,
		SuccessCount: successes,
		FailureCount: failures,
	}
	out.Summary = scrapeSummary(out)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: out.Summary}}}, out, nil
}

func scrapeCounts(results []scraper.Result) (successes, failures int) {
	for _, r := range results {
		if r.Error != "" {
			failures++
		} else {
			successes++
		}
	}
	return successes, failures
}

func scrapeSummary(out tools.ScrapeOutput) string {
	parts := []string{fmt.Sprintf("Degoog scrape returned %d successful and %d failed URL(s)", out.SuccessCount, out.FailureCount)}
	if out.FailureCount > 0 {
		fails := make([]string, 0, out.FailureCount)
		for _, r := range out.Results {
			if r.Error != "" {
				fails = append(fails, fmt.Sprintf("%s: %s", r.URL, r.Error))
			}
		}
		parts = append(parts, "failures: "+strings.Join(fails, "; "))
	}
	return strings.Join(parts, "; ") + ". Structured content contains one row per requested URL with title/content or error."
}
