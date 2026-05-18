package commands

import (
	"context"
	"errors"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/logger"
	"degoog-mcp/internal/scraper"
	"degoog-mcp/tools"
)

var ErrNoURLs = errors.New("scrape: at least one url is required")

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
	logger.Get().Info("scrape: dispatching %d url(s)", len(in.URLs))
	results := h.sc.ScrapeMany(ctx, in.URLs)
	logger.Get().Info("scrape: returning %d/%d successful result(s)", len(results), len(in.URLs))
	return nil, tools.ScrapeOutput{Results: results}, nil
}
