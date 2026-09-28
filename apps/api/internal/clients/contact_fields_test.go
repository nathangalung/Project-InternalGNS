package clients_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// Contact fields fail per field.
// A bad phone or email is a 422 naming the input, never the generic CHECK
// message, and nothing is written.
func TestHandler_ContactFields_FieldLevel422(t *testing.T) {
	const thirteen = "8123456789012"
	srv := newSrv(t)
	clientID := newClient(t)
	seeded := seedContact(t, clientID)
	clientPath := "/clients/" + itoa(clientID)
	contacts := clientPath + "/contacts"
	patch := contactPath(clientID, seeded.ID)

	cases := []struct {
		name   string
		method string
		path   string
		body   map[string]any
		want   map[string]string
	}{
		{"create client bad email", http.MethodPost, "/clients/",
			map[string]any{"name": "PT Surel Salah", "email": "tata@usaha"},
			map[string]string{"email": validate.EmailMessage}},
		{"update client bad email", http.MethodPut, clientPath,
			map[string]any{"name": "PT Surel Salah", "email": "tata usaha@x.id", "isActive": true},
			map[string]string{"email": validate.EmailMessage}},
		{"create contact 13 digit phone", http.MethodPost, contacts,
			map[string]any{"name": "Kontak", "phone": thirteen},
			map[string]string{"phone": validate.PhoneMessage}},
		{"create contact 8 digit phone", http.MethodPost, contacts,
			map[string]any{"name": "Kontak", "phone": "81234567"},
			map[string]string{"phone": validate.PhoneMessage}},
		{"create contact blank phone", http.MethodPost, contacts,
			map[string]any{"name": "Kontak", "phone": ""},
			map[string]string{"phone": validate.PhoneMessage}},
		{"create contact bad email", http.MethodPost, contacts,
			map[string]any{"name": "Kontak", "email": "kontak@x"},
			map[string]string{"email": validate.EmailMessage}},
		{"create contact both bad", http.MethodPost, contacts,
			map[string]any{"name": "Kontak", "phone": thirteen, "email": "kontak@x"},
			map[string]string{"phone": validate.PhoneMessage, "email": validate.EmailMessage}},
		{"patch contact 13 digit phone", http.MethodPatch, patch,
			map[string]any{"name": "Kontak", "phone": thirteen},
			map[string]string{"phone": validate.PhoneMessage}},
		{"patch contact bad email", http.MethodPatch, patch,
			map[string]any{"name": "Kontak", "email": "kontak@x"},
			map[string]string{"email": validate.EmailMessage}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var p httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, c.want, p.Fields)
		})
	}

	// Nothing was written.
	list := doJSON(t, srv, http.MethodGet, contacts, nil)
	defer list.Body.Close()
	var got []struct {
		Name  string  `json:"name"`
		Email *string `json:"email"`
		Phone *string `json:"phone"`
	}
	require.NoError(t, json.NewDecoder(list.Body).Decode(&got))
	require.Len(t, got, 1)
	assert.Equal(t, seeded.Name, got[0].Name)
	assert.Equal(t, seeded.Email, got[0].Email)
	assert.Nil(t, got[0].Phone)
}

// Valid contact fields still save.
// The email is checked trimmed, since the SQL stores it trimmed, and a
// phone at either bound passes.
func TestHandler_ContactFields_ValidSaves(t *testing.T) {
	srv := newSrv(t)
	clientID := newClient(t)
	email := fmt.Sprintf("kontak.%d@uji.co.id", time.Now().UnixNano())

	res := doJSON(t, srv, http.MethodPost, "/clients/"+itoa(clientID)+"/contacts",
		map[string]any{"name": "Kontak", "phone": "0812-3456-7890", "email": "  " + email + "  "})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var c struct {
		ID    int64   `json:"id"`
		Email *string `json:"email"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
	require.NotNil(t, c.Email)
	assert.Equal(t, email, *c.Email)

	for _, phone := range []string{"812345678", "812345678901"} {
		up := doJSON(t, srv, http.MethodPatch, contactPath(clientID, c.ID),
			map[string]any{"name": "Kontak", "phone": phone})
		up.Body.Close()
		assert.Equal(t, http.StatusOK, up.StatusCode, phone)
	}
}
