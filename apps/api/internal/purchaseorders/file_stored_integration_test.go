package purchaseorders_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// fakeObjects answers stat calls.
type fakeObjects struct {
	found bool
	err   error
	asked []string
}

func (f *fakeObjects) ObjectExists(_ context.Context, bucket, key string) (bool, error) {
	f.asked = append(f.asked, bucket+"/"+key)
	return f.found, f.err
}

// objectsServer mounts routes over objects.
func objectsServer(t *testing.T, exec db.Executor, objects deps.ObjectStore) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(poInjectUser(seedUserID))
	r.Mount("/purchase-orders", purchaseorders.Routes(deps.Deps{
		Pool: exec, Queries: testutil.Store(t), Storage: &storage.Client{}, Objects: objects,
	}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// Attach needs the uploaded object.
// A valid key only says where an upload would land; a PO must never move
// to UPLOADED on a file that never arrived.
func TestHandler_UpdateFile_ObjectMustExist(t *testing.T) {
	cases := []struct {
		name     string
		store    *fakeObjects
		status   int
		detail   string
		field    string
		uploaded bool
	}{
		{
			name:   "storage not configured",
			status: http.StatusServiceUnavailable,
			detail: "Berkas belum bisa disimpan saat ini. Hubungi administrator.",
		},
		{
			name:   "never uploaded",
			store:  &fakeObjects{},
			status: http.StatusUnprocessableEntity,
			detail: "Berkas PO belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
			field:  "Berkas PO belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
		},
		{
			name:   "storage fails",
			store:  &fakeObjects{err: errors.New("minio down")},
			status: http.StatusInternalServerError,
			detail: "internal server error",
		},
		{
			name:     "uploaded",
			store:    &fakeObjects{found: true},
			status:   http.StatusNoContent,
			uploaded: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, tx := testutil.BeginTx(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			var objects deps.ObjectStore
			if tc.store != nil {
				objects = tc.store
			}
			srv := objectsServer(t, tx, objects)
			base := fmt.Sprintf("/purchase-orders/%d", poID)
			file := ownedPOFile(poID)
			sent := file
			sent.ObjectKey = " " + file.ObjectKey + " "

			res := doJSON(t, srv, http.MethodPatch, base+"/file", sent)
			require.Equal(t, tc.status, res.StatusCode)
			if tc.detail != "" {
				p := readProblem(t, res)
				assert.Equal(t, tc.detail, p.Detail)
				assert.Equal(t, tc.field, p.Fields["objectKey"])
			}
			res.Body.Close()
			if tc.store != nil {
				assert.Equal(t, []string{storage.BucketPODocs + "/" + file.ObjectKey}, tc.store.asked)
			}

			res = doJSON(t, srv, http.MethodGet, base, nil)
			var po purchaseorders.PurchaseOrder
			readJSON(t, res, &po)
			res.Body.Close()
			want := purchaseorders.StatusPending
			if tc.uploaded {
				want = purchaseorders.StatusUploaded
			}
			assert.Equal(t, want, po.Status)
			assert.Equal(t, tc.uploaded, po.FileURL != nil, "file attached")
		})
	}
}
