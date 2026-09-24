package clients_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Every write and read fails closed.
func TestHandler_DBFailureIsGenericProblem(t *testing.T) {
	srv := mountedSrv(t, testutil.FakeExec{})
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"summary", http.MethodGet, "/clients/summary", nil},
		{"update", http.MethodPut, "/clients/1",
			clients.UpdateClientRequest{Name: "PT Gagal", CountryCode: "IDN", IsActive: true}},
		{"update contact", http.MethodPatch, "/clients/1/contacts/1", map[string]any{"name": "Gagal"}},
		{"delete contact", http.MethodDelete, "/clients/1/contacts/1", nil},
		{"logo upload url", http.MethodGet, "/clients/1/logo/upload-url?fileName=a.png", nil},
		{"logo download url", http.MethodGet, "/clients/1/logo/download-url", nil},
		{"logo attach", http.MethodPatch, "/clients/1/logo", clients.UpdateLogoRequest{ObjectKey: "clients/1/a.png"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// The parent check passes, then the read fails.
func TestHandler_SecondQueryFailure(t *testing.T) {
	id := strconv.FormatInt(newClient(t), 10)
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"list data after count", http.MethodGet, "/clients/?q=PT", nil},
		{"contacts after parent", http.MethodGet, "/clients/" + id + "/contacts", nil},
		{"logo key after parent", http.MethodPatch, "/clients/" + id + "/logo",
			clients.UpdateLogoRequest{ObjectKey: "clients/" + id + "/a.png"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}
			res := doJSON(t, mountedSrv(t, exec), c.method, c.path, c.body)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// A failed recheck is not a lock.
func TestRepo_Update_RecheckFailureIsNotNumberLocked(t *testing.T) {
	exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1}
	repo := clients.NewRepo(exec, testutil.Store(t))
	_, err := repo.Update(context.Background(), 999999999,
		clients.UpdateClientRequest{Name: "PT Hilang", CountryCode: "IDN"}, seedUserID)
	require.ErrorIs(t, err, testutil.ErrFake)
	assert.NotErrorIs(t, err, clients.ErrNumberLocked)
	assert.NotErrorIs(t, err, clients.ErrNotFound)
}

// Repo surfaces executor failures.
func TestRepo_MoreErrorPaths(t *testing.T) {
	r := clients.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	ctx := context.Background()
	cases := []struct {
		name string
		call func() error
	}{
		{"update", func() error {
			_, err := r.Update(ctx, 1, clients.UpdateClientRequest{Name: "x"}, 1)
			return err
		}},
		{"summary", func() error { _, err := r.Summary(ctx); return err }},
		{"get by ids", func() error { _, err := r.GetByIDs(ctx, []int64{1}); return err }},
		{"update logo", func() error { return r.UpdateLogo(ctx, 1, "clients/1/a.png", 1) }},
		{"update contact", func() error {
			_, err := r.UpdateContact(ctx, 1, 1, clients.UpdateContactRequest{Name: "x"}, 1)
			return err
		}},
		{"deactivate contact", func() error { return r.DeactivateContact(ctx, 1, 1, 1) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.ErrorIs(t, c.call(), testutil.ErrFake)
		})
	}
}
