package degoog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"degoog-mcp/internal/logger"
)

const (
	PATH_SEARCH    = "/api/search"
	HEADER_AUTH    = "Authorization"
	HEADER_ACCEPT  = "Accept"
	HEADER_CONTENT = "Content-Type"
	ACCEPT_JSON    = "application/json"
	CONTENT_JSON   = "application/json"
	BEARER_PREFIX  = "Bearer "

	PARAM_Q        = "q"
	PARAM_TYPE     = "type"
	PARAM_PAGE     = "page"
	PARAM_TIME     = "time"
	PARAM_LANG     = "lang"
	PARAM_DATEFROM = "dateFrom"
	PARAM_DATETO   = "dateTo"

	TYPE_WEB    = "web"
	TYPE_IMAGES = "images"
	TYPE_VIDEOS = "videos"
	TYPE_NEWS   = "news"

	TIME_ANY    = "any"
	TIME_HOUR   = "hour"
	TIME_DAY    = "day"
	TIME_WEEK   = "week"
	TIME_MONTH  = "month"
	TIME_YEAR   = "year"
	TIME_CUSTOM = "custom"

	MAX_PAGE = 10
)

var (
	ErrEmptyQuery = errors.New("degoog: query is required")
	ErrBadPage    = errors.New("degoog: page must be between 1 and 10")
)

type Hit struct {
	Title   string   `json:"title"`
	URL     string   `json:"url"`
	Snippet string   `json:"snippet"`
	Source  string   `json:"source,omitempty"`
	Score   int      `json:"score,omitempty"`
	Sources []string `json:"sources,omitempty"`
}

type EngineTiming struct {
	Name        string `json:"name"`
	Time        int    `json:"time"`
	ResultCount int    `json:"resultCount"`
	Status      string `json:"status,omitempty"`
	ErrorReason string `json:"errorReason,omitempty"`
	HTTPStatus  int    `json:"httpStatus,omitempty"`
	Indexed     *bool  `json:"indexed,omitempty"`
}

type Response struct {
	Results          []Hit          `json:"results"`
	Query            string         `json:"query"`
	TotalTime        int            `json:"totalTime"`
	Type             string         `json:"type"`
	EngineTimings    []EngineTiming `json:"engineTimings,omitempty"`
	RelatedSearches  []string       `json:"relatedSearches,omitempty"`
	ResultsBeforeCap int            `json:"-"`
	ResultsDropped   int            `json:"-"`
}

type SearchParams struct {
	Query      string
	Type       string
	Page       int
	Time       string
	Lang       string
	DateFrom   string
	DateTo     string
	Engines    []string
	MaxResults int
}

type searchBody struct {
	Query    string   `json:"query"`
	Engines  []string `json:"engines"`
	Type     string   `json:"type,omitempty"`
	Page     int      `json:"page,omitempty"`
	Time     string   `json:"time,omitempty"`
	Lang     string   `json:"lang,omitempty"`
	DateFrom string   `json:"dateFrom,omitempty"`
	DateTo   string   `json:"dateTo,omitempty"`
}

type Client struct {
	base     string
	apiKey   string
	maxBytes int64
	http     *http.Client
}

func New(base, apiKey string, timeout time.Duration, maxBytes int64) *Client {
	return &Client{
		base:     strings.TrimRight(base, "/"),
		apiKey:   apiKey,
		maxBytes: maxBytes,
		http:     &http.Client{Timeout: timeout},
	}
}

func (c *Client) errBodyReader(r io.Reader) io.Reader {
	if c.maxBytes <= 0 {
		return r
	}
	return io.LimitReader(r, c.maxBytes)
}

