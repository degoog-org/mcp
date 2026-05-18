package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/degoog"
)

const (
	SEARCH_NAME = "search"
	SEARCH_DESC = `Run a meta-search query against the Degoog aggregator. Returns merged, deduped, scored results pulled from multiple search engines in one call.

USE THIS FIRST for quick wins and factual lookups: when you need a fact, want authoritative URLs to verify a claim, or want to discover what exists before drilling deeper. Cheap and fast.

DO NOT use this when the user has asked for deep article content — chain the returned URLs into the 'scrape' tool for that.

Optional parameters mirror the Degoog HTTP API: result 'type' (web|images|videos|news), 'page' (1-10), time window ('any'|'hour'|'day'|'week'|'month'|'year'|'custom' with dateFrom/dateTo as 'YYYY MM DD'), and 'lang' (ISO 639-1).`
)

type SearchInput struct {
	Query    string `json:"query" jsonschema:"the search query string"`
	Type     string `json:"type,omitempty" jsonschema:"result type: web (default), images, videos, news"`
	Page     int    `json:"page,omitempty" jsonschema:"result page, 1-10"`
	Time     string `json:"time,omitempty" jsonschema:"time window: any, hour, day, week, month, year, custom"`
	Lang     string `json:"lang,omitempty" jsonschema:"ISO 639-1 language code"`
	DateFrom string `json:"dateFrom,omitempty" jsonschema:"YYYY MM DD, required when time=custom"`
	DateTo   string `json:"dateTo,omitempty" jsonschema:"YYYY MM DD, required when time=custom"`
}

type SearchOutput struct {
	Results         []degoog.Hit          `json:"results"`
	Query           string                `json:"query"`
	TotalTime       int                   `json:"totalTime"`
	Type            string                `json:"type"`
	EngineTimings   []degoog.EngineTiming `json:"engineTimings,omitempty"`
	RelatedSearches []string              `json:"relatedSearches,omitempty"`
}

func SearchTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        SEARCH_NAME,
		Description: SEARCH_DESC,
	}
}
