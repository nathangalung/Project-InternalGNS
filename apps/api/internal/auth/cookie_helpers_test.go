package auth_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
)

// testOrigin is the listed SPA.
const testOrigin = "http://app.test"

// newHandler wires production cookie rules.
// The zero Cookies marks every cookie Secure, as production does.
func newHandler(svc *auth.Service) *auth.Handler {
	return auth.NewHandler(svc, session.Cookies{}, session.NewOrigins([]string{testOrigin}))
}

// cookieCall posts a guarded auth call.
// It carries the listed Origin, the CSRF header and, when token is set, the
// refresh cookie; mutate may strip or alter any of them.
func cookieCall(t *testing.T, srv *httptest.Server, path, token string, mutate func(*http.Request)) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+path, nil)
	require.NoError(t, err)
	req.Header.Set("Origin", testOrigin)
	req.Header.Set(session.CSRFHeader, "1")
	if token != "" {
		req.AddCookie(&http.Cookie{Name: session.CookieName, Value: token})
	}
	if mutate != nil {
		mutate(req)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

// refreshCookieOf finds the refresh cookie.
func refreshCookieOf(t *testing.T, res *http.Response) *http.Cookie {
	t.Helper()
	for _, c := range res.Cookies() {
		if c.Name == session.CookieName {
			return c
		}
	}
	return nil
}

// assertIssued checks the issued cookie.
// It returns the token it carries.
func assertIssued(t *testing.T, res *http.Response) string {
	t.Helper()
	c := refreshCookieOf(t, res)
	require.NotNil(t, c, "no refresh cookie in %v", res.Header.Values("Set-Cookie"))
	assert.NotEmpty(t, c.Value)
	assert.True(t, c.HttpOnly, "HttpOnly")
	assert.True(t, c.Secure, "Secure")
	assert.Equal(t, http.SameSiteStrictMode, c.SameSite)
	assert.Equal(t, session.CookiePath, c.Path)
	assert.Empty(t, c.Domain, "host-only")
	assert.Zero(t, c.MaxAge, "a session cookie has no Max-Age")
	assert.True(t, c.Expires.IsZero(), "a session cookie has no Expires")
	return c.Value
}

// assertCleared checks the expiring cookie.
func assertCleared(t *testing.T, res *http.Response) {
	t.Helper()
	c := refreshCookieOf(t, res)
	require.NotNil(t, c, "no clearing cookie in %v", res.Header.Values("Set-Cookie"))
	assert.Empty(t, c.Value)
	assert.Negative(t, c.MaxAge, "Max-Age=0 expires it now")
	assert.True(t, c.HttpOnly, "HttpOnly")
	assert.True(t, c.Secure, "Secure must match the issued cookie")
	assert.Equal(t, http.SameSiteStrictMode, c.SameSite)
	assert.Equal(t, session.CookiePath, c.Path)
	assert.Empty(t, c.Domain)
}

// assertNoCookie checks nothing was set.
func assertNoCookie(t *testing.T, res *http.Response) {
	t.Helper()
	assert.Nil(t, refreshCookieOf(t, res), "unexpected %v", res.Header.Values("Set-Cookie"))
}

// assertTokenNotInBody checks the body.
// The refresh token travels in the cookie only.
func assertTokenNotInBody(t *testing.T, body []byte, token string) {
	t.Helper()
	require.NotEmpty(t, token)
	assert.False(t, strings.Contains(string(body), token), "refresh token leaked into the body")
}
