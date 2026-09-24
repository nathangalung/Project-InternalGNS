package vendors_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
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
		{"update", http.MethodPut, "/vendors/1", vendors.UpdateVendorRequest{Name: "CV Gagal", IsActive: true}},
		{"logo upload url", http.MethodGet, "/vendors/1/logo/upload-url?fileName=a.png", nil},
		{"logo download url", http.MethodGet, "/vendors/1/logo/download-url", nil},
		{"logo attach", http.MethodPatch, "/vendors/1/logo", vendors.UpdateLogoRequest{ObjectKey: "vendors/1/a.png"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// Later queries fail after earlier ones pass.
func TestHandler_LaterQueryFailure(t *testing.T) {
	vendorID, _ := seedVendorWithItems(t, 1)
	cases := []struct {
		name      string
		failAfter int
		method    string
		path      string
		body      any
	}{
		{"list data after count", 1, http.MethodGet, "/vendors/?q=a", nil},
		{"items count after parent", 1, http.MethodGet, vendorPath(vendorID, "/items"), nil},
		{"items rows after count", 2, http.MethodGet, vendorPath(vendorID, "/items"), nil},
		{"logo key after parent", 1, http.MethodPatch, vendorPath(vendorID, "/logo"),
			vendors.UpdateLogoRequest{ObjectKey: fmt.Sprintf("vendors/%d/a.png", vendorID)}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			exec := &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: c.failAfter}
			res := doJSON(t, mountedSrv(t, exec), c.method, c.path, c.body)
			defer res.Body.Close()
			assertInternalProblem(t, res)
		})
	}
}

// Repo surfaces executor failures.
func TestRepo_MoreErrorPaths(t *testing.T) {
	r := vendors.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	ctx := context.Background()
	cases := []struct {
		name string
		call func() error
	}{
		{"update", func() error {
			_, err := r.Update(ctx, 1, vendors.UpdateVendorRequest{Name: "x"}, 1)
			return err
		}},
		{"update logo", func() error { return r.UpdateLogo(ctx, 1, "vendors/1/a.png", 1) }},
		{"list items", func() error { _, err := r.ListItems(ctx, 1, 10, 0); return err }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.ErrorIs(t, c.call(), testutil.ErrFake)
		})
	}
}
