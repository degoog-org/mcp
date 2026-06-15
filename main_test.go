package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/config"
	"degoog-mcp/internal/logger"
)

func newServer() *mcp.Server {
	return mcp.NewServer(&mcp.Implementation{Name: SERVER_NAME, Version: SERVER_VERSION}, nil)
}

func TestHealthOpen(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{}, logger.Get())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ROUTE_HEALTH, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health status: want 200, got %d", rec.Code)
	}
	if rec.Body.String() != HEALTH_BODY {
		t.Fatalf("health body: want %q, got %q", HEALTH_BODY, rec.Body.String())
	}
}

func TestHealthOpenWithToken(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{AuthToken: "s3cret"}, logger.Get())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ROUTE_HEALTH, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health should stay open with token set: got %d", rec.Code)
	}
}

func TestMcpReachableNoToken(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{}, logger.Get())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ROUTE_MCP, nil))
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("no token configured should not auth-block /mcp, got 401")
	}
}

func TestMcpMissingAuth(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{AuthToken: "s3cret"}, logger.Get())

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, ROUTE_MCP, nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth: want 401, got %d", rec.Code)
	}
	assertWWWAuthenticate(t, rec)
}

func TestMcpMalformedAuth(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{AuthToken: "s3cret"}, logger.Get())

	req := httptest.NewRequest(http.MethodPost, ROUTE_MCP, nil)
	req.Header.Set(HEADER_AUTHZ, "s3cret")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("malformed auth (no bearer prefix): want 401, got %d", rec.Code)
	}
	assertWWWAuthenticate(t, rec)
}

func TestMcpWrongToken(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{AuthToken: "s3cret"}, logger.Get())

	req := httptest.NewRequest(http.MethodPost, ROUTE_MCP, nil)
	req.Header.Set(HEADER_AUTHZ, BEARER_PREFIX+"nope")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: want 401, got %d", rec.Code)
	}
	assertWWWAuthenticate(t, rec)
}

func TestMcpCorrectToken(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{AuthToken: "s3cret"}, logger.Get())

	req := httptest.NewRequest(http.MethodGet, ROUTE_MCP, nil)
	req.Header.Set(HEADER_AUTHZ, BEARER_PREFIX+"s3cret")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("correct token should pass through to /mcp handler, got 401")
	}
}

func TestMcpCorrectTokenIsCaseAndWhitespaceTolerant(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{AuthToken: "s3cret"}, logger.Get())

	req := httptest.NewRequest(http.MethodGet, ROUTE_MCP, nil)
	req.Header.Set(HEADER_AUTHZ, "bearer   s3cret")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("case-insensitive bearer scheme with extra spaces should pass through to /mcp handler, got 401")
	}
}

func assertWWWAuthenticate(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if got := rec.Header().Get(HEADER_WWW_AUTH); got != WWW_AUTH_VALUE {
		t.Fatalf("WWW-Authenticate: want %q, got %q", WWW_AUTH_VALUE, got)
	}
}

func TestLegacyRoutesGone(t *testing.T) {
	mux := buildMux(newServer(), &config.Config{}, logger.Get())

	for _, path := range []string{"/sse", "/"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("legacy path %q: want 404, got %d", path, rec.Code)
		}
	}
}
