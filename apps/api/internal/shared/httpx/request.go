package httpx

import (
	"encoding/json"
	"errors"
	"io"
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
	return decodeJSON(w, r, dst, false)
}

// DecodeOptionalJSON allows an empty body.
// It is DecodeJSON for routes whose every field is optional: an empty or
// missing body leaves dst untouched and returns true.
func DecodeOptionalJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if r.Body == nil {
		return true
	}
	return decodeJSON(w, r, dst, true)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any, optional bool) bool {
	err := json.NewDecoder(r.Body).Decode(dst)
	if err == nil || optional && errors.Is(err, io.EOF) {
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
