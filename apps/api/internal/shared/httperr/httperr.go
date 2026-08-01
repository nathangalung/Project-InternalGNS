package httperr

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

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
func Unprocessable(fields map[string]string) Error {
	return Error{Type: "about:blank", Title: "Unprocessable Entity", Status: http.StatusUnprocessableEntity, Fields: fields}
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
		case "P0001":
			// Business-rule message raised intentionally by plpgsql; safe to surface.
			return Unprocessable(map[string]string{"db": pgErr.Message})
		case "23503":
			return NotFound("referenced record does not exist")
		case "23505":
			return Conflict("a record with these values already exists")
		case "23502", "23514", "22P02", "22003":
			return Unprocessable(map[string]string{"field": "invalid value"})
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
