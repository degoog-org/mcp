package commands

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/config"
	"degoog-mcp/internal/degoog"
	"degoog-mcp/internal/logger"
	"degoog-mcp/tools"
)

type searchHandler struct {
	client         *degoog.Client
	defaultEngines []string
	defaultMax     int
	searchText     string
	scrapeEnabled  bool
}

func newSearchH(c *degoog.Client, cfg *config.Config) *searchHandler {
	return &searchHandler{
		client:         c,
		defaultEngines: cfg.Engines,
		defaultMax:     cfg.MaxResults,
		searchText:     cfg.SearchText,
		scrapeEnabled:  !cfg.DisableScrape,
	}
}

func (h *searchHandler) handle(ctx context.Context, req *mcp.CallToolRequest, in tools.SearchInput) (*mcp.CallToolResult, tools.SearchOutput, error) {
	engines := h.pickEngines(in.Engines)
	max := h.pickMax(in.MaxResults)
	logger.Get().Info("search: q=%q type=%q page=%d time=%q lang=%q engines=%v max=%d", in.Query, in.Type, in.Page, in.Time, in.Lang, engines, max)

	resp, err := h.client.Search(ctx, degoog.SearchParams{
		Query:      in.Query,
		Type:       in.Type,
		Page:       in.Page,
		Time:       in.Time,
		Lang:       in.Lang,
		DateFrom:   in.DateFrom,
		DateTo:     in.DateTo,
		Engines:    engines,
		MaxResults: max,
	})
	if err != nil {
		logger.Get().Error("search: degoog call failed: %v", err)
		return nil, tools.SearchOutput{}, err
	}

	out := tools.SearchOutput{
		Results:         resp.Results,
		Query:           resp.Query,
		TotalTime:       resp.TotalTime,
		Type:            resp.Type,
		EngineTimings:   resp.EngineTimings,
		RelatedSearches: resp.RelatedSearches,
		Meta: tools.SearchMeta{
			ReturnedResults:  len(resp.Results),
			ResultsBeforeCap: resp.ResultsBeforeCap,
			DroppedByCap:     resp.ResultsDropped,
			CapApplied:       resp.ResultsDropped > 0,
			EngineCount:      len(resp.EngineTimings),
			SourceOverlap:    sourceOverlap(resp.Results),
		},
	}
	out.Summary = searchStructuredSummary(out, h.scrapeEnabled)
	return &mcp.CallToolResult{Content: searchVisibleContent(out, h.searchText, h.scrapeEnabled)}, out, nil
}

func (h *searchHandler) pickEngines(in []string) []string {
	if len(in) > 0 {
		return in
	}
	return h.defaultEngines
}

func (h *searchHandler) pickMax(in int) int {
	if in > 0 {
		return in
	}
	return h.defaultMax
}

func searchBreakdownLine(out tools.SearchOutput) string {
	parts := []string{fmt.Sprintf("Degoog %s search for %q returned %d result(s)", out.Type, out.Query, out.Meta.ReturnedResults)}
	if out.Meta.ResultsBeforeCap > 0 && out.Meta.DroppedByCap > 0 {
		parts = append(parts, fmt.Sprintf("%d before maxResults cap; %d dropped", out.Meta.ResultsBeforeCap, out.Meta.DroppedByCap))
	}
	if out.Meta.EngineCount > 0 {
		parts = append(parts, fmt.Sprintf("%d engine(s)", out.Meta.EngineCount))
	}
	if out.TotalTime > 0 {
		parts = append(parts, fmt.Sprintf("%dms", out.TotalTime))
	}
	if len(out.Meta.SourceOverlap) > 0 {
		parts = append(parts, "top sources: "+formatSourceOverlap(out.Meta.SourceOverlap, 5))
	}
	return strings.Join(parts, "; ") + "."
}

func searchVisibleContent(out tools.SearchOutput, mode string, scrapeEnabled bool) []mcp.Content {
	text := searchVisibleText(out, mode, scrapeEnabled)
	if text == "" {
		return []mcp.Content{}
	}
	return []mcp.Content{&mcp.TextContent{Text: text}}
}

