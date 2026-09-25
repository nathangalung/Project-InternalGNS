package paginate

import (
	"net/http"
	"strconv"
)

// MaxLimit caps parsed limits.
// Values above it are clamped down to it, matching listq.Page, so the two
// agree on what "too large" means.
const MaxLimit = 200

// Parse reads ?limit & ?offset.
// Defaults: limit 50, offset 0. limit clamped to (0, MaxLimit].
func Parse(r *http.Request) (limit, offset int) {
	limit = ParseLimit(r, 50)
	if s := r.URL.Query().Get("offset"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 0 {
			offset = v
		}
	}
	return
}

// ParseLimit reads a clamped limit.
// It falls back to def when ?limit is missing, invalid or non-positive, and
// clamps anything above MaxLimit down to it.
//
// Clamping rather than falling back: ?limit=500 used to yield the caller's
// default, so asking for more rows silently returned fewer than ?limit=200
// did, and a caller could not tell a clamp from a rejected value.
func ParseLimit(r *http.Request, def int) int {
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			return Clamp(v, def)
		}
	}
	return def
}

// Clamp bounds a body limit.
// The result is in (0, MaxLimit].
// Non-positive falls back to def; for limits carried in a request body.
func Clamp(v, def int) int {
	if v <= 0 {
		return def
	}
	return min(v, MaxLimit)
}
