package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	payload := map[string]any{"id": 7, "ok": true}
	WriteJSON(rec, http.StatusCreated, payload)

	res := rec.Result()
	defer res.Body.Close()
	assert.Equal(t, http.StatusCreated, res.StatusCode)
	assert.Equal(t, "application/json", res.Header.Get("Content-Type"))

	var got map[string]any
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.EqualValues(t, 7, got["id"])
	assert.Equal(t, true, got["ok"])
}

func TestWriteJSON_NilBody(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, nil)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "null\n", rec.Body.String())
}
