package commands

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/config"
	"degoog-mcp/internal/degoog"
	"degoog-mcp/internal/scraper"
	"degoog-mcp/tools"
)

func Register(server *mcp.Server, sc *scraper.Scraper, dg *degoog.Client, cfg *config.Config) {
	sh := newSearchH(dg, cfg)
	mcp.AddTool(server, tools.SearchTool(), sh.handle)

	rh := newScrapeH(sc)
	mcp.AddTool(server, tools.ScrapeTool(), rh.handle)
}
