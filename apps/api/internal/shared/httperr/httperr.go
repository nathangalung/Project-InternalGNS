package httperr

import (
	"encoding/json"
	"net/http"
)

// Error is the wire shape returned to clients (RFC 7807-ish).
type Error struct {
	Type     string            `json:"type"`
	Title    string            `json:"title"`
	Status   int               `json:"status"`
	Detail   string            `json:"detail,omitempty"`
	Instance string            `json:"instance,omitempty"`
	Fields   map[string]string `json:"fields,omitempty"`
}

func (e Error) Error() string { return e.Title + ": " + e.Detail }

// Render writes an Error as application/problem+json.
func Render(w http.ResponseWriter, e Error) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(e)
}

// Builders
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
func Internal(detail string) Error {
	return Error{Type: "about:blank", Title: "Internal Server Error", Status: http.StatusInternalServerError, Detail: detail}
}
