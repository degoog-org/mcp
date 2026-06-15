package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"degoog-mcp/commands"
	"degoog-mcp/internal/cache"
	"degoog-mcp/internal/config"
	"degoog-mcp/internal/degoog"
	"degoog-mcp/internal/logger"
	"degoog-mcp/internal/scraper"
)

const (
	SERVER_NAME     = "degoog-mcp"
	SERVER_VERSION  = "0.2.0"
	SHUTDOWN_WAIT   = 5 * time.Second
	ROUTE_MCP       = "/mcp"
	ROUTE_HEALTH    = "/healthz"
	HEALTH_BODY     = "ok"
	READ_TIMEOUT    = 30 * time.Second
	WRITE_TIMEOUT   = 0
	IDLE_TIMEOUT    = 120 * time.Second
	HEADER_AUTHZ    = "Authorization"
	HEADER_WWW_AUTH = "WWW-Authenticate"
	BEARER_PREFIX   = "Bearer "
	WWW_AUTH_VALUE  = "Bearer"
	DENIED_BODY     = "unauthorized\n"
)

func main() {
	log := logger.Get()
	cfg := config.Load()
	log.Info("boot: %s v%s on %s", SERVER_NAME, SERVER_VERSION, listenAddr(cfg))

	store, err := cache.New(cfg.CacheExpiry, cfg.CacheSizeMB)
	if err != nil {
		log.Error("boot: cache init failed: %v", err)
		os.Exit(1)
	}
	defer store.Close()

	sc := scraper.NewWithOptions(store, cfg.UserAgent, cfg.Timeout, scraper.Options{
		MaxLength:   cfg.MaxLength,
		MaxURLs:     cfg.MaxURLs,
		Concurrency: cfg.Concurrency,
		MaxBytes:    cfg.MaxBytes,
	})
	dg := degoog.New(cfg.DegoogURL, cfg.APIKey, cfg.Timeout, cfg.MaxBytes)
	log.Info("degoog: client targeting %s (api key: %v)", cfg.DegoogURL, cfg.APIKey != "")

	srv := mcp.NewServer(&mcp.Implementation{Name: SERVER_NAME, Version: SERVER_VERSION}, nil)
	commands.Register(srv, sc, dg, cfg)

	mux := buildMux(srv, cfg, log)
	if cfg.AuthToken != "" {
		log.Info("auth: inbound bearer auth enabled for %s", ROUTE_MCP)
	}

	httpSrv := &http.Server{
		Addr:         listenAddr(cfg),
		Handler:      mux,
		ReadTimeout:  READ_TIMEOUT,
		WriteTimeout: WRITE_TIMEOUT,
		IdleTimeout:  IDLE_TIMEOUT,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("http: listening on %s", httpSrv.Addr)
		if lerr := httpSrv.ListenAndServe(); lerr != nil && !errors.Is(lerr, http.ErrServerClosed) {
			errCh <- lerr
			return
		}
		errCh <- nil
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Info("signal: received %s, draining", sig)
	case lerr := <-errCh:
		if lerr != nil {
			log.Error("http: server failed: %v", lerr)
			os.Exit(1)
		}
	}

	lightsOut(httpSrv, log)
}

func listenAddr(cfg *config.Config) string {
	return cfg.BindHost + ":" + cfg.Port
}

func buildMux(srv *mcp.Server, cfg *config.Config, log *logger.Logger) *http.ServeMux {
	mcpHandler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, nil)

	mux := http.NewServeMux()
	mux.Handle(ROUTE_MCP, bouncer(mcpHandler, cfg.AuthToken, log))
	mux.HandleFunc(ROUTE_HEALTH, func(w http.ResponseWriter, r *http.Request) {
		if _, werr := w.Write([]byte(HEALTH_BODY)); werr != nil {
			log.Warn("health: write failed: %v", werr)
		}
	})
	return mux
}

func bouncer(next http.Handler, token string, log *logger.Logger) http.Handler {
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !tokenOK(r.Header.Get(HEADER_AUTHZ), token) {
			log.Warn("auth: rejected request to %s", r.URL.Path)
			w.Header().Set(HEADER_WWW_AUTH, WWW_AUTH_VALUE)
			w.WriteHeader(http.StatusUnauthorized)
			if _, werr := w.Write([]byte(DENIED_BODY)); werr != nil {
				log.Warn("auth: write failed: %v", werr)
			}
			return
		}
		next.ServeHTTP(w, r)
	})
}

func tokenOK(header, token string) bool {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], strings.TrimSpace(BEARER_PREFIX)) {
		return false
	}
	gotHash := sha256.Sum256([]byte(parts[1]))
	tokenHash := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(gotHash[:], tokenHash[:]) == 1
}

func lightsOut(srv *http.Server, log *logger.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), SHUTDOWN_WAIT)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown: %v", err)
		return
	}
	log.Info("shutdown: complete")
}
