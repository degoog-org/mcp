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

func sampleSearchResponse() degoog.Response {
	return degoog.Response{
		Results: []degoog.Hit{
			{Title: "First cast result", URL: "https://a.example/cast", Snippet: "Kurt Russell, Wyatt Russell, Anna Sawai, Kiersey Clemons, Ren Watabe, Mari Yamamoto, Anders Holm, Joe Tippett, and Elisa Lasowski star in the series.", Source: "brave", Score: 10, Sources: []string{"brave", "duckduckgo"}},
			{Title: "Second cast result", URL: "https://b.example/cast", Snippet: "The Apple TV+ series includes Kurt Russell and Wyatt Russell as Lee Shaw, with Anna Sawai and Kiersey Clemons in lead roles.", Source: "brave", Score: 9, Sources: []string{"brave"}},
			{Title: "Third cast result", URL: "https://c.example/cast", Snippet: "Cast and character guide for the MonsterVerse show.", Source: "bing", Score: 8, Sources: []string{"bing"}},
		},
		Query:         "agent ergonomics",
		Type:          degoog.TYPE_WEB,
		TotalTime:     123,
		EngineTimings: []degoog.EngineTiming{{Name: "Brave", Time: 40, ResultCount: 2}},
	}
}

func newSearchTestHandler(t *testing.T, cfg *config.Config) *searchHandler {
	t.Helper()
	resp := sampleSearchResponse()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}))
	t.Cleanup(srv.Close)
	return newSearchH(degoog.New(srv.URL, "", time.Second, 0), cfg)
}

func callSearchText(t *testing.T, h *searchHandler) (string, tools.SearchOutput, int) {
	t.Helper()
	call, out, err := h.handle(context.Background(), &mcp.CallToolRequest{}, tools.SearchInput{Query: "agent ergonomics", MaxResults: 2})
	if err != nil {
		t.Fatalf("handle: %v", err)
	}
	if call == nil {
		t.Fatalf("expected call result")
	}
	if len(call.Content) == 0 {
		return "", out, 0
	}
	text, ok := call.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content should be text, got %T", call.Content[0])
	}
	return text.Text, out, len(call.Content)
}

func TestSearchTextFullIncludesStatusResultsAndGuidance(t *testing.T) {
	h := newSearchTestHandler(t, &config.Config{SearchText: config.SEARCH_TEXT_FULL})
	text, out, contentCount := callSearchText(t, h)

	if contentCount != 1 {
		t.Fatalf("expected one visible text block, got %d", contentCount)
	}
	if strings.HasPrefix(strings.TrimSpace(text), "{") {
		t.Fatalf("visible text should be readable text, not raw JSON: %s", text)
	}
	for _, want := range []string{
		"Degoog web search for",
		"3 before maxResults cap; 1 dropped",
		"Visible text:",
		"structuredContent:",
		"Results:",
		"1. First cast result",
		"https://a.example/cast",
		"Kurt Russell",
		"2. Second cast result",
		"https://b.example/cast",
		"For research or when snippets are insufficient",
		"call scrape automatically",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("full visible text missing %q: %s", want, text)
		}
	}
	if out.Meta.ReturnedResults != 2 || out.Meta.ResultsBeforeCap != 3 || out.Meta.DroppedByCap != 1 || !out.Meta.CapApplied {
		t.Fatalf("bad meta: %+v", out.Meta)
	}
	if len(out.Meta.SourceOverlap) == 0 || out.Meta.SourceOverlap[0].Source != "brave" || out.Meta.SourceOverlap[0].Count != 2 {
		t.Fatalf("bad source overlap: %+v", out.Meta.SourceOverlap)
	}
}

