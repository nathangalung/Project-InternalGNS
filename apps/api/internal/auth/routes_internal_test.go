package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
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

// loginHit posts one login.
// The stub echoes the email it decoded, so a test also sees that the
// limiter handed the body on intact.
func loginHit(h http.Handler, body string) (int, string) {
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func stubLogin() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req LoginRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		_, _ = w.Write([]byte(req.Email))
	})
}

func loginBody(email string) string {
	return `{"email":"` + email + `","password":"x"}`
}

// Login limits count per account.
// An office signs in from one public address at the start of the day, so
// the address carries only a flood ceiling; the tight budget is per address
// and account.
func TestLoginLimit(t *testing.T) {
	t.Run("six accounts from one address all pass", func(t *testing.T) {
		h := loginLimit(loginPerIP, loginPerAccount)(stubLogin())
		for i := range 6 {
			email := "staf" + strconv.Itoa(i) + "@globalsakti.com"
			code, echoed := loginHit(h, loginBody(email))
			assert.Equal(t, http.StatusOK, code, "login %d", i+1)
			assert.Equal(t, email, echoed, "the handler reads the same body")
		}
	})

	t.Run("one account is limited, in any casing", func(t *testing.T) {
		h := loginLimit(loginPerIP, loginPerAccount)(stubLogin())
		for i := range loginPerAccount {
			code, _ := loginHit(h, loginBody("budi@globalsakti.com"))
			assert.Equal(t, http.StatusOK, code, "login %d", i+1)
		}
		code, _ := loginHit(h, loginBody("  BUDI@GlobalSakti.com "))
		assert.Equal(t, http.StatusTooManyRequests, code)
		code, _ = loginHit(h, loginBody("ani@globalsakti.com"))
		assert.Equal(t, http.StatusOK, code, "a colleague keeps her own budget")
	})

	t.Run("the address ceiling caps distinct accounts", func(t *testing.T) {
		h := loginLimit(3, 2)(stubLogin())
		for i := range 3 {
			code, _ := loginHit(h, loginBody("u"+strconv.Itoa(i)+"@x.com"))
			assert.Equal(t, http.StatusOK, code, "login %d", i+1)
		}
		code, _ := loginHit(h, loginBody("u9@x.com"))
		assert.Equal(t, http.StatusTooManyRequests, code)
	})

	t.Run("an unreadable body spends the address budget", func(t *testing.T) {
		h := loginLimit(10, 3)(stubLogin())
		for _, body := range []string{"{", "[]", "nope"} {
			code, _ := loginHit(h, body)
			assert.Equal(t, http.StatusOK, code)
		}
		code, _ := loginHit(h, "x")
		assert.Equal(t, http.StatusTooManyRequests, code, "garbage shares one bucket per address")
		code, _ = loginHit(h, loginBody("budi@globalsakti.com"))
		assert.Equal(t, http.StatusOK, code, "an account keeps its own budget")
	})

	// The handler decodes the first value and ignores the rest, so the
	// key must too, or junk would buy a second budget.
	t.Run("trailing junk shares the account budget", func(t *testing.T) {
		h := loginLimit(loginPerIP, 2)(stubLogin())
		for i := range 2 {
			code, _ := loginHit(h, loginBody("budi@globalsakti.com"))
			assert.Equal(t, http.StatusOK, code, "login %d", i+1)
		}
		code, _ := loginHit(h, loginBody("budi@globalsakti.com")+" x")
		assert.Equal(t, http.StatusTooManyRequests, code)
		code, _ = loginHit(h, loginBody("budi@globalsakti.com")+strings.Repeat(" ", 200))
		assert.Equal(t, http.StatusTooManyRequests, code)
	})

	t.Run("an oversized body is refused unread", func(t *testing.T) {
		h := loginLimit(loginPerIP, loginPerAccount)(stubLogin())
		padded := loginBody("budi@globalsakti.com") + strings.Repeat(" ", loginBodyMax)
		code, body := loginHit(h, padded)
		assert.Equal(t, http.StatusRequestEntityTooLarge, code)
		assert.Contains(t, body, httpx.BodyTooLargeDetail)
		assert.NotContains(t, body, "budi", "the handler never ran")
		code, _ = loginHit(h, loginBody("budi@globalsakti.com")+strings.Repeat(" ", loginBodyMax-60))
		assert.Equal(t, http.StatusOK, code, "a body within the bound passes")
	})

	t.Run("any other key failure is a 500", func(t *testing.T) {
		rec := httptest.NewRecorder()
		loginKeyError(rec, httptest.NewRequest(http.MethodPost, "/login", nil), assert.AnError)
		assert.Equal(t, http.StatusInternalServerError, rec.Code)
	})

	t.Run("the account key never holds the raw email", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(loginBody("rahasia@globalsakti.com")))
		key, err := loginAccountKey(req)
		assert.NoError(t, err)
		assert.NotContains(t, key, "rahasia")
	})
}

// Password changes count per user.
// Colleagues behind one address change their passwords independently.
func TestPasswordLimit(t *testing.T) {
	hit := func(h http.Handler, user int64) int {
		req := httptest.NewRequest(http.MethodPatch, "/me/password", nil)
		req = req.WithContext(deps.WithUserID(req.Context(), user))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	h := passwordLimit(passwordPerIP, passwordPerUser)(stubRefresh())
	for i := range passwordPerUser {
		assert.Equal(t, http.StatusOK, hit(h, 1), "change %d", i+1)
	}
	assert.Equal(t, http.StatusTooManyRequests, hit(h, 1))
	assert.Equal(t, http.StatusOK, hit(h, 2), "another user keeps his own budget")

	ceiling := passwordLimit(2, 5)(stubRefresh())
	assert.Equal(t, http.StatusOK, hit(ceiling, 1))
	assert.Equal(t, http.StatusOK, hit(ceiling, 2))
	assert.Equal(t, http.StatusTooManyRequests, hit(ceiling, 3), "the address ceiling still holds")
}
