package tests

import (
	"errors"
	"testing"

	"degoog-mcp/internal/scraper"
)

const TEST_UA = "TestAgent/9.9"

func TestPolyjuiceRejectsLoopback(t *testing.T) {
	client := scraper.Polyjuice(TEST_UA)
	_, err := client.Get("http://127.0.0.1:1")
	if !errors.Is(err, scraper.ErrBadIP) {
		t.Fatalf("want ErrBadIP, got %v", err)
	}
}
