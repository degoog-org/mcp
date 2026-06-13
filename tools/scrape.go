package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/scraper"
)

const (
	SCRAPE_NAME = "scrape"
	SCRAPE_DESC = `Fetch one or more URLs and return their main article content as clean Markdown.

USE THIS when deep, article-level context is needed: after a 'search' surfaces promising URLs, when the user gives you a link to analyze, or when a snippet isn't enough to answer. Multiple URLs are fetched concurrently. Failed URLs (timeout, 4xx/5xx, unreadable) are silently dropped from the response, successful ones are still returned.

Long pages are truncated head + tail to fit a token budget; the middle is removed and a marker is inserted.`
)

type ScrapeInput struct {
	URLs []string `json:"urls" jsonschema:"one or more URLs to fetch and convert to markdown"`
}

type ScrapeOutput struct {
	Results []scraper.Result `json:"results"`
}

func ScrapeTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        SCRAPE_NAME,
		Description: SCRAPE_DESC,
	}
}
