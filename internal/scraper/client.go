package scraper

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"time"

	"degoog-mcp/internal/logger"
)

const (
	HEADER_UA       = "User-Agent"
	HEADER_ACCEPT   = "Accept"
	HEADER_LANG     = "Accept-Language"
	HEADER_DNT      = "DNT"
	HEADER_UPGRADE  = "Upgrade-Insecure-Requests"
	HEADER_SEC_FU   = "Sec-Fetch-User"
	HEADER_SEC_FM   = "Sec-Fetch-Mode"
	HEADER_SEC_FD   = "Sec-Fetch-Dest"
	ACCEPT_DEFAULT  = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
	LANG_DEFAULT    = "en-US,en;q=0.9"
	DNT_DEFAULT     = "1"
	UPGRADE_DEFAULT = "1"
	SEC_FU_DEFAULT  = "?1"
	SEC_FM_DEFAULT  = "navigate"
	SEC_FD_DEFAULT  = "document"
)

var (
	ErrBadScheme = errors.New("url scheme must be http or https")
	ErrBadHost   = errors.New("url host is required")
	ErrBadIP     = errors.New("url resolves to blocked ip")
)

var blockedNets = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("255.255.255.255/32"),
	netip.MustParsePrefix("2001:db8::/32"),
}

type browserRT struct {
	base http.RoundTripper
	ua   string
}

func (b *browserRT) RoundTrip(r *http.Request) (*http.Response, error) {
	r.Header.Set(HEADER_UA, b.ua)
	r.Header.Set(HEADER_ACCEPT, ACCEPT_DEFAULT)
	r.Header.Set(HEADER_LANG, LANG_DEFAULT)
	r.Header.Set(HEADER_DNT, DNT_DEFAULT)
	r.Header.Set(HEADER_UPGRADE, UPGRADE_DEFAULT)
	r.Header.Set(HEADER_SEC_FU, SEC_FU_DEFAULT)
	r.Header.Set(HEADER_SEC_FM, SEC_FM_DEFAULT)
	r.Header.Set(HEADER_SEC_FD, SEC_FD_DEFAULT)
	return b.base.RoundTrip(r)
}

type guardRT struct {
	base http.RoundTripper
}

func (g *guardRT) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := CheckURL(r.Context(), r.URL); err != nil {
		logger.Get().Warn("scraper: rejected url=%s: %v", r.URL.String(), err)
		return nil, err
	}
	return g.base.RoundTrip(r)
}

// Polyjuice creates an HTTP client with URL and IP validation and browser-like request headers.
//
// ua is the user agent string to set on outgoing requests.
func Polyjuice(ua string) *http.Client {
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           guardedDial,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &http.Client{
		Transport: &browserRT{base: &guardRT{base: transport}, ua: ua},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if err := CheckURL(req.Context(), req.URL); err != nil {
				logger.Get().Warn("scraper: rejected redirect url=%s: %v", req.URL.String(), err)
				return err
			}
			return nil
		},
	}
}

// CheckURL validates that a target URL is safe for scraping. It returns ErrBadScheme
// if the scheme is not http or https, ErrBadHost if the URL is nil or has an empty
// hostname, ErrBadIP if the hostname does not resolve to any allowed IP addresses,
// or nil if validation succeeds.
func CheckURL(ctx context.Context, target *url.URL) error {
	if target == nil {
		return ErrBadHost
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return ErrBadScheme
	}
	if target.Hostname() == "" {
		return ErrBadHost
	}
	_, err := resolveHost(ctx, target.Hostname())
	return err
}

// guardedDial dials a network connection by resolving the host and attempting to connect to each resolved IP address until one succeeds.
func guardedDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}

	ips, err := resolveHost(ctx, host)
	if err != nil {
		return nil, err
	}

	dialer := &net.Dialer{}
	var lastErr error
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
		logger.Get().Warn("scraper: dial failed ip=%s port=%s: %v", ip.String(), port, err)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, ErrBadIP
}

// resolveHost resolves a hostname to a list of allowed IP addresses.
// The host parameter may be a hostname or a direct IP address.
// Returns the list of allowed addresses or an error if resolution fails
// or no allowed IPs remain.
func resolveHost(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(host); err == nil {
		return vetIPs([]netip.Addr{ip})
	}

	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		logger.Get().Warn("scraper: dns failed host=%s: %v", host, err)
		return nil, err
	}

	ips := make([]netip.Addr, 0, len(addrs))
	for _, addr := range addrs {
		ip, ok := netip.AddrFromSlice(addr.IP)
		if ok {
			ips = append(ips, ip.Unmap())
		}
	}
	return vetIPs(ips)
}

// vetIPs filters the input IPs to keep only those that are allowed, returning the filtered slice or ErrBadIP if no IPs remain.
func vetIPs(ips []netip.Addr) ([]netip.Addr, error) {
	allowed := make([]netip.Addr, 0, len(ips))
	for _, ip := range ips {
		if isAllowedIP(ip) {
			allowed = append(allowed, ip)
		} else {
			logger.Get().Warn("scraper: blocked ip=%s", ip.String())
		}
	}
	if len(allowed) == 0 {
		return nil, ErrBadIP
	}
	return allowed, nil
}

// isAllowedIP reports whether an IP address can be used. It returns true if the IP is valid, globally unicast, and not private, loopback, link-local, multicast, unspecified, or contained in a blocked network range; false otherwise.
func isAllowedIP(ip netip.Addr) bool {
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}

	for _, prefix := range blockedNets {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}
