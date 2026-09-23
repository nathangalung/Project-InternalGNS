package clients_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// Attach binds the key to its record (MD-14).
func TestHandler_UpdateLogo_RejectsForeignKey(t *testing.T) {
	srv := newSrv(t)
	cases := []struct {
		name string
		key  string
	}{
		{"another record", "clients/2/x.png"},
		{"another entity", "vendors/1/x.png"},
		{"path traversal", "../../etc/x.png"},
		{"prefix only", "clients/1/"},
		{"disallowed extension", "clients/1/x.exe"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPatch, "/clients/1/logo",
				clients.UpdateLogoRequest{ObjectKey: c.key})
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode, "client logo key %q", c.key)
		})
	}
}
