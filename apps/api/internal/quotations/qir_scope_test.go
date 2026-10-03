package quotations_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// Request save needs If-Match.
// If-Match is required; a stale one is the standard version conflict.
func TestHandler_UpdateItemRequest_IfMatch(t *testing.T) {
	srv, _ := resetServer(t)
	qid := mustCreate(t, srv)
	cres := doJSON(t, srv, http.MethodPost, idPath(qid, "/requests"),
		map[string]any{"lineNo": 1, "requestText": "LAMP LED 12W"})
	require.Equal(t, http.StatusCreated, cres.StatusCode)
	var created quotations.ItemRequestRow
	decodeBody(t, cres, &created)
	url := srv.URL + idPath(qid, "/requests/"+strconv.FormatInt(created.ID, 10))
	body := `{"lineNo":1,"requestText":"LAMP LED 18W","matchStatus":"pending","sourceType":"manual"}`

	cases := []struct {
		name    string
		ifMatch map[string]string
		status  int
		code    string
	}{
		{"missing", nil, http.StatusBadRequest, ""},
		{"malformed", map[string]string{"If-Match": `"v1"`}, http.StatusBadRequest, ""},
		{"current", map[string]string{"If-Match": "0"}, http.StatusOK, ""},
		{"stale", map[string]string{"If-Match": "0"}, http.StatusConflict, "version_conflict"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doRaw(t, http.MethodPut, url, body, c.ifMatch)
			defer res.Body.Close()
			require.Equal(t, c.status, res.StatusCode)
			if c.code != "" {
				assert.Equal(t, c.code, problemOf(t, res).Code)
			}
		})
	}
}

// Requests answer under their quotation.
func TestHandler_ItemRequests_ScopedToParent(t *testing.T) {
	srv, _ := resetServer(t)
	owner := mustCreate(t, srv)
	other := mustCreate(t, srv)

	cres := doJSON(t, srv, http.MethodPost, idPath(owner, "/requests"),
		map[string]any{"lineNo": 1, "requestText": "LAMP LED 12W"})
	require.Equal(t, http.StatusCreated, cres.StatusCode)
	var created quotations.ItemRequestRow
	decodeBody(t, cres, &created)
	foreign := idPath(other, "/requests/"+strconv.FormatInt(created.ID, 10))

	cases := []struct {
		name, method, body string
		headers            map[string]string
	}{
		{"update", http.MethodPut, `{"lineNo":1,"requestText":"HIJACKED","matchStatus":"pending","sourceType":"manual"}`,
			map[string]string{"If-Match": "0"}},
		{"delete", http.MethodDelete, "", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doRaw(t, c.method, srv.URL+foreign, c.body, c.headers)
			e := problemOf(t, res)
			assert.Equal(t, http.StatusNotFound, res.StatusCode)
			assert.Equal(t, http.StatusNotFound, e.Status)
		})
	}

	var rows []quotations.ItemRequestRow
	getJSON(t, srv, idPath(owner, "/requests"), &rows)
	require.Len(t, rows, 1, "the owner's request survives")
	assert.Equal(t, "LAMP LED 12W", rows[0].RequestText)
	assert.Equal(t, int32(0), rows[0].RowVersion)
}
