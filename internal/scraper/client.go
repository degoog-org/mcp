package scraper

import "net/http"

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

func Polyjuice(ua string) *http.Client {
	return &http.Client{
		Transport: &browserRT{base: http.DefaultTransport, ua: ua},
	}
}
