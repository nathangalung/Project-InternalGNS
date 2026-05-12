package paginate

import (
	"net/http"
	"strconv"
)

// MaxLimit is the upper bound applied to any limit parsed from the
// request. Values above this are rejected and fall back to the caller-
// supplied default.
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

// ParseLimit reads ?limit, falling back to def when missing, invalid,
// non-positive, or greater than MaxLimit.
func ParseLimit(r *http.Request, def int) int {
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 && v <= MaxLimit {
			return v
		}
	}
	return def
}
