package session_test

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
)

func TestParseOrigin(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"https://internal.globalsakti.com", "https://internal.globalsakti.com", true},
		{"  https://Internal.GlobalSakti.com ", "https://internal.globalsakti.com", true},
		{"http://localhost:5174", "http://localhost:5174", true},
		{"http://127.0.0.1:4173", "http://127.0.0.1:4173", true},
		{"*", "", false},
		{"", "", false},
		{"https://*.globalsakti.com", "", false},
		{"https://internal.globalsakti.com/", "", false},
		{"https://internal.globalsakti.com/app", "", false},
		{"https://internal.globalsakti.com?x=1", "", false},
		{"https://internal.globalsakti.com#x", "", false},
		{"https://user@internal.globalsakti.com", "", false},
		{"ftp://internal.globalsakti.com", "", false},
		{"internal.globalsakti.com", "", false},
		{"https://", "", false},
		{"null", "", false},
		{"http://[::1", "", false},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			got, err := session.ParseOrigin(c.in)
			if !c.ok {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, c.want, got)
		})
	}
}

func TestOrigins_Allowed(t *testing.T) {
	o := session.NewOrigins([]string{"https://Internal.GlobalSakti.com", "*", "not an origin", "http://localhost:5174"})
	cases := []struct {
		origin string
		want   bool
	}{
		{"https://internal.globalsakti.com", true},
		{"http://localhost:5174", true},
		{"https://evil.example", false},
		{"https://internal.globalsakti.com.evil.example", false},
		{"http://internal.globalsakti.com", false},
		{"*", false},
		{"null", false},
		{"", false},
	}
	for _, c := range cases {
		t.Run(c.origin, func(t *testing.T) {
			assert.Equal(t, c.want, o.Allowed(c.origin))
			assert.Equal(t, c.want, o.AllowFunc(nil, c.origin))
		})
	}
}

func TestOrigins_EmptyAllowsNothing(t *testing.T) {
	var o session.Origins
	assert.False(t, o.Allowed("http://localhost:5174"))
}

// guardProblem posts through the guard.
func guardProblem(t *testing.T, origin, csrf string, setOrigin bool) (int, string) {
	t.Helper()
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := session.Guard(session.NewOrigins([]string{"https://internal.globalsakti.com"}))(next)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	if setOrigin {
		req.Header.Set("Origin", origin)
	}
	if csrf != "" {
		req.Header.Set(session.CSRFHeader, csrf)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusNoContent {
		return rec.Code, ""
	}
	assert.Equal(t, "application/problem+json", rec.Header().Get("Content-Type"))
	var p httperr.Error
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&p))
	return rec.Code, p.Detail
}

func TestGuard(t *testing.T) {
	const good = "https://internal.globalsakti.com"
	cases := []struct {
		name      string
		origin    string
		setOrigin bool
		csrf      string
		status    int
		detail    string
	}{
		{"listed origin with header", good, true, "1", http.StatusNoContent, ""},
		{"missing origin", "", false, "1", http.StatusForbidden, session.DetailOriginRefused},
		{"empty origin", "", true, "1", http.StatusForbidden, session.DetailOriginRefused},
		{"null origin", "null", true, "1", http.StatusForbidden, session.DetailOriginRefused},
		{"foreign origin", "https://evil.example", true, "1", http.StatusForbidden, session.DetailOriginRefused},
		{"missing header", good, true, "", http.StatusForbidden, session.DetailCSRFMissing},
		{"wrong header value", good, true, "yes", http.StatusForbidden, session.DetailCSRFMissing},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, detail := guardProblem(t, c.origin, c.csrf, c.setOrigin)
			assert.Equal(t, c.status, status)
			assert.Equal(t, c.detail, detail)
		})
	}
}

// setCookieFor records one Set-Cookie line.
func setCookieFor(t *testing.T, c session.Cookies, target string, useTLS bool, clear bool) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, nil)
	if !useTLS {
		req.TLS = nil
	} else {
		req.TLS = &tls.ConnectionState{}
	}
	rec := httptest.NewRecorder()
	if clear {
		c.Clear(rec, req)
	} else {
		c.Set(rec, req, "tok_abc-123")
	}
	lines := rec.Result().Header.Values("Set-Cookie")
	require.Len(t, lines, 1)
	return lines[0]
}

func TestCookies_SetAttributes(t *testing.T) {
	cases := []struct {
		name   string
		dev    bool
		target string
		tls    bool
		secure bool
	}{
		{"production over tls", false, "https://api.internal.globalsakti.com/api/v1/auth/login", true, true},
		// Traefik terminates TLS, so production sees plain http.
		{"production behind proxy", false, "http://api.internal.globalsakti.com/api/v1/auth/login", false, true},
		{"production on localhost", false, "http://localhost:8080/api/v1/auth/login", false, true},
		{"development on localhost", true, "http://localhost:8080/api/v1/auth/login", false, false},
		{"development on 127.0.0.1", true, "http://127.0.0.1:8080/api/v1/auth/login", false, false},
		{"development on ::1", true, "http://[::1]:8080/api/v1/auth/login", false, false},
		{"development on bare localhost", true, "http://localhost/api/v1/auth/login", false, false},
		{"development on a real host", true, "http://api.internal.globalsakti.com/api/v1/auth/login", false, true},
		{"development over tls", true, "https://localhost:8080/api/v1/auth/login", true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			line := setCookieFor(t, session.Cookies{Development: c.dev}, c.target, c.tls, false)
			assert.True(t, strings.HasPrefix(line, "gns_refresh=tok_abc-123;"), line)
			assert.Contains(t, line, "Path=/api/v1/auth")
			assert.Contains(t, line, "HttpOnly")
			assert.Contains(t, line, "SameSite=Strict")
			assert.NotContains(t, line, "Domain=")
			assert.NotContains(t, line, "Max-Age")
			assert.NotContains(t, line, "Expires")
			assert.Equal(t, c.secure, strings.Contains(line, "Secure"), line)
		})
	}
}

func TestCookies_ClearMatchesSet(t *testing.T) {
	cases := []struct {
		name   string
		dev    bool
		target string
		secure bool
	}{
		{"production", false, "http://api.internal.globalsakti.com/api/v1/auth/logout", true},
		{"development on localhost", true, "http://localhost:8080/api/v1/auth/logout", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			line := setCookieFor(t, session.Cookies{Development: c.dev}, c.target, false, true)
			assert.True(t, strings.HasPrefix(line, "gns_refresh=;"), line)
			assert.Contains(t, line, "Path=/api/v1/auth")
			assert.Contains(t, line, "Max-Age=0")
			assert.Contains(t, line, "Expires=Thu, 01 Jan 1970 00:00:00 GMT")
			assert.Contains(t, line, "HttpOnly")
			assert.Contains(t, line, "SameSite=Strict")
			assert.NotContains(t, line, "Domain=")
			assert.Equal(t, c.secure, strings.Contains(line, "Secure"), line)
		})
	}
}

func TestRead(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	assert.Empty(t, session.Read(req))
	req.AddCookie(&http.Cookie{Name: "other", Value: "x"})
	assert.Empty(t, session.Read(req))
	req.AddCookie(&http.Cookie{Name: session.CookieName, Value: "tok"})
	assert.Equal(t, "tok", session.Read(req))
}
