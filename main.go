package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
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
	SERVER_NAME    = "degoog-mcp"
	SERVER_VERSION = "0.1.0"
	SHUTDOWN_WAIT  = 5 * time.Second
	ROUTE_SSE      = "/"
	ROUTE_HEALTH   = "/healthz"
	HEALTH_BODY    = "ok"
	READ_TIMEOUT   = 30 * time.Second
	WRITE_TIMEOUT  = 0
	IDLE_TIMEOUT   = 120 * time.Second
)

func main() {
	log := logger.Get()
	cfg := config.Load()
	log.Info("boot: %s v%s on :%s", SERVER_NAME, SERVER_VERSION, cfg.Port)

	store, err := cache.New(cfg.CacheExpiry, cfg.CacheSizeMB)
	if err != nil {
		log.Error("boot: cache init failed: %v", err)
		os.Exit(1)
	}
	defer store.Close()

	sc := scraper.New(store, cfg.UserAgent, cfg.Timeout, cfg.MaxLength)
	dg := degoog.New(cfg.DegoogURL, cfg.APIKey, cfg.Timeout)
	log.Info("degoog: client targeting %s (api key: %v)", cfg.DegoogURL, cfg.APIKey != "")

	srv := mcp.NewServer(&mcp.Implementation{Name: SERVER_NAME, Version: SERVER_VERSION}, nil)
	commands.Register(srv, sc, dg)

	sseHandler := mcp.NewSSEHandler(func(*http.Request) *mcp.Server { return srv }, nil)

	mux := http.NewServeMux()
	mux.Handle(ROUTE_SSE, sseHandler)
	mux.HandleFunc(ROUTE_HEALTH, func(w http.ResponseWriter, r *http.Request) {
		if _, werr := w.Write([]byte(HEALTH_BODY)); werr != nil {
			log.Warn("health: write failed: %v", werr)
		}
	})

	httpSrv := &http.Server{
		Addr:         ":" + cfg.Port,
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

func lightsOut(srv *http.Server, log *logger.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), SHUTDOWN_WAIT)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown: %v", err)
		return
	}
	log.Info("shutdown: complete")
}
