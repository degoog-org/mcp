package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"degoog-mcp/internal/degoog"
)

const (
	FIXTURE_API_KEY = "deadbeefcafef00d"
	FIXTURE_QUERY   = "rust lifetimes"
)

func fixtureResp() degoog.Response {
	return degoog.Response{
		Results: []degoog.Hit{
			{
				Title:   "Lifetimes - The Rust Programming Language",
				URL:     "https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html",
				Snippet: "Every reference in Rust has a lifetime...",
				Source:  "google",
				Score:   92,
				Sources: []string{"google", "duckduckgo"},
			},
		},
		Query:           FIXTURE_QUERY,
		TotalTime:       812,
		Type:            degoog.TYPE_WEB,
		EngineTimings:   []degoog.EngineTiming{{Name: "Google", Time: 540, ResultCount: 10}},
		RelatedSearches: []string{"rust lifetime elision"},
	}
}

func TestSearchHappyPath(t *testing.T) {
	var gotPath, gotQuery, gotAuth, gotAccept string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		gotAccept = r.Header.Get("Accept")
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(fixtureResp()); err != nil {
			t.Fatalf("encode: %v", err)
		}
	}))
	defer srv.Close()

	c := degoog.New(srv.URL, FIXTURE_API_KEY, 5*time.Second, 0)
	resp, err := c.Search(context.Background(), degoog.SearchParams{
		Query: FIXTURE_QUERY,
		Type:  degoog.TYPE_WEB,
		Page:  2,
		Lang:  "en",
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	if gotPath != degoog.PATH_SEARCH {
		t.Errorf("path: want %s, got %s", degoog.PATH_SEARCH, gotPath)
	}
	if !strings.Contains(gotQuery, "q=rust+lifetimes") {
		t.Errorf("query missing q: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "type=web") {
		t.Errorf("query missing type: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "page=2") {
		t.Errorf("query missing page: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "lang=en") {
		t.Errorf("query missing lang: %s", gotQuery)
	}
	if gotAuth != "Bearer "+FIXTURE_API_KEY {
		t.Errorf("auth header: want bearer %s, got %q", FIXTURE_API_KEY, gotAuth)
	}
	if gotAccept != degoog.ACCEPT_JSON {
		t.Errorf("accept header: want %s, got %s", degoog.ACCEPT_JSON, gotAccept)
	}

	if len(resp.Results) != 1 {
		t.Fatalf("results: want 1, got %d", len(resp.Results))
	}
	if resp.Results[0].Score != 92 {
		t.Errorf("score: want 92, got %d", resp.Results[0].Score)
	}
	if resp.TotalTime != 812 {
		t.Errorf("totalTime: want 812, got %d", resp.TotalTime)
	}
	if len(resp.EngineTimings) != 1 || resp.EngineTimings[0].Name != "Google" {
		t.Errorf("engineTimings mismatch: %+v", resp.EngineTimings)
	}
	if len(resp.RelatedSearches) != 1 {
		t.Errorf("relatedSearches missing")
	}
}

func TestSearchNoAPIKey(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewEncoder(w).Encode(fixtureResp()); err != nil {
			t.Fatalf("encode: %v", err)
		}
	}))
	defer srv.Close()

	c := degoog.New(srv.URL, "", 5*time.Second, 0)
	if _, err := c.Search(context.Background(), degoog.SearchParams{Query: FIXTURE_QUERY}); err != nil {
		t.Fatalf("search: %v", err)
	}
	if gotAuth != "" {
		t.Errorf("expected no auth header, got %q", gotAuth)
	}
}

func TestSearchEmptyQuery(t *testing.T) {
	c := degoog.New("http://unused", "", time.Second, 0)
	_, err := c.Search(context.Background(), degoog.SearchParams{Query: "   "})
	if err != degoog.ErrEmptyQuery {
		t.Errorf("want ErrEmptyQuery, got %v", err)
	}
}

func TestSearchBadPage(t *testing.T) {
	c := degoog.New("http://unused", "", time.Second, 0)
	_, err := c.Search(context.Background(), degoog.SearchParams{Query: "x", Page: 99})
	if err != degoog.ErrBadPage {
		t.Errorf("want ErrBadPage, got %v", err)
	}
}

func TestSearchEnginesPost(t *testing.T) {
	var gotMethod, gotContentType string
	var gotBody struct {
		Query   string   `json:"query"`
		Engines []string `json:"engines"`
		Type    string   `json:"type"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotContentType = r.Header.Get("Content-Type")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if err := json.NewEncoder(w).Encode(fixtureResp()); err != nil {
			t.Fatalf("encode: %v", err)
		}
	}))
	defer srv.Close()

	c := degoog.New(srv.URL, "", 5*time.Second, 0)
	if _, err := c.Search(context.Background(), degoog.SearchParams{
		Query:   FIXTURE_QUERY,
		Type:    degoog.TYPE_WEB,
		Engines: []string{"brave", "duckduckgo"},
	}); err != nil {
		t.Fatalf("search: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method: want POST, got %s", gotMethod)
	}
	if gotContentType != degoog.CONTENT_JSON {
		t.Errorf("content-type: want %s, got %s", degoog.CONTENT_JSON, gotContentType)
	}
	if gotBody.Query != FIXTURE_QUERY {
		t.Errorf("body query: want %q, got %q", FIXTURE_QUERY, gotBody.Query)
	}
	if len(gotBody.Engines) != 2 || gotBody.Engines[0] != "brave" {
		t.Errorf("body engines mismatch: %v", gotBody.Engines)
	}
}

func TestSearchMaxResults(t *testing.T) {
	resp := fixtureResp()
	resp.Results = []degoog.Hit{
		{Title: "a", URL: "https://a", Score: 90},
		{Title: "b", URL: "https://b", Score: 80},
		{Title: "c", URL: "https://c", Score: 70},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			t.Fatalf("encode: %v", err)
		}
	}))
	defer srv.Close()

	c := degoog.New(srv.URL, "", 5*time.Second, 0)
	got, err := c.Search(context.Background(), degoog.SearchParams{Query: FIXTURE_QUERY, MaxResults: 2})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got.Results) != 2 {
		t.Fatalf("results: want 2 after cap, got %d", len(got.Results))
	}
	if got.Results[0].URL != "https://a" || got.Results[1].URL != "https://b" {
		t.Errorf("cap should keep top-scored order, got %+v", got.Results)
	}
}

func TestSearchUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := degoog.New(srv.URL, "wrong-key", time.Second, 0)
	_, err := c.Search(context.Background(), degoog.SearchParams{Query: FIXTURE_QUERY})
	if err == nil {
		t.Fatalf("expected error on 401")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention status 401, got %v", err)
	}
}
