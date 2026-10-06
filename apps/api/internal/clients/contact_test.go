package clients_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// seedContact posts a titled contact.
// The contact has an email and a title.
func seedContact(t *testing.T, clientID int64) clients.Contact {
	t.Helper()
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/clients/"+strconv.FormatInt(clientID, 10)+"/contacts",
		map[string]any{
			"name":  "Kontak Uji",
			"email": fmt.Sprintf("kontak.%d@uji.local", time.Now().UnixNano()),
			"title": "Purchasing",
		})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var c clients.Contact
	require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
	require.NotNil(t, c.Email)
	require.NotNil(t, c.Title)
	return c
}

func contactPath(clientID, contactID int64) string {
	return "/clients/" + strconv.FormatInt(clientID, 10) + "/contacts/" + strconv.FormatInt(contactID, 10)
}

// PATCH clears null, keeps absent.
// A null or blank field is cleared; an absent one is kept (MD-06).
func TestHandler_UpdateContact_ClearsEmailAndTitle(t *testing.T) {
	cases := []struct {
		name      string
		patch     map[string]any
		wantEmail bool
		wantTitle bool
	}{
		{"absent keeps both", map[string]any{}, true, true},
		{"null email clears it", map[string]any{"email": nil}, false, true},
		{"blank email clears it", map[string]any{"email": "  "}, false, true},
		{"null title clears it", map[string]any{"title": nil}, true, false},
		{"blank title clears it", map[string]any{"title": ""}, true, false},
		{"both cleared", map[string]any{"email": "", "title": nil}, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clientID := newClient(t)
			seeded := seedContact(t, clientID)
			// The phone keeps the contact reachable once the email goes.
			body := map[string]any{"name": "Kontak Uji", "phone": "81234567890"}
			for k, v := range c.patch {
				body[k] = v
			}
			res := doJSON(t, newSrv(t), http.MethodPatch, contactPath(clientID, seeded.ID), body)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var got clients.Contact
			require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
			if c.wantEmail {
				require.NotNil(t, got.Email)
				assert.Equal(t, *seeded.Email, *got.Email)
			} else {
				assert.Nil(t, got.Email)
			}
			if c.wantTitle {
				require.NotNil(t, got.Title)
				assert.Equal(t, *seeded.Title, *got.Title)
			} else {
				assert.Nil(t, got.Title)
			}
		})
	}
}

// Deleted contacts reject edits.
// A soft-deleted contact is gone for edits (MD-07).
func TestHandler_UpdateContact_DeletedIsNotFound(t *testing.T) {
	srv := newSrv(t)
	clientID := newClient(t)
	seeded := seedContact(t, clientID)

	del := doJSON(t, srv, http.MethodDelete, contactPath(clientID, seeded.ID), nil)
	del.Body.Close()
	require.Equal(t, http.StatusNoContent, del.StatusCode)

	res := doJSON(t, srv, http.MethodPatch, contactPath(clientID, seeded.ID),
		map[string]any{"name": "Hidup Lagi"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

// Deleted contacts free their email.
// It covers MD-08.
func TestHandler_CreateContact_ReusesDeletedEmail(t *testing.T) {
	srv := newSrv(t)
	clientID := newClient(t)
	seeded := seedContact(t, clientID)

	del := doJSON(t, srv, http.MethodDelete, contactPath(clientID, seeded.ID), nil)
	del.Body.Close()
	require.Equal(t, http.StatusNoContent, del.StatusCode)

	res := doJSON(t, srv, http.MethodPost, "/clients/"+strconv.FormatInt(clientID, 10)+"/contacts",
		map[string]any{"name": "Pemilik Baru", "email": *seeded.Email})
	defer res.Body.Close()
	assert.Equal(t, http.StatusCreated, res.StatusCode)
}

// Emails are unique per client.
// One person may be the contact of two clients of the same group, so another
// client's active contact never blocks the email. Within one client an
// active contact still owns it, in any case.
func TestHandler_ContactEmail_UniquePerClient(t *testing.T) {
	srv := newSrv(t)
	firstClient := newClient(t)
	seeded := seedContact(t, firstClient)

	otherClient := newClient(t)
	res := doJSON(t, srv, http.MethodPost, "/clients/"+strconv.FormatInt(otherClient, 10)+"/contacts",
		map[string]any{"name": "Kontak Grup", "email": strings.ToUpper(*seeded.Email)})
	defer res.Body.Close()
	assert.Equal(t, http.StatusCreated, res.StatusCode)

	dup := doJSON(t, srv, http.MethodPost, "/clients/"+strconv.FormatInt(firstClient, 10)+"/contacts",
		map[string]any{"name": "Penyalin", "email": strings.ToUpper(*seeded.Email)})
	defer dup.Body.Close()
	requireEmailTaken(t, dup)

	kept := seedContact(t, firstClient)
	upd := doJSON(t, srv, http.MethodPatch, contactPath(firstClient, kept.ID),
		map[string]any{"name": kept.Name, "email": *seeded.Email, "countryCode": "IDN"})
	defer upd.Body.Close()
	requireEmailTaken(t, upd)
}

// requireEmailTaken expects the email field.
func requireEmailTaken(t *testing.T, res *http.Response) {
	t.Helper()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	var p httperr.Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	assert.Equal(t, map[string]string{
		"email": "Email ini sudah dipakai kontak lain di klien ini.",
	}, p.Fields)
}
