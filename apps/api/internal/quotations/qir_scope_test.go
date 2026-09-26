package quotations_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

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
	}{
		{"update", http.MethodPut, `{"lineNo":1,"requestText":"HIJACKED","matchStatus":"pending","sourceType":"manual"}`},
		{"delete", http.MethodDelete, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doRaw(t, c.method, srv.URL+foreign, c.body, nil)
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
