package commands

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/degoog"
	"degoog-mcp/internal/logger"
	"degoog-mcp/tools"
)

type searchHandler struct {
	client *degoog.Client
}

func newSearchH(c *degoog.Client) *searchHandler {
	return &searchHandler{client: c}
}

func (h *searchHandler) handle(ctx context.Context, req *mcp.CallToolRequest, in tools.SearchInput) (*mcp.CallToolResult, tools.SearchOutput, error) {
	logger.Get().Info("search: q=%q type=%q page=%d time=%q lang=%q", in.Query, in.Type, in.Page, in.Time, in.Lang)

	resp, err := h.client.Search(ctx, degoog.SearchParams{
		Query:    in.Query,
		Type:     in.Type,
		Page:     in.Page,
		Time:     in.Time,
		Lang:     in.Lang,
		DateFrom: in.DateFrom,
		DateTo:   in.DateTo,
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
