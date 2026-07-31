package httperr

import (
	"encoding/json"
	"errors"
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

// FromDBErr maps pg SQLSTATE to HTTP.
func FromDBErr(err error) Error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "P0001":
			return Unprocessable(map[string]string{"db": pgErr.Message})
		case "23503":
			return NotFound(pgErr.Message)
		case "23505":
			return Conflict(pgErr.Message)
		case "23502", "23514", "22P02", "22003":
			return Unprocessable(map[string]string{"db": pgErr.Message})
		}
	}
	return Internal(err.Error())
}

// RenderDBErr writes pg-aware error response.
func RenderDBErr(w http.ResponseWriter, err error) {
	Render(w, FromDBErr(err))
}
