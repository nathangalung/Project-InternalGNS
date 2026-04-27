package paginate

import (
	"net/http"
	"strconv"
)

// Defaults: limit 50, offset 0.
// limit clamped to (0, 200].
func Parse(r *http.Request) (limit, offset int) {
	limit, offset = 50, 0
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}
	if s := r.URL.Query().Get("offset"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 0 {
			offset = v
		}
	}
	return
}
