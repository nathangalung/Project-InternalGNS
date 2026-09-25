package items_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
)

// Attach binds keys to records.
// It covers MD-14.
func TestHandler_UpdateImage_RejectsForeignKey(t *testing.T) {
	srv := newSrv(t)
	cases := []struct {
		name string
		key  string
	}{
		{"another record", "items/2/x.png"},
		{"another entity", "clients/1/x.png"},
		{"path traversal", "../../etc/x.png"},
		{"prefix only", "items/1/"},
		{"disallowed extension", "items/1/x.exe"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPatch, "/items/1/image",
				items.UpdateImageRequest{ObjectKey: c.key})
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode, "item image key %q", c.key)
		})
	}
}