func searchVisibleText(out tools.SearchOutput, mode string, scrapeEnabled bool) string {
	guidance := searchFollowupGuidance(scrapeEnabled)
	switch mode {
	case config.SEARCH_TEXT_NONE:
		return ""
	case config.SEARCH_TEXT_BREAKDOWN:
		return strings.Join([]string{searchBreakdownLine(out), searchOutputExplanation(), guidance}, "\n\n")
	case config.SEARCH_TEXT_RESULTS:
		return strings.Join([]string{searchResultsText(out), guidance}, "\n\n")
	case config.SEARCH_TEXT_FULL, "":
		return strings.Join([]string{searchBreakdownLine(out), searchOutputExplanation(), searchResultsText(out), guidance}, "\n\n")
	default:
		return strings.Join([]string{searchBreakdownLine(out), searchOutputExplanation(), searchResultsText(out), guidance}, "\n\n")
	}
}

func searchOutputExplanation() string {
	return "Visible text: model-readable search context. structuredContent: exact JSON with full result objects, engine timings, related searches, cap/source metadata, and follow-up guidance. Use visible text when your client/model does not reliably expose structuredContent; use structuredContent when exact fields are available."
}

func searchStructuredSummary(out tools.SearchOutput, scrapeEnabled bool) string {
	return searchBreakdownLine(out) + " " + searchFollowupGuidance(scrapeEnabled)
}

func searchFollowupGuidance(scrapeEnabled bool) string {
	if !scrapeEnabled {
		return "No scrape tool is available on this MCP server. Use returned snippets, titles, URLs, related searches, and source metadata as the available evidence."
	}
	return "Use snippets for simple answers. For research or when snippets are insufficient, call scrape automatically on the most relevant returned URLs from this search; do not ask permission unless your client requires it."
}

func searchResultsText(out tools.SearchOutput) string {
	if len(out.Results) == 0 {
		return "Results: none returned."
	}

	var b strings.Builder
	b.WriteString("Results:\n")
	for i, r := range out.Results {
		title := cleanLine(r.Title)
		if title == "" {
			title = "Untitled result"
		}
		b.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
		if strings.TrimSpace(r.URL) != "" {
			b.WriteString(fmt.Sprintf("   URL: %s\n", strings.TrimSpace(r.URL)))
		}
		if len(r.Sources) > 0 {
			b.WriteString(fmt.Sprintf("   Sources: %s\n", strings.Join(r.Sources, ", ")))
		} else if strings.TrimSpace(r.Source) != "" {
			b.WriteString(fmt.Sprintf("   Source: %s\n", strings.TrimSpace(r.Source)))
		}
		if snippet := cleanLine(r.Snippet); snippet != "" {
			b.WriteString(fmt.Sprintf("   Snippet: %s\n", snippet))
		}
		if i < len(out.Results)-1 {
			b.WriteString("\n")
		}
	}

	if len(out.RelatedSearches) > 0 {
		b.WriteString("\n\nRelated searches:\n")
		for _, related := range out.RelatedSearches {
			if clean := cleanLine(related); clean != "" {
				b.WriteString("- ")
				b.WriteString(clean)
				b.WriteString("\n")
			}
		}
	}

	return b.String()
}

func cleanLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func sourceOverlap(results []degoog.Hit) []tools.SourceOverlap {
	counts := make(map[string]int)
	for _, r := range results {
		if len(r.Sources) == 0 && r.Source != "" {
			counts[r.Source]++
			continue
		}
		for _, source := range r.Sources {
			source = strings.TrimSpace(source)
			if source != "" {
				counts[source]++
			}
		}
	}
	out := make([]tools.SourceOverlap, 0, len(counts))
	for source, count := range counts {
		out = append(out, tools.SourceOverlap{Source: source, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count == out[j].Count {
			return out[i].Source < out[j].Source
		}
		return out[i].Count > out[j].Count
	})
	return out
}

func formatSourceOverlap(overlap []tools.SourceOverlap, max int) string {
	if max > len(overlap) {
		max = len(overlap)
	}
	parts := make([]string, 0, max)
	for _, item := range overlap[:max] {
		parts = append(parts, fmt.Sprintf("%s=%d", item.Source, item.Count))
	}
	return strings.Join(parts, ", ")
}
