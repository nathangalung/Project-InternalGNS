package auth

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
)

// refreshHit posts one refresh.
func refreshHit(h http.Handler, cookie string) int {
	req := httptest.NewRequest(http.MethodPost, "/refresh", nil)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: session.CookieName, Value: cookie})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func stubRefresh() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

// Refresh limits count per cookie.
// Every page load and new tab rotates the cookie, and an office shares one
// public address, so the IP must not carry the tight limit.
func TestRefreshLimit(t *testing.T) {
	t.Run("distinct cookies from one address all pass", func(t *testing.T) {
		h := refreshLimit(refreshPerIP, refreshPerCookie)(stubRefresh())
		for i := range 25 {
			assert.Equal(t, http.StatusOK, refreshHit(h, "rt-"+strconv.Itoa(i)), "refresh %d", i+1)
		}
	})

	t.Run("one cookie presented too often is refused", func(t *testing.T) {
		h := refreshLimit(refreshPerIP, refreshPerCookie)(stubRefresh())
		for i := range refreshPerCookie {
			assert.Equal(t, http.StatusOK, refreshHit(h, "same"), "refresh %d", i+1)
		}
		assert.Equal(t, http.StatusTooManyRequests, refreshHit(h, "same"))
		assert.Equal(t, http.StatusOK, refreshHit(h, "other"), "another cookie keeps its own budget")
	})

	t.Run("cookieless requests spend only the address ceiling", func(t *testing.T) {
		h := refreshLimit(5, 2)(stubRefresh())
		for i := range 5 {
			assert.Equal(t, http.StatusOK, refreshHit(h, ""), "request %d", i+1)
		}
		assert.Equal(t, http.StatusTooManyRequests, refreshHit(h, ""), "the flood guard still holds")
	})

	t.Run("the address ceiling caps distinct cookies", func(t *testing.T) {
		h := refreshLimit(3, 2)(stubRefresh())
		for i := range 3 {
			assert.Equal(t, http.StatusOK, refreshHit(h, "c"+strconv.Itoa(i)), "request %d", i+1)
		}
		assert.Equal(t, http.StatusTooManyRequests, refreshHit(h, "c9"))
	})

	t.Run("the cookie key never holds the raw token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/refresh", nil)
		req.AddCookie(&http.Cookie{Name: session.CookieName, Value: "secret-token"})
		key, err := refreshCookieKey(req)
		assert.NoError(t, err)
		assert.NotContains(t, key, "secret-token")
		assert.Len(t, key, 64)
	})
}
