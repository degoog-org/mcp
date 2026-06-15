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
}

func newSearchH(c *degoog.Client, cfg *config.Config) *searchHandler {
	return &searchHandler{
		client:         c,
		defaultEngines: cfg.Engines,
		defaultMax:     cfg.MaxResults,
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
	out.Summary = searchSummary(out)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: out.Summary}}}, out, nil
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

func searchSummary(out tools.SearchOutput) string {
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
	return strings.Join(parts, "; ") + ". Structured content contains full results, timings, related searches, and cap/source metadata; call scrape with selected URLs for article text."
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
