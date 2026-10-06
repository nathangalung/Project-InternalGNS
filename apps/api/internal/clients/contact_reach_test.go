package clients_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// legacyContact inserts an unreachable contact.
// Imported rows may carry neither an email nor a phone.
func legacyContact(t *testing.T, clientID int64) int64 {
	t.Helper()
	var id int64
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(), `
		INSERT INTO company_contacts (company_id, name, created_by, updated_by)
		VALUES ($1, 'Kontak Lama', $2, $2) RETURNING id`, clientID, seedUserID).Scan(&id))
	return id
}

// Contacts need an email or phone.
// Create, and a PATCH whose result would have neither, are a 422 on both
// fields; a stored email or phone the body leaves out still counts.
func TestHandler_Contact_NeedsEmailOrPhone(t *testing.T) {
	need := map[string]string{"email": clients.MsgContactReach, "phone": clients.MsgContactReach}
	srv := newSrv(t)
	clientID := newClient(t)
	contacts := "/clients/" + itoa(clientID) + "/contacts"
	withEmail := seedContact(t, clientID)
	legacy := legacyContact(t, clientID)

	cases := []struct {
		name   string
		method string
		path   string
		body   map[string]any
		status int
	}{
		{"create name only", http.MethodPost, contacts,
			map[string]any{"name": "Tanpa Kontak"}, http.StatusUnprocessableEntity},
		{"create blank email", http.MethodPost, contacts,
			map[string]any{"name": "Tanpa Kontak", "email": "  "}, http.StatusUnprocessableEntity},
		{"create phone only", http.MethodPost, contacts,
			map[string]any{"name": "Lewat HP", "phone": "81234567890"}, http.StatusCreated},
		{"patch clears the only email", http.MethodPatch, contactPath(clientID, withEmail.ID),
			map[string]any{"name": "Kontak Uji", "email": nil}, http.StatusUnprocessableEntity},
		{"patch keeps the stored email", http.MethodPatch, contactPath(clientID, withEmail.ID),
			map[string]any{"name": "Kontak Uji"}, http.StatusOK},
		{"rename a legacy contact", http.MethodPatch, contactPath(clientID, legacy),
			map[string]any{"name": "Kontak Lama Baru"}, http.StatusUnprocessableEntity},
		{"legacy contact gets a phone", http.MethodPatch, contactPath(clientID, legacy),
			map[string]any{"name": "Kontak Lama", "phone": "81234567891"}, http.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			require.Equal(t, c.status, res.StatusCode)
			if c.status != http.StatusUnprocessableEntity {
				return
			}
			var p httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, need, p.Fields)
		})
	}
}

// Unreachable contacts can be deleted.
// The rule guards saves, never the removal of an imported row.
func TestHandler_Contact_DeleteUnreachable(t *testing.T) {
	clientID := newClient(t)
	res := doJSON(t, newSrv(t), http.MethodDelete, contactPath(clientID, legacyContact(t, clientID)), nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
}
