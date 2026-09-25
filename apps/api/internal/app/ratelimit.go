package app

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// rateLimitDetail explains a limiter refusal.
const rateLimitDetail = "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."

// problemJSON429 renders 429 as problem+json.
// httprate writes plain text and offers no hook for the body, while the SPA
// runs every error response through JSON.parse, so the raw "Too Many
// Requests" surfaced to the user as "Unexpected token 'T'". Rewriting at the
// mount leaves the limiter configuration where it belongs.
func problemJSON429(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&problem429Writer{ResponseWriter: w}, r)
	})
}

// problem429Writer rewrites plain-text 429s.
// The body becomes problem+json.
type problem429Writer struct {
	http.ResponseWriter
	headerWritten bool
	replaced      bool
}

// Unwrap exposes the real writer.
// http.ResponseController needs it.
func (w *problem429Writer) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *problem429Writer) WriteHeader(status int) {
	if w.headerWritten {
		return
	}
	w.headerWritten = true
	// A handler that already rendered problem+json (an account lockout, say)
	// keeps its own message: only the limiter's plain text is replaced.
	if status != http.StatusTooManyRequests ||
		w.Header().Get("Content-Type") == "application/problem+json" {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.replaced = true
	body, err := json.Marshal(httperr.TooManyRequests(rateLimitDetail))
	if err != nil {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	body = append(body, '\n')
	// Retry-After and the X-RateLimit-* headers were set before this point
	// and are left as the limiter wrote them.
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.ResponseWriter.WriteHeader(status)
	_, _ = w.ResponseWriter.Write(body)
}

func (w *problem429Writer) Write(p []byte) (int, error) {
	if !w.headerWritten {
		w.WriteHeader(http.StatusOK)
	}
	if w.replaced {
		// Swallow the limiter's plain-text body; it is already replaced.
		return len(p), nil
	}
	return w.ResponseWriter.Write(p)
}
