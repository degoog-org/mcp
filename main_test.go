package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/internal/logger"
)

func TestBuildMuxRoutes(t *testing.T) {
	srv := mcp.NewServer(&mcp.Implementation{Name: SERVER_NAME, Version: SERVER_VERSION}, nil)
	mux := buildMux(srv, logger.Get())

	health := httptest.NewRecorder()
	mux.ServeHTTP(health, httptest.NewRequest(http.MethodGet, ROUTE_HEALTH, nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health status: want 200, got %d", health.Code)
	}
	if health.Body.String() != HEALTH_BODY {
		t.Fatalf("health body: want %q, got %q", HEALTH_BODY, health.Body.String())
	}

	cases := []struct {
		name string
		path string
		want string
	}{
		{name: "modern", path: ROUTE_MCP, want: ROUTE_MCP},
		{name: "sse", path: ROUTE_SSE, want: ROUTE_SSE},
		{name: "legacy", path: ROUTE_LEGACY, want: ROUTE_LEGACY},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, pattern := mux.Handler(httptest.NewRequest(http.MethodGet, tt.path, nil))
			if pattern != tt.want {
				t.Fatalf("route pattern: want %q, got %q", tt.want, pattern)
			}
		})
	}
}
