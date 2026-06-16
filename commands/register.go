package commands

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/config"
	"degoog-mcp/internal/degoog"
	"degoog-mcp/internal/scraper"
	"degoog-mcp/tools"
)

func Register(server *mcp.Server, sc *scraper.Scraper, dg *degoog.Client, cfg *config.Config) []string {
	registered := []string{tools.SEARCH_NAME}
	sh := newSearchH(dg, cfg)
	mcp.AddTool(server, tools.SearchTool(!cfg.DisableScrape), sh.handle)

	if cfg.DisableScrape {
		return registered
	}
	rh := newScrapeH(sc)
	mcp.AddTool(server, tools.ScrapeTool(), rh.handle)
	registered = append(registered, tools.SCRAPE_NAME)
	return registered
}
