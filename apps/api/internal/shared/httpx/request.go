package httpx

import (
	"encoding/json"
	"errors"
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

// BodyTooLargeDetail explains a 413.
const BodyTooLargeDetail = "Data yang dikirim terlalu besar. Kurangi isian lalu coba lagi."

// DecodeJSON decodes bodies into dst.
// A body past the router's size limit renders 413; any other failure
// renders 400 "invalid json". It returns false after rendering.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	err := json.NewDecoder(r.Body).Decode(dst)
	if err == nil {
		return true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		httperr.Render(w, httperr.PayloadTooLarge(BodyTooLargeDetail))
		return false
	}
	httperr.Render(w, httperr.BadRequest("invalid json"))
	return false
}
