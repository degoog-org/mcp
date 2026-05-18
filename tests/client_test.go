package tests

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"degoog-mcp/internal/scraper"
)

const TEST_UA = "TestAgent/9.9"

func TestPolyjuiceHeaders(t *testing.T) {
	var captured http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Header.Clone()
		if _, err := io.WriteString(w, "ok"); err != nil {
			t.Fatalf("write: %v", err)
		}
	}))
	defer srv.Close()

	client := scraper.Polyjuice(TEST_UA)
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if cerr := resp.Body.Close(); cerr != nil {
		t.Fatalf("close: %v", cerr)
	}

	expect := map[string]string{
		scraper.HEADER_UA:      TEST_UA,
		scraper.HEADER_ACCEPT:  scraper.ACCEPT_DEFAULT,
		scraper.HEADER_LANG:    scraper.LANG_DEFAULT,
		scraper.HEADER_DNT:     scraper.DNT_DEFAULT,
		scraper.HEADER_UPGRADE: scraper.UPGRADE_DEFAULT,
		scraper.HEADER_SEC_FU:  scraper.SEC_FU_DEFAULT,
		scraper.HEADER_SEC_FM:  scraper.SEC_FM_DEFAULT,
		scraper.HEADER_SEC_FD:  scraper.SEC_FD_DEFAULT,
	}

	for k, want := range expect {
		got := captured.Get(k)
		if !strings.EqualFold(got, want) {
			t.Errorf("header %s: want %q, got %q", k, want, got)
		}
	}
}
