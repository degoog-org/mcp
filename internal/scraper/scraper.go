package scraper

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	md "github.com/JohannesKaufmann/html-to-markdown"
	"github.com/go-shiori/go-readability"

	"degoog-mcp/internal/cache"
	"degoog-mcp/internal/logger"
)

const (
	TRUNCATE_NOTE = "\n\n... [content truncated: middle removed to fit token budget] ...\n\n"
	ERR_TIMEOUT   = "timeout"
)

type Result struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Content string `json:"content,omitempty"`
	Error   string `json:"error,omitempty"`
}

type Scraper struct {
	client    *http.Client
	cache     *cache.Cache
	conv      *md.Converter
	timeout   time.Duration
	maxLength int
}

func New(c *cache.Cache, ua string, timeout time.Duration, maxLen int) *Scraper {
	return &Scraper{
		client:    Polyjuice(ua),
		cache:     c,
		conv:      md.NewConverter("", true, nil),
		timeout:   timeout,
		maxLength: maxLen,
	}
}

func (s *Scraper) ScrapeMany(ctx context.Context, urls []string) []Result {
	results := make([]Result, len(urls))
	var wg sync.WaitGroup
	for i, raw := range urls {
		wg.Add(1)
		go func(idx int, target string) {
			defer wg.Done()
			results[idx] = s.scrapeOne(ctx, target)
		}(i, raw)
	}
	wg.Wait()

	kept := make([]Result, 0, len(results))
	for _, r := range results {
		if r.Error != "" {
			logger.Get().Warn("scraper: discarding url=%s reason=%s", r.URL, r.Error)
			continue
		}
		kept = append(kept, r)
	}
	return kept
}

func (s *Scraper) scrapeOne(ctx context.Context, raw string) Result {
	res := Result{URL: raw}

	if cached, ok := s.cache.Get(raw); ok {
		logger.Get().Debug("scraper: cache hit url=%s", raw)
		res.Content = cached
		return res
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		res.Error = fmt.Sprintf("invalid url: %v", err)
		logger.Get().Error("scraper: invalid url=%s: %v", raw, err)
		return res
	}

	fetchCtx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, raw, nil)
	if err != nil {
		res.Error = fmt.Sprintf("build request: %v", err)
		logger.Get().Error("scraper: build request url=%s: %v", raw, err)
		return res
	}

	resp, err := s.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			res.Error = ERR_TIMEOUT
		} else {
			res.Error = fmt.Sprintf("fetch: %v", err)
		}
		logger.Get().Warn("scraper: fetch url=%s: %v", raw, err)
		return res
	}
	defer func() {
		if cerr := resp.Body.Close(); cerr != nil {
			logger.Get().Warn("scraper: body close url=%s: %v", raw, cerr)
		}
	}()

	if resp.StatusCode >= http.StatusBadRequest {
		res.Error = fmt.Sprintf("http %d", resp.StatusCode)
		logger.Get().Warn("scraper: bad status url=%s status=%d", raw, resp.StatusCode)
		return res
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		res.Error = fmt.Sprintf("read body: %v", err)
		logger.Get().Error("scraper: read body url=%s: %v", raw, err)
		return res
	}

	article, err := readability.FromReader(strings.NewReader(string(body)), parsed)
	if err != nil {
		res.Error = fmt.Sprintf("readability: %v", err)
		logger.Get().Warn("scraper: readability url=%s: %v", raw, err)
		return res
	}

	markdown, err := s.conv.ConvertString(article.Content)
	if err != nil {
		res.Error = fmt.Sprintf("markdown: %v", err)
		logger.Get().Error("scraper: convert url=%s: %v", raw, err)
		return res
	}

	trimmed := Thanos(markdown, s.maxLength)
	res.Title = article.Title
	res.Content = trimmed
	s.cache.Set(raw, trimmed)
	logger.Get().Info("scraper: ok url=%s title=%q bytes=%d", raw, res.Title, len(trimmed))
	return res
}

func Thanos(s string, maxLen int) string {
	if maxLen <= 0 || len(s) <= maxLen {
		return s
	}
	note := TRUNCATE_NOTE
	if maxLen <= len(note) {
		return s[:maxLen]
	}
	half := (maxLen - len(note)) / 2
	if half <= 0 {
		return s[:maxLen]
	}
	return s[:half] + note + s[len(s)-half:]
}
