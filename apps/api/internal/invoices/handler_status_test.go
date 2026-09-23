package invoices_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
)

// Input fails before the database.
func TestHandler_ChangeStatus_RejectsBadInput(t *testing.T) {
	str := func(s string) *string { return &s }
	cases := []struct {
		name   string
		body   invoices.ChangeStatusRequest
		detail string
	}{
		{
			name:   "unknown status",
			body:   invoices.ChangeStatusRequest{Status: "INVALID"},
			detail: "Status invoice tidak dikenal.",
		},
		{
			name:   "proof on a non-payment move",
			body:   invoices.ChangeStatusRequest{Status: invoices.StatusSent, PaymentProofKey: str("invoices/1/1700000000-bukti.pdf")},
			detail: "Bukti pembayaran hanya dapat dilampirkan saat invoice ditandai Dibayar.",
		},
		{
			name:   "proof of another invoice",
			body:   invoices.ChangeStatusRequest{Status: invoices.StatusPaid, PaymentProofKey: str("invoices/2/1700000000-bukti.pdf")},
			detail: "Berkas bukti pembayaran tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
		},
		{
			name:   "proof outside the bucket prefix",
			body:   invoices.ChangeStatusRequest{Status: invoices.StatusPaid, PaymentProofKey: str("../po/1/x.pdf")},
			detail: "Berkas bukti pembayaran tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newSrv(t)
			res := doJSON(t, srv, http.MethodPatch, "/invoices/1/status", tc.body)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var problem struct {
				Detail string `json:"detail"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
			assert.Equal(t, tc.detail, problem.Detail)
		})
	}
}
