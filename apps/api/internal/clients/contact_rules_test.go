package clients_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// Contacts stay with their client.
func TestHandler_Contact_OtherClientCannotTouchIt(t *testing.T) {
	srv := newSrv(t)
	owner := newClient(t)
	stranger := newClient(t)
	seeded := seedContact(t, owner)

	patch := doJSON(t, srv, http.MethodPatch, contactPath(stranger, seeded.ID),
		map[string]any{"name": "Dibajak", "email": nil})
	patch.Body.Close()
	assert.Equal(t, http.StatusNotFound, patch.StatusCode, "PATCH through another client")

	del := doJSON(t, srv, http.MethodDelete, contactPath(stranger, seeded.ID), nil)
	del.Body.Close()
	assert.Equal(t, http.StatusNotFound, del.StatusCode, "DELETE through another client")

	list := doJSON(t, srv, http.MethodGet, "/clients/"+itoa(owner)+"/contacts", nil)
	defer list.Body.Close()
	require.Equal(t, http.StatusOK, list.StatusCode)
	var got []clients.Contact
	require.NoError(t, json.NewDecoder(list.Body).Decode(&got))
	require.Len(t, got, 1)
	assert.Equal(t, seeded.Name, got[0].Name)
	assert.Equal(t, seeded.Email, got[0].Email)
	assert.True(t, got[0].IsActive)
}

// Deleting twice is 404.
func TestHandler_DeleteContact_Twice(t *testing.T) {
	srv := newSrv(t)
	clientID := newClient(t)
	seeded := seedContact(t, clientID)

	first := doJSON(t, srv, http.MethodDelete, contactPath(clientID, seeded.ID), nil)
	first.Body.Close()
	require.Equal(t, http.StatusNoContent, first.StatusCode)

	again := doJSON(t, srv, http.MethodDelete, contactPath(clientID, seeded.ID), nil)
	again.Body.Close()
	assert.Equal(t, http.StatusNotFound, again.StatusCode)
}

// Malformed contact requests never write.
func TestHandler_Contact_RequestValidation(t *testing.T) {
	srv := newSrv(t)
	clientID := newClient(t)
	seeded := seedContact(t, clientID)
	good := contactPath(clientID, seeded.ID)
	cases := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"patch bad client id", http.MethodPatch, "/clients/x/contacts/1", `{"name":"A"}`, http.StatusBadRequest},
		{"patch bad contact id", http.MethodPatch, "/clients/1/contacts/x", `{"name":"A"}`, http.StatusBadRequest},
		{"patch bad json", http.MethodPatch, good, `{"name":`, http.StatusBadRequest},
		{"patch blank name", http.MethodPatch, good, `{"name":"  \t"}`, http.StatusUnprocessableEntity},
		{"delete bad client id", http.MethodDelete, "/clients/x/contacts/1", "", http.StatusBadRequest},
		{"delete bad contact id", http.MethodDelete, "/clients/1/contacts/x", "", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, err := http.NewRequest(c.method, srv.URL+c.path, strings.NewReader(c.body))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
			assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
		})
	}

	// The seeded contact kept its name.
	list := doJSON(t, srv, http.MethodGet, "/clients/"+itoa(clientID)+"/contacts", nil)
	defer list.Body.Close()
	var got []clients.Contact
	require.NoError(t, json.NewDecoder(list.Body).Decode(&got))
	require.Len(t, got, 1)
	assert.Equal(t, seeded.Name, got[0].Name)
}

// Missing client refuses contacts.
func TestHandler_CreateContact_MissingClient(t *testing.T) {
	res := doJSON(t, newSrv(t), http.MethodPost, "/clients/999999999/contacts",
		clients.CreateContactRequest{Name: "Yatim"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}
