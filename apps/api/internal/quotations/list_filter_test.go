package quotations_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

// Q-15: bad dates are 422.
// The ::date cast raises 22007 or 22008, which httperr maps to 422.
func TestHandler_List_BadDateFilter(t *testing.T) {
	srv, _ := resetServer(t)
	mustCreate(t, srv)

	cases := []struct {
		name  string
		query string
		want  int
	}{
		{"date only", "dateFrom=2000-01-01&dateTo=2099-12-31", http.StatusOK},
		{"garbage from", "dateFrom=kemarin", http.StatusUnprocessableEntity},
		{"impossible to", "dateTo=2026-02-30", http.StatusUnprocessableEntity},
		{"day first", "dateFrom=31-12-2026", http.StatusUnprocessableEntity},
	}
	for _, path := range []string{"/quotations/", "/quotations/export.xlsx"} {
		for _, c := range cases {
			t.Run(path+" "+c.name, func(t *testing.T) {
				res := doJSON(t, srv, http.MethodGet, path+"?"+c.query, nil)
				if c.want == http.StatusOK {
					res.Body.Close()
					assert.Equal(t, http.StatusOK, res.StatusCode)
					return
				}
				e := problemOf(t, res)
				assert.Equal(t, c.want, res.StatusCode)
				assert.Contains(t, e.Detail, "anggal", "the detail names the date")
			})
		}
	}
}
