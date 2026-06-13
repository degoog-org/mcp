package scraper

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

type captureRT struct {
	header http.Header
}

func (c *captureRT) RoundTrip(r *http.Request) (*http.Response, error) {
	c.header = r.Header.Clone()
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader("ok")),
		Header:     make(http.Header),
		Request:    r,
	}, nil
}

func TestBrowserRTHeaders(t *testing.T) {
	capture := &captureRT{}
	rt := &browserRT{base: capture, ua: "TestAgent/9.9"}
	req := httptestReq(t, "https://example.com/")

	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("round trip: %v", err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	expect := map[string]string{
		HEADER_UA:      "TestAgent/9.9",
		HEADER_ACCEPT:  ACCEPT_DEFAULT,
		HEADER_LANG:    LANG_DEFAULT,
		HEADER_DNT:     DNT_DEFAULT,
		HEADER_UPGRADE: UPGRADE_DEFAULT,
		HEADER_SEC_FU:  SEC_FU_DEFAULT,
		HEADER_SEC_FM:  SEC_FM_DEFAULT,
		HEADER_SEC_FD:  SEC_FD_DEFAULT,
	}

	for k, want := range expect {
		got := capture.header.Get(k)
		if !strings.EqualFold(got, want) {
			t.Errorf("header %s: want %q, got %q", k, want, got)
		}
	}
}

func httptestReq(t *testing.T, raw string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	return req
}

func TestCheckURLRejectsBadScheme(t *testing.T) {
	target, err := url.Parse("file:///etc/passwd")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	err = CheckURL(context.Background(), target)
	if !errors.Is(err, ErrBadScheme) {
		t.Fatalf("want ErrBadScheme, got %v", err)
	}
}

func TestCheckURLRejectsLoopbackHost(t *testing.T) {
	target, err := url.Parse("http://127.0.0.1:8080/")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	err = CheckURL(context.Background(), target)
	if !errors.Is(err, ErrBadIP) {
		t.Fatalf("want ErrBadIP, got %v", err)
	}
}

func TestPolyjuiceRejectsLoopbackRedirect(t *testing.T) {
	client := Polyjuice("TestAgent/1.0")
	req := &http.Request{URL: &url.URL{Scheme: "http", Host: "127.0.0.1:8080", Path: "/"}}

	err := client.CheckRedirect(req, nil)
	if !errors.Is(err, ErrBadIP) {
		t.Fatalf("want ErrBadIP, got %v", err)
	}
}

func TestIPFilter(t *testing.T) {
	blocked := []string{
		"127.0.0.1",
		"10.1.2.3",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.1.1",
		"224.0.0.1",
		"0.0.0.0",
		"100.64.0.1",
		"198.18.0.1",
		"240.0.0.1",
		"::1",
		"fe80::1",
		"2001:db8::1",
	}

	for _, raw := range blocked {
		ip := netip.MustParseAddr(raw)
		if isAllowedIP(ip) {
			t.Fatalf("ip %s should be blocked", raw)
		}
	}

	allowed := []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"}
	for _, raw := range allowed {
		ip := netip.MustParseAddr(raw)
		if !isAllowedIP(ip) {
			t.Fatalf("ip %s should be allowed", raw)
		}
	}
}

func TestReadCap(t *testing.T) {
	body, cut, err := readCap(strings.NewReader("abcdef"), 4)
	if err != nil {
		t.Fatalf("readCap: %v", err)
	}
	if !cut {
		t.Fatalf("expected truncation")
	}
	if string(body) != "abcd" {
		t.Fatalf("body: want abcd, got %q", string(body))
	}
}