func TestSearchTextModesAreComposable(t *testing.T) {
	t.Run("results only", func(t *testing.T) {
		h := newSearchTestHandler(t, &config.Config{SearchText: config.SEARCH_TEXT_RESULTS})
		text, _, contentCount := callSearchText(t, h)
		if contentCount != 1 {
			t.Fatalf("expected one visible text block, got %d", contentCount)
		}
		for _, want := range []string{"Results:", "1. First cast result", "https://a.example/cast", "call scrape automatically"} {
			if !strings.Contains(text, want) {
				t.Fatalf("results text missing %q: %s", want, text)
			}
		}
		for _, notWant := range []string{"Degoog web search for", "Visible text:", "structuredContent:"} {
			if strings.Contains(text, notWant) {
				t.Fatalf("results text should not contain %q: %s", notWant, text)
			}
		}
	})

	t.Run("breakdown only", func(t *testing.T) {
		h := newSearchTestHandler(t, &config.Config{SearchText: config.SEARCH_TEXT_BREAKDOWN})
		text, out, contentCount := callSearchText(t, h)
		if contentCount != 1 {
			t.Fatalf("expected one visible text block, got %d", contentCount)
		}
		for _, want := range []string{"Degoog web search for", "Visible text:", "structuredContent:", "call scrape automatically"} {
			if !strings.Contains(text, want) {
				t.Fatalf("breakdown text missing %q: %s", want, text)
			}
		}
		if !strings.Contains(out.Summary, "call scrape automatically") {
			t.Fatalf("structured summary should include follow-up guidance: %s", out.Summary)
		}
		if strings.Contains(text, "1. First cast result") || strings.Contains(text, "Results:") {
			t.Fatalf("breakdown text should not contain result rows: %s", text)
		}
	})

	t.Run("none", func(t *testing.T) {
		h := newSearchTestHandler(t, &config.Config{SearchText: config.SEARCH_TEXT_NONE})
		text, out, contentCount := callSearchText(t, h)
		if contentCount != 0 || text != "" {
			t.Fatalf("none mode should emit no visible text, count=%d text=%q", contentCount, text)
		}
		if !strings.Contains(out.Summary, "call scrape automatically") {
			t.Fatalf("none mode structured summary should still guide MCP clients that read structuredContent: %s", out.Summary)
		}
	})

	t.Run("scrape disabled", func(t *testing.T) {
		h := newSearchTestHandler(t, &config.Config{SearchText: config.SEARCH_TEXT_BREAKDOWN, DisableScrape: true})
		text, out, contentCount := callSearchText(t, h)
		if contentCount != 1 {
			t.Fatalf("expected one visible text block, got %d", contentCount)
		}
		for _, got := range []string{text, out.Summary} {
			if strings.Contains(got, "call scrape") {
				t.Fatalf("scrape-disabled guidance should not tell agents to call scrape: %s", got)
			}
			if !strings.Contains(got, "No scrape tool is available") {
				t.Fatalf("scrape-disabled guidance should explain scrape is unavailable: %s", got)
			}
		}
	})
}

func TestScrapeHelpersCountAndSummarizeFailures(t *testing.T) {
	results := []scraper.Result{
		{URL: "https://ok.example", Title: "ok", Content: "body"},
		{URL: "https://bad.example", Error: "lookup bad.example on 127.0.0.11:53: no such host"},
	}
	successes, failures := scrapeCounts(results)
	if successes != 1 || failures != 1 {
		t.Fatalf("counts: got %d/%d", successes, failures)
	}
	summary := scrapeSummary(tools.ScrapeOutput{Results: results, SuccessCount: successes, FailureCount: failures})
	if !strings.Contains(summary, "https://bad.example: DNS lookup failed for bad.example: no such host") {
		t.Fatalf("summary missing failed url: %s", summary)
	}
	if strings.Contains(summary, "127.0.0.11:53") {
		t.Fatalf("summary should hide Docker DNS resolver internals: %s", summary)
	}
	if !strings.Contains(summary, "Do not stop") || !strings.Contains(summary, "previous search results") {
		t.Fatalf("summary should tell agents to continue from available context: %s", summary)
	}
	if !strings.Contains(summary, "Tell the user which URLs failed") || !strings.Contains(summary, "alongside the available results") {
		t.Fatalf("summary should tell agents to disclose failures with results: %s", summary)
	}
}

func TestRegisterCanDisableScrapeTool(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	registered := Register(server, nil, nil, &config.Config{DisableScrape: true})
	if len(registered) != 1 || registered[0] != tools.SEARCH_NAME {
		t.Fatalf("registered tools with scrape disabled: got %#v", registered)
	}
}

func TestToolDescriptionsGuideModelsAwayFromInventedScrapeURLs(t *testing.T) {
	searchDesc := tools.SearchTool().Description
	for _, want := range []string{"Visible text", "structuredContent", "answer from snippets", "Do not invent URLs", "If snippets are insufficient", "call scrape"} {
		if !strings.Contains(searchDesc, want) {
			t.Fatalf("search description missing %q: %s", want, searchDesc)
		}
	}
	if strings.Contains(strings.ToLower(searchDesc), "concise summary") {
		t.Fatalf("search description should not call visible text a summary: %s", searchDesc)
	}

	searchOnlyDesc := tools.SearchTool(false).Description
	if !strings.Contains(searchOnlyDesc, "No scrape tool is available") {
		t.Fatalf("search-only description should mention scrape is unavailable: %s", searchOnlyDesc)
	}
	for _, forbidden := range []string{"scrape only promising URLs", "Use scrape on selected URLs", "If scrape fails"} {
		if strings.Contains(searchOnlyDesc, forbidden) {
			t.Fatalf("search-only description should not include scrape-use instruction %q: %s", forbidden, searchOnlyDesc)
		}
	}

	scrapeDesc := tools.ScrapeTool().Description
	for _, want := range []string{"Do not invent", "only URLs returned by search", "Use this automatically", "do not stop", "Tell the user which URLs failed"} {
		if !strings.Contains(scrapeDesc, want) {
			t.Fatalf("scrape description missing %q: %s", want, scrapeDesc)
		}
	}
}
