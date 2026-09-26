package invoices_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// fakeProofs stores objects in memory.
type fakeProofs struct {
	keys  map[string]bool
	err   error
	asked []string
}

func (f *fakeProofs) ObjectExists(_ context.Context, bucket, key string) (bool, error) {
	f.asked = append(f.asked, bucket+"/"+key)
	return f.keys[key], f.err
}

// Payment records only uploaded proofs.
// The checks run before the database, which FaultyServer makes fail, so a
// 500 on the "uploaded" row means the proof passed and the repo was reached.
func TestHandler_ChangeStatus_ProofMustExist(t *testing.T) {
	const uploaded = "invoices/1/payment/1700000000-bukti.pdf"
	cases := []struct {
		name   string
		store  *fakeProofs
		key    string
		status int
		detail string
		asked  bool
	}{
		{
			name:   "storage not configured",
			key:    uploaded,
			status: http.StatusServiceUnavailable,
			detail: "Penyimpanan berkas belum dikonfigurasi.",
		},
		{
			name:   "the attachment folder",
			store:  &fakeProofs{keys: map[string]bool{"invoices/1/1700000000-bukti.pdf": true}},
			key:    "invoices/1/1700000000-bukti.pdf",
			status: http.StatusUnprocessableEntity,
			detail: "Berkas bukti pembayaran tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
		},
		{
			name:   "never uploaded",
			store:  &fakeProofs{},
			key:    uploaded,
			status: http.StatusUnprocessableEntity,
			detail: "Berkas bukti pembayaran belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
			asked:  true,
		},
		{
			name:   "storage fails",
			store:  &fakeProofs{err: errors.New("minio down")},
			key:    uploaded,
			status: http.StatusInternalServerError,
			asked:  true,
		},
		{
			name:   "uploaded",
			store:  &fakeProofs{keys: map[string]bool{uploaded: true}},
			key:    uploaded,
			status: http.StatusInternalServerError,
			asked:  true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := testutil.FaultyServer(t, seedUserID, func(r chi.Router, d deps.Deps) {
				var proofs invoices.ProofStore
				if tc.store != nil {
					proofs = tc.store
				}
				r.Mount("/invoices", invoices.RoutesWithProofs(d, proofs))
			})
			key := tc.key
			res := doJSON(t, srv, http.MethodPatch, "/invoices/1/status",
				invoices.ChangeStatusRequest{Status: invoices.StatusPaid, PaymentProofKey: &key})
			defer res.Body.Close()
			require.Equal(t, tc.status, res.StatusCode)
			if tc.detail != "" {
				var problem struct {
					Detail string `json:"detail"`
				}
				require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
				assert.Equal(t, tc.detail, problem.Detail)
			}
			if tc.store != nil {
				assert.Equal(t, tc.asked, len(tc.store.asked) == 1, "stat calls %v", tc.store.asked)
			}
		})
	}
}

// No proof means no storage.
func TestHandler_ChangeStatus_NoProofSkipsStorage(t *testing.T) {
	srv := testutil.FaultyServer(t, seedUserID, func(r chi.Router, d deps.Deps) {
		r.Mount("/invoices", invoices.RoutesWithProofs(d, nil))
	})
	res := doJSON(t, srv, http.MethodPatch, "/invoices/1/status", invoices.ChangeStatusRequest{Status: invoices.StatusPaid})
	defer res.Body.Close()
	assert.Equal(t, http.StatusInternalServerError, res.StatusCode, "reaches the failing repo, not a storage 503")
}
