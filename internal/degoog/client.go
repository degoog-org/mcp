package degoog

import (
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
	PATH_SEARCH   = "/api/search"
	HEADER_AUTH   = "Authorization"
	HEADER_ACCEPT = "Accept"
	ACCEPT_JSON   = "application/json"
	BEARER_PREFIX = "Bearer "

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
}

type Response struct {
	Results         []Hit          `json:"results"`
	Query           string         `json:"query"`
	TotalTime       int            `json:"totalTime"`
	Type            string         `json:"type"`
	EngineTimings   []EngineTiming `json:"engineTimings,omitempty"`
	RelatedSearches []string       `json:"relatedSearches,omitempty"`
}

type SearchParams struct {
	Query    string
	Type     string
	Page     int
	Time     string
	Lang     string
	DateFrom string
	DateTo   string
}

type Client struct {
	base   string
	apiKey string
	http   *http.Client
}

func New(base, apiKey string, timeout time.Duration) *Client {
	return &Client{
		base:   strings.TrimRight(base, "/"),
		apiKey: apiKey,
		http:   &http.Client{Timeout: timeout},
	}
}

func (c *Client) Search(ctx context.Context, p SearchParams) (*Response, error) {
	q := strings.TrimSpace(p.Query)
	if q == "" {
		return nil, ErrEmptyQuery
	}
	if p.Page < 0 || p.Page > MAX_PAGE {
		return nil, ErrBadPage
	}

	u, err := url.Parse(c.base + PATH_SEARCH)
	if err != nil {
		logger.Get().Error("degoog: invalid base url=%s: %v", c.base, err)
		return nil, err
	}

	qp := u.Query()
	qp.Set(PARAM_Q, q)
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
	req.Header.Set(HEADER_ACCEPT, ACCEPT_JSON)
	if c.apiKey != "" {
		req.Header.Set(HEADER_AUTH, BEARER_PREFIX+c.apiKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		logger.Get().Warn("degoog: request failed url=%s: %v", u.String(), err)
		return nil, err
	}
	defer func() {
		if cerr := resp.Body.Close(); cerr != nil {
			logger.Get().Warn("degoog: body close: %v", cerr)
		}
	}()

	if resp.StatusCode >= http.StatusBadRequest {
		body, rerr := io.ReadAll(resp.Body)
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

	logger.Get().Info("degoog: ok q=%q type=%q hits=%d took=%dms", q, out.Type, len(out.Results), out.TotalTime)
	return &out, nil
}
