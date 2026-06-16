package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/scraper"
)

const (
	SCRAPE_NAME = "scrape"
	SCRAPE_DESC = `Fetch one or more URLs and return their main article content as clean Markdown.

USE THIS when deep, article-level context is needed: after a 'search' surfaces promising URLs, when the user gives you a link to analyze, or when a snippet isn't enough to answer. Multiple URLs are fetched concurrently. Every requested URL gets a result entry: successful rows include title/content, failed rows include an error string so agents can retry or choose another source.

Do not invent, guess, or rewrite URLs for this tool. Use only URLs returned by search or explicitly provided by the user. If one or all scrape rows fail, do not stop: use successful rows plus the previous search results as context, or choose another URL from the same search result set. Tell the user which URLs failed alongside the available results instead of hiding failed attempts.

Long pages are truncated head + tail to fit a token budget; the middle is removed and a marker is inserted.`
)

type ScrapeInput struct {
	URLs []string `json:"urls" jsonschema:"one or more URLs to fetch and convert to markdown"`
}

type ScrapeOutput struct {
	Summary      string           `json:"summary"`
	Results      []scraper.Result `json:"results"`
	SuccessCount int              `json:"successCount"`
	FailureCount int              `json:"failureCount"`
}

func ScrapeTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        SCRAPE_NAME,
		Description: SCRAPE_DESC,
	}
}
