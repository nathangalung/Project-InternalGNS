package httpx

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// PathID parses int64 path parameters.
// On failure it renders 400 with msg and returns false; the caller returns.
// msg is the caller's so each route keeps the message it already sends.
func PathID(w http.ResponseWriter, r *http.Request, name, msg string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest(msg))
		return 0, false
	}
	return id, true
}

// DecodeJSON decodes bodies into dst.
// On failure it renders 400 "invalid json" and returns false.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return false
	}
	return true
}
