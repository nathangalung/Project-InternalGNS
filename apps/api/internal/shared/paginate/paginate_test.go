package paginate

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParse(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
	}{
		{"defaults", "", 50, 0},
		{"valid limit", "?limit=10", 10, 0},
		{"valid offset", "?offset=20", 50, 20},
		{"both", "?limit=100&offset=200", 100, 200},
		{"limit zero rejected", "?limit=0", 50, 0},
		{"limit negative rejected", "?limit=-5", 50, 0},
		{"limit over 200 rejected", "?limit=500", 50, 0},
		{"limit at boundary 200", "?limit=200", 200, 0},
		{"limit non-numeric rejected", "?limit=abc", 50, 0},
		{"offset negative rejected", "?offset=-1", 50, 0},
		{"offset non-numeric rejected", "?offset=foo", 50, 0},
		{"offset zero accepted", "?offset=0", 50, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/x"+tc.query, nil)
			gotL, gotO := Parse(r)
			assert.Equal(t, tc.wantLimit, gotL)
			assert.Equal(t, tc.wantOffset, gotO)
		})
	}
}

func TestParseLimit(t *testing.T) {
	cases := []struct {
		name  string
		query string
		def   int
		want  int
	}{
		{"missing returns default", "", 10, 10},
		{"valid", "?limit=25", 10, 25},
		{"zero rejected", "?limit=0", 10, 10},
		{"negative rejected", "?limit=-1", 10, 10},
		{"over max rejected", "?limit=500", 10, 10},
		{"at max boundary accepted", "?limit=200", 10, 200},
		{"non-numeric rejected", "?limit=abc", 10, 10},
		{"default of 5 honored", "", 5, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/x"+tc.query, nil)
			assert.Equal(t, tc.want, ParseLimit(r, tc.def))
		})
	}
}
