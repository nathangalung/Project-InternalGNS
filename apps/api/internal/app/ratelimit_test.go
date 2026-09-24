package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// httprate writes a plain-text 429, which the SPA feeds to JSON.parse and
// reports as "Unexpected token 'T'". The mount rewrites it as problem+json
// and leaves a response that is already problem+json alone.
func TestProblemJSON429(t *testing.T) {
	cases := []struct {
		name       string
		inner      http.HandlerFunc
		wantStatus int
		wantCT     string
		wantDetail string
	}{
		{
			name: "plain text 429 rewritten",
			inner: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Retry-After", "60")
				http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
			},
			wantStatus: http.StatusTooManyRequests,
			wantCT:     "application/problem+json",
			wantDetail: rateLimitDetail,
		},
		{
			name: "problem json 429 passes through",
			inner: func(w http.ResponseWriter, _ *http.Request) {
				httperr.Render(w, httperr.TooManyRequests("Akun terkunci sementara."))
			},
			wantStatus: http.StatusTooManyRequests,
			wantCT:     "application/problem+json",
			wantDetail: "Akun terkunci sementara.",
		},
		{
			name: "other statuses untouched",
			inner: func(w http.ResponseWriter, _ *http.Request) {
				httperr.Render(w, httperr.Unauthorized("Email atau kata sandi salah."))
			},
			wantStatus: http.StatusUnauthorized,
			wantCT:     "application/problem+json",
			wantDetail: "Email atau kata sandi salah.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			problemJSON429(tc.inner).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))

			assert.Equal(t, tc.wantStatus, rec.Code)
			assert.Equal(t, tc.wantCT, rec.Header().Get("Content-Type"))

			var body httperr.Error
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body),
				"body must parse as JSON, got %q", rec.Body.String())
			assert.Equal(t, tc.wantStatus, body.Status)
			assert.Equal(t, tc.wantDetail, body.Detail)
		})
	}
	t.Run("rate-limit headers survive", func(t *testing.T) {
		rec := httptest.NewRecorder()
		problemJSON429(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
		})).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
		assert.Equal(t, "60", rec.Header().Get("Retry-After"))
	})
}

// End to end through the mounted limiter: the sixth login in a minute must
// come back as problem+json, not as text the SPA cannot parse.
func TestRouter_RateLimitedLoginIsProblemJSON(t *testing.T) {
	srv := httptest.NewServer(mkRouter(t))
	t.Cleanup(srv.Close)

	var last *http.Response
	for i := 0; i < 6; i++ {
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/auth/login",
			strings.NewReader(`{"email":"x@y.z","password":"wrong-password"}`))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		res, err := srv.Client().Do(req)
		require.NoError(t, err)
		if i < 5 {
			res.Body.Close()
			continue
		}
		last = res
	}
	require.NotNil(t, last)
	defer last.Body.Close()

	require.Equal(t, http.StatusTooManyRequests, last.StatusCode)
	assert.Equal(t, "application/problem+json", last.Header.Get("Content-Type"))
	raw, err := io.ReadAll(last.Body)
	require.NoError(t, err)
	var body httperr.Error
	require.NoError(t, json.Unmarshal(raw, &body), "body must parse as JSON, got %q", raw)
	assert.Equal(t, http.StatusTooManyRequests, body.Status)
	assert.Equal(t, rateLimitDetail, body.Detail)
}

// Rewrite keeps writer contract.
// A body written without a status is a 200 that passes through, a second
// status is ignored as net/http does, and the real writer stays reachable
// for http.ResponseController.
func TestProblemJSON429_WriterContract(t *testing.T) {
	t.Run("implicit 200 passes the body", func(t *testing.T) {
		rec := httptest.NewRecorder()
		problemJSON429(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"token":"x"}`))
		})).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, `{"token":"x"}`, rec.Body.String())
	})

	t.Run("second status ignored", func(t *testing.T) {
		rec := httptest.NewRecorder()
		problemJSON429(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("Too Many Requests\n"))
		})).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
		assert.Equal(t, http.StatusTooManyRequests, rec.Code)
		assert.NotContains(t, rec.Body.String(), "Too Many Requests\n", "the plain text is swallowed")
		var p httperr.Error
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &p))
		assert.Equal(t, rateLimitDetail, p.Detail)
	})

	t.Run("controller reaches the real writer", func(t *testing.T) {
		rec := httptest.NewRecorder()
		problemJSON429(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			require.NoError(t, http.NewResponseController(w).Flush())
		})).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
		assert.True(t, rec.Flushed, "Flush must reach the recorder through Unwrap")
	})
}
