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
	TRUNCATE_NOTE       = "\n\n... [content truncated: middle removed to fit token budget] ...\n\n"
	ERR_TIMEOUT         = "timeout"
	DEFAULT_MAX_URLS    = 8
	DEFAULT_CONCURRENCY = 4
	DEFAULT_MAX_BYTES   = 2 * 1024 * 1024
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
	maxURLs   int
	concur    int
	maxBytes  int64
}

type Options struct {
	MaxLength   int
	MaxURLs     int
	Concurrency int
	MaxBytes    int64
}

New creates a Scraper with the provided cache, user agent, timeout, and maximum markdown length, using default values for other configuration options.
func New(c *cache.Cache, ua string, timeout time.Duration, maxLen int) *Scraper {
	return NewWithOptions(c, ua, timeout, Options{MaxLength: maxLen})
}

NewWithOptions creates a Scraper initialized with the provided cache, user agent, timeout, and options, applying defaults to unspecified option values.
func NewWithOptions(c *cache.Cache, ua string, timeout time.Duration, opts Options) *Scraper {
	opts = fillOpts(opts)
	return &Scraper{
		client:    Polyjuice(ua),
		cache:     c,
		conv:      md.NewConverter("", true, nil),
		timeout:   timeout,
		maxLength: opts.MaxLength,
		maxURLs:   opts.MaxURLs,
		concur:    opts.Concurrency,
		maxBytes:  opts.MaxBytes,
	}
}

// fillOpts returns opts with zero or negative fields populated with default values.
func fillOpts(opts Options) Options {
	if opts.MaxURLs <= 0 {
		opts.MaxURLs = DEFAULT_MAX_URLS
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = DEFAULT_CONCURRENCY
	}
	if opts.MaxBytes <= 0 {
		opts.MaxBytes = DEFAULT_MAX_BYTES
	}
	return opts
}

func (s *Scraper) MaxURLs() int {
	return s.maxURLs
}

func (s *Scraper) ScrapeMany(ctx context.Context, urls []string) []Result {
	results := make([]Result, len(urls))
	var wg sync.WaitGroup
	sem := make(chan struct{}, s.concur)
	for i, raw := range urls {
		wg.Add(1)
		go func(idx int, target string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[idx] = s.scrapeOne(ctx, target)
		}(i, raw)
	}
	wg.Wait()

	for _, r := range results {
		if r.Error != "" {
			logger.Get().Warn("scraper: failed url=%s reason=%s", r.URL, r.Error)
		}
	}
	return results
}

func (s *Scraper) scrapeOne(ctx context.Context, raw string) Result {
	res := Result{URL: raw}

	parsed, err := url.Parse(raw)
	if err != nil {
		res.Error = fmt.Sprintf("invalid url: %v", err)
		logger.Get().Error("scraper: invalid url=%s: %v", raw, err)
		return res
	}
	if err := CheckURL(ctx, parsed); err != nil {
		res.Error = fmt.Sprintf("blocked url: %v", err)
		logger.Get().Warn("scraper: rejected url=%s: %v", raw, err)
		return res
	}

	if cached, ok := s.cache.Get(raw); ok {
		logger.Get().Debug("scraper: cache hit url=%s", raw)
		res.Content = cached
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

	body, cut, err := readCap(resp.Body, s.maxBytes)
	if err != nil {
		res.Error = fmt.Sprintf("read body: %v", err)
		logger.Get().Error("scraper: read body url=%s: %v", raw, err)
		return res
	}
	if cut {
		logger.Get().Warn("scraper: response truncated before readability url=%s limit=%d", raw, s.maxBytes)
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

// readCap reads from r and returns up to maxBytes of data, with a boolean indicating whether the stream contained additional unread data. If maxBytes is zero or negative, the entire stream is read with no truncation indication.
func readCap(r io.Reader, maxBytes int64) ([]byte, bool, error) {
	if maxBytes <= 0 {
		body, err := io.ReadAll(r)
		return body, false, err
	}

	body, err := io.ReadAll(io.LimitReader(r, maxBytes+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(body)) <= maxBytes {
		return body, false, nil
	}
	return body[:maxBytes], true, nil
}

// Thanos truncates a string using middle truncation when it exceeds maxLen, keeping the start and end while inserting a truncation marker between them.
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