func (c *Client) Search(ctx context.Context, p SearchParams) (*Response, error) {
	q := strings.TrimSpace(p.Query)
	if q == "" {
		return nil, ErrEmptyQuery
	}
	if p.Page < 0 || p.Page > MAX_PAGE {
		return nil, ErrBadPage
	}
	p.Query = q

	req, err := c.buildReq(ctx, p)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		logger.Get().Warn("degoog: request failed url=%s: %v", req.URL.String(), err)
		return nil, err
	}
	defer func() {
		if cerr := resp.Body.Close(); cerr != nil {
			logger.Get().Warn("degoog: body close: %v", cerr)
		}
	}()

	if resp.StatusCode >= http.StatusBadRequest {
		body, rerr := io.ReadAll(c.errBodyReader(resp.Body))
		if rerr != nil {
			logger.Get().Warn("degoog: error body read: %v", rerr)
		}
		statusErr := fmt.Errorf("degoog: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		logger.Get().Error("%v", statusErr)
		return nil, statusErr
	}

	var out Response
	if derr := json.NewDecoder(resp.Body).Decode(&out); derr != nil {
		logger.Get().Error("degoog: decode failed: %v", derr)
		return nil, derr
	}

	out.ResultsBeforeCap = len(out.Results)
	trimmed := capResults(&out, p.MaxResults)
	out.ResultsDropped = trimmed
	logger.Get().Info("degoog: ok q=%q type=%q engines=%d hits=%d capped=%d took=%dms", q, out.Type, len(p.Engines), len(out.Results), trimmed, out.TotalTime)
	return &out, nil
}

func (c *Client) buildReq(ctx context.Context, p SearchParams) (*http.Request, error) {
	if len(p.Engines) > 0 {
		return c.postReq(ctx, p)
	}
	return c.getReq(ctx, p)
}

func (c *Client) getReq(ctx context.Context, p SearchParams) (*http.Request, error) {
	u, err := url.Parse(c.base + PATH_SEARCH)
	if err != nil {
		logger.Get().Error("degoog: invalid base url=%s: %v", c.base, err)
		return nil, err
	}

	qp := u.Query()
	qp.Set(PARAM_Q, p.Query)
	if p.Type != "" {
		qp.Set(PARAM_TYPE, p.Type)
	}
	if p.Page > 0 {
		qp.Set(PARAM_PAGE, strconv.Itoa(p.Page))
	}
	if p.Time != "" {
		qp.Set(PARAM_TIME, p.Time)
	}
	if p.Lang != "" {
		qp.Set(PARAM_LANG, p.Lang)
	}
	if p.DateFrom != "" {
		qp.Set(PARAM_DATEFROM, p.DateFrom)
	}
	if p.DateTo != "" {
		qp.Set(PARAM_DATETO, p.DateTo)
	}
	u.RawQuery = qp.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		logger.Get().Error("degoog: build request: %v", err)
		return nil, err
	}
	c.setHeaders(req)
	return req, nil
}

func (c *Client) postReq(ctx context.Context, p SearchParams) (*http.Request, error) {
	payload, err := json.Marshal(searchBody{
		Query:    p.Query,
		Engines:  p.Engines,
		Type:     p.Type,
		Page:     p.Page,
		Time:     p.Time,
		Lang:     p.Lang,
		DateFrom: p.DateFrom,
		DateTo:   p.DateTo,
	})
	if err != nil {
		logger.Get().Error("degoog: marshal body: %v", err)
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+PATH_SEARCH, bytes.NewReader(payload))
	if err != nil {
		logger.Get().Error("degoog: build request: %v", err)
		return nil, err
	}
	req.Header.Set(HEADER_CONTENT, CONTENT_JSON)
	c.setHeaders(req)
	return req, nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set(HEADER_ACCEPT, ACCEPT_JSON)
	if c.apiKey != "" {
		req.Header.Set(HEADER_AUTH, BEARER_PREFIX+c.apiKey)
	}
}

func capResults(out *Response, max int) int {
	if max <= 0 || len(out.Results) <= max {
		return 0
	}
	dropped := len(out.Results) - max
	out.Results = out.Results[:max]
	return dropped
}
