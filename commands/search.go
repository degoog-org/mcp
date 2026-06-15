package commands

import (
	"context"

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

	return nil, tools.SearchOutput{
		Results:         resp.Results,
		Query:           resp.Query,
		TotalTime:       resp.TotalTime,
		Type:            resp.Type,
		EngineTimings:   resp.EngineTimings,
		RelatedSearches: resp.RelatedSearches,
	}, nil
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
