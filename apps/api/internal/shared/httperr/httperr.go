package httperr

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// Wire-shape error response.
type Error struct {
	Type     string            `json:"type"`
	Title    string            `json:"title"`
	Status   int               `json:"status"`
	Detail   string            `json:"detail,omitempty"`
	Instance string            `json:"instance,omitempty"`
	Fields   map[string]string `json:"fields,omitempty"`
}

func (e Error) Error() string { return e.Title + ": " + e.Detail }

// Write error as JSON.
func Render(w http.ResponseWriter, e Error) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(e)
}

func BadRequest(detail string) Error {
	return Error{Type: "about:blank", Title: "Bad Request", Status: http.StatusBadRequest, Detail: detail}
}
func Unauthorized(detail string) Error {
	return Error{Type: "about:blank", Title: "Unauthorized", Status: http.StatusUnauthorized, Detail: detail}
}
func Forbidden(detail string) Error {
	return Error{Type: "about:blank", Title: "Forbidden", Status: http.StatusForbidden, Detail: detail}
}
func NotFound(detail string) Error {
	return Error{Type: "about:blank", Title: "Not Found", Status: http.StatusNotFound, Detail: detail}
}
func Conflict(detail string) Error {
	return Error{Type: "about:blank", Title: "Conflict", Status: http.StatusConflict, Detail: detail}
}

// Shown when no field carries a message.
const genericInvalidPayload = "Data yang dikirim tidak valid. Periksa kembali isian Anda."

// UnprocessableDetail carries prose plus fields.
func UnprocessableDetail(detail string, fields map[string]string) Error {
	return Error{
		Type:   "about:blank",
		Title:  "Unprocessable Entity",
		Status: http.StatusUnprocessableEntity,
		Detail: detail,
		Fields: fields,
	}
}

// Unprocessable pairs field errors with prose. Detail is what the toast reads
// and Fields stays per-field so forms can mark the offending inputs. The two
// must agree, so Detail is built from the field messages rather than a fixed
// sentence that would erase which input failed.
func Unprocessable(fields map[string]string) Error {
	return UnprocessableDetail(fieldsDetail(fields), fields)
}

// Joins field messages, never their keys.
func fieldsDetail(fields map[string]string) string {
	keys := make([]string, 0, len(fields))
	for k, v := range fields {
		if strings.TrimSpace(v) != "" {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return genericInvalidPayload
	}
	// Map order is randomised, so sort to keep the message reproducible.
	sort.Strings(keys)
	msgs := make([]string, 0, len(keys))
	for _, k := range keys {
		msgs = append(msgs, strings.TrimSpace(fields[k]))
	}
	return strings.Join(msgs, "; ")
}
func TooManyRequests(detail string) Error {
	return Error{Type: "about:blank", Title: "Too Many Requests", Status: http.StatusTooManyRequests, Detail: detail}
}
func Internal(detail string) Error {
	return Error{Type: "about:blank", Title: "Internal Server Error", Status: http.StatusInternalServerError, Detail: detail}
}
func ServiceUnavailable(detail string) Error {
	return Error{Type: "about:blank", Title: "Service Unavailable", Status: http.StatusServiceUnavailable, Detail: detail}
}

// FromDBErr maps pg SQLSTATE to HTTP with a curated, non-leaking message.
func FromDBErr(err error) Error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "P0001", "P0012", "P0014":
			// Business-rule message raised intentionally by plpgsql; safe to
			// surface. P0012 invalid transition and P0014 validation are the
			// typed successors assigned by migration 00046. It is prose, not a
			// field error, so it belongs in Detail like P0011 and P0013.
			return UnprocessableDetail(pgErr.Message, nil)
		case "P0011":
			return NotFound(pgErr.Message)
		case "P0013":
			// Blocked by the state of a related record.
			return Conflict(pgErr.Message)
		case "23503":
			return NotFound("referenced record does not exist")
		case "23505":
			return Conflict("a record with these values already exists")
		// The constraint names the column, not the form input, so name the
		// remedy instead of echoing an untranslatable identifier.
		case "23502":
			return UnprocessableDetail("Ada isian wajib yang masih kosong. Lengkapi data lalu simpan kembali.", nil)
		case "23514":
			return UnprocessableDetail("Ada isian yang melanggar aturan validasi. Periksa nilai yang dimasukkan.", nil)
		case "22P02":
			return UnprocessableDetail("Format salah satu isian tidak sesuai. Periksa tanggal, angka, dan pilihan yang dipilih.", nil)
		case "22003":
			return UnprocessableDetail("Nilai angka di luar batas yang diizinkan. Masukkan angka yang lebih kecil.", nil)
		}
	}
	// Never surface raw internal error text to the client; RenderDBErr logs it.
	return Internal("internal server error")
}

// RenderDBErr writes a pg-aware response and logs the real error on a 500.
func RenderDBErr(w http.ResponseWriter, err error) {
	// A deadline is backpressure, not a crash: 503 + Retry-After is retryable
	// and must not page a 5xx alert. Logged Warn, never Error.
	if errors.Is(err, context.DeadlineExceeded) {
		slog.Warn("request deadline exceeded", "error", err.Error())
		w.Header().Set("Retry-After", "2")
		Render(w, ServiceUnavailable("request timed out, please retry"))
		return
	}
	e := FromDBErr(err)
	if e.Status >= http.StatusInternalServerError {
		slog.Error("unhandled server error", "error", err.Error())
	}
	Render(w, e)
}
