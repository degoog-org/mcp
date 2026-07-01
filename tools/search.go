package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/degoog"
)

const (
	SEARCH_NAME        = "search"
	SEARCH_DESC_COMMON = `Run a meta-search query against the Degoog aggregator. Returns merged, deduped, scored results pulled from multiple search engines in one call.

USE THIS FIRST for quick wins and factual lookups: when you need a fact, want authoritative URLs to verify a claim, or want to discover what exists before drilling deeper. Cheap and fast.

For simple factual questions, answer from snippets and structured results when they are sufficient. Do not invent URLs or modify result URLs.

Optional parameters mirror the Degoog HTTP API: result 'type' (web|images|videos|news), 'page' (1-10), time window ('any'|'hour'|'day'|'week'|'month'|'year'|'custom' with dateFrom/dateTo as 'YYYY MM DD'), and 'lang' (ISO 639-1).

To keep responses small, set 'maxResults' to cap how many merged results come back (top-scored kept). Use 'engines' to restrict the query to specific engine ids (see /api/extensions?type=engine on your Degoog instance); leave it empty to use the instance defaults.

Output shape depends on 'DEGOOG_MCP_SEARCH_TEXT': Visible text can include metadata, titles, URLs, snippets, and follow-up guidance, or be disabled entirely with 'none'. structuredContent is always the exact machine-readable JSON payload with full results, engine timings, related searches, cap/drop counts, source overlap, and guidance in 'summary'. Prefer visible text when the client/model does not expose structuredContent reliably; prefer structuredContent when you need exact fields.`
	SEARCH_DESC = SEARCH_DESC_COMMON + `

If snippets are insufficient for the user's question, call scrape automatically on the most relevant URLs returned by this search. Do not ask for permission unless your client requires confirmation. If scrape fails, do not stop: continue from the search snippets, titles, related searches, and source metadata, or try another URL from these search results. Tell the user which URLs failed alongside the available results instead of hiding failed attempts.`
	SEARCH_DESC_NO_SCRAPE = SEARCH_DESC_COMMON + `

No scrape tool is available on this MCP server. Use the returned snippets, titles, URLs, related searches, and metadata as the available context, and answer transparently from that evidence.`
)

type SearchInput struct {
	Query      string   `json:"query" jsonschema:"the search query string"`
	Type       string   `json:"type,omitempty" jsonschema:"result type: web (default), images, videos, news"`
	Page       int      `json:"page,omitempty" jsonschema:"result page, 1-10"`
	Time       string   `json:"time,omitempty" jsonschema:"time window: any, hour, day, week, month, year, custom"`
	Lang       string   `json:"lang,omitempty" jsonschema:"ISO 639-1 language code"`
	DateFrom   string   `json:"dateFrom,omitempty" jsonschema:"YYYY MM DD, required when time=custom"`
	DateTo     string   `json:"dateTo,omitempty" jsonschema:"YYYY MM DD, required when time=custom"`
	Engines    []string `json:"engines,omitempty" jsonschema:"restrict to these engine ids only, e.g. [brave, duckduckgo]; empty uses instance defaults"`
	MaxResults int      `json:"maxResults,omitempty" jsonschema:"cap returned results to the top N merged hits; 0 or omitted uses the server default"`
}

type SearchOutput struct {
	Summary         string                `json:"summary"`
	Results         []degoog.Hit          `json:"results"`
	Query           string                `json:"query"`
	TotalTime       int                   `json:"totalTime"`
	Type            string                `json:"type"`
	EngineTimings   []degoog.EngineTiming `json:"engineTimings,omitempty"`
	RelatedSearches []string              `json:"relatedSearches,omitempty"`
	Meta            SearchMeta            `json:"meta"`
}

type SearchMeta struct {
	ReturnedResults  int             `json:"returnedResults"`
	ResultsBeforeCap int             `json:"resultsBeforeCap,omitempty"`
	DroppedByCap     int             `json:"droppedByCap,omitempty"`
	CapApplied       bool            `json:"capApplied"`
	EngineCount      int             `json:"engineCount"`
	SourceOverlap    []SourceOverlap `json:"sourceOverlap,omitempty"`
}

type SourceOverlap struct {
	Source string `json:"source"`
	Count  int    `json:"count"`
}

func SearchTool(scrapeEnabled ...bool) *mcp.Tool {
	desc := SEARCH_DESC
	if len(scrapeEnabled) > 0 && !scrapeEnabled[0] {
		desc = SEARCH_DESC_NO_SCRAPE
	}
	return &mcp.Tool{
		Name:        SEARCH_NAME,
		Description: desc,
	}
}
