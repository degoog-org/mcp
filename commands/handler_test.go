package commands

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/config"
	"degoog-mcp/internal/degoog"
	"degoog-mcp/internal/scraper"
	"degoog-mcp/tools"
)

func TestSearchHandlerReturnsConciseTextAndStructuredMetadata(t *testing.T) {
	resp := degoog.Response{
		Results: []degoog.Hit{
			{Title: "a", URL: "https://a.example", Source: "brave", Score: 10, Sources: []string{"brave", "duckduckgo"}},
			{Title: "b", URL: "https://b.example", Source: "brave", Score: 9, Sources: []string{"brave"}},
			{Title: "c", URL: "https://c.example", Source: "bing", Score: 8, Sources: []string{"bing"}},
		},
		Query:         "agent ergonomics",
		Type:          degoog.TYPE_WEB,
		TotalTime:     123,
		EngineTimings: []degoog.EngineTiming{{Name: "Brave", Time: 40, ResultCount: 2}},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}))
	defer srv.Close()

	h := newSearchH(degoog.New(srv.URL, "", time.Second, 0), &config.Config{})
	call, out, err := h.handle(context.Background(), &mcp.CallToolRequest{}, tools.SearchInput{Query: "agent ergonomics", MaxResults: 2})
	if err != nil {
		t.Fatalf("handle: %v", err)
	}
	if call == nil || len(call.Content) != 1 {
		t.Fatalf("expected concise text content, got %#v", call)
	}
	text, ok := call.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content should be text, got %T", call.Content[0])
	}
	if strings.HasPrefix(strings.TrimSpace(text.Text), "{") {
		t.Fatalf("text content should be a concise summary, not raw JSON: %s", text.Text)
	}
	if !strings.Contains(text.Text, "3 before maxResults cap; 1 dropped") {
		t.Fatalf("summary missing cap metadata: %s", text.Text)
	}
	if out.Meta.ReturnedResults != 2 || out.Meta.ResultsBeforeCap != 3 || out.Meta.DroppedByCap != 1 || !out.Meta.CapApplied {
		t.Fatalf("bad meta: %+v", out.Meta)
	}
	if len(out.Meta.SourceOverlap) == 0 || out.Meta.SourceOverlap[0].Source != "brave" || out.Meta.SourceOverlap[0].Count != 2 {
		t.Fatalf("bad source overlap: %+v", out.Meta.SourceOverlap)
	}
}

func TestScrapeHelpersCountAndSummarizeFailures(t *testing.T) {
	results := []scraper.Result{
		{URL: "https://ok.example", Title: "ok", Content: "body"},
		{URL: "https://bad.example", Error: "http 403"},
	}
	successes, failures := scrapeCounts(results)
	if successes != 1 || failures != 1 {
		t.Fatalf("counts: got %d/%d", successes, failures)
	}
	summary := scrapeSummary(tools.ScrapeOutput{Results: results, SuccessCount: successes, FailureCount: failures})
	if !strings.Contains(summary, "https://bad.example: http 403") {
		t.Fatalf("summary missing failed url: %s", summary)
	}
}
