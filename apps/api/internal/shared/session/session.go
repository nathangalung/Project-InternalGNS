// Package session carries refresh cookies.
//
// The refresh token travels only in an HttpOnly cookie scoped to the auth
// routes of the API host. The endpoints that read it (refresh, logout) sit
// behind Guard, which demands a listed Origin and a custom header, so a
// cross-site page can neither send the cookie nor skip the CORS preflight.
package session

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

const (
	// CookieName names the refresh cookie.
	CookieName = "gns_refresh"
	// CookiePath scopes it to auth.
	CookiePath = "/api/v1/auth"
	// CSRFHeader forces a CORS preflight.
	// A cross-origin page cannot add a custom header without one, and the
	// preflight only passes for a listed origin.
	CSRFHeader = "X-GNS-CSRF"
	csrfValue  = "1"
)

// Indonesian 403 problem details.
const (
	DetailOriginRefused = "Permintaan ditolak karena asal halaman tidak diizinkan."
	DetailCSRFMissing   = "Permintaan ditolak karena header keamanan tidak ada."
)

// Cookies issues the refresh cookie.
// The zero value always marks it Secure.
type Cookies struct {
	// Development allows plain-http loopback.
	// It is true only when ENV is development, and even then only a request
	// that reached the API over plain http on a loopback host gets a cookie
	// without Secure. Production sits behind Traefik, where r.TLS is nil, so
	// the environment is what keeps Secure on there.
	Development bool
}

// Set issues the refresh token.
// It is a session cookie: no Max-Age or Expires, since the server-side
// refresh expiry is the limit. No Domain, so it stays host-only.
func (c Cookies) Set(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, c.cookie(r, token))
}

// Clear expires the refresh cookie.
// Name, Path and Secure match Set, or the browser keeps the original.
func (c Cookies) Clear(w http.ResponseWriter, r *http.Request) {
	ck := c.cookie(r, "") //nolint:gosec // G124: Secure follows cookie(), HttpOnly and SameSite are fixed
	ck.MaxAge = -1
	ck.Expires = time.Unix(0, 0)
	http.SetCookie(w, ck)
}

func (c Cookies) cookie(r *http.Request, value string) *http.Cookie {
	return &http.Cookie{ //nolint:gosec // G124: Secure is off only for dev loopback, see secure
		Name:     CookieName,
		Value:    value,
		Path:     CookiePath,
		HttpOnly: true,
		Secure:   c.secure(r),
		SameSite: http.SameSiteStrictMode,
	}
}

func (c Cookies) secure(r *http.Request) bool {
	return !c.Development || r.TLS != nil || !loopbackHost(r.Host)
}

// loopbackHost matches localhost addresses.
func loopbackHost(hostport string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		host = hostport
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && ip.IsLoopback()
}

// Read returns the refresh token.
// Empty when the cookie is absent.
func Read(r *http.Request) string {
	ck, err := r.Cookie(CookieName)
	if err != nil {
		return ""
	}
	return ck.Value
}

var errBadOrigin = errors.New("not a scheme://host[:port] origin")

// ParseOrigin canonicalizes one origin.
// It accepts only http or https with a host and nothing after it, so a
// wildcard, a path or a trailing slash is refused rather than never
// matching what a browser sends.
func ParseOrigin(s string) (string, error) {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "*") {
		return "", fmt.Errorf("%q: wildcards are not allowed: %w", s, errBadOrigin)
	}
	u, err := url.Parse(s)
	if err != nil {
		return "", fmt.Errorf("%q: %w", s, errBadOrigin)
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil ||
		u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" ||
		strings.HasSuffix(s, "#") {
		return "", fmt.Errorf("%q: %w", s, errBadOrigin)
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

// Origins holds allowed origins.
// The zero value allows nothing.
type Origins struct {
	set map[string]struct{}
}

// NewOrigins builds the allowed set.
// Entries ParseOrigin refuses (a wildcard among them) are dropped, so they
// match nothing; config validation reports them at startup.
func NewOrigins(list []string) Origins {
	o := Origins{set: make(map[string]struct{}, len(list))}
	for _, s := range list {
		if canon, err := ParseOrigin(s); err == nil {
			o.set[canon] = struct{}{}
		}
	}
	return o
}

// Allowed reports a listed origin.
// A browser sends the origin already serialized in lowercase, so the match
// is exact.
func (o Origins) Allowed(origin string) bool {
	_, ok := o.set[origin]
	return ok
}

// AllowFunc adapts Allowed for CORS.
func (o Origins) AllowFunc(_ *http.Request, origin string) bool {
	return o.Allowed(origin)
}

// Guard protects cookie-authenticated routes.
// A missing, null or unlisted Origin is refused first, then a request
// without the CSRF header.
func Guard(o Origins) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !o.Allowed(r.Header.Get("Origin")) {
				httperr.Render(w, httperr.Forbidden(DetailOriginRefused))
				return
			}
			if r.Header.Get(CSRFHeader) != csrfValue {
				httperr.Render(w, httperr.Forbidden(DetailCSRFMissing))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
