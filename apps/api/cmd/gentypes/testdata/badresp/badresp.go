// Package badresp breaks wire rules.
// TestUnnamedResponses_FlagsFixture loads it to prove the scan bites; every
// handler here writes a response shape gentypes cannot name.
package badresp

import (
	"encoding/json"
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// Named is a wire type.
type Named struct {
	ID int64 `json:"id"`
}

// Map literal body.
func MapBody(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Anonymous struct body.
func AnonBody(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, struct {
		ID int64 `json:"id"`
	}{ID: 1})
}

// Map held in a variable.
func MapVar(w http.ResponseWriter, _ *http.Request) {
	body := map[string]int{"n": 1}
	httpx.WriteJSON(w, http.StatusOK, &body)
}

// Slice of anonymous structs.
func AnonList(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteList(w, 1, []struct{ N int }{{N: 1}})
}

// Encoder with a map.
func EncodeMap(w http.ResponseWriter, _ *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]any{"n": 1})
}

// Named types pass.
func NamedBody(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, Named{ID: 1})
	httpx.WriteList(w, 1, []Named{{ID: 1}})
}
