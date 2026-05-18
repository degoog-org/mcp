package tests

import (
	"strings"
	"testing"

	"degoog-mcp/internal/scraper"
)

func TestThanosNoOp(t *testing.T) {
	in := "short content well under budget"
	out := scraper.Thanos(in, 1000)
	if out != in {
		t.Fatalf("expected passthrough, got %q", out)
	}
}

func TestThanosDisabled(t *testing.T) {
	in := strings.Repeat("x", 5000)
	out := scraper.Thanos(in, 0)
	if out != in {
		t.Fatalf("maxLen=0 must disable truncation")
	}
}

func TestThanosKeepsHeadTail(t *testing.T) {
	head := strings.Repeat("H", 2000)
	mid := strings.Repeat("M", 8000)
	tail := strings.Repeat("T", 2000)
	in := head + mid + tail

	out := scraper.Thanos(in, 1000)

	if len(out) > 1000+len(scraper.TRUNCATE_NOTE) {
		t.Fatalf("output too long: %d", len(out))
	}
	if !strings.HasPrefix(out, "H") {
		t.Fatalf("expected output to start with head (H), got prefix %q", out[:5])
	}
	if !strings.HasSuffix(out, "T") {
		t.Fatalf("expected output to end with tail (T), got suffix %q", out[len(out)-5:])
	}
	if !strings.Contains(out, scraper.TRUNCATE_NOTE) {
		t.Fatalf("expected truncation marker present")
	}
	if strings.Contains(out, "M") {
		t.Fatalf("middle section should have been removed")
	}
}

func TestThanosTinyBudget(t *testing.T) {
	in := strings.Repeat("y", 500)
	out := scraper.Thanos(in, 10)
	if len(out) > 10+len(scraper.TRUNCATE_NOTE) {
		t.Fatalf("tiny budget overflowed: len=%d", len(out))
	}
}
